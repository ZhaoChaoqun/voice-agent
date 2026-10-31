# Copyright (c) Microsoft. All rights reserved.
"""Portal-owned template catalog, MCP checks, and publishing routes."""

from __future__ import annotations

import asyncio
import copy
import ipaddress
import json
import logging
import re
import socket
import sys
import time
import uuid
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import requests
from aiohttp import web
from azure.ai.projects import AIProjectClient
from azure.core.exceptions import HttpResponseError
from dotenv import dotenv_values


try:
    from .common import AgentsConfig, FOUNDRY_FEATURES, regional_model_publish_fallback
    from .guide_render import render_page
except ImportError:
    from common import AgentsConfig, FOUNDRY_FEATURES, regional_model_publish_fallback
    from guide_render import render_page


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
VOICE_AGENT_ROOT = ROOT.parent
SAMPLES_DIR = VOICE_AGENT_ROOT / "samples"
SHARED_MCP_DIR = VOICE_AGENT_ROOT / "shared_mcp"
DOCS_DIR = VOICE_AGENT_ROOT / "docs"
sys.path.insert(0, str(SAMPLES_DIR))
from voice_agent_definition import materialize_handoff_instruction_inheritance

logger = logging.getLogger(__name__)

DEFAULT_TEMPLATE_CONFIG = ROOT / "templates.config.json"
ARM_TOKEN_SCOPE = "https://management.azure.com/.default"
ARM_MANAGEMENT_BASE = "https://management.azure.com"
CONNECTION_API_VERSION = "2025-04-01-preview"
MCP_PROBE_TIMEOUT_SECONDS = 15
MCP_PROTOCOL_VERSION = "2025-06-18"
TEMPLATE_AGENT_PREFIX = "local-only-"
TEMPLATE_AGENT_NAME = re.compile(
    r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$"
)
AGENT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
ENTRYPOINT_NODE_ID = "$entrypoint"
CATALOG_KEY = web.AppKey("voice_portal_template_catalog", object)
MODEL_OVERRIDE_KEY = web.AppKey("voice_portal_template_model_override", str)
AGENTS_CONFIG_KEY = web.AppKey("voice_portal_agents_config", AgentsConfig)
CONFIG_RESOLVER_KEY = web.AppKey("voice_portal_config_resolver", object)
TEMPLATE_ASSETS = frozenset({
    "template-app.js",
    "template-graph.js",
    "template-styles.css",
})


def validate_https_url(value: str, field: str) -> str:
    url = value.strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc or "<" in url or ">" in url:
        raise ValueError(f"{field} must be a public HTTPS URL.")
    return url


def normalize_bearer_token(value: str) -> str:
    token = value.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        raise ValueError("MCP bearer token is required.")
    if "\r" in token or "\n" in token:
        raise ValueError("MCP bearer token cannot contain newlines.")
    if len(token.encode("utf-8")) > 16 * 1024:
        raise ValueError("MCP bearer token must not exceed 16 KiB.")
    return token


def template_agent_name(requested_name: str, template_id: str) -> str:
    base_name = requested_name.strip() or f"{template_id}-{uuid.uuid4().hex[:8]}"
    base_name = re.sub(r"[^A-Za-z0-9-]+", "-", base_name).strip("-")
    name = (
        base_name
        if base_name.startswith(TEMPLATE_AGENT_PREFIX)
        else f"{TEMPLATE_AGENT_PREFIX}{base_name}"
    )
    if len(name) > 63 or not TEMPLATE_AGENT_NAME.fullmatch(name):
        max_base_length = 63 - len(TEMPLATE_AGENT_PREFIX)
        raise ValueError(
            f"Template Agent name must be at most {max_base_length} characters before the "
            f"required '{TEMPLATE_AGENT_PREFIX}' prefix and may contain only "
            "letters, numbers, and hyphens."
        )
    return name


def iter_mcp_tools(value: Any):
    if isinstance(value, dict):
        if value.get("type") == "mcp":
            yield value
        for child in value.values():
            yield from iter_mcp_tools(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_mcp_tools(child)


def tool_names(tools: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for tool in tools:
        if tool.get("type") == "mcp":
            names.extend(
                str(name)
                for name in tool.get("allowed_tools") or []
                if name
            )
        elif tool.get("name"):
            names.append(str(tool["name"]))
    return names


def tool_refs(tools: list[dict[str, Any]]) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    for tool in tools:
        if tool.get("type") == "mcp":
            server = str(tool.get("server_label") or "mcp")
            refs.extend(
                {"name": str(name), "server": server}
                for name in tool.get("allowed_tools") or []
                if name
            )
        elif tool.get("name"):
            refs.append({"name": str(tool["name"]), "server": ""})
    return refs


class McpProbeError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        latency_ms: float = 0.0,
        http_status: int = 0,
    ) -> None:
        super().__init__(message)
        self.latency_ms = round(latency_ms, 1)
        self.http_status = http_status


def validate_mcp_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise McpProbeError("MCP probes require an absolute HTTPS URL")
    if parsed.username or parsed.password or parsed.fragment:
        raise McpProbeError("MCP probe URLs cannot contain credentials or fragments")
    try:
        parsed.port
    except ValueError as error:
        raise McpProbeError("MCP server port is invalid") from error
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise McpProbeError("MCP URLs cannot target localhost")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return
    if not address.is_global:
        raise McpProbeError("MCP URLs cannot target private, loopback, link-local, or reserved addresses")


def validate_mcp_probe_url(url: str) -> None:
    validate_mcp_url(url)
    parsed = urlparse(url)
    try:
        addresses = {
            ipaddress.ip_address(record[4][0])
            for record in socket.getaddrinfo(
                parsed.hostname,
                parsed.port or 443,
                type=socket.SOCK_STREAM,
            )
        }
    except (OSError, ValueError) as error:
        raise McpProbeError(
            f"MCP server address could not be resolved: {error}"
        ) from error
    if not addresses or any(not address.is_global for address in addresses):
        raise McpProbeError(
            "MCP probes cannot target private, loopback, link-local, or reserved addresses"
        )


def decode_mcp_response(response: requests.Response) -> dict[str, Any]:
    text = response.text or ""
    if "text/event-stream" in (response.headers.get("Content-Type") or ""):
        for line in text.splitlines():
            if line.startswith("data:"):
                return json.loads(line[5:].strip())
        raise ValueError("event stream carried no data frame")
    return json.loads(text) if text.strip() else {}


def mcp_handshake(url: str, bearer_token: str = "") -> dict[str, Any]:
    validate_mcp_probe_url(url)
    session = requests.Session()
    session.trust_env = False
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    started = time.perf_counter()
    try:
        initialized = session.post(
            url,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {
                        "name": "voice-agent-portal-probe",
                        "version": "1.0",
                    },
                },
            },
            headers=headers,
            timeout=MCP_PROBE_TIMEOUT_SECONDS,
            allow_redirects=False,
        )
    except requests.RequestException as error:
        raise McpProbeError(f"{type(error).__name__}: {error}") from error
    initialize_ms = (time.perf_counter() - started) * 1000
    if initialized.status_code >= 300:
        raise McpProbeError(
            f"initialize returned HTTP {initialized.status_code}",
            latency_ms=initialize_ms,
            http_status=initialized.status_code,
        )
    payload = decode_mcp_response(initialized)
    if payload.get("error"):
        raise McpProbeError(
            f"initialize failed: {payload['error']}",
            latency_ms=initialize_ms,
            http_status=initialized.status_code,
        )
    server_info = (payload.get("result") or {}).get("serverInfo") or {}
    session_id = initialized.headers.get("Mcp-Session-Id", "")
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    session.post(
        url,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers=headers,
        timeout=MCP_PROBE_TIMEOUT_SECONDS,
        allow_redirects=False,
    )
    started = time.perf_counter()
    listed = session.post(
        url,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        headers=headers,
        timeout=MCP_PROBE_TIMEOUT_SECONDS,
        allow_redirects=False,
    )
    tools_ms = (time.perf_counter() - started) * 1000
    if listed.status_code >= 300:
        raise McpProbeError(
            f"tools/list returned HTTP {listed.status_code}",
            latency_ms=initialize_ms + tools_ms,
            http_status=listed.status_code,
        )
    listing = decode_mcp_response(listed)
    if listing.get("error"):
        raise McpProbeError(
            f"tools/list failed: {listing['error']}",
            latency_ms=initialize_ms + tools_ms,
            http_status=listed.status_code,
        )
    tools = sorted(
        str(tool.get("name") or "")
        for tool in (listing.get("result") or {}).get("tools") or []
        if isinstance(tool, dict)
    )
    return {
        "initialize_ms": round(initialize_ms, 1),
        "tools_ms": round(tools_ms, 1),
        "latency_ms": round(initialize_ms + tools_ms, 1),
        "http_status": listed.status_code,
        "reached": True,
        "server_name": str(server_info.get("name") or ""),
        "server_version": str(server_info.get("version") or ""),
        "tools": tools,
    }


