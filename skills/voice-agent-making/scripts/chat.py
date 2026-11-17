"""Talk to a published agent with text turns and see nodes, tools, and replies.

Examples:
    python chat.py --agent my-support-agent --say "My API calls return 401 errors."
    python chat.py --agent my-support-agent          # type turns; empty line to stop
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from va_common import print_turn, run_session


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent", required=True, help="Published agent name.")
    parser.add_argument("--say", action="append", default=[], help="One caller turn; repeat for more.")
    parser.add_argument("--timeout", type=float, default=45.0, help="Seconds of silence that count as a stall.")
    parser.add_argument("--save", type=Path, help="Write the session record to this JSON file.")
    args = parser.parse_args()

    turns = list(args.say)
    if not turns:
        print("Type one caller turn per line; an empty line starts the call.")
        while (line := input("caller> ").strip()):
            turns.append(line)
    session = asyncio.run(run_session(args.agent, turns, timeout=args.timeout))
    for index, record in enumerate(session["turns"]):
        print_turn(index, record)
    print(f"\nconversation_id: {session['conversation_id']}")
    if args.save:
        args.save.write_text(json.dumps(session, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
