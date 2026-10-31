#!/usr/bin/env python3
"""Create a GPT Live agent with model Responses delegation and bind a SIP connection."""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit

TOKEN_SCOPE = "https://ai.azure.com/.default"
ARM_TOKEN_SCOPE = "https://management.azure.com/.default"
CONNECTION_API_VERSION = "2025-06-01"
FEATURE_HEADERS = {"Foundry-Features": "VoiceAgents=V1Preview"}

# Separate frontend conversation instructions from backend response instructions.
FRONTEND_INSTRUCTIONS = """You are a friendly telephone assistant. Speak in the caller's language.
Keep each reply short and natural. Wait for the caller to speak first.
Backchannel policy: Briefly acknowledge the caller without taking over their speech.
Interruption policy: Stop speaking and listen when the caller interrupts.
Delegation policy:
Backend tools:
- Assistant: answers questions and helps with explanations.
Delegate to the backend when the caller asks a substantive question.
Do not delegate greetings, short clarifications, or repetition of an answer already received.
Do not guess while waiting. Deliver the backend's answer naturally, without markdown.
Closing policy: When the caller explicitly finishes or asks to hang up, use the platform's
end_conversation capability. Follow its farewell and delegation instructions.
Never claim to send messages or perform an unavailable action."""

BACKEND_INSTRUCTIONS = """Help a telephone assistant answer the caller's question.
Return a concise, speech-friendly answer in the caller's language, usually one or two sentences.
Treat transcripts as imperfect; ask for clarification when needed. Do not invent facts or actions.
Follow the platform's end_conversation instructions when the frontend delegates an explicit ending.
Do not claim to send messages or perform an unavailable action."""


def required(value: str | None, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} is required")
    return value.strip()


def project_endpoint(value: str | None) -> str:
    endpoint = required(value, "PROJECT_ENDPOINT / --project-endpoint").rstrip("/")
    parsed = urlsplit(endpoint)
    if (
        parsed.scheme != "https"
        or not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.services\.ai\.azure\.com",
            parsed.hostname or "",
        )
        or parsed.port not in (None, 443) or parsed.username
        or parsed.password or "?" in endpoint or "#" in endpoint
        or not parsed.path.startswith("/api/projects/")
        or len(parsed.path.split("/")) != 4
        or not parsed.path.split("/")[-1]
    ):
        raise ValueError("Use https://<resource>.services.ai.azure.com/api/projects/<project>")
    return endpoint


def voice_definition(model: str, voice: str, responses_model: str | None,
                     transfer_targets: list[dict] | None = None) -> dict:
    targets = transfer_targets or []
    definition = {
        "kind": "voice", "sub_protocol": "live", "model_type": "self_deployed",
        "model": required(model, "GPT_LIVE_MODEL_DEPLOYMENT / --live-model"),
        "instructions": FRONTEND_INSTRUCTIONS,
        "store": False,
        "tools": [{"type": "system", "name": "end_conversation"}],
        "audio": {
            "format": {"type": "audio/pcm", "rate": 24000},
            "output": {"voice": required(voice, "--voice")},
        },
        "delegation": {
            "type": "responses",
            "responses": {
                "model": required(responses_model, "RESPONSES_MODEL_DEPLOYMENT / --responses-model"),
                "instructions": BACKEND_INSTRUCTIONS,
            },
        },
    }
    if targets:
        definition["tools"].append({
            "type": "system", "name": "transfer", "timeout_seconds": 60,
            "targets": [{
                "name": target["name"], "description": target["description"],
                "destinations": [target["destination"]],
                "routing": {"strategy": "sequential", "ring_timeout_seconds": 20},
            } for target in targets],
        })
    return definition


def target_name(value: str) -> str:
    value = required(value, "transfer target name")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", value):
        raise ValueError("Transfer target names use 1-64 letters, digits, '_' or '-', starting with a letter or digit")
    return value


def transfer_targets_body(filename: str) -> dict:
    body = json.loads(Path(filename).read_text(encoding="utf-8"))
    if not isinstance(body, dict) or set(body) != {"transfer_targets"} or not isinstance(body["transfer_targets"], list):
        raise ValueError("Targets file must contain only a transfer_targets array")
    names = set()
    for target in body["transfer_targets"]:
        if not isinstance(target, dict) or set(target) != {"name", "description", "destination"}:
            raise ValueError("Each target requires name, description, and destination")
        name = target_name(target["name"])
        if name != target["name"] or name.lower() in names:
            raise ValueError("Transfer target names must be unique and have no surrounding whitespace")
        names.add(name.lower())
        required(target["description"], "transfer target description")
        destination = target["destination"]
        if (not isinstance(destination, dict) or set(destination) != {"type", "value"}
                or destination["type"] != "phone_number"
                or not isinstance(destination["value"], str)
                or not re.fullmatch(r"\+[1-9][0-9]{6,14}", destination["value"])):
            raise ValueError("This SIP sample supports destination.type=phone_number with an E.164 value")
    return body