_TOOL_NAME_CHARS = re.compile(r"[^a-z0-9]")
WORK_IQ_NOTE = (
    "Work IQ can't be connected with an MCP URL yet. Its calendar, Teams, and mail tools act as "
    "the signed-in Microsoft 365 user, and the shared Playground can't hold that identity, so "
    "this Agent keeps using mock data here. In your own Foundry Project, attach a Work IQ "
    "Toolbox instead."
)


@dataclass(frozen=True)
class ToolGroup:
    """Business system behind a set of Template tools, connected to one MCP server."""

    id: str
    label: str
    pattern: re.Pattern[str]
    connectable: bool = True
    note: str = ""


# Mock tools grouped by the real system they stand for, in display order.
TOOL_GROUPS = (
    ToolGroup("salesforce", "Salesforce", re.compile(r"^mock_tool_call_salesforce_")),
    ToolGroup("zendesk", "Zendesk", re.compile(r"^mock_tool_call_zendesk_")),
    ToolGroup("twilio", "Twilio SMS", re.compile(r"^mock_tool_call_twilio_")),
    ToolGroup(
        "work_iq",
        "Microsoft 365 (Work IQ)",
        re.compile(
            r"^mock_tool_call_(find_meeting_times|get_user_date_and_time_zone_settings|create_event"
            r"|list_calendar_view|update_event|cancel_event|get_user_presence|send_email_with_attachments)$"
        ),
        connectable=False,
        note=WORK_IQ_NOTE,
    ),
    ToolGroup("orders", "Order system", re.compile(r"^mock_tool_call_order_")),
    ToolGroup("reservations", "Reservation system", re.compile(r"^mock_tool_call_hotel_")),
    ToolGroup("records", "Learning and research records", re.compile(r"^mock_tool_call_(quiz|training|research)_")),
)
OTHER_TOOL_GROUP = ToolGroup("other", "Other tools", re.compile(""))


def tool_group(name: str) -> ToolGroup:
    """The business system a Template tool belongs to."""
    return next((group for group in TOOL_GROUPS if group.pattern.search(name)), OTHER_TOOL_GROUP)


def tool_groups(definition: dict[str, Any]) -> list[dict[str, Any]]:
    """The systems a definition's mock tools belong to, each with its tools, in display order."""
    tools = [name for name in required_mcp_tools(definition) if name.startswith("mock_tool_call_")]
    groups = []
    for group in (*TOOL_GROUPS, OTHER_TOOL_GROUP):
        names = [name for name in tools if tool_group(name) is group]
        if names:
            groups.append({
                "id": group.id,
                "label": group.label,
                "tools": names,
                "connectable": group.connectable,
                "note": group.note,
            })
    return groups


def required_mcp_tools(definition: dict[str, Any]) -> list[str]:
    """Every MCP tool name a definition's stages allow, in first-use order."""
    names = (
        str(name)
        for tool in iter_mcp_tools(definition)
        for name in tool.get("allowed_tools") or []
        if isinstance(name, str) and name
    )
    return list(dict.fromkeys(names))


def _tool_key(name: str) -> str:
    """Compare tool names across naming styles: drop a mock or server-label prefix, case, and separators."""
    bare = name.rsplit("___", 1)[-1]
    if bare.startswith("mock_tool_call_"):
        bare = bare[len("mock_tool_call_"):]
    return _TOOL_NAME_CHARS.sub("", bare.lower())


def suggest_tool_map(required: list[str], available: list[str]) -> dict[str, str]:
    """Map each required tool to a server tool with the same name in any naming style, or ''."""
    by_key: dict[str, str] = {}
    for name in available:
        by_key.setdefault(_tool_key(name), name)
    return {
        name: name if name in available else by_key.get(_tool_key(name), "")
        for name in required
    }


def validate_tool_map(
    required: list[str],
    available: list[str],
    tool_map: Any,
) -> dict[str, str]:
    """Check that every required tool maps to a tool the server lists."""
    if not isinstance(tool_map, dict):
        raise ValueError("tool_map must map every template tool to a server tool.")
    mapped = {str(key): str(value or "").strip() for key, value in tool_map.items()}
    missing = [name for name in required if not mapped.get(name)]
    if missing:
        raise ValueError(f"Choose a server tool for: {', '.join(missing)}")
    unknown = sorted({mapped[name] for name in required} - set(available))
    if unknown:
        raise ValueError(f"The MCP server does not list: {', '.join(unknown)}")
    return {name: mapped[name] for name in required}


def _split_mcp_tool(
    tool: dict[str, Any],
    servers: dict[str, tuple[str, dict[str, str]]],
) -> list[dict[str, Any]]:
    """Split one MCP tool into one per connected system; unconnected tools stay on the tool's server."""
    kept: list[str] = []
    connected: dict[str, list[str]] = {}
    for name in tool.get("allowed_tools") or []:
        group = tool_group(str(name)).id
        if group in servers:
            connected.setdefault(group, []).append(servers[group][1][str(name)])
        else:
            kept.append(str(name))
    split: list[dict[str, Any]] = []
    if kept:
        split.append({**tool, "allowed_tools": kept})
    for group, names in connected.items():
        entry = {
            **tool,
            "server_label": group,
            "server_url": servers[group][0],
            "allowed_tools": list(dict.fromkeys(names)),
        }
        for key in ("project_connection_id", "authorization", "headers"):
            entry.pop(key, None)
        split.append(entry)
    return split


def apply_tool_servers(
    definition: dict[str, Any],
    servers: dict[str, tuple[str, dict[str, str]]],
) -> dict[str, Any]:
    """Point each connected system's tools at the user's MCP server for that system.

    ``servers`` maps a tool group ID to its server URL and the map from Template tool to
    server tool. Tools of other systems keep their server. Mapped tool names are renamed in
    the instructions.
    """
    if not servers:
        return definition

    def split(value: Any) -> Any:
        if isinstance(value, list):
            items: list[Any] = []
            for item in value:
                if isinstance(item, dict) and item.get("type") == "mcp":
                    items.extend(_split_mcp_tool(item, servers))
                else:
                    items.append(split(item))
            return items
        if isinstance(value, dict):
            return {key: split(item) for key, item in value.items()}
        return value

    definition = split(definition)
    renames = {
        old: new
        for _, tool_map in servers.values()
        for old, new in tool_map.items()
        if old != new
    }
    if not renames:
        return definition
    pattern = re.compile(
        r"\b(" + "|".join(re.escape(name) for name in sorted(renames, key=len, reverse=True)) + r")\b"
    )

    def rename(value: Any) -> Any:
        if isinstance(value, str):
            return pattern.sub(lambda match: renames[match.group(1)], value)
        if isinstance(value, list):
            return [rename(item) for item in value]
        if isinstance(value, dict):
            return {
                key: item if key in {"allowed_tools", "server_url"} else rename(item)
                for key, item in value.items()
            }
        return value

    return rename(definition)


MOCK_SERVER_LABEL = "mock_tool_call"
MOCK_ROUTE_SUFFIX = "/mcp/mock-tool-call"


def definition_tool_groups(definition: dict[str, Any]) -> list[dict[str, Any]]:
    """Systems a working definition uses: mock tools per system, plus systems already connected."""
    groups = {group["id"]: {**group, "connected": None} for group in tool_groups(definition)}
    by_id = {group.id: group for group in TOOL_GROUPS}
    for tool in iter_mcp_tools(definition):
        group = by_id.get(str(tool.get("server_label") or ""))
        if group is None:
            continue
        entry = groups.setdefault(group.id, {
            "id": group.id, "label": group.label, "tools": [],
            "connectable": group.connectable, "note": group.note, "connected": None,
        })
        connected = entry["connected"] or {"server_url": str(tool.get("server_url") or ""), "tools": []}
        connected["tools"] = list(dict.fromkeys([*connected["tools"], *(tool.get("allowed_tools") or [])]))
        entry["connected"] = connected
    order = [group.id for group in (*TOOL_GROUPS, OTHER_TOOL_GROUP)]
    return sorted(groups.values(), key=lambda group: order.index(group["id"]))


