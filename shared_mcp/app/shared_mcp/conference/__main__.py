"""Serve the conference pack locally as a no-auth, stateless Streamable HTTP MCP route.

    cd shared_mcp/app
    python -m shared_mcp.conference --port 8787

The route is http://127.0.0.1:8787/mcp/conference, the same path the shared no-auth
MCP service would use. Foundry calls MCP servers from the cloud, so expose this port
with a Dev Tunnel for a live voice test (see the pack README). Pass --allowed-host for
the tunnel host name, or --allowed-host '*' to accept any Host header.
"""

from __future__ import annotations

import argparse
import logging
import os

import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse

from .pack import register

ROUTE = "/mcp/conference"


def build_app(allowed_hosts: list[str]) -> Starlette:
    mcp = FastMCP("conference_mcp", stateless_http=True, json_response=True)
    mcp.settings.streamable_http_path = ROUTE
    any_host = "*" in allowed_hosts
    mcp.settings.transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=not any_host,
        allowed_hosts=[] if any_host else ["127.0.0.1:*", "localhost:*", *allowed_hosts],
        allowed_origins=[] if any_host else ["http://127.0.0.1:*", "http://localhost:*"],
    )
    register(mcp)

    @mcp.custom_route("/healthz", methods=["GET"])
    async def healthz(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "route": ROUTE})

    return mcp.streamable_http_app()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--allowed-host", action="append", default=[], help="Extra Host header to accept, or '*'.")
    parser.add_argument("--live-refresh-minutes", type=float, default=None,
                        help="Refresh sessions from the public catalog every N minutes (0 = snapshot only).")
    args = parser.parse_args()
    if args.live_refresh_minutes is not None:
        os.environ["CONFERENCE_LIVE_REFRESH_MINUTES"] = str(args.live_refresh_minutes)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    uvicorn.run(build_app(args.allowed_host), host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
