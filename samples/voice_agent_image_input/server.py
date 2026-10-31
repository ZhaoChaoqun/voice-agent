"""Loopback web UI: talk, type, upload images, or share camera frames with a Foundry Voice Agent.

Azure credentials stay in this process. The browser sends microphone PCM, text,
images, and camera frames to this server over a same-origin WebSocket; the server
validates them and relays them to the Voice Agent through the Projects SDK.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aiohttp import WSMsgType, web

from image_input import (
    CAMERA_DEFAULT_RETAINED_FRAMES,
    CAMERA_MAX_RETAINED_FRAMES,
    CAMERA_MIN_RETAINED_FRAMES,
    MAX_FRAME_BYTES,
    MAX_IMAGE_BYTES,
    MAX_IMAGES_PER_TURN,
    CameraContext,
    conversation_item_create,
    user_message,
    validate_image_data_url,
)
from voice_image_agent import configure_console, credential_for, ensure_agent, event_payload, project_endpoint, wait_for_session

ROOT = Path(__file__).resolve().parent
STATIC_FILES = {"app.js", "frames.mjs", "playback.js", "pcm-worklet.js", "style.css"}
# 5 images of up to 8 MiB each are ~53 MiB as base64; keep a margin for JSON.
MAX_BROWSER_MESSAGE = (MAX_IMAGES_PER_TURN * MAX_IMAGE_BYTES * 4) // 3 + 64 * 1024
MAX_PCM_CHUNK = 9600
logger = logging.getLogger(__name__)


@dataclass
class Settings:
    port: int
    agent_name: str | None = None
    client: Any = None
    voice_active: bool = False
    agent_lock: asyncio.Lock | None = None


SETTINGS = web.AppKey("settings", Settings)


@web.middleware
async def local_only(request: web.Request, handler):
    port = request.app[SETTINGS].port
    if request.host not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
        raise web.HTTPForbidden(text="Use the loopback address printed by the server.")
    origin = request.headers.get("Origin")
    if origin and origin != f"{request.scheme}://{request.host}":
        raise web.HTTPForbidden(text="Cross-origin requests are not allowed.")
    response = await handler(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


async def index(_request: web.Request) -> web.FileResponse:
    return web.FileResponse(ROOT / "static" / "index.html")


async def asset(request: web.Request) -> web.FileResponse:
    name = request.match_info["name"]
    if name not in STATIC_FILES:
        raise web.HTTPNotFound()
    return web.FileResponse(ROOT / "static" / name)


async def config(_request: web.Request) -> web.Response:
    return web.json_response({
        "max_images": MAX_IMAGES_PER_TURN, "max_image_bytes": MAX_IMAGE_BYTES,
        "max_frame_bytes": MAX_FRAME_BYTES, "retain_default": CAMERA_DEFAULT_RETAINED_FRAMES,
        "retain_min": CAMERA_MIN_RETAINED_FRAMES, "retain_max": CAMERA_MAX_RETAINED_FRAMES,
    })


async def healthz(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


class Relay:
    """Translate browser packets to Voice Agent events and service events to browser messages."""

    def __init__(self, connection: Any, notify, send_audio) -> None:
        self.connection = connection
        self.notify = notify
        self.send_audio = send_audio
        self.camera = CameraContext()
        self.response_active = False
        self.turn_started: float | None = None
        self.first_audio_reported = False

    async def _send_all(self, events: list[dict[str, Any]]) -> None:
        for event in events:
            await self.connection.send(event)
        await self.notify({"type": "camera", **self.camera.snapshot()})

    async def _ask(self, item: dict[str, Any]) -> bool:
        if self.response_active:
            await self.notify({"type": "notice", "message": "Wait for the current answer to finish."})
            return False
        self.turn_started = time.perf_counter()
        self.first_audio_reported = False
        await self.connection.send(conversation_item_create(item))
        await self.connection.response.create()
        return True

    async def from_browser(self, packet: bytes | dict[str, Any]) -> None:
        if isinstance(packet, bytes):
            await self.connection.input_audio_buffer.append(audio=packet)
            return
        kind = packet.get("type")
        if kind == "text":
            if await self._ask(user_message(str(packet.get("text", "")))):
                await self.notify({"type": "transcript", "role": "user", "text": packet.get("text", "")})
        elif kind == "image":
            images = packet.get("images")
            if not isinstance(images, list) or not 1 <= len(images) <= MAX_IMAGES_PER_TURN:
                raise ValueError(f"Attach 1 to {MAX_IMAGES_PER_TURN} images.")
            for image in images:
                validate_image_data_url(image)
            item = user_message(str(packet.get("text", "")), images)
            if await self._ask(item):
                await self.notify({
                    "type": "transcript", "role": "user",
                    "text": f"{item['content'][0]['text']} [+{len(images)} image(s)]",
                })
        elif kind == "camera_frame":
            await self._send_all(self.camera.queue_frame(packet.get("image")))
        elif kind == "camera_clear":
            await self._send_all(self.camera.clear())
        elif kind == "camera_retain":
            await self._send_all(self.camera.set_max_frames(packet.get("count")))
        else:
            raise ValueError("Unsupported browser message.")

    async def from_cloud(self, event: dict[str, Any]) -> None:
        kind = event.get("type")
        if kind == "response.created":
            self.response_active = True
            self.camera.set_response_active(True)
            await self.notify({"type": "response", "state": "started"})
        elif kind == "response.done":
            self.response_active = False
            response = event.get("response") or {}
            elapsed = None if self.turn_started is None else round((time.perf_counter() - self.turn_started) * 1000)
            await self.notify({"type": "response", "state": response.get("status", "unknown"), "total_ms": elapsed})
            self.turn_started = None
            await self._send_all(self.camera.set_response_active(False))
        elif kind == "input_audio_buffer.speech_started":
            await self.notify({"type": "interrupt"})
        elif kind == "input_audio_buffer.committed":
            self.turn_started = time.perf_counter()
            self.first_audio_reported = False
        elif kind == "conversation.item.created":
            item_id = (event.get("item") or {}).get("id")
            await self._send_all(self.camera.on_created(item_id))
        elif kind == "conversation.item.deleted":
            await self._send_all(self.camera.on_deleted(event.get("item_id")))
        elif kind == "conversation.item.input_audio_transcription.completed":
            await self.notify({"type": "transcript", "role": "user", "text": event.get("transcript", "")})
        elif kind in {"response.output_audio_transcript.delta", "response.output_text.delta"}:
            await self.notify({"type": "assistant_delta", "delta": event.get("delta", "")})
        elif kind == "response.output_audio.delta":
            if not self.first_audio_reported and self.turn_started is not None:
                self.first_audio_reported = True
                await self.notify({
                    "type": "latency", "first_audio_ms": round((time.perf_counter() - self.turn_started) * 1000),
                })
            delta = event.get("delta")
            if delta:
                await self.send_audio(delta)
        elif kind == "error":
            if self.camera.on_error(event):
                await self.notify({"type": "camera", **self.camera.snapshot()})
                return
            error = event.get("error") or {}
            if error.get("code") == "response_cancel_not_active":
                return
            message = str(error.get("message") or "The voice service reported an error.")[:300]
            await self.notify({"type": "error", "message": message})


async def cloud_resources(app: web.Application):
    from azure.ai.projects.aio import AIProjectClient

    settings = app[SETTINGS]
    settings.agent_lock = asyncio.Lock()
    endpoint = project_endpoint(os.getenv("AZURE_VOICE_AGENTS_ENDPOINT", ""))
    async with credential_for(os.getenv("AZURE_CREDENTIAL_MODE", "cli")) as credential, AIProjectClient(
        endpoint=endpoint, credential=credential, allow_preview=True,
    ) as client:
        settings.client = client
        try:
            yield
        finally:
            settings.client = None


async def cloud_session(settings: Settings, socket: web.WebSocketResponse, incoming: asyncio.Queue) -> None:
    await socket.send_json({"type": "progress", "message": "Preparing the agent…"})
    async with settings.agent_lock:
        settings.agent_name = await ensure_agent(
            settings.client, settings.agent_name,
            model=os.getenv("AZURE_VOICE_AGENTS_MODEL", "gpt-realtime"),
            voice=os.getenv("AZURE_VOICE_AGENTS_VOICE", "en-US-AvaNeural"),
            prefix=os.getenv("AZURE_VOICE_AGENTS_AGENT_PREFIX", "voice-image-input"),
        )
    logger.info("Using agent %s", settings.agent_name)
    await socket.send_json({"type": "progress", "message": "Opening the voice session…"})
    async with settings.client.beta.voice_agents.realtime.connect(agent_name=settings.agent_name) as connection:
        await wait_for_session(connection)

        async def send_audio(delta: Any) -> None:
            await socket.send_bytes(delta if isinstance(delta, bytes) else base64.b64decode(delta))

        relay = Relay(connection, socket.send_json, send_audio)
        await socket.send_json({"type": "ready", "agent": settings.agent_name})

        async def cloud_to_browser() -> None:
            while True:
                await relay.from_cloud(event_payload(await connection.recv()))

        async def browser_to_cloud() -> None:
            while True:
                packet = await incoming.get()
                try:
                    await relay.from_browser(packet)
                except ValueError as error:
                    await socket.send_json({"type": "notice", "message": str(error)})

        tasks = [asyncio.create_task(cloud_to_browser()), asyncio.create_task(browser_to_cloud())]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


async def read_browser(socket: web.WebSocketResponse, incoming: asyncio.Queue) -> None:
    async for message in socket:
        if message.type == WSMsgType.BINARY:
            if not message.data or len(message.data) > MAX_PCM_CHUNK or len(message.data) % 2:
                raise ValueError("Expected small 24 kHz PCM16 microphone chunks.")
            packet: Any = message.data
        elif message.type == WSMsgType.TEXT:
            packet = json.loads(message.data)
            if not isinstance(packet, dict):
                raise ValueError("Expected a JSON object.")
        elif message.type == WSMsgType.ERROR:
            raise RuntimeError("Browser socket failed.")
        else:
            continue
        try:
            incoming.put_nowait(packet)
        except asyncio.QueueFull as error:
            raise RuntimeError("Browser input is falling behind.") from error


async def voice(request: web.Request) -> web.WebSocketResponse:
    settings = request.app[SETTINGS]
    if settings.voice_active:
        raise web.HTTPConflict(text="Another session is active.")
    socket = web.WebSocketResponse(max_msg_size=MAX_BROWSER_MESSAGE, heartbeat=20)
    settings.voice_active = True
    tasks: list[asyncio.Task] = []
    try:
        await socket.prepare(request)
        incoming: asyncio.Queue = asyncio.Queue(maxsize=400)
        tasks = [
            asyncio.create_task(read_browser(socket, incoming)),
            asyncio.create_task(cloud_session(settings, socket, incoming)),
        ]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except Exception:
            # Azure exceptions can include endpoint or request details; keep them in the server log.
            logger.exception("Voice session failed")
            if not socket.closed:
                try:
                    await socket.send_json({
                        "type": "error",
                        "message": "Voice session failed. Check the server log, Azure sign-in, and model configuration.",
                    })
                except ConnectionResetError:
                    pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await socket.close()
        settings.voice_active = False
    return socket


def create_app(port: int, agent_name: str | None = None, with_cloud: bool = True) -> web.Application:
    app = web.Application(middlewares=[local_only], client_max_size=4096)
    app[SETTINGS] = Settings(port, agent_name=agent_name)
    if with_cloud:
        app.cleanup_ctx.append(cloud_resources)
    app.add_routes([
        web.get("/", index), web.get("/static/{name}", asset), web.get("/api/config", config),
        web.get("/healthz", healthz), web.get("/ws", voice),
    ])
    return app


def main() -> None:
    from dotenv import load_dotenv

    configure_console()
    load_dotenv(ROOT / ".env", override=False)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8780)
    parser.add_argument("--agent-name", default=os.getenv("AZURE_VOICE_AGENTS_AGENT_NAME") or None,
                        help="Reuse an existing image-capable agent without modifying it.")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("--port must be between 1024 and 65535.")
    project_endpoint(os.getenv("AZURE_VOICE_AGENTS_ENDPOINT", ""))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("azure").setLevel(logging.WARNING)
    print(f"Open http://127.0.0.1:{args.port}")
    web.run_app(create_app(args.port, args.agent_name), host="127.0.0.1", port=args.port, print=None)


if __name__ == "__main__":
    main()