def binding_body(connection: str, allowed_callers: list[str]) -> dict:
    body = {"provider": "sip", "connection_name": required(connection, "SIP_CONNECTION_NAME / --connection")}
    if allowed_callers:
        body["allowed_calling_numbers"] = allowed_callers
    return body


def agent_path(name: str) -> str:
    return f"/agents/{quote(required(name, '--agent-name'), safe='')}"


def connection_path(resource_id: str | None, name: str | None) -> str:
    resource_id = required(resource_id, "PROJECT_RESOURCE_ID / --project-resource-id").rstrip("/")
    name = required(name, "SIP_CONNECTION_NAME / --connection")
    segment = r"[a-zA-Z0-9_.()-]+"
    subscription = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    if not re.fullmatch(
        rf"/subscriptions/{subscription}/resourceGroups/{segment}"
        rf"/providers/Microsoft\.CognitiveServices/accounts/{segment}/projects/{segment}",
        resource_id, re.IGNORECASE,
    ) or any(part in (".", "..") for part in resource_id.split("/")):
        raise ValueError("Use the project ARM resource ID: /subscriptions/<id>/resourceGroups/<group>"
                         "/providers/Microsoft.CognitiveServices/accounts/<account>/projects/<project>")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]*", name):
        raise ValueError("Connection name must start with a letter or digit and use letters, digits, '_' or '-'")
    return resource_id + "/connections/" + name


def connection_body(auth_type: str | None, *, preview: bool = False) -> dict:
    auth_type = auth_type or "digest"
    if auth_type == "digest":
        if preview:
            keys = {"username": "<from SIP_USERNAME>", "password": "<from SIP_PASSWORD>"}
        else:
            username = required(os.getenv("SIP_USERNAME"), "SIP_USERNAME for a new digest connection")
            password = os.getenv("SIP_PASSWORD")
            required(password, "SIP_PASSWORD for a new digest connection")
            keys = {"username": username, "password": password}  # Preserve password whitespace.
    elif auth_type == "ip_acl":
        if preview:
            keys = {"source_cidrs": "<from SIP_SOURCE_CIDRS>"}
        else:
            cidrs = required(os.getenv("SIP_SOURCE_CIDRS"), "SIP_SOURCE_CIDRS for a new IP ACL connection")
            try:
                for cidr in cidrs.split(","):
                    ipaddress.ip_network(cidr.strip(), strict=False)
            except ValueError:
                raise ValueError("SIP_SOURCE_CIDRS must be a non-empty, comma-separated list of IPs or CIDRs") from None
            keys = {"source_cidrs": cidrs}
    else:
        raise ValueError("SIP_AUTH_TYPE / --auth-type must be digest or ip_acl")
    return {"properties": {
        "category": "SipInbound", "target": "sip", "authType": "CustomKeys",
        "metadata": {"sip_auth_type": auth_type}, "credentials": {"keys": keys},
    }}


def arm_request(session, credential, method: str, path: str, *, allow_not_found: bool = False, **kwargs):
    """Use ARM credentials only for the fixed public-cloud connection endpoint."""
    resource_id, _, name = path.rpartition("/connections/")
    path = connection_path(resource_id, name)  # Validate before acquiring an ARM token.
    response = session.request(
        method, "https://management.azure.com" + path,
        params={"api-version": CONNECTION_API_VERSION},
        headers={"Authorization": f"Bearer {credential.get_token(ARM_TOKEN_SCOPE).token}",
                 "Content-Type": "application/json"},
        timeout=60, allow_redirects=False, **kwargs,
    )
    if not 200 <= response.status_code < 300 and not (
        allow_not_found and method == "GET" and response.status_code == 404
    ):
        request_id = response.headers.get("x-ms-request-id", "not supplied")
        raise RuntimeError(f"{method} connection: HTTP {response.status_code}; request-id={request_id}")
    return response