def revert_tool_server(
    definition: dict[str, Any],
    group_id: str,
    tool_map: dict[str, str],
    mock_url: str,
) -> dict[str, Any]:
    """Move a connected system's tools back to the mock server and restore their mock names."""
    reverse = {new: old for old, new in tool_map.items()}

    def merge(tools: list[Any]) -> list[Any]:
        merged: list[Any] = []
        mock: dict[str, Any] | None = None
        for tool in tools:
            if isinstance(tool, dict) and tool.get("type") == "mcp" and tool.get("server_label") == group_id:
                tool = {
                    **tool,
                    "server_label": MOCK_SERVER_LABEL,
                    "server_url": mock_url,
                    "allowed_tools": [reverse.get(str(name), str(name)) for name in tool.get("allowed_tools") or []],
                }
            if isinstance(tool, dict) and tool.get("type") == "mcp" and tool.get("server_label") == MOCK_SERVER_LABEL:
                if mock is not None:
                    mock["allowed_tools"] = list(dict.fromkeys([*mock["allowed_tools"], *tool["allowed_tools"]]))
                    continue
                mock = {**tool, "allowed_tools": list(tool.get("allowed_tools") or [])}
                tool = mock
            merged.append(tool)
        return merged

    def walk(value: Any) -> Any:
        if isinstance(value, list):
            items = [walk(item) for item in value]
            if any(isinstance(item, dict) and item.get("type") == "mcp" for item in items):
                return merge(items)
            return items
        if isinstance(value, dict):
            return {key: walk(item) for key, item in value.items()}
        return value

    definition = walk(definition)
    renames = {new: old for old, new in tool_map.items() if old != new}
    if not renames:
        return definition
    pattern = re.compile(
        r"\b(" + "|".join(re.escape(name) for name in sorted(renames, key=len, reverse=True)) + r")\b"
    )

    def rename(value: Any) -> Any:
        if isinstance(value, str):
            return pattern.sub(lambda match: renames[match.group(1)], value)
        if isinstance(value, list):
            return [rename(item) for item in value]
        if isinstance(value, dict):
            return {
                key: item if key in {"allowed_tools", "server_url"} else rename(item)
                for key, item in value.items()
            }
        return value

    return rename(definition)


def materialize_template(
    document: dict[str, Any],
    *,
    model: str,
    voice: str,
    mcp_server_url: str,
    mcp_connection_id: str,
    mcp_public: bool = False,
) -> dict[str, Any]:
    definition = copy.deepcopy(document["definition"])
    if model.strip():
        definition["model"] = model.strip()
    if voice.strip():
        output = definition.setdefault("audio", {}).setdefault("output", {})
        output["voice"] = {"type": "azure-standard", "name": voice.strip()}
        output.pop("voice_type", None)
    mcp_tools = list(iter_mcp_tools(definition))
    if mcp_tools:
        server_url = validate_https_url(mcp_server_url, "MCP server URL")
        connection_id = mcp_connection_id.strip()
        if not mcp_public and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", connection_id):
            raise ValueError("MCP connection ID is required and has an invalid format.")
        for tool in mcp_tools:
            tool["server_url"] = server_url
            if mcp_public:
                tool.pop("project_connection_id", None)
            else:
                tool["project_connection_id"] = connection_id
            tool.pop("authorization", None)
            tool.pop("headers", None)
    materialize_handoff_instruction_inheritance(definition)
    return definition


def graph_summary(definition: dict[str, Any]) -> dict[str, Any]:
    handoff = definition.get("handoff")
    if not isinstance(handoff, dict):
        return {"nodes": [], "edges": []}
    nodes = []
    for node in handoff.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        config = node.get("config") or {}
        config_tools = [
            tool
            for tool in config.get("tools") or []
            if isinstance(tool, dict)
        ]
        nodes.append(
            {
                "id": str(node.get("id") or ""),
                "description": str(node.get("description") or ""),
                "instructions": str(config.get("instructions") or ""),
                "tools": tool_names(config_tools),
                "tool_refs": tool_refs(config_tools),
            }
        )
    return {
        "nodes": nodes,
        "edges": [
            {
                "id": str(edge.get("id") or f"{edge.get('source')}:{edge.get('target')}"),
                "source": str(edge.get("source") or ""),
                "target": str(edge.get("target") or ""),
                "description": str(edge.get("description") or ""),
            }
            for edge in handoff.get("edges") or []
            if isinstance(edge, dict)
        ],
    }


def template_graph_view(definition: dict[str, Any]) -> dict[str, Any]:
    handoff = definition.get("handoff") or {}
    authored_nodes = {
        str(node.get("id")): node
        for node in handoff.get("nodes") or []
        if isinstance(node, dict) and node.get("id")
    }
    raw_edges = [
        edge for edge in handoff.get("edges") or [] if isinstance(edge, dict)
    ]
    node_ids = [ENTRYPOINT_NODE_ID, *authored_nodes]
    for edge in raw_edges:
        for key in ("source", "target"):
            value = str(edge.get(key) or "")
            if value and value not in node_ids:
                node_ids.append(value)
    outgoing = {node_id: [] for node_id in node_ids}
    for edge in raw_edges:
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        if source in outgoing and target in outgoing:
            outgoing[source].append(target)
    back_edges: set[tuple[str, str]] = set()
    color: dict[str, int] = {}

    def visit(node_id: str) -> None:
        color[node_id] = 1
        for target in outgoing[node_id]:
            if color.get(target) == 1:
                back_edges.add((node_id, target))
            elif not color.get(target):
                visit(target)
        color[node_id] = 2

    for node_id in node_ids:
        if not color.get(node_id):
            visit(node_id)
    indegree = {node_id: 0 for node_id in node_ids}
    for source, targets in outgoing.items():
        for target in targets:
            if (source, target) not in back_edges:
                indegree[target] += 1
    depth = {node_id: 0 for node_id in node_ids}
    queue = [node_id for node_id, degree in indegree.items() if degree == 0]
    while queue:
        current = queue.pop(0)
        for target in outgoing[current]:
            if (current, target) in back_edges:
                continue
            depth[target] = max(depth[target], depth[current] + 1)
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    orders: dict[int, int] = {}
    nodes = []
    for node_id in node_ids:
        authored = authored_nodes.get(node_id) or {}
        config = definition if node_id == ENTRYPOINT_NODE_ID else authored.get("config") or {}
        layer = depth[node_id]
        order = orders.get(layer, 0)
        orders[layer] = order + 1
        config_tools = [
            tool
            for tool in config.get("tools") or []
            if isinstance(tool, dict)
        ]
        nodes.append({
            "id": node_id,
            "label": "entrypoint" if node_id == ENTRYPOINT_NODE_ID else node_id,
            "kind": (
                "entry"
                if node_id == ENTRYPOINT_NODE_ID
                else "node"
                if outgoing[node_id]
                else "terminal"
            ),
            "description": str(authored.get("description") or ""),
            "instructions": str(config.get("instructions") or ""),
            "tools": tool_names(config_tools),
            "tool_refs": tool_refs(config_tools),
            "tool_choice": str(config.get("tool_choice") or "auto"),
            "layer": layer,
            "order": order,
        })
    edges = [
        {
            "id": str(edge.get("id") or f"{edge.get('source')}:{edge.get('target')}:{index}"),
            "from": str(edge.get("source") or ""),
            "to": str(edge.get("target") or ""),
            "description": str(edge.get("description") or ""),
            "target_response": str(edge.get("target_response") or "auto"),
        }
        for index, edge in enumerate(raw_edges)
    ]
    return {"nodes": nodes, "edges": edges}


@dataclass(frozen=True)
class TemplateSource:
    id: str
    name: str
    path: Path
    category: str
    accent: str
    summary: str
    mcp_server_url: str
    mcp_connection_id: str
    connection_mode: str
    allowed_backends: tuple[str, ...]
    source_label: str
    source_reference: str
    mcp_config_path: Path | None
    mcp_token_file: Path | None
    lock_runtime: bool
    target_locale: str = ""


