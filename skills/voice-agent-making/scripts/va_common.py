"""Shared helpers: load an agent.json, publish it, and drive text sessions."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse, urlunparse

# Public no-auth MCP server with fictional data, used by the bundled examples.
MOCK_MCP_URL = (
    "https://voice-agent-noauth-mcp.lemonsky-36682081.westus2.azurecontainerapps.io"
    "/mcp/mock-tool-call"
)
TOKEN_SCOPE = "https://ai.azure.com/.default"
VOICE_AGENT_FEATURE = "VoiceAgents=V1Preview"
API_VERSION = "v1"
TEXT_DELTA_EVENTS = {
    "response.audio_transcript.delta",
    "response.output_audio_transcript.delta",
    "response.output_text.delta",
}
# Output item types that call a tool; end_conversation arrives as "system_tool".
TOOL_ITEM_TYPES = {"mcp_call", "function_call", "system_tool"}


def project_endpoint() -> str:
    endpoint = os.getenv("AZURE_AI_PROJECT_ENDPOINT", "").strip().rstrip("/")
    if not endpoint.startswith("https://"):
        raise SystemExit(
            "Set AZURE_AI_PROJECT_ENDPOINT to your Foundry project endpoint, for example "
            "https://<resource>.services.ai.azure.com/api/projects/<project>."
        )
    return endpoint


def _use_cli_credential() -> bool:
    # Set AZURE_CREDENTIAL_MODE=cli on a machine whose managed identity would
    # otherwise be picked before your `az login` user.
    return os.getenv("AZURE_CREDENTIAL_MODE", "default").strip().lower() == "cli"


def sync_credential() -> Any:
    from azure.identity import AzureCliCredential, DefaultAzureCredential

    return AzureCliCredential() if _use_cli_credential() else DefaultAzureCredential()


def async_credential() -> Any:
    from azure.identity.aio import AzureCliCredential, DefaultAzureCredential

    return AzureCliCredential() if _use_cli_credential() else DefaultAzureCredential()


def _mcp_tools(definition: dict[str, Any]) -> list[dict[str, Any]]:
    tools = list(definition.get("tools") or [])
    for node in (definition.get("subagent_config") or {}).get("subagents") or []:
        tools.extend(node.get("tools") or [])
    return [tool for tool in tools if isinstance(tool, dict) and tool.get("type") == "mcp"]


def load_agent(
    path: Path,
    *,
    mcp_url: str | None = None,
    model: str | None = None,
) -> tuple[str, str, dict[str, Any]]:
    """Return (name, description, definition) with every MCP server URL filled in."""
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    definition = copy.deepcopy(document["definition"])
    if definition.get("kind") != "voice":
        raise SystemExit(f"{path}: definition.kind must be 'voice'.")
    if model:
        definition["model"] = model
    for tool in _mcp_tools(definition):
        if mcp_url:
            tool["server_url"] = mcp_url
        elif not tool.get("server_url"):
            if tool.get("server_label") != "mock_tool_call":
                raise SystemExit(
                    f"{path}: MCP server '{tool.get('server_label')}' has no server_url; "
                    "pass --mcp-url."
                )
            tool["server_url"] = MOCK_MCP_URL
    return str(document.get("name") or ""), str(document.get("description") or ""), definition


def fingerprint(definition: dict[str, Any]) -> str:
    """Short hash of a definition: equal fingerprints mean identical content."""
    canonical = json.dumps(definition, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _plain(value: Any) -> Any:
    if hasattr(value, "as_dict"):
        return value.as_dict()
    return value


def _prompts(definition: dict[str, Any]) -> list[Any]:
    nodes = (definition.get("subagent_config") or {}).get("subagents") or []
    return [definition.get("instructions")] + [
        (node.get("id"), node.get("instructions")) for node in nodes
    ]


def publish(name: str, definition: dict[str, Any], description: str = "") -> str:
    """Create a new immutable version of the agent, read it back, and return the version."""
    from azure.ai.projects import AIProjectClient

    with sync_credential() as credential, AIProjectClient(
        endpoint=project_endpoint(), credential=credential, allow_preview=True
    ) as client:
        created = client.agents.create_version(
            name, {"definition": definition, "description": description}
        )
        version = str(getattr(created, "version", None) or _plain(created).get("version"))
        if hasattr(client.agents, "enable"):
            client.agents.enable(name)
        readback = _plain(client.agents.get_version(name, version))
    stored = _plain(readback.get("definition") if isinstance(readback, dict) else readback.definition)
    if stored.get("model") != definition.get("model") or _prompts(stored) != _prompts(definition):
        raise SystemExit(f"Read-back of {name}:{version} does not match the published definition.")
    return version


def _voice_url(agent_name: str) -> str:
    parsed = urlparse(project_endpoint())
    path = f"{parsed.path.rstrip('/')}/agents/{quote(agent_name, safe='')}/endpoint/protocols/voice"
    query = f"api-version={API_VERSION}&agent_session_id=skill-{uuid.uuid4().hex}"
    return urlunparse(("wss", parsed.netloc, path, "", query, ""))


def _event(kind: str, **fields: Any) -> str:
    return json.dumps({"type": kind, **fields}, separators=(",", ":"))


class _Turn:
    def __init__(self, user: str | None) -> None:
        self.user = user
        self.text: list[str] = []
        self.tools: list[str] = []
        self.tool_errors: list[str] = []
        self.handoffs: list[list[str]] = []
        self.responses: list[list[str]] = []
        self.errors: list[str] = []
        self.outcome = "ok"

    def record(self, node: str | None) -> dict[str, Any]:
        return {
            "user": self.user,
            "agent": "".join(self.text).strip(),
            "node": node,
            "tools": self.tools,
            "tool_errors": self.tool_errors,
            "handoffs": self.handoffs,
            "responses": self.responses,
            "errors": self.errors,
            "outcome": self.outcome,
        }


async def _read_turn(ws: Any, turn: _Turn, state: dict[str, Any], timeout: float) -> None:
    """Read events until the agent finishes answering one caller turn."""
    from websockets.exceptions import ConnectionClosed

    handoff_pending = False
    while True:
        try:
            event = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        except asyncio.TimeoutError:
            turn.outcome = "stalled"  # no new response: the caller would hear silence
            return
        except ConnectionClosed:
            turn.outcome = "ended"
            return
        kind = event.get("type", "")
        if kind == "error":
            error = event.get("error") or {}
            turn.errors.append(f"{error.get('code') or error.get('type')}: {error.get('message')}")
        elif kind in TEXT_DELTA_EVENTS:
            turn.text.append(event.get("delta") or "")
        elif kind == "session.handoff.started":
            handoff_pending = True
        elif kind in {"session.handoff.completed", "session.handoff.aborted"}:
            handoff_pending = False
            if kind.endswith("completed"):
                state["node"] = event.get("to_node_id") or state.get("node")
                turn.handoffs.append([event.get("from_node_id"), event.get("to_node_id")])
        elif kind == "response.done":
            response = event.get("response") or {}
            output = [item for item in response.get("output") or [] if isinstance(item, dict)]
            turn.responses.append([str(item.get("type")) for item in output])
            for item in output:
                if item.get("type") in TOOL_ITEM_TYPES and item.get("name") != "handoff":
                    turn.tools.append(str(item.get("name")))
                    if item.get("error"):
                        turn.tool_errors.append(f"{item.get('name')}: {item.get('error')}")
            if response.get("status") not in {None, "completed"}:
                turn.errors.append(f"response status {response.get('status')}")
            waiting = any(item.get("type") in TOOL_ITEM_TYPES for item in output)
            if not waiting and not handoff_pending:
                return


async def run_session(agent_name: str, turns: list[str], *, timeout: float = 45.0) -> dict[str, Any]:
    """Send caller turns as text and return the greeting plus one record per turn."""
    from websockets.asyncio.client import connect

    credential = async_credential()
    try:
        token = await credential.get_token(TOKEN_SCOPE)
    finally:
        await credential.close()
    headers = {"Authorization": f"Bearer {token.token}", "Foundry-Features": VOICE_AGENT_FEATURE}
    state: dict[str, Any] = {"node": None, "conversation_id": None}
    records: list[dict[str, Any]] = []
    async with connect(_voice_url(agent_name), additional_headers=headers, max_size=None,
                       ping_timeout=None, open_timeout=timeout) as ws:
        while True:  # wait for the session to be ready
            event = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
            if event.get("type") == "session.created":
                state["conversation_id"] = event.get("conversation_id")
            if event.get("type") == "error":
                raise SystemExit(f"Session error: {event.get('error')}")
            if event.get("type") == "session.updated":
                break
        greeting = _Turn(None)
        await _read_turn(ws, greeting, state, timeout)
        records.append(greeting.record(state["node"]))
        for text in turns:
            if records[-1]["outcome"] != "ok":
                break  # the call ended or stalled; later turns cannot be judged
            turn = _Turn(text)
            await ws.send(_event("conversation.item.create", item={
                "type": "message", "role": "user",
                "content": [{"type": "input_text", "text": text}],
            }))
            await ws.send(_event("response.create"))
            await _read_turn(ws, turn, state, timeout)
            records.append(turn.record(state["node"]))
    return {"agent": agent_name, "conversation_id": state["conversation_id"], "turns": records}


def print_turn(index: int, record: dict[str, Any]) -> None:
    if record["user"] is not None:
        print(f"\n[{index}] caller> {record['user']}")
    for source, target in record["handoffs"]:
        print(f"    handoff> {source} -> {target}")
    for name in record["tools"]:
        print(f"    tool> {name}")
    for error in record["tool_errors"] + record["errors"]:
        print(f"    error> {error}")
    print(f"    agent ({record['node'] or 'start'})> {record['agent'] or '<no speech>'}")
    if record["outcome"] != "ok":
        print(f"    outcome> {record['outcome']}")