def prepare_connection(args, send):
    path = connection_path(args.project_resource_id, args.connection)
    if args.dry_run:
        return {"method": "GET", "path": path, "if_missing": {
            "method": "PUT", "body": connection_body(args.auth_type, preview=True),
        }}
    current = send("GET", path, allow_not_found=True)
    created = current.status_code == 404
    if created:
        result = send("PUT", path, json=connection_body(args.auth_type))
        if result.status_code == 202:
            raise RuntimeError("Connection creation was accepted but is not confirmed complete; "
                               "inspect the connection in ARM before retrying or binding")
        current = send("GET", path)
    properties = current.json().get("properties") or {}
    if properties.get("category") != "SipInbound" or properties.get("authType") != "CustomKeys":
        raise ValueError("Connection must be SipInbound with CustomKeys; choose another name, not an update")
    auth_type = ((properties.get("metadata") or {}).get("sip_auth_type") or "digest").strip().lower()
    if auth_type not in ("digest", "ip_acl") or (args.auth_type and args.auth_type != auth_type):
        raise ValueError("Connection authentication mode does not match; use its mode or choose another name")
    # Never print a server response that could include credentials.
    return {"connection_name": args.connection.strip(), "resource_id": path,
            "status": "created" if created else "existing", "auth_type": auth_type}


def request(session, credential, endpoint: str, method: str, path: str, **kwargs):
    """Send an authenticated Agents REST request without automatic retries."""
    endpoint = project_endpoint(endpoint)  # Validate the token destination before acquiring a token.
    headers = {
        "Authorization": f"Bearer {credential.get_token(TOKEN_SCOPE).token}",
        "Content-Type": "application/json", **FEATURE_HEADERS,
        **kwargs.pop("headers", {}),
    }
    response = session.request(
        method, endpoint + path, params={"api-version": "v1", **kwargs.pop("params", {})},
        headers=headers, timeout=60, allow_redirects=False, **kwargs,
    )
    if not 200 <= response.status_code < 300:
        # Do not echo credentials, raw response bodies, or authorization headers.
        request_id = response.headers.get("x-ms-request-id", "not supplied")
        raise RuntimeError(f"{method} {path}: HTTP {response.status_code}; request-id={request_id}")
    return response