class TemplateCatalog:
    def __init__(
        self,
        config_path: Path = DEFAULT_TEMPLATE_CONFIG,
        allowed_root: Path = SAMPLES_DIR,
        mcp_root: Path = SHARED_MCP_DIR,
    ) -> None:
        self.config_path = config_path.resolve()
        self.allowed_root = allowed_root.resolve()
        self.mcp_root = mcp_root.resolve()
        self._sources: tuple[TemplateSource, ...] = ()
        self._versions: dict[str, dict[str, TemplateSource]] = {}
        self._documents: dict[Path, dict[str, Any]] = {}
        self._errors: list[dict[str, str]] = []
        self.reload()

    @property
    def errors(self) -> list[dict[str, str]]:
        return copy.deepcopy(self._errors)

    def reload(self) -> None:
        try:
            payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(
                f"Could not read template config {self.config_path}: {error}"
            ) from error
        if not isinstance(payload, dict) or payload.get("version") != 1:
            raise RuntimeError("Template config must be an object with version=1.")
        entries = payload.get("templates")
        if not isinstance(entries, list):
            raise RuntimeError("Template config must contain a templates array.")
        self._documents.clear()
        self._versions.clear()
        self._errors = []
        sources: list[TemplateSource] = []
        seen: set[str] = set()
        for index, entry in enumerate(entries):
            template_id = ""
            try:
                if not isinstance(entry, dict):
                    raise ValueError("Template entry must be an object.")
                template_id = str(entry.get("id") or "").strip()
                if entry.get("enabled", True) is False:
                    continue
                if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", template_id):
                    raise ValueError("id must be a lowercase DNS label of at most 63 characters")
                if template_id in seen:
                    raise ValueError("id is duplicated")
                lock_runtime = entry.get("lock_runtime", False)
                if not isinstance(lock_runtime, bool):
                    raise ValueError("lock_runtime must be a boolean")
                target_locale = entry.get("target_locale", "")
                if not isinstance(target_locale, str) or (
                    target_locale and not re.fullmatch(
                        r"[a-z]{2,3}(?:-[A-Z][a-z]{3})?-(?:[A-Z]{2}|[0-9]{3})",
                        target_locale,
                    )
                ):
                    raise ValueError("target_locale must be a locale such as hi-IN or en-US")
                folder_value = str(entry.get("folder") or "").strip()
                if not folder_value:
                    raise ValueError("folder is required")
                folder = (self.config_path.parent / folder_value).resolve()
                if not folder.is_relative_to(self.allowed_root):
                    raise ValueError(f"folder must resolve under {self.allowed_root}")
                agent_file = str(entry.get("agent_file") or "agent.json").strip()
                path = (folder / agent_file).resolve()
                if not path.is_relative_to(folder) or not path.is_relative_to(self.allowed_root):
                    raise ValueError("agent_file resolves outside the configured folder")
                if not path.is_file():
                    raise ValueError(f"Agent definition does not exist: {path}")
                mcp_config = entry.get("mcp") or {}
                if not isinstance(mcp_config, dict):
                    raise ValueError("mcp must be an object")
                connection_mode = str(
                    mcp_config.get("connection_mode") or "managed"
                ).strip()
                if connection_mode not in {"managed", "existing", "public"}:
                    raise ValueError(
                        "mcp.connection_mode must be 'managed', 'existing', or 'public'"
                    )
                allowed_backends_value = (
                    mcp_config.get("allowed_backends") or []
                )
                if not isinstance(allowed_backends_value, list) or any(
                    not isinstance(value, str) or not value.strip()
                    for value in allowed_backends_value
                ):
                    raise ValueError(
                        "mcp.allowed_backends must be an array of "
                        "non-empty strings"
                    )
                mcp_config_path = None
                mcp_values: dict[str, str] = {}
                config_file = str(mcp_config.get("config_file") or "").strip()
                if config_file:
                    mcp_config_path = (self.config_path.parent / config_file).resolve()
                    if not mcp_config_path.is_relative_to(self.mcp_root):
                        raise ValueError(f"mcp.config_file must resolve under {self.mcp_root}")
                    if mcp_config_path.is_file():
                        mcp_values = {
                            key: str(value)
                            for key, value in dotenv_values(mcp_config_path).items()
                            if value is not None
                        }
                token_file = str(mcp_config.get("token_file") or "").strip()
                mcp_token_file = (
                    (self.config_path.parent / token_file).resolve()
                    if token_file
                    else None
                )
                if mcp_token_file and not mcp_token_file.is_relative_to(self.mcp_root):
                    raise ValueError(f"mcp.token_file must resolve under {self.mcp_root}")
                source = TemplateSource(
                    id=template_id,
                    name=str(entry.get("name") or "").strip(),
                    path=path,
                    category=str(entry.get("category") or "Voice Agent").strip(),
                    accent=str(entry.get("accent_color") or "#147d64").strip(),
                    summary=str(entry.get("summary") or "").strip(),
                    mcp_server_url=str(
                        mcp_values.get("VOICE_AGENT_MCP_SERVER_URL")
                        or mcp_config.get("server_url")
                        or ""
                    ).strip(),
                    mcp_connection_id=str(
                        mcp_values.get("VOICE_AGENT_MCP_CONNECTION_ID")
                        or mcp_config.get("connection_id")
                        or ""
                    ).strip(),
                    connection_mode=connection_mode,
                    allowed_backends=tuple(
                        value.strip() for value in allowed_backends_value
                    ),
                    source_label=str(
                        mcp_config.get("source_label") or "MCP server"
                    ).strip(),
                    source_reference=str(
                        mcp_config.get("source_reference") or ""
                    ).strip(),
                    mcp_config_path=mcp_config_path,
                    mcp_token_file=mcp_token_file,
                    lock_runtime=lock_runtime,
                    target_locale=target_locale,
                )
                self._validate_source(source)
            except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
                self._errors.append(
                    {"id": template_id or f"entry-{index}", "error": str(error)}
                )
                continue
            seen.add(template_id)
            sources.append(source)
            versions = {".": source}
            for candidate in sorted(folder.rglob(path.name)):
                if candidate == folder / agent_file:
                    continue
                version = candidate.parent.relative_to(folder).as_posix()
                if version == ".":
                    continue
                try:
                    version_path = candidate.resolve()
                    if not version_path.is_relative_to(folder):
                        raise ValueError("Version resolves outside the configured folder")
                    version_source = replace(source, path=version_path)
                    self._validate_source(version_source)
                except (OSError, ValueError, RuntimeError) as error:
                    self._errors.append({
                        "id": template_id, "version": version, "error": str(error),
                    })
                    continue
                versions[version] = version_source
            self._versions[template_id] = versions
        self._sources = tuple(sources)

    def _validate_source(self, source: TemplateSource) -> None:
        document = self._load(source)
        if not list(iter_mcp_tools(document["definition"])):
            return
        if not source.mcp_server_url and source.mcp_config_path is None:
            raise ValueError("mcp.server_url is required for an MCP template")
        if source.mcp_server_url:
            validate_https_url(source.mcp_server_url, "mcp.server_url")
        if source.mcp_connection_id and not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._-]*", source.mcp_connection_id,
        ):
            raise ValueError("MCP connection ID has an invalid format")
        if (
            source.mcp_config_path
            and source.mcp_config_path.is_file()
            and not (
                source.mcp_server_url
                and (source.mcp_connection_id or source.connection_mode == "public")
            )
        ):
            raise ValueError(
                "mcp.config_file must define both "
                "VOICE_AGENT_MCP_SERVER_URL and "
                "VOICE_AGENT_MCP_CONNECTION_ID"
            )

    def _load(self, source: TemplateSource) -> dict[str, Any]:
        if source.path not in self._documents:
            document = json.loads(source.path.read_text(encoding="utf-8"))
            if not isinstance(document, dict) or not isinstance(document.get("definition"), dict):
                raise RuntimeError(f"{source.path} has no definition object.")
            self._documents[source.path] = document
        return self._documents[source.path]

    def cards(self) -> list[dict[str, Any]]:
        return [self._card(source) for source in self._sources]

    def _card(self, source: TemplateSource) -> dict[str, Any]:
        document = self._load(source)
        definition = document["definition"]
        graph = graph_summary(definition)
        mcp_tools = list(iter_mcp_tools(definition))
        systems = [
            {"id": group["id"], "label": group["label"], "connectable": group["connectable"]}
            for group in tool_groups(definition)
        ]
        return {
            "id": source.id,
            "name": source.name or str(document.get("name") or source.id),
            "category": source.category,
            "target_locale": source.target_locale,
            "summary": source.summary or str(document.get("description") or "Voice Agent template."),
            "accent": source.accent,
            "accent_color": source.accent,
            "tags": ["mcp", "voice-agent"] if mcp_tools else ["voice-agent"],
            "featured": bool(mcp_tools),
            "node_count": len(graph["nodes"]),
            "edge_count": len(graph["edges"]),
            "tool_count": len(mcp_tools),
            "input_count": 0,
            "error_count": 0,
            "warning_count": 0,
            "requires_mcp": bool(mcp_tools),
            "mock_tools": bool(systems),
            "tool_systems": systems,
            "default_version": ".",
            "versions": [
                {
                    "id": version,
                    "name": f"Default ({source.path.name})" if version == "." else version,
                }
                for version in self._versions[source.id]
            ],
        }

    def detail(self, template_id: str, version: str = ".") -> dict[str, Any] | None:
        source = self.source(template_id, version)
        if source is None:
            return None
        document = self._load(source)
        definition = document["definition"]
        graph = template_graph_view(definition)
        mcp_tools = list(iter_mcp_tools(definition))
        connection_configured = bool(
            source.mcp_server_url
            and (source.mcp_connection_id or source.connection_mode == "public")
            and (
                source.connection_mode in {"existing", "public"}
                or (
                    source.mcp_token_file
                    and source.mcp_token_file.is_file()
                )
            )
        )
        source_description = source.source_label + (
            f" · {source.source_reference}"
            if source.source_reference
            else ""
        )
        tool_servers: dict[str, dict[str, Any]] = {}
        tools: dict[tuple[str, str], dict[str, Any]] = {}
        for tool in mcp_tools:
            server_label = str(tool.get("server_label") or "mcp")
            tool_servers.setdefault(server_label, {
                "id": server_label,
                "kind": "mcp",
                "module": source_description,
            })
            for tool_name in tool.get("allowed_tools") or []:
                key = (server_label, str(tool_name))
                tools.setdefault(
                    key,
                    {
                        "name": str(tool_name),
                        "server": server_label,
                        "kind": "mcp",
                        "transport": "mcp",
                        "description": "",
                        "parameters": {},
                    },
                )
        return {
            **self._card(source),
            "version": version,
            "description": document.get("description") or source.summary,
            "model": definition.get("model") or "gpt-realtime",
            "voice": voice_name(definition),
            "runtime_locked": source.lock_runtime,
            "instructions": definition.get("instructions") or "",
            "graph": graph,
            "agent_name": str(document.get("name") or source.id),
            "config_groups": [
                {
                    "title": "Voice Agent",
                    "items": [
                        {"label": "Target locale", "value": source.target_locale or "Not specified"},
                        {"label": "Model", "value": definition.get("model") or "—"},
                        {"label": "Voice", "value": voice_name(definition) or "—"},
                        {
                            "label": "Store conversation",
                            "value": "On" if definition.get("store") else "Off",
                        },
                    ],
                },
                {
                    "title": "MCP source",
                    "items": [
                        {"label": "Runtime", "value": source.source_label},
                        {
                            "label": "Reference",
                            "value": source.source_reference or "—",
                        },
                        {
                            "label": "Connection mode",
                            "value": source.connection_mode,
                        },
                    ],
                },
            ],
            "tool_servers": list(tool_servers.values()),
            "tools": list(tools.values()),
            "issues": [],
            "yaml": json.dumps(document, indent=2),
            "mcp": {
                "auth_configured": connection_configured,
                "connection_configured": connection_configured,
                "configuration_required": bool(mcp_tools and not connection_configured),
                "token_required": False,
                "connection_mode": source.connection_mode,
                "allowed_backends": list(source.allowed_backends),
                "source_label": source.source_label,
                "source_reference": source.source_reference,
                "allow_user_token": False,
            },
        }

    def document(self, template_id: str, version: str = ".") -> dict[str, Any] | None:
        source = self.source(template_id, version)
        return copy.deepcopy(self._load(source)) if source else None

    def source(self, template_id: str, version: str = ".") -> TemplateSource | None:
        return self._versions.get(template_id, {}).get(version)


