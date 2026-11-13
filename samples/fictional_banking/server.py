"""Loopback-only banking UI; no cloud writes on import, startup or connection."""

from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import ipaddress
import json
import logging
import os
import uuid
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import aiohttp
from aiohttp import WSMsgType, web
from azure.core.exceptions import AzureError

from banking import (
    DEFAULT_MODEL, DEFAULT_VOICE, LANGUAGES, MODELS, RATE, ROOT, SCENARIOS,
    check_definition, inputs, load_bindings, project_endpoint, voice_option,
)

LOG = logging.getLogger(__name__)
MAX_FRAME = 128 * 1024
ASSETS = {"app.mjs", "state.mjs", "i18n.mjs", "audio.mjs", "pcm.mjs", "pcm-worklet.mjs", "style.css", "mark.svg"}


@dataclass
class Settings:
    demo: bool = False
    port: int = 8766
    endpoint: str = ""
    bindings: dict[tuple[str, str], dict[str, str]] = field(default_factory=dict)
    credential_mode: str = "cli"
    sockets: set[web.WebSocketResponse] = field(default_factory=set)
    client: Any = None
    credential: Any = None
    http: aiohttp.ClientSession | None = None


SETTINGS = web.AppKey("settings", Settings)


@web.middleware
async def local_only(request: web.Request, handler):
    settings = request.app[SETTINGS]
    failure = None
    try:
        peer = ipaddress.ip_address(request.remote or "")
        loopback = peer.is_loopback
    except ValueError:
        loopback = False
    if not loopback or request.host not in {f"127.0.0.1:{settings.port}", f"localhost:{settings.port}"}:
        raise web.HTTPForbidden(text="Open this sample on its printed loopback address.")
    origin = request.headers.get("Origin")
    if origin is not None and origin != f"{request.scheme}://{request.host}":
        raise web.HTTPForbidden(text="Cross-origin requests are not allowed.")
    if request.path == "/api/voice" and not origin:
        raise web.HTTPForbidden(text="Voice connections require a same-origin browser.")
    try:
        response = await handler(request)
    except web.HTTPException as error:
        response = error
        failure = error
    if not response.prepared:
        response.headers.update({
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer", "Permissions-Policy": "microphone=(self), camera=()",
            "Content-Security-Policy": (
                "default-src 'self'; script-src 'self'; style-src 'self'; "
                "connect-src 'self'; img-src 'self'; media-src 'self' blob:; "
                "frame-ancestors 'none'; base-uri 'none'"
            ),
        })
    if failure is not None:
        raise failure
    return response


async def home(_request):
    return web.FileResponse(ROOT / "static/index.html")


async def asset(request):
    name = request.match_info["name"]
    if name not in ASSETS:
        raise web.HTTPNotFound()
    return web.FileResponse(ROOT / "static" / name)


async def config(request):
    return web.json_response({
        "mode": "demo" if request.app[SETTINGS].demo else "cloud",
        "default_model": DEFAULT_MODEL, "default_voice": DEFAULT_VOICE,
        "models": MODELS, "synthetic": True,
    })


def selected(query) -> tuple[str, str, str, str]:
    if set(query) != {"model", "voice", "scenario", "language"} or any(
        len(query.getall(key)) != 1 for key in query
    ):
        raise ValueError("Specify model, voice, scenario and language once each.")
    model, voice = query["model"], query["voice"]
    voice_option(model, voice)
    if query["scenario"] not in SCENARIOS or query["language"] not in LANGUAGES:
        raise ValueError("Choose a supported scenario and language.")
    return model, voice, query["scenario"], query["language"]


def voice_url(endpoint: str, binding: dict[str, str]) -> str:
    query = urlencode({
        "api-version": "v1", "agent_session_id": f"northstar-{uuid.uuid4().hex}",
        "x-agent-version-override": binding["agent_version"], "store": "false",
    })
    return (
        f"wss://{endpoint.removeprefix('https://')}/agents/"
        f"{quote(binding['agent_name'], safe='')}/endpoint/protocols/voice?{query}"
    )