def execute(args, send):
    """Perform only the explicitly requested operation; `send` is the REST function."""
    if args.command == "connection":
        return prepare_connection(args, send)
    if args.command == "create":
        body = {
            "name": required(args.agent_name, "--agent-name"),
            "definition": voice_definition(args.live_model, args.voice, args.responses_model,
                transfer_targets_body(args.transfer_targets_file)["transfer_targets"] if args.transfer_targets_file else None),
        }
        if args.dry_run:
            return {"method": "POST", "path": "/agents", "body": body}
        return send("POST", "/agents", json=body).json()

    path = agent_path(args.agent_name)
    bindings = path + "/telephony/bindings"
    if args.command == "targets":
        targets_path = path + "/telephony/transfer_targets"
        if not args.file:
            if args.dry_run:
                return {"method": "GET", "path": targets_path}
            response = send("GET", targets_path)
            return {"configuration": response.json(), "etag": response.headers.get("ETag")}
        body = transfer_targets_body(args.file)
        if args.dry_run:
            return {"method": "GET", "path": targets_path, "then": {
                "method": "PUT", "path": targets_path, "headers": {"If-Match": "<ETag from GET>"}, "body": body,
            }}
        if not args.yes:
            raise ValueError("Pass --yes to replace the agent's complete transfer-target configuration")
        current = send("GET", targets_path)
        etag = current.headers.get("ETag")
        if not etag or not etag.strip() or etag == "*":
            raise RuntimeError("Targets GET returned no usable ETag; no PUT was sent")
        response = send("PUT", targets_path, json=body, headers={"If-Match": etag})
        return {"configuration": response.json(), "etag": response.headers.get("ETag")}
    if args.command in ("transfer", "end"):
        call_path = path + "/telephony/calls/" + quote(required(args.call_id, "--call-id"), safe="")
        kwargs = {"json": {"target": target_name(args.target)}} if args.command == "transfer" else {}
        if args.dry_run:
            return {"method": "POST", "path": call_path + ":" + args.command, **kwargs}
        return send("POST", call_path + ":" + args.command, **kwargs).json()
    if args.command == "bind":
        body = binding_body(args.connection, args.allowed_caller)
        if args.dry_run:
            return {"method": "POST", "path": bindings, "body": body}
        response = send("POST", bindings, json=body)
        binding = response.json()
        # Print the server-owned ID/URI unchanged. Never construct a SIP address.
        return {"binding": binding, "etag": response.headers.get("ETag")}
    if args.command == "calls":
        if args.call_id:
            return send("GET", path + "/telephony/calls/" + quote(args.call_id, safe="")).json()
        return send("GET", path + "/telephony/calls", params={"provider": "sip", "limit": 20}).json()
    if args.command == "show":
        if args.binding_id:
            response = send("GET", bindings + "/" + quote(args.binding_id, safe=""))
            return {"binding": response.json(), "etag": response.headers.get("ETag")}
        return send("GET", bindings, params={"provider": "sip"}).json()
    if args.command == "unbind":
        if not args.yes:
            raise ValueError("Pass --yes to remove this binding's routing for new calls")
        binding_path = bindings + "/" + quote(args.binding_id, safe="")
        current = send("GET", binding_path)
        if current.json().get("provider") != "sip":
            raise ValueError("Refusing to delete a non-SIP binding")
        etag = current.headers.get("ETag")
        if not etag or not etag.strip() or etag == "*":
            raise RuntimeError("Binding GET returned no usable ETag; no DELETE was sent")
        send("DELETE", binding_path, headers={"If-Match": etag})
        return {"deleted_binding": args.binding_id, "agent_retained": args.agent_name}
    raise ValueError(f"Unknown command: {args.command}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-endpoint", default=os.getenv("PROJECT_ENDPOINT"))
    commands = parser.add_subparsers(dest="command", required=True)
    connection = commands.add_parser("connection", help="Reuse a SIP connection or create it if missing (ARM)")
    connection.add_argument("--project-resource-id", default=os.getenv("PROJECT_RESOURCE_ID"))
    connection.add_argument("--connection", default=os.getenv("SIP_CONNECTION_NAME"))
    connection.add_argument("--auth-type", choices=("digest", "ip_acl"), default=os.getenv("SIP_AUTH_TYPE"),
                            help="New connection mode (default: digest); if set, must match an existing connection")
    connection.add_argument("--dry-run", action="store_true", help="Preview without credentials, secrets, or network calls")
    create = commands.add_parser("create", help="Create a GPT Live agent with model Responses delegation")
    create.add_argument("--agent-name", required=True)
    create.add_argument("--live-model", default=os.getenv("GPT_LIVE_MODEL_DEPLOYMENT"))
    create.add_argument("--voice", default="marin")
    create.add_argument("--responses-model", default=os.getenv("RESPONSES_MODEL_DEPLOYMENT"),
                        help="Model deployment used directly by the Responses backend (not an Agent name)")
    create.add_argument("--transfer-targets-file", help="JSON target configuration used to declare the shared transfer system tool")
    create.add_argument("--dry-run", action="store_true", help="Print JSON without authentication or network calls")
    bind = commands.add_parser("bind", help="Create a SIP binding to an existing connection")
    bind.add_argument("--agent-name", required=True)
    bind.add_argument("--connection", default=os.getenv("SIP_CONNECTION_NAME"))
    bind.add_argument("--allowed-caller", action="append", default=[], help="Optional E.164 caller or supported anchored pattern; repeatable")
    bind.add_argument("--dry-run", action="store_true")
    show = commands.add_parser("show", help="Read a binding or the first SIP binding page")
    show.add_argument("--agent-name", required=True)
    show.add_argument("--binding-id")
    calls = commands.add_parser("calls", help="Read a call or the latest SIP call page")
    calls.add_argument("--agent-name", required=True)
    calls.add_argument("--call-id")
    targets = commands.add_parser("targets", help="Read or replace agent-scoped transfer targets")
    targets.add_argument("--agent-name", required=True)
    targets.add_argument("--file", help="JSON file containing the complete transfer_targets configuration")
    targets.add_argument("--yes", action="store_true", help="Replace all targets, including clearing with an empty array")
    targets.add_argument("--dry-run", action="store_true")
    for command in ("transfer", "end"):
        control = commands.add_parser(command, help=f"Request {command} of one active call (no automatic retry)")
        control.add_argument("--agent-name", required=True)
        control.add_argument("--call-id", required=True)
        if command == "transfer":
            control.add_argument("--target", required=True, help="Configured transfer target name, never a number or URI")
        control.add_argument("--dry-run", action="store_true")
    unbind = commands.add_parser("unbind", help="Remove only the named SIP binding; retain agent/connection")
    unbind.add_argument("--agent-name", required=True)
    unbind.add_argument("--binding-id", required=True)
    unbind.add_argument("--yes", action="store_true")
    return parser


def main() -> None:
    # dotenv is optional for --help and offline dry runs using explicit arguments.
    try:
        from dotenv import load_dotenv
    except ModuleNotFoundError:
        pass
    else:
        load_dotenv(interpolate=False)
    args = build_parser().parse_args()
    if getattr(args, "dry_run", False):
        result = execute(args, None)
    else:
        if args.command == "connection":
            connection_path(args.project_resource_id, args.connection)
        else:
            endpoint = project_endpoint(args.project_endpoint)
        import requests
        from azure.identity import DefaultAzureCredential

        with DefaultAzureCredential() as credential, requests.Session() as session:
            if args.command == "connection":
                result = execute(args, lambda method, path, **kw: arm_request(session, credential, method, path, **kw))
            else:
                result = execute(args, lambda method, path, **kw: request(session, credential, endpoint, method, path, **kw))
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, ModuleNotFoundError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