def voice_name(definition: dict[str, Any]) -> str:
    voice = ((definition.get("audio") or {}).get("output") or {}).get("voice")
    if isinstance(voice, dict):
        return str(voice.get("name") or "")
    return str(voice or "")


def discover_projects(
    cfg: AgentsConfig,
    current_endpoint: str = "",
) -> list[dict[str, str]]:
    token = cfg.credential().get_token(ARM_TOKEN_SCOPE).token
    headers = {"Authorization": f"Bearer {token}"}
    subscriptions = requests.get(
        f"{ARM_MANAGEMENT_BASE}/subscriptions",
        params={"api-version": "2020-01-01"},
        headers=headers,
        timeout=30,
    )
    subscriptions.raise_for_status()
    subscription_ids = [
        item["subscriptionId"]
        for item in subscriptions.json().get("value", [])
        if item.get("subscriptionId")
    ]
    query = (
        "resources "
        "| where type =~ 'microsoft.cognitiveservices/accounts/projects' "
        "| extend proj=tostring(split(name, '/')[-1]), acct=tostring(split(name, '/')[0]) "
        "| project proj, acct, resourceGroup, subscriptionId "
        "| join kind=leftouter (resources "
        "| where type =~ 'microsoft.cognitiveservices/accounts' "
        "| project acct=name, subscriptionId, resourceGroup, location) "
        "on acct, subscriptionId, resourceGroup "
        "| project proj, acct, resourceGroup, subscriptionId, location"
    )
    rows = []
    for index in range(0, len(subscription_ids), 1000):
        response = requests.post(
            f"{ARM_MANAGEMENT_BASE}/providers/Microsoft.ResourceGraph/resources",
            params={"api-version": "2021-03-01"},
            headers={**headers, "Content-Type": "application/json"},
            json={"subscriptions": subscription_ids[index:index + 1000], "query": query},
            timeout=60,
        )
        response.raise_for_status()
        rows.extend(response.json().get("data", []))
    projects = [
        {
            "name": str(row.get("proj") or ""),
            "account": str(row.get("acct") or ""),
            "label": f"{row.get('proj')} · {row.get('acct')}",
            "endpoint": (
                f"https://{row.get('acct')}.services.ai.azure.com"
                f"/api/projects/{row.get('proj')}"
            ),
            "subscription_id": str(row.get("subscriptionId") or ""),
            "resource_group": str(row.get("resourceGroup") or ""),
            "region": str(row.get("location") or ""),
        }
        for row in rows
        if row.get("proj") and row.get("acct")
    ]
    projects.sort(
        key=lambda item: (
            item["endpoint"] != current_endpoint,
            item["name"].lower(),
            item["account"].lower(),
        )
    )
    return projects


def create_mcp_connection(
    cfg: AgentsConfig,
    *,
    connection_name: str,
    server_url: str,
    bearer_token: str,
) -> None:
    project = next(
        (item for item in discover_projects(cfg, cfg.host) if item["endpoint"] == cfg.host),
        None,
    )
    if project is None:
        raise RuntimeError(
            "The configured Project could not be resolved to an Azure resource. "
            "Reader access is required before its MCP connection can be created."
        )
    account_id = (
        f"/subscriptions/{project['subscription_id']}"
        f"/resourceGroups/{project['resource_group']}"
        "/providers/Microsoft.CognitiveServices"
        f"/accounts/{project['account']}"
    )
    token = cfg.credential().get_token(ARM_TOKEN_SCOPE).token
    response = requests.put(
        (
            f"{ARM_MANAGEMENT_BASE}{account_id}/connections/"
            f"{quote(connection_name, safe='')}"
        ),
        params={"api-version": CONNECTION_API_VERSION},
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "properties": {
                "category": "RemoteTool",
                "target": server_url,
                "authType": "CustomKeys",
                "isDefault": False,
                "isSharedToAll": False,
                "credentials": {
                    "keys": {"Authorization": f"Bearer {bearer_token}"}
                },
                "metadata": {
                    "displayName": connection_name,
                    "source": "voice-agent-portal",
                },
            }
        },
        timeout=60,
    )
    if not response.ok:
        raise RuntimeError(
            f"Create MCP Project connection failed with HTTP "
            f"{response.status_code} ({response.reason}). "
            "The signed-in identity needs connection write permission."
        )


