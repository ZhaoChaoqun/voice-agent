#!/usr/bin/env python3
"""Give a published Conference Concierge Agent a Twilio phone number.

    python bind_phone.py bind --agent-name <agent> --connection <twilio-connection> --phone-number +15551234567
    python bind_phone.py show --agent-name <agent>
    python bind_phone.py calls --agent-name <agent>
    python bind_phone.py unbind --agent-name <agent> --binding-id twilio:15551234567 --yes

The Foundry Agent Service answers the calls itself: `bind` creates a Twilio telephony binding,
and the service points the number's incoming-call webhook at the Agent. The script needs an
existing Foundry connection of category Twilio (target: Account SID, key: Auth Token) and a
voice-capable number in that Twilio account. It never reads or prints the Auth Token.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from urllib.parse import quote, urlsplit

TOKEN_SCOPE = "https://ai.azure.com/.default"
E164 = re.compile(r"\+[1-9]\d{6,14}")
AGENT_NAME = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?")


def required(value: str | None, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} is required")
    return value.strip()


def project_endpoint(value: str | None) -> str:
    endpoint = required(value, "PROJECT_ENDPOINT / --project-endpoint").rstrip("/")
    parsed = urlsplit(endpoint)
    if (
        parsed.scheme != "https"
        or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.services\.ai\.azure\.com", parsed.hostname or "")
        or parsed.port not in (None, 443) or parsed.username or parsed.password
        or parsed.query or parsed.fragment
        or not re.fullmatch(r"/api/projects/[^/]+", parsed.path)
    ):
        raise ValueError("Use https://<resource>.services.ai.azure.com/api/projects/<project>")
    return endpoint


def agent_path(name: str | None) -> str:
    name = required(name, "--agent-name")
    if not AGENT_NAME.fullmatch(name):
        raise ValueError("--agent-name must be a Foundry Agent name")
    return "/agents/" + quote(name, safe="")


def phone_number(value: str | None) -> str:
    number = required(value, "--phone-number").replace(" ", "").replace("-", "")
    if not E164.fullmatch(number):
        raise ValueError("--phone-number must be E.164, for example +15551234567")
    return number


def binding_body(connection: str | None, number: str | None, label: str | None) -> dict:
    body = {
        "provider": "twilio",
        "connection": required(connection, "--connection / TWILIO_CONNECTION_NAME"),
        "phone_number": phone_number(number),
    }
    if label:
        body["label"] = label
    return body


def request(session, credential, endpoint: str, method: str, path: str, **kwargs):
    """Send one authenticated Agents REST request; errors keep only the status and request ID."""
    endpoint = project_endpoint(endpoint)
    headers = {
        "Authorization": f"Bearer {credential.get_token(TOKEN_SCOPE).token}",
        "Content-Type": "application/json",
        **kwargs.pop("headers", {}),
    }
    response = session.request(
        method, endpoint + path, params={"api-version": "v1", **kwargs.pop("params", {})},
        headers=headers, timeout=60, allow_redirects=False, **kwargs,
    )
    if not 200 <= response.status_code < 300:
        request_id = response.headers.get("x-ms-request-id") or response.headers.get("apim-request-id") or "not supplied"
        try:
            error = response.json().get("error") or {}
        except ValueError:
            error = {}
        detail = f"; {error.get('code')}: {error.get('message')}" if error.get("code") else ""
        raise RuntimeError(f"{method} {path}: HTTP {response.status_code}{detail}; request-id={request_id}")
    return response


def execute(args, send):
    """Perform only the requested operation; `send` is the REST function (None for --dry-run)."""
    bindings = agent_path(args.agent_name) + "/telephony/bindings"
    if args.command == "bind":
        body = binding_body(args.connection, args.phone_number, args.label)
        if args.dry_run:
            return {"method": "POST", "path": bindings, "body": body}
        binding = send("POST", bindings, json=body).json()
        return {
            "binding": binding,
            "call": binding.get("phone_number"),
            "note": "The service set this number's Twilio Voice webhook to incoming_call_url.",
        }
    if args.command == "show":
        return send("GET", bindings, params={"provider": "twilio"}).json()
    if args.command == "calls":
        return send("GET", agent_path(args.agent_name) + "/telephony/calls",
                    params={"provider": "twilio", "limit": args.limit}).json()
    if args.command == "unbind":
        if not args.yes:
            raise ValueError("Pass --yes to stop routing new calls on this number to the Agent")
        binding_path = bindings + "/" + quote(required(args.binding_id, "--binding-id"), safe="")
        current = send("GET", binding_path)
        if current.json().get("provider") != "twilio":
            raise ValueError("Refusing to delete a non-Twilio binding")
        etag = current.headers.get("ETag")
        if not etag or not etag.strip() or etag == "*":
            raise RuntimeError("Binding GET returned no usable ETag; no DELETE was sent")
        send("DELETE", binding_path, headers={"If-Match": etag})
        return {"deleted_binding": args.binding_id, "agent_retained": args.agent_name}
    raise ValueError(f"Unknown command: {args.command}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project-endpoint", default=os.getenv("PROJECT_ENDPOINT") or os.getenv("AZURE_VOICE_AGENTS_ENDPOINT"))
    commands = parser.add_subparsers(dest="command", required=True)
    bind = commands.add_parser("bind", help="Route calls on a Twilio number to the Agent")
    bind.add_argument("--agent-name", required=True)
    bind.add_argument("--connection", default=os.getenv("TWILIO_CONNECTION_NAME"), help="Foundry connection of category Twilio")
    bind.add_argument("--phone-number", default=os.getenv("TWILIO_PHONE_NUMBER"), help="Voice-capable number in that Twilio account, E.164")
    bind.add_argument("--label", default="conference-concierge-phone")
    bind.add_argument("--dry-run", action="store_true", help="Print the request without authentication or network calls")
    show = commands.add_parser("show", help="List the Agent's Twilio bindings")
    show.add_argument("--agent-name", required=True)
    calls = commands.add_parser("calls", help="List the Agent's latest Twilio calls")
    calls.add_argument("--agent-name", required=True)
    calls.add_argument("--limit", type=int, default=10)
    unbind = commands.add_parser("unbind", help="Remove one Twilio binding; keeps the Agent, connection, and number")
    unbind.add_argument("--agent-name", required=True)
    unbind.add_argument("--binding-id", required=True, help="For example twilio:15551234567, from `show`")
    unbind.add_argument("--yes", action="store_true")
    return parser


def main() -> None:
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
        endpoint = project_endpoint(args.project_endpoint)
        import requests
        from azure.identity import DefaultAzureCredential

        with DefaultAzureCredential() as credential, requests.Session() as session:
            result = execute(args, lambda method, path, **kw: request(session, credential, endpoint, method, path, **kw))
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