def verify_session(session: dict[str, Any], model: str, voice: str) -> None:
    audio = session.get("audio") or {}
    output = audio.get("output") or {}
    returned_voice = output.get("voice")
    name = returned_voice.get("name") if isinstance(returned_voice, dict) else returned_voice
    voice_type = returned_voice.get("type") if isinstance(returned_voice, dict) else output.get("voice_type")
    if session.get("model") != model or name != voice or voice_type != voice_option(model, voice)["type"]:
        raise ValueError("The service did not confirm the selected model and voice; no substitute is used.")
    for direction in ("input", "output"):
        config = audio.get(direction) or {}
        fmt = config.get("format") or {}
        if (
            fmt.get("type") != "audio/pcm" or fmt.get("rate") != RATE
            or fmt.get("channels", 1) != 1 or config.get("channels", 1) != 1
        ):
            raise ValueError("The service must confirm mono PCM audio at 24 kHz.")
    vad = (audio.get("input") or {}).get("turn_detection") or {}
    if any(vad.get(key) is not True for key in ("create_response", "interrupt_response", "auto_truncate")):
        raise ValueError("The service must confirm automatic responses, interruption and truncation.")


def browser_event(event: dict[str, Any]) -> dict[str, Any] | None:
    """Project service events; never send saved prompts or raw service errors."""
    kind = event.get("type")
    if kind in {"error", "conversation.item.input_audio_transcription.failed"}:
        raise ValueError("The voice service could not process this conversation.")
    if kind in {"response.audio.delta", "response.output_audio.delta"}:
        delta = event.get("delta")
        if not isinstance(delta, str) or len(delta) > 4 * 1024 * 1024:
            raise ValueError("Invalid voice-service audio.")
        try:
            pcm = base64.b64decode(delta, validate=True)
        except binascii.Error as error:
            raise ValueError("Invalid voice-service PCM.") from error
        if not pcm or len(pcm) % 2:
            raise ValueError("Invalid voice-service PCM.")
        return {
            "type": "audio", "pcm": delta,
            "response_id": event.get("response_id"), "item_id": event.get("item_id"),
        }
    transcripts = {
        "conversation.item.input_audio_transcription.delta": ("user", "delta", False),
        "conversation.item.input_audio_transcription.completed": ("user", "transcript", True),
        "response.audio_transcript.delta": ("assistant", "delta", False),
        "response.output_audio_transcript.delta": ("assistant", "delta", False),
        "response.audio_transcript.done": ("assistant", "transcript", True),
        "response.output_audio_transcript.done": ("assistant", "transcript", True),
    }
    if kind in transcripts:
        role, field_name, final = transcripts[kind]
        text, item = event.get(field_name, ""), event.get("item_id")
        if not isinstance(text, str) or len(text) > 16000 or not isinstance(item, str) or len(item) > 200:
            raise ValueError("Invalid voice-service transcript.")
        return {"type": "transcript", "role": role, "id": item, "text": text, "final": final}
    if kind == "input_audio_buffer.speech_started":
        return {"type": "interrupt"}
    if kind == "input_audio_buffer.speech_stopped":
        return {"type": "status", "status": "thinking"}
    if kind == "response.created":
        return {"type": "response", "id": (event.get("response") or {}).get("id")}
    if kind == "response.done":
        response = event.get("response") or {}
        if response.get("status") not in {"completed", "cancelled"}:
            raise ValueError("The voice service did not complete its response.")
        if any(item.get("type") == "function_call" for item in response.get("output", [])):
            raise ValueError("This fictional consultation has no execution tools.")
        return {"type": "status", "status": "listening"}
    return None


