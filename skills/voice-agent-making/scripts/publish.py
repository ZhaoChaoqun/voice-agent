"""Publish an agent.json to a Foundry project as a new agent version.

Example:
    export AZURE_AI_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
    python publish.py ../examples/customer_support/agent.json --name my-support-agent
"""

from __future__ import annotations

import argparse
from pathlib import Path

from va_common import fingerprint, load_agent, publish


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("agent_file", type=Path, help="Path to an agent.json file.")
    parser.add_argument("--name", help="Agent name in the project (default: the file's name field).")
    parser.add_argument("--model", help="Override definition.model, for example gpt-realtime.")
    parser.add_argument("--mcp-url", help="Use this MCP server URL for every MCP tool.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print, do not publish.")
    args = parser.parse_args()

    file_name, description, definition = load_agent(args.agent_file, mcp_url=args.mcp_url, model=args.model)
    name = args.name or file_name
    if not name:
        parser.error("Pass --name or set name in the agent file.")
    nodes = [node["id"] for node in (definition.get("subagent_config") or {}).get("subagents") or []]
    print(f"agent:       {name}")
    print(f"model:       {definition.get('model')}")
    print(f"nodes:       {', '.join(nodes) if nodes else '(flat, no handoff)'}")
    print(f"fingerprint: {fingerprint(definition)}")
    if args.dry_run:
        return
    version = publish(name, definition, description)
    print(f"published:   {name}:{version} (read back and matched)")
    print(f"\nTry it:  python chat.py --agent {name} --say \"Hi, I need some help.\"")


if __name__ == "__main__":
    main()