def publish_agent(
    cfg: AgentsConfig,
    *,
    name: str,
    description: str,
    definition: dict[str, Any],
    metadata: dict[str, str] | None = None,
) -> dict[str, Any]:
    preview_headers = {"Foundry-Features": FOUNDRY_FEATURES}
    body: dict[str, Any] = {"definition": definition, "description": description}
    if metadata:
        body["metadata"] = metadata
    with AIProjectClient(
        endpoint=cfg.host,
        credential=cfg.credential(),
        allow_preview=True,
    ) as client:
        try:
            created = client.agents.create_version(name, body, headers=preview_headers)
        except HttpResponseError as error:
            retry_definition = regional_model_publish_fallback(
                definition, error.status_code, str(error),
            )
            if retry_definition is None:
                raise
            definition = retry_definition
            created = client.agents.create_version(
                name, {**body, "definition": definition}, headers=preview_headers,
            )
        client.agents.enable(name, headers=preview_headers)
        version = str(getattr(created, "version", "") or "")
        readback = client.agents.get_version(name, version, headers=preview_headers)
    readback_definition = getattr(readback, "definition", definition)
    if hasattr(readback_definition, "as_dict"):
        readback_definition = readback_definition.as_dict()
    return {"name": name, "version": version, "definition": readback_definition}


def get_agent(cfg: AgentsConfig, name: str) -> dict[str, Any]:
    with AIProjectClient(
        endpoint=cfg.host,
        credential=cfg.credential(),
        allow_preview=True,
    ) as client:
        resource = client.agents.get(
            name,
            headers={"Foundry-Features": FOUNDRY_FEATURES},
        )
    return resource.as_dict() if hasattr(resource, "as_dict") else resource


async def _cfg(request: web.Request) -> AgentsConfig:
    resolver = request.app[CONFIG_RESOLVER_KEY]
    return await resolver(request)


def _catalog(request: web.Request) -> TemplateCatalog:
    return request.app[CATALOG_KEY]


def require_template_backend(source: TemplateSource, backend: str) -> None:
    if source.allowed_backends and backend not in source.allowed_backends:
        allowed = ", ".join(source.allowed_backends)
        raise ValueError(
            f"Template '{source.id}' requires Agent backend {allowed}; "
            f"the selected backend is {backend}."
        )


async def templates_index(_: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "templates.html")


async def template_asset(request: web.Request) -> web.FileResponse:
    name = request.match_info["asset"]
    if name not in TEMPLATE_ASSETS:
        raise web.HTTPNotFound()
    return web.FileResponse(STATIC_DIR / name)


async def examples_guide(_: web.Request) -> web.FileResponse:
    return web.FileResponse(DOCS_DIR / "03_run_samples.md")


async def real_tools_guide(_: web.Request) -> web.Response:
    markdown = (DOCS_DIR / "05_connect_real_tools.md").read_text(encoding="utf-8")
    return web.Response(text=render_page(markdown), content_type="text/html")


TRY_TURNS_HEADING = "## Try these turns"


def try_it_turns(readme: Path) -> list[str]:
    """The bullets under a sample README's "Try these turns" heading, one string per turn."""
    try:
        lines = readme.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    turns: list[str] = []
    inside = False
    for line in lines:
        if line.strip() == TRY_TURNS_HEADING:
            inside = True
            continue
        if not inside:
            continue
        if line.startswith("## "):
            break
        if line.startswith("- "):
            turns.append(line[2:].strip())
        elif turns and line.startswith((" ", "\t")) and line.strip():
            turns[-1] = f"{turns[-1]} {line.strip()}"
    return [turn.replace("mock_tool_call_", "") for turn in turns]


def try_it_note(readme: Path) -> str:
    """The paragraph between the "Try these turns" heading and its first bullet, if the README has one.

    A Template whose tools serve live data uses it to replace the default test-data notice.
    """
    try:
        lines = readme.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    note: list[str] = []
    inside = False
    for line in lines:
        if line.strip() == TRY_TURNS_HEADING:
            inside = True
            continue
        if not inside:
            continue
        if line.startswith(("## ", "- ")):
            break
        if line.strip():
            note.append(line.strip())
    return " ".join(note)


async def template_try_it(request: web.Request) -> web.Response:
    """Sample turns and test data for a Template's mock tools, for the conversation page."""
    source = _catalog(request).source(request.match_info["template_id"])
    if source is None:
        raise web.HTTPNotFound(text="Unknown template.")
    readme = source.path.parent / "README.md"
    turns = try_it_turns(readme)
    if not turns:
        raise web.HTTPNotFound(text="This template has no sample turns.")
    return web.json_response({"id": source.id, "name": source.name, "turns": turns, "note": try_it_note(readme)})


async def logic_apps_mcp_guide(_: web.Request) -> web.Response:
    markdown = (DOCS_DIR / "06_logic_apps_mcp_servers.md").read_text(encoding="utf-8")
    return web.Response(text=render_page(markdown), content_type="text/html")


async def template_config(request: web.Request) -> web.Response:
    cfg = await _cfg(request)
    return web.json_response({
        "configured": True,
        "project": cfg.project,
        "endpoint": cfg.host,
        "credential_mode": "default",
        "api_version": cfg.api_version,
        "foundry_features": FOUNDRY_FEATURES,
    })


async def list_templates(request: web.Request) -> web.Response:
    catalog = _catalog(request)
    if request.query.get("reload") == "1":
        try:
            await asyncio.to_thread(catalog.reload)
        except RuntimeError as error:
            return web.json_response({
                "available": False,
                "reason": str(error),
                "templates": [],
                "errors": [],
            })
    cards = catalog.cards()
    return web.json_response({
        "available": bool(cards),
        "reason": "" if cards else "No valid templates are configured.",
        "templates": cards,
        "errors": catalog.errors,
    })


async def templates_env(request: web.Request) -> web.Response:
    catalog = _catalog(request)
    cards = catalog.cards()
    return web.json_response({
        "available": bool(cards),
        "reason": "" if cards else "No valid templates are configured.",
        "templates_root": str(catalog.config_path),
        "template_count": len(cards),
    })


async def get_template(request: web.Request) -> web.Response:
    catalog = _catalog(request)
    template_id = request.match_info["template_id"]
    version = request.query.get("version", ".")
    source = catalog.source(template_id, version)
    detail = catalog.detail(template_id, version)
    document = catalog.document(template_id, version)
    if source is None or detail is None or document is None:
        raise web.HTTPNotFound(text="Unknown template or version.")
    model_override = request.app[MODEL_OVERRIDE_KEY]
    if model_override and not source.lock_runtime:
        detail["model"] = model_override
        for group in detail["config_groups"]:
            for item in group["items"]:
                if item["label"] == "Model":
                    item["value"] = model_override
    definition = copy.deepcopy(document["definition"])
    if model_override and not source.lock_runtime:
        definition["model"] = model_override
    for tool in iter_mcp_tools(definition):
        if source.mcp_server_url:
            tool["server_url"] = source.mcp_server_url
        if source.mcp_connection_id:
            tool["project_connection_id"] = source.mcp_connection_id
        if source.connection_mode == "public":
            tool.pop("project_connection_id", None)
        tool.pop("authorization", None)
        tool.pop("headers", None)
    materialize_handoff_instruction_inheritance(definition)
    detail["definition"] = definition
    detail["yaml"] = json.dumps({**document, "definition": definition}, indent=2)
    detail["suggested_agent_name"] = template_agent_name("", template_id)
    return web.json_response(detail)


def _probe_report(source: TemplateSource) -> dict[str, Any]:
    return {
        "ok": False,
        "reached": False,
        "server_url": source.mcp_server_url,
        "project_connection_id": source.mcp_connection_id,
        "guide_url": "/guide/run-samples",
        "start_command": (
            "" if source.connection_mode == "public"
            else "cd VoiceAgent/shared_mcp && ./scripts/e2e-local.sh"
        ),
        "checked_at": time.strftime("%H:%M:%S", time.localtime()),
    }