async def cloud_call(settings, browser, parameters, incoming):
    model, voice, scenario, language = parameters
    binding = settings.bindings[(model, voice)]
    async with asyncio.timeout(45):
        saved = await settings.client.agents.get_version(
            agent_name=binding["agent_name"], agent_version=binding["agent_version"],
        )
        check_definition(saved.definition, model, voice)
        token = await settings.credential.get_token("https://ai.azure.com/.default")
    headers = {
        "Authorization": f"Bearer {token.token}", "Foundry-Features": "VoiceAgents=V1Preview",
        "x-ms-voice-structured-inputs": json.dumps(inputs(scenario, language), ensure_ascii=True, separators=(",", ":")),
    }
    async with AsyncExitStack() as stack:
        async with asyncio.timeout(45):
            upstream = await stack.enter_async_context(settings.http.ws_connect(
                voice_url(settings.endpoint, binding), headers=headers,
                heartbeat=20, max_msg_size=4 * 1024 * 1024,
            ))
            buffered = []
            buffered_bytes = 0
            while True:
                frame = await upstream.receive()
                if frame.type != WSMsgType.TEXT:
                    raise ValueError("Voice connection closed before its saved configuration was ready.")
                event = json.loads(frame.data)
                if event.get("type") == "session.updated":
                    verify_session(event.get("session") or {}, model, voice)
                    break
                projected = browser_event(event)
                if projected:
                    buffered_bytes += len(frame.data.encode("utf-8"))
                    if buffered_bytes > 4 * 1024 * 1024:
                        raise ValueError("Voice greeting exceeded the startup buffer.")
                    buffered.append(projected)
        await browser.send_json({"type": "ready", "model": model, "voice": voice, "mode": "cloud"})
        for event in buffered:
            await browser.send_json(event)

        async def to_cloud():
            while True:
                packet = await incoming.get()
                if isinstance(packet, bytes):
                    await upstream.send_json({"type": "input_audio_buffer.append", "audio": base64.b64encode(packet).decode("ascii")})
                else:
                    await upstream.send_json({"type": "input_audio_buffer.clear"})

        async def to_browser():
            async for frame in upstream:
                if frame.type != WSMsgType.TEXT:
                    break
                event = json.loads(frame.data)
                if event.get("type") == "session.updated":
                    verify_session(event.get("session") or {}, model, voice)
                projected = browser_event(event)
                if projected:
                    await browser.send_json(projected)
            raise ConnectionError("Voice connection closed.")

        tasks = [asyncio.create_task(to_cloud()), asyncio.create_task(to_browser())]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


async def read_browser(browser, incoming):
    async for frame in browser:
        if frame.type == WSMsgType.BINARY:
            if not frame.data or len(frame.data) > 4800 or len(frame.data) % 2:
                raise ValueError("Expected small 24 kHz mono PCM16 microphone packets.")
            packet = frame.data
        elif frame.type == WSMsgType.TEXT:
            if json.loads(frame.data) != {"type": "clear"}:
                raise ValueError("Only microphone input and mute are accepted.")
            packet = {"type": "clear"}
        elif frame.type == WSMsgType.ERROR:
            raise ConnectionError("Browser WebSocket failed.")
        else:
            continue
        try:
            incoming.put_nowait(packet)
        except asyncio.QueueFull as error:
            raise ValueError("Microphone upload is falling behind. End and reconnect.") from error


async def demo_call(browser, parameters):
    model, voice, scenario, language = parameters
    await asyncio.sleep(0.15)
    await browser.send_json({"type": "ready", "model": model, "voice": voice, "mode": "demo"})
    await browser.send_json({
        "type": "transcript", "role": "assistant", "id": "demo-greeting",
        "text": LANGUAGES[language]["greeting"], "final": True,
    })
    examples = {
        "overdraft": {
            "de": ("Ich möchte einen fiktiven Dispo von 2.400 Euro besprechen.", "Wofür benötigen Sie den zusätzlichen Spielraum im Beispiel?"),
            "en": ("I'd like to discuss a hypothetical 2,400 euro overdraft.", "What would you use the extra flexibility for in this example?"),
            "zh": ("我想了解假设的 2,400 欧元透支额度。", "在这个虚构案例里，您希望额外额度用来做什么？"),
        },
        "investing": {
            "de": ("Ich möchte mit einem fiktiven Sparplan beginnen.", "Haben Sie im Beispiel schon Erfahrung mit Geldanlagen?"),
            "en": ("I'd like to start a fictional savings plan.", "What investing experience should we assume for this example?"),
            "zh": ("我想开始一个虚构的储蓄投资计划。", "在这个案例里，您有投资经验吗？"),
        },
    }
    for index, (role, text) in enumerate(zip(("user", "assistant"), examples[scenario][language])):
        await asyncio.sleep(0.2)
        await browser.send_json({"type": "transcript", "role": role, "id": f"demo-{index}", "text": text, "final": True})
    await asyncio.Event().wait()


