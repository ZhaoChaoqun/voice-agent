# Copyright (c) Microsoft. All rights reserved.
"""Run the unchanged portal on loopback plus nginx as the public listener.

If either process exits, stop the other and exit, so Container Apps restarts the
replica instead of leaving nginx answering 502 for a dead portal.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time

PORTAL = [sys.executable, "/app/portal/demo_server.py", "--no-record-sessions"]
NGINX = ["nginx", "-e", "/dev/stderr", "-c", "/app/portal/deploy/aca/nginx.conf", "-g", "daemon off;"]


def main() -> int:
    if os.getenv("VOICE_PORTAL_RECORD_SESSIONS", "false").lower() in {"1", "true", "yes"}:
        PORTAL[-1] = "--record-sessions"
    children = [subprocess.Popen(PORTAL), subprocess.Popen(NGINX)]
    stopping = False

    def stop(*_args) -> None:
        nonlocal stopping
        stopping = True
        for child in children:
            if child.poll() is None:
                child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while True:
        for child in children:
            code = child.poll()
            if code is None:
                continue
            if not stopping:
                print(f"[supervise] {child.args[0]} exited with {code}; stopping", flush=True)
            stop()
            deadline = time.monotonic() + 20
            for other in children:
                try:
                    other.wait(timeout=max(0.1, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    other.kill()
            return 0 if stopping and code in (0, -signal.SIGTERM) else (code or 1)
        time.sleep(0.5)


if __name__ == "__main__":
    sys.exit(main())