async def probe_template_mcp(request: web.Request) -> web.Response:
    catalog = _catalog(request)
    template_id = request.match_info["template_id"]
    version = request.query.get("version", ".")
    source = catalog.source(template_id, version)
    document = catalog.document(template_id, version)
    if source is None or document is None:
        raise web.HTTPNotFound(text="Unknown template or version.")
    cfg = await _cfg(request)
    report = _probe_report(source)
    report["backend"] = cfg.backend
    try:
        require_template_backend(source, cfg.backend)
    except ValueError as error:
        return web.json_response({**report, "error": str(error)})
    if (
        not source.mcp_server_url
        or (not source.mcp_connection_id and source.connection_mode != "public")
        or (
            source.connection_mode == "managed"
            and (
                source.mcp_token_file is None
                or not source.mcp_token_file.is_file()
            )
        )
    ):
        return web.json_response({
            **report,
            "error": (
                "Local MCP configuration is not ready. "
                "Start the local MCP E2E, then reload templates."
            ),
        })
    try:
        bearer_token = (
            ""
            if source.connection_mode in {"existing", "public"}
            else normalize_bearer_token(
                source.mcp_token_file.read_text(encoding="utf-8")
            )
        )
        result = await asyncio.to_thread(
            mcp_handshake,
            source.mcp_server_url,
            bearer_token,
        )
    except McpProbeError as error:
        if (
            source.connection_mode == "existing"
            and error.http_status in {401, 403}
        ):
            return web.json_response({
                **report,
                "ok": True,
                "reached": True,
                "auth_gate": True,
                "project_connection_auth": True,
                "http_status": error.http_status,
                "latency_ms": error.latency_ms,
                "error": (
                    "The endpoint is reachable; authentication is held by "
                    "the existing Foundry Project connection."
                ),
            })
        return web.json_response({
            **report,
            "reached": bool(error.http_status),
            "auth_gate": error.http_status in {401, 403},
            "http_status": error.http_status,
            "latency_ms": error.latency_ms,
            "error": str(error),
        })
    except Exception as error:
        return web.json_response({**report, "error": f"{type(error).__name__}: {error}"})
    expected_tools = {
        name
        for tool in iter_mcp_tools(document["definition"])
        for name in tool.get("allowed_tools") or []
        if isinstance(name, str) and name
    }
    missing_tools = sorted(expected_tools - set(result["tools"]))
    if missing_tools:
        return web.json_response({
            **report,
            **result,
            "error": f"MCP tools/list is missing expected tools: {missing_tools}",
        })
    return web.json_response({
        **report,
        **result,
        "ok": True,
        "reached": True,
        "auth_gate": False,
        "message": "MCP handshake and tools/list succeeded.",
    })


async def probe_published_mcp(request: web.Request) -> web.Response:
    cfg = await _cfg(request)
    try:
        body = await request.json()
        agent_name = str(body.get("agent") or "").strip()
        server_label = str(body.get("server_label") or "").strip()
        if not AGENT_NAME.fullmatch(agent_name):
            raise ValueError(
                "Agent name must be 1-63 characters and contain only letters, "
                "numbers, '.', '_', or '-'."
            )
        agent = await asyncio.to_thread(get_agent, cfg, agent_name)
    except (json.JSONDecodeError, ValueError) as error:
        raise web.HTTPBadRequest(text=str(error)) from error
    except Exception as error:
        return web.json_response(
            {"ok": False, "error": f"{type(error).__name__}: {error}"},
            status=502,
        )
    definition = (
        ((agent.get("versions") or {}).get("latest") or {}).get("definition")
        or agent.get("definition")
        or {}
    )
    tool = next(
        (
            item
            for item in iter_mcp_tools(definition)
            if not server_label or item.get("server_label") == server_label
        ),
        None,
    )
    if tool is None:
        return web.json_response({
            "ok": False,
            "no_mcp": True,
            "server_label": server_label,
            "error": f"the published '{agent_name}' declares no MCP server '{server_label}'",
        })
    server_url = str(tool.get("server_url") or "")
    allowed_tools = [str(name) for name in tool.get("allowed_tools") or []]
    report = {
        "ok": False,
        "reached": False,
        "server_label": str(tool.get("server_label") or server_label),
        "server_url": server_url,
        "project_connection_id": str(tool.get("project_connection_id") or ""),
        "allowed_tools": allowed_tools,
        "checked_at": time.strftime("%H:%M:%S", time.localtime()),
    }
    if not server_url and report["project_connection_id"]:
        return web.json_response({
            **report,
            "connection_only": True,
            "error": (
                "this MCP tool resolves through a project connection, so it "
                "has no URL the portal can call directly"
            ),
        })
    inline_token = ""
    if tool.get("authorization"):
        try:
            inline_token = normalize_bearer_token(
                str(tool["authorization"])
            )
        except ValueError as error:
            return web.json_response({**report, "error": str(error)})
    try:
        result = await asyncio.to_thread(
            mcp_handshake,
            server_url,
            inline_token,
        )
    except McpProbeError as error:
        if (
            error.http_status in {401, 403}
            and report["project_connection_id"]
        ):
            return web.json_response({
                **report,
                "reached": True,
                "auth_gate": True,
                "project_connection_auth": True,
                "http_status": error.http_status,
                "latency_ms": error.latency_ms,
                "error": (
                    "the endpoint is reachable; authentication is held by "
                    "the Foundry Project connection"
                ),
            })
        return web.json_response({
            **report,
            "reached": bool(error.http_status),
            "http_status": error.http_status,
            "latency_ms": error.latency_ms,
            "error": str(error),
        })
    except Exception as error:
        return web.json_response({**report, "error": f"{type(error).__name__}: {error}"})
    missing = [name for name in allowed_tools if name not in result["tools"]]
    return web.json_response({
        **report,
        **result,
        "ok": not missing,
        "missing_tools": missing,
        "error": (
            f"allowed_tools missing on the server: {', '.join(missing)}"
            if missing
            else ""
        ),
    })


async def ensure_template_mcp_connection(
    cfg: AgentsConfig,
    source: TemplateSource,
    definition: dict[str, Any],
) -> str:
    if not list(iter_mcp_tools(definition)):
        return ""
    if source.connection_mode == "public":
        validate_mcp_url(source.mcp_server_url)
        return ""
    if (
        not source.mcp_server_url
        or not source.mcp_connection_id
        or (
            source.connection_mode == "managed"
            and (
                source.mcp_token_file is None
                or not source.mcp_token_file.is_file()
            )
        )
    ):
        raise ValueError(
            "The local MCP config is not ready. Run "
            "VoiceAgent/shared_mcp/scripts/e2e-local.sh and reload templates."
        )
    if source.connection_mode == "managed":
        assert source.mcp_token_file is not None
        bearer_token = normalize_bearer_token(
            source.mcp_token_file.read_text(encoding="utf-8")
        )
        validate_mcp_probe_url(source.mcp_server_url)
        await asyncio.to_thread(
            create_mcp_connection,
            cfg,
            connection_name=source.mcp_connection_id,
            server_url=source.mcp_server_url,
            bearer_token=bearer_token,
        )
    return source.mcp_connection_id


async def configure_template_mcp(request: web.Request) -> web.Response:
    raw_body = await request.read()
    if raw_body:
        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError as error:
            raise web.HTTPBadRequest(text="Expected a JSON object.") from error
        if not isinstance(body, dict):
            raise web.HTTPBadRequest(text="Expected a JSON object.")
        if "token" in body:
            raise web.HTTPConflict(
                text=(
                    "Portal Templates use server-configured MCP settings; "
                    "browser-provided MCP tokens are disabled."
                )
            )
        if body:
            raise web.HTTPBadRequest(
                text="Client-provided MCP configuration is not supported."
            )

    cfg = await _cfg(request)
    template_id = request.match_info["template_id"]
    catalog = _catalog(request)
    version = request.query.get("version", ".")
    document = catalog.document(template_id, version)
    source = catalog.source(template_id, version)
    if document is None or source is None:
        raise web.HTTPNotFound(text="Unknown template or version.")
    try:
        require_template_backend(source, cfg.backend)
        connection_name = await ensure_template_mcp_connection(
            cfg,
            source,
            document["definition"],
        )
    except ValueError as error:
        raise web.HTTPBadRequest(text=str(error)) from error
    except Exception as error:
        return web.json_response(
            {"error": f"{type(error).__name__}: {error}."},
            status=502,
        )
    return web.json_response({
        "configured": bool(connection_name or source.connection_mode == "public"),
        "connection_name": connection_name,
        "backend": cfg.backend,
    })


async def custom_server_tools(server_url: str) -> tuple[str, list[str]]:
    """Validate a user's public MCP URL and list its tools without credentials."""
    url = validate_https_url(server_url, "MCP server URL")
    try:
        result = await asyncio.to_thread(mcp_handshake, url)
    except McpProbeError as error:
        raise ValueError(f"The MCP server could not be reached: {error}") from error
    return url, list(result["tools"])


@dataclass(frozen=True)
class _SystemToolDiscovery:
    """Request-scoped discovery, shared by legacy discovery and one-step connection."""

    group: str
    server_url: str
    tools: list[str]
    required: list[str]
    mapping: dict[str, str]

    def _payload(self) -> dict[str, Any]:
        return {
            "ok": True,
            "group": self.group,
            "server_url": self.server_url,
            "tools": self.tools,
            "required": self.required,
            "mapping": self.mapping,
            "unmapped": [name for name in self.required if not self.mapping[name]],
        }