async def voice_socket(request):
    settings = request.app[SETTINGS]
    try:
        parameters = selected(request.query)
    except ValueError as error:
        raise web.HTTPBadRequest(text=str(error)) from None
    if settings.sockets:
        raise web.HTTPServiceUnavailable(text="End the existing conversation first.")
    browser = web.WebSocketResponse(heartbeat=20, max_msg_size=MAX_FRAME)
    await browser.prepare(request)
    settings.sockets.add(browser)
    incoming = asyncio.Queue(maxsize=100)
    tasks = [
        asyncio.create_task(read_browser(browser, incoming)),
        asyncio.create_task(
            demo_call(browser, parameters) if settings.demo else
            cloud_call(settings, browser, parameters, incoming)
        ),
    ]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (aiohttp.ClientError, TimeoutError, ConnectionError, ValueError, TypeError, KeyError) as error:
        LOG.warning("Voice connection stopped (%s); no alternate model or voice selected.", type(error).__name__)
        if not browser.closed:
            await browser.send_json({"type": "error", "code": "connection", "detail": type(error).__name__})
    except AzureError as error:
        # Azure SDK errors may contain project URLs or request data. Surface the
        # failure by type, without logging credentials, prompts or transcripts.
        LOG.warning("Azure request failed (%s).", type(error).__name__)
        if not browser.closed:
            await browser.send_json({"type": "error", "code": "authentication"})
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        settings.sockets.discard(browser)
        await browser.close()
    return browser


async def resources(app):
    settings = app[SETTINGS]
    if settings.demo:
        yield
        return
    from azure.ai.projects.aio import AIProjectClient
    from azure.identity.aio import AzureCliCredential, DefaultAzureCredential

    async with (
        AzureCliCredential() if settings.credential_mode == "cli" else DefaultAzureCredential()
    ) as credential, AIProjectClient(
        endpoint=settings.endpoint, credential=credential, allow_preview=True,
    ) as client, aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=None, connect=20, sock_read=90),
        trust_env=True,
    ) as http:
        settings.credential, settings.client, settings.http = credential, client, http
        yield


async def shutdown(app):
    for socket in tuple(app[SETTINGS].sockets):
        await socket.close(code=1001, message=b"Server shutdown")


def create_app(settings: Settings) -> web.Application:
    app = web.Application(middlewares=[local_only], client_max_size=MAX_FRAME)
    app[SETTINGS] = settings
    app.router.add_get("/", home)
    app.router.add_get("/assets/{name}", asset)
    app.router.add_get("/api/config", config)
    app.router.add_get("/api/voice", voice_socket)
    app.cleanup_ctx.append(resources)
    app.on_shutdown.append(shutdown)
    return app


def main():
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo", action="store_true", help="Offline scripted UI preview; no microphone, Azure or generated audio.")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535.")
    settings = Settings(demo=args.demo, port=args.port)
    if not args.demo:
        try:
            settings.endpoint = project_endpoint(os.getenv("AZURE_AI_PROJECT_ENDPOINT", ""))
            settings.credential_mode = os.getenv("AZURE_CREDENTIAL_MODE", "cli")
            if settings.credential_mode not in {"cli", "default"}:
                raise ValueError("AZURE_CREDENTIAL_MODE must be cli or default.")
            path = Path(os.getenv("BANKING_AGENT_BINDINGS", "bindings.local.json"))
            settings.bindings = load_bindings(path if path.is_absolute() else ROOT / path, settings.endpoint)
        except (OSError, ValueError) as error:
            parser.error(str(error))
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("azure").setLevel(logging.WARNING)
    web.run_app(create_app(settings), host="127.0.0.1", port=args.port, access_log=None)


if __name__ == "__main__":
    main()
