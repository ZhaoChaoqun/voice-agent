"""Create a Foundry Voice Agent and connect it to Genesys Audio Connector."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

API_VERSION = "v1"
TOKEN_RESOURCE = "https://ai.azure.com"
PROVIDER = "genesys-audiohook"


def project_endpoint(value: str | None) -> str:
    """Validate the credential destination before asking Azure CLI for a token."""
    value = (value or "").strip().rstrip("/")
    message = "Set PROJECT_ENDPOINT to https://<resource>.services.ai.azure.com/api/projects/<project>."
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise ValueError(message) from None
    if (
        any(character.isspace() or ord(character) < 32 for character in value)
        or parsed.scheme != "https"
        or not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.services\.ai\.azure\.com",
            parsed.hostname or "",
        )
        or port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or "?" in value
        or "#" in value
        or not re.fullmatch(r"/api/projects/(?:_project|[A-Za-z0-9][A-Za-z0-9_-]*)", parsed.path)
    ):
        raise ValueError(message)
    return f"https://{parsed.hostname}{parsed.path}"


def agent_path(name: str | None) -> str:
    if not name or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,62}", name):
        raise ValueError("Set --agent-name to 1-63 letters, digits, hyphens or underscores, starting with a letter or digit.")
    return "/agents/" + quote(name, safe="")


def connection_uri(endpoint: str | None, name: str | None) -> str:
    endpoint = project_endpoint(endpoint)
    path = agent_path(name) + "/endpoint/protocols/voice/telephony/" + PROVIDER
    return "wss://" + endpoint.removeprefix("https://") + path + "?api-version=" + API_VERSION


def voice_definition(model: str, model_type: str, voice: str) -> dict:
    if not model or not model.strip() or not voice or not voice.strip():
        raise ValueError("Set a model and voice before creating the Agent.")
    if model_type not in ("managed", "self_deployed"):
        raise ValueError("Model type must be managed or self_deployed.")
    return {
        "kind": "voice",
        "model_type": model_type,
        "model": model.strip(),
        "instructions": (
            "You are a friendly telephone assistant. Keep answers brief and natural. "
            "Ask one question at a time and listen when the caller interrupts. "
            "When the caller finishes or asks to leave the assistant, say a brief closing "
            "message and invoke end_conversation exactly once in the same response. "
            "The call flow handles the next step. Do not speak after invoking the tool."
        ),
        "audio": {
            "input": {"format": {"type": "audio/pcm", "rate": 24000}},
            "output": {
                "format": {"type": "audio/pcm", "rate": 24000},
                "voice": voice.strip(),
                "voice_type": "azure-standard",
            },
        },
        "output_modalities": ["audio"],
        "tools": [{
            "type": "system", "name": "end_conversation",
            "description": "After saying a brief closing message, end the assistant session and return to the call flow.",
        }],
        "store": False,
    }


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def access_token() -> str:
    executable = shutil.which("az") or shutil.which("az.cmd")
    if executable is None:
        raise RuntimeError("Run this command from an Azure CLI environment signed in with az login.")
    try:
        result = subprocess.run(
            [executable, "account", "get-access-token", "--resource", TOKEN_RESOURCE,
             "--query", "accessToken", "--output", "tsv"],
            capture_output=True, text=True, timeout=60, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("Azure CLI could not obtain a token. Check az login before retrying.") from None
    token = result.stdout.strip()
    if result.returncode or not token or any(character.isspace() for character in token):
        raise RuntimeError("Azure CLI could not obtain a token. Check az login before retrying.")
    return token


def request(endpoint: str, operation: dict) -> dict:
    endpoint = project_endpoint(endpoint)
    url = endpoint + operation["path"] + "?" + urlencode({
        "api-version": API_VERSION, **operation.get("params", {}),
    })
    body = operation.get("body")
    outgoing = Request(
        url, method=operation["method"],
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={
            "Authorization": "Bearer " + access_token(),
            "Content-Type": "application/json",
            "Foundry-Features": "VoiceAgents=V1Preview",
        },
    )
    try:
        with build_opener(NoRedirect()).open(outgoing, timeout=60) as response:
            if response.status == 202:
                raise RuntimeError("The operation was accepted and is still pending. Check its state before retrying.")
            raw = response.read()
    except HTTPError as error:
        raise RuntimeError(f"{operation['method']} returned HTTP {error.code}.") from None
    except (URLError, OSError):
        raise RuntimeError("The request did not complete. Check the Agent state before retrying.") from None
    try:
        return json.loads(raw) if raw else {}
    except (ValueError, UnicodeDecodeError):
        raise RuntimeError("The service returned an unexpected response. Check the Agent state before retrying.") from None


def operation_for(args: argparse.Namespace) -> dict:
    path = agent_path(args.agent_name)
    if args.command == "create":
        return {"method": "POST", "path": "/agents", "body": {
            "name": args.agent_name,
            "description": "Voice assistant for a Genesys Audio Connector call flow.",
            "definition": voice_definition(args.model, args.model_type, args.voice),
        }}
    if args.command == "calls":
        return {"method": "GET", "path": path + "/telephony/calls",
                "params": {"provider": PROVIDER, "limit": 20}}
    if args.command == "delete":
        return {"method": "DELETE", "path": path}
    raise ValueError("Choose create, calls, delete, or endpoint.")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    for name in ("create", "endpoint", "calls", "delete"):
        command = commands.add_parser(name)
        command.add_argument("--project-endpoint", default=os.getenv("PROJECT_ENDPOINT"))
        command.add_argument("--agent-name", default=os.getenv("AGENT_NAME", "genesys-voice-demo"))
        if name != "endpoint":
            command.add_argument("--dry-run", action="store_true", help="Print the REST operation without sending it")
        if name == "create":
            command.add_argument("--model", default=os.getenv("VOICE_MODEL", "gpt-realtime"))
            command.add_argument("--model-type", choices=("managed", "self_deployed"),
                                 default=os.getenv("VOICE_MODEL_TYPE", "managed"))
            command.add_argument("--voice", default=os.getenv("VOICE", "en-US-AvaNeural"))
    return result


def main(argv: list[str] | None = None) -> None:
    args = parser().parse_args(argv)
    if args.command == "endpoint":
        print(connection_uri(args.project_endpoint, args.agent_name))
        return
    operation = operation_for(args)
    if args.dry_run:
        print(json.dumps(operation, indent=2))
        return
    result = request(args.project_endpoint, operation)
    if args.command == "create":
        result = {"agent": result, "connection_uri": connection_uri(args.project_endpoint, args.agent_name)}
    elif args.command == "delete":
        result = {"deleted_agent": args.agent_name}
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from None