async def _discover_system_tools(group: dict[str, Any], server_url: str) -> _SystemToolDiscovery:
    logger.info("Discovering MCP tools for system=%s", group["id"])
    url, tools = await custom_server_tools(server_url)
    mapping = suggest_tool_map(group["tools"], tools)
    logger.info("Discovered MCP tools for system=%s count=%s", group["id"], len(tools))
    return _SystemToolDiscovery(group["id"], url, tools, group["tools"], mapping)


def catalog_mock_url(catalog: TemplateCatalog) -> str:
    """The mock-tool-call server URL that the catalog's mock-tool Templates use."""
    for card in catalog.cards():
        source = catalog.source(card["id"])
        if source and source.connection_mode == "public" and source.mcp_server_url.endswith(MOCK_ROUTE_SUFFIX):
            return source.mcp_server_url
    return ""


async def _tool_request(request: web.Request) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Read a working definition and one of its systems from a tool-connection request."""
    try:
        body = await request.json()
    except json.JSONDecodeError as error:
        raise web.HTTPBadRequest(text="Expected a JSON object.") from error
    if not isinstance(body, dict) or not isinstance(body.get("definition"), dict):
        raise web.HTTPBadRequest(text="Expected a JSON object with a definition.")
    definition = body["definition"]
    groups = {group["id"]: group for group in definition_tool_groups(definition)}
    group = groups.get(str(body.get("group") or ""))
    if group is None:
        raise web.HTTPBadRequest(text="The definition has no tools for that system.")
    return body, definition, group


async def list_definition_tool_groups(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError as error:
        raise web.HTTPBadRequest(text="Expected a JSON object.") from error
    if not isinstance(body, dict) or not isinstance(body.get("definition"), dict):
        raise web.HTTPBadRequest(text="Expected a JSON object with a definition.")
    return web.json_response({"groups": definition_tool_groups(body["definition"])})


async def discover_definition_tools(request: web.Request) -> web.Response:
    """Keep the legacy discovery-only API without applying a connection.

    Parameters
    ----------
    request : web.Request
        Working definition, system id, and MCP URL.

    Returns
    -------
    web.Response
        The existing discovery payload or an explicit discovery error.
    """
    body, _, group = await _tool_request(request)
    if not group["connectable"] or not group["tools"]:
        logger.error("MCP discovery is unavailable for system=%s", group["id"])
        return web.json_response({"ok": False, "error": f"{group['label']} cannot be connected here."})
    try:
        discovery = await _discover_system_tools(group, str(body.get("server_url") or ""))
    except ValueError as error:
        logger.error("MCP discovery failed for system=%s error=%s", group["id"], type(error).__name__)
        return web.json_response({"ok": False, "error": str(error)})
    return web.json_response(discovery._payload())


async def connect_definition_tools(request: web.Request) -> web.Response:
    """Discover and connect one system using exactly one fresh MCP handshake.

    Parameters
    ----------
    request : web.Request
        Working definition, system, URL, and optional explicit tool mapping.

    Returns
    -------
    web.Response
        Connected definition, or discovery with connected=false when mapping is needed.

    Raises
    ------
    web.HTTPBadRequest
        If the system, server, or explicit mapping is invalid.
    """
    body, definition, group = await _tool_request(request)
    if not group["connectable"] or not group["tools"]:
        logger.error("MCP connection is unavailable for system=%s", group["id"])
        raise web.HTTPBadRequest(text=f"{group['label']} cannot be connected here.")
    try:
        discovery = await _discover_system_tools(group, str(body.get("server_url") or ""))
        payload = discovery._payload()
        if "tool_map" not in body and payload["unmapped"]:
            logger.info("MCP connection requires manual mapping for system=%s", group["id"])
            return web.json_response({**payload, "connected": False})
        proposed = body["tool_map"] if "tool_map" in body else discovery.mapping
        tool_map = validate_tool_map(group["tools"], discovery.tools, proposed)
    except ValueError as error:
        logger.error("MCP connection failed for system=%s error=%s", group["id"], type(error).__name__)
        raise web.HTTPBadRequest(text=str(error)) from error
    updated = apply_tool_servers(definition, {group["id"]: (discovery.server_url, tool_map)})
    logger.info("Connected MCP tools for system=%s", group["id"])
    return web.json_response({
        **payload,
        "connected": True,
        "definition": updated,
        "tool_map": tool_map,
        "groups": definition_tool_groups(updated),
    })


async def disconnect_definition_tools(request: web.Request) -> web.Response:
    body, definition, group = await _tool_request(request)
    tool_map = body.get("tool_map")
    if not group["connected"] or not isinstance(tool_map, dict):
        raise web.HTTPBadRequest(text=f"{group['label']} is not connected to your server.")
    mock_url = catalog_mock_url(_catalog(request))
    if not mock_url:
        raise web.HTTPBadRequest(text="No mock tool server is configured.")
    updated = revert_tool_server(
        definition, group["id"], {str(key): str(value) for key, value in tool_map.items()}, mock_url,
    )
    return web.json_response({"definition": updated, "groups": definition_tool_groups(updated)})


async def publish_template(request: web.Request) -> web.Response:
    cfg = await _cfg(request)
    template_id = request.match_info["template_id"]
    catalog = _catalog(request)
    version = request.query.get("version", ".")
    document = catalog.document(template_id, version)
    source = catalog.source(template_id, version)
    if document is None or source is None:
        raise web.HTTPNotFound(text="Unknown template or version.")
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("Expected a JSON object.")
        name = template_agent_name(str(body.get("name") or ""), template_id)
        require_template_backend(source, cfg.backend)
        connection_name = await ensure_template_mcp_connection(
            cfg,
            source,
            document["definition"],
        )
        definition = materialize_template(
            document,
            model=(
                ""
                if source.lock_runtime
                else str(body.get("model") or request.app[MODEL_OVERRIDE_KEY])
            ),
            voice="" if source.lock_runtime else str(body.get("voice") or ""),
            mcp_server_url=source.mcp_server_url,
            mcp_connection_id=connection_name,
            mcp_public=source.connection_mode == "public",
        )
        result = await asyncio.to_thread(
            publish_agent,
            cfg,
            name=name,
            metadata={"source_template_id": template_id, "source_template_version": version},
            description=str(document.get("description") or ""),
            definition=definition,
        )
    except (json.JSONDecodeError, ValueError) as error:
        raise web.HTTPBadRequest(text=str(error)) from error
    except Exception as error:
        return web.json_response(
            {"error": f"{type(error).__name__}: {error}."},
            status=502,
        )
    return web.json_response({
        **result,
        "agent_name": result["name"],
        "backend": cfg.project,
        "source_agent_name": str(document.get("name") or template_id),
        "source_template_version": version,
        "mcp_connection_name": connection_name,
    }, status=201)


def install_template_routes(
    app: web.Application,
    *,
    cfg: AgentsConfig,
    config_resolver,
    model_override: str = "",
    template_config_path: Path = DEFAULT_TEMPLATE_CONFIG,
) -> None:
    app[AGENTS_CONFIG_KEY] = cfg
    app[CONFIG_RESOLVER_KEY] = config_resolver
    app[CATALOG_KEY] = TemplateCatalog(template_config_path)
    app[MODEL_OVERRIDE_KEY] = model_override
    app.router.add_get("/templates", templates_index)
    app.router.add_get("/templates/", templates_index)
    app.router.add_get("/guide/run-samples", examples_guide)
    app.router.add_get("/guide/real-tools", real_tools_guide)
    app.router.add_get("/guide/logic-apps-mcp", logic_apps_mcp_guide)
    app.router.add_get("/api/config", template_config)
    app.router.add_get("/api/templates", list_templates)
    app.router.add_get("/api/templates/env", templates_env)
    app.router.add_get("/api/templates/{template_id}", get_template)
    app.router.add_get("/api/templates/{template_id}/try-it", template_try_it)
    app.router.add_get(
        "/api/templates/{template_id}/mcp/probe",
        probe_template_mcp,
    )
    app.router.add_post(
        "/api/templates/{template_id}/mcp/configure",
        configure_template_mcp,
    )
    app.router.add_post("/api/tools/groups", list_definition_tool_groups)
    app.router.add_post("/api/tools/discover", discover_definition_tools)
    app.router.add_post("/api/tools/connect", connect_definition_tools)
    app.router.add_post("/api/tools/disconnect", disconnect_definition_tools)
    app.router.add_post("/api/templates/{template_id}/publish", publish_template)
    app.router.add_get("/static/{asset}", template_asset)
