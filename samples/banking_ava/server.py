"""AVA's authenticated web UI and per-call Foundry voice bridge."""

import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
import secrets
import sys
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit

import aiohttp
from aiohttp import web
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "foundry_voice_webrtc"))
from auth import AuthenticationError, AzureTokenProvider  # noqa: E402
from banking import DemoBank, MODEL, VOICE  # noqa: E402

LOG = logging.getLogger("ava")
COOKIE = "ava_demo"
MAX_FRAME = 128 * 1024
MAX_CALL_SECONDS = 600
ASSETS = {"index.html", "style.css", "app.js", "favicon.svg"}


@dataclass(frozen=True)
class Settings:
    endpoint: str
    access_code: str
    agent: str = "ava-mobile-banking-demo"
    api_version: str = "v1"
    features: str = "VoiceAgents=V1Preview"
    public_origin: str = ""

    def __post_init__(self):
        parsed = urlsplit(self.endpoint)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or not re.fullmatch(r"/api/projects/[^/]+", parsed.path)):
            raise ValueError("Set AZURE_AI_PROJECT_ENDPOINT to an HTTPS Foundry project endpoint.")
        if len(self.access_code) < 16:
            raise ValueError("DEMO_ACCESS_CODE must contain at least 16 characters.")
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9-]{0,62}", self.agent):
            raise ValueError("Invalid AZURE_VOICE_AGENT_NAME.")
        if self.public_origin:
            origin = urlsplit(self.public_origin)
            if (origin.scheme != "https" or not origin.hostname or origin.path
                    or origin.query or origin.fragment or origin.username or origin.password):
                raise ValueError("PUBLIC_ORIGIN must be an HTTPS origin without a path.")

    @classmethod
    def from_env(cls):
        return cls(os.getenv("AZURE_AI_PROJECT_ENDPOINT", "").rstrip("/"),
                   os.getenv("DEMO_ACCESS_CODE", ""),
                   os.getenv("AZURE_VOICE_AGENT_NAME", "ava-mobile-banking-demo"),
                   os.getenv("AZURE_API_VERSION", "v1"),
                   os.getenv("FOUNDRY_FEATURES", "VoiceAgents=V1Preview"),
                   os.getenv("PUBLIC_ORIGIN", "").rstrip("/"))

    def voice_url(self, transport):
        query = {"api-version": self.api_version, "store": "false",
                 "agent_session_id": f"ava-{secrets.token_hex(12)}"}
        if transport == "webrtc":
            query["transport"] = "webrtc"
        return (f"{self.endpoint.replace('https://', 'wss://', 1)}/agents/"
                f"{quote(self.agent, safe='')}/endpoint/protocols/voice?{urlencode(query)}")


def cookie_value(cfg, now=None):
    payload = f"{int(now or time.time()) + 8 * 3600}.{secrets.token_hex(16)}"
    return f"{payload}.{hmac.new(cfg.access_code.encode(), payload.encode(), hashlib.sha256).hexdigest()}"


def valid_cookie(cfg, value):
    if not value or len(value) > 160:
        return False
    parts = value.split(".")
    if (len(parts) != 3 or not re.fullmatch(r"[0-9]{1,12}", parts[0])
            or not re.fullmatch(r"[0-9a-f]{32}", parts[1])
            or not re.fullmatch(r"[0-9a-f]{64}", parts[2])):
        return False
    payload = ".".join(parts[:2])
    expected = hmac.new(cfg.access_code.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return int(parts[0]) > time.time() and hmac.compare_digest(parts[2], expected)


def trusted_origin(request, mutating=False):
    cfg = request.app[CONFIG]
    supplied = request.headers.get("Origin")
    if cfg.public_origin:
        expected = cfg.public_origin
        valid_host = request.host == urlsplit(expected).netloc
    else:
        try:
            peer = ipaddress.ip_address(request.remote or "")
            valid_host = (peer.is_loopback and
                          urlsplit(f"http://{request.host}").hostname in {"localhost", "127.0.0.1", "::1"})
        except ValueError:
            valid_host = False
        expected = f"{request.scheme}://{request.host}"
    return valid_host and (supplied == expected or (supplied is None and not mutating))


@web.middleware
async def protect(request, handler):
    try:
        if request.path != "/health" and not trusted_origin(
                request, request.method == "POST" or request.path == "/api/voice"):
            raise web.HTTPForbidden(text="Open AVA using its configured address.")
        if request.path.startswith("/api/") and request.path != "/api/login":
            if not valid_cookie(request.app[CONFIG], request.cookies.get(COOKIE)):
                raise web.HTTPUnauthorized(text="Enter your presenter access code.")
        response = await handler(request)
    except web.HTTPException as error:
        response = web.json_response({"error": error.text}, status=error.status)
    response.headers.update({
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer", "Permissions-Policy": "microphone=(self), camera=()",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; "
                                   "connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; "
                                   "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    })
    if request.app[CONFIG].public_origin:
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


async def login(request):
    attempts = request.app[ATTEMPTS]
    now = time.monotonic()
    while attempts and attempts[0] < now - 60:
        attempts.popleft()
    if len(attempts) >= 30:
        raise web.HTTPTooManyRequests(text="Too many access attempts. Wait a minute.")
    attempts.append(now)
    try:
        body = await request.json()
    except (ValueError, UnicodeError):
        raise web.HTTPBadRequest(text="Expected a presenter access code.") from None
    code = body.get("code") if isinstance(body, dict) else None
    cfg = request.app[CONFIG]
    if not isinstance(code, str) or not hmac.compare_digest(code.encode(), cfg.access_code.encode()):
        raise web.HTTPUnauthorized(text="That access code is not valid.")
    response = web.json_response({"ok": True})
    response.set_cookie(COOKIE, cookie_value(cfg), httponly=True, secure=bool(cfg.public_origin),
                        samesite="Strict", max_age=8 * 3600, path="/")
    return response


async def config(request):
    return web.json_response({"model": MODEL, "voice": VOICE, "maxCallSeconds": MAX_CALL_SECONDS,
                              "demo": True})


async def logout(request):
    response = web.json_response({"ok": True})
    response.del_cookie(COOKIE, path="/")
    return response


async def health(request):
    return web.json_response({"status": "ok", "sample": "banking_ava"})


async def asset(request):
    name = request.match_info.get("name", "index.html")
    if name not in ASSETS:
        raise web.HTTPNotFound()
    return web.FileResponse(ROOT / "public" / name)


def client_event(frame, transport, offered, ready, busy):
    if not isinstance(frame, dict):
        raise ValueError("Expected an event object.")
    kind = frame.get("type")
    if kind == "session.close" and set(frame) == {"type"}:
        return frame
    if kind == "rtc.call.sdp.create" and transport == "webrtc" and not offered:
        offer = frame.get("sdp_offer")
        if not isinstance(offer, str) or not offer.startswith("v=0") or len(offer) > 64000:
            raise ValueError("Invalid audio connection offer.")
        return {"type": kind, "sdp_offer": offer}
    if kind == "demo.text" and ready and not busy:
        text = frame.get("text")
        if set(frame) != {"type", "text"} or not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ValueError("Enter between 1 and 2,000 characters.")
        return {"type": kind, "text": text.strip()}
    raise ValueError("Wait for AVA to finish, or start a new conversation.")


async def relay(browser, upstream, transport):
    bank = DemoBank()
    ready = False
    offered = False
    busy = True
    acknowledged = False
    tool_rounds = 0

    async def from_browser():
        nonlocal offered, busy, tool_rounds
        async for message in browser:
            if message.type != aiohttp.WSMsgType.TEXT:
                if message.type == aiohttp.WSMsgType.ERROR:
                    raise ValueError("Browser connection failed.")
                continue
            try:
                frame = client_event(json.loads(message.data), transport, offered, ready, busy)
            except ValueError as error:
                await browser.send_json({"type": "demo.notice", "message": str(error)})
                continue
            if frame["type"] == "session.close":
                await upstream.send_json(frame)
                return
            if frame["type"] == "demo.text":
                busy = True
                tool_rounds = 0
                await upstream.send_json({"type": "conversation.item.create", "item": {
                    "type": "message", "role": "user",
                    "content": [{"type": "input_text", "text": frame["text"]}]}})
                await browser.send_json({"type": "demo.user_text", "text": frame["text"]})
                await upstream.send_json({"type": "response.create"})
            else:
                offered = True
                await upstream.send_json(frame)

    async def from_azure():
        nonlocal ready, busy, acknowledged, tool_rounds
        async with asyncio.timeout(45) as startup:
            async for message in upstream:
                if message.type != aiohttp.WSMsgType.TEXT:
                    if message.type == aiohttp.WSMsgType.ERROR:
                        raise RuntimeError("Azure voice transport failed.")
                    continue
                frame = json.loads(message.data)
                kind = frame.get("type", "")
                if kind == "error":
                    LOG.warning("Foundry voice error code=%s", (frame.get("error") or {}).get("code", "unknown"))
                    raise RuntimeError("The voice service could not complete this call. Please start again.")
                if kind == "session.updated":
                    session = frame.get("session") or {}
                    audio = session.get("audio") or {}
                    voice = (audio.get("output") or {}).get("voice", session.get("voice"))
                    if isinstance(voice, dict):
                        voice = voice.get("name")
                    if session.get("model") != MODEL or voice != VOICE:
                        raise RuntimeError("The saved agent does not match GPT Realtime 2.1 / Harper Flash. Ask the presenter to provision AVA.")
                    stable = "turn_detection" in (audio.get("input") or {})
                    vad = audio["input"]["turn_detection"] if stable else session.get("turn_detection")
                    if not isinstance(vad, dict) or vad.get("create_response") is False:
                        raise RuntimeError("Automatic turn detection is not configured.")
                    if not acknowledged:
                        acknowledged = True
                        vad = {**vad, "auto_truncate": True, "interrupt_response": True}
                        update = {"audio": {"input": {"turn_detection": vad}}, "type": "realtime"} if stable else {"turn_detection": vad}
                        await upstream.send_json({"type": "session.update", "session": update})
                    elif not ready:
                        if vad.get("auto_truncate") is not True or vad.get("interrupt_response") is not True:
                            raise RuntimeError("The voice service did not enable interruption handling.")
                        ready = True
                        startup.reschedule(None)
                        await browser.send_json({"type": "demo.ready", "state": bank.snapshot()})
                    continue
                if kind == "response.created":
                    busy = True
                    await browser.send_json({"type": "demo.busy"})
                if kind == "input_audio_buffer.speech_started":
                    tool_rounds = 0
                if kind == "response.done":
                    response = frame.get("response") or {}
                    status = response.get("status")
                    calls = [item for item in response.get("output", []) if item.get("type") == "function_call"]
                    if status == "completed" and calls:
                        tool_rounds += 1
                        if tool_rounds > 8:
                            raise RuntimeError("Too many tool steps. Start a new demo call.")
                        for call in calls:
                            result = bank.execute(call)
                            if not result["ok"]:
                                LOG.warning("Demo tool rejected: %s", call.get("name"))
                            await upstream.send_json({"type": "conversation.item.create", "item": {
                                "type": "function_call_output", "call_id": call["call_id"],
                                "output": json.dumps(result)}})
                            await browser.send_json({"type": "demo.state", "state": bank.snapshot()})
                        await upstream.send_json({"type": "response.create"})
                    else:
                        if status not in {"completed", "cancelled", "canceled"}:
                            raise RuntimeError("AVA's response did not complete. Please reconnect.")
                        busy = False
                        await browser.send_json({"type": "demo.idle"})
                    continue
                if kind == "session.closed":
                    return
                allowed = {
                    "rtc.call.sdp.created", "input_audio_buffer.speech_started",
                    "input_audio_buffer.speech_stopped",
                    "conversation.item.input_audio_transcription.completed",
                    "conversation.item.input_audio_transcription.failed",
                    "response.audio_transcript.delta", "response.audio_transcript.done",
                    "response.output_audio_transcript.delta", "response.output_audio_transcript.done",
                    "response.text.delta", "response.text.done", "response.output_text.delta", "response.output_text.done",
                    "response.audio.done", "response.output_audio.done",
                }
                if transport == "text":
                    allowed |= {"response.audio.delta", "response.output_audio.delta"}
                if kind in allowed:
                    await browser.send_json(frame)

    tasks = [asyncio.create_task(from_browser()), asyncio.create_task(from_azure())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def bridge(request):
    cfg = request.app[CONFIG]
    transport = request.query.get("transport", "webrtc")
    if transport not in {"webrtc", "text"}:
        raise web.HTTPBadRequest(text="Unsupported transport.")
    caller = request.cookies[COOKIE]
    active = request.app[ACTIVE]
    if caller in active or len(active) >= 4:
        raise web.HTTPTooManyRequests(text="The demo is busy. End your other call or try again shortly.")
    active.add(caller)
    browser = web.WebSocketResponse(max_msg_size=MAX_FRAME, heartbeat=20)
    try:
        await browser.prepare(request)
        async with asyncio.timeout(MAX_CALL_SECONDS):
            token = await request.app[TOKENS].get_token()
            headers = {"Authorization": f"Bearer {token}", "Foundry-Features": cfg.features}
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=45)) as client:
                async with client.ws_connect(cfg.voice_url(transport), headers=headers,
                                             heartbeat=20, max_msg_size=4 * 1024 * 1024) as upstream:
                    await relay(browser, upstream, transport)
    except (AuthenticationError, aiohttp.ClientError, TimeoutError, ValueError, RuntimeError) as error:
        LOG.warning("Voice call ended: %s", type(error).__name__)
        if isinstance(error, TimeoutError):
            message = "The connection timed out or reached the ten-minute demo limit. Start a new call."
        elif isinstance(error, RuntimeError):
            message = str(error)
        elif isinstance(error, AuthenticationError):
            message = "The server could not authenticate to Foundry. Ask the presenter to check its managed identity."
        else:
            message = "The voice connection failed. Check your connection and ask the presenter to check Foundry access."
        if browser.prepared and not browser.closed:
            await browser.send_json({"type": "demo.error", "message": message})
    finally:
        active.discard(caller)
        if browser.prepared:
            await browser.close()
    return browser


CONFIG = web.AppKey("config", Settings)
ACTIVE = web.AppKey("active", set)
ATTEMPTS = web.AppKey("attempts", deque)
TOKENS = web.AppKey("tokens", AzureTokenProvider)


def create_app(settings=None, token_provider=None):
    app = web.Application(middlewares=[protect], client_max_size=8192)
    app[CONFIG] = settings or Settings.from_env()
    app[ACTIVE] = set()
    app[ATTEMPTS] = deque()
    app[TOKENS] = token_provider or AzureTokenProvider()
    app.router.add_get("/health", health)
    app.router.add_post("/api/login", login)
    app.router.add_post("/api/logout", logout)
    app.router.add_get("/api/config", config)
    app.router.add_get("/api/voice", bridge)
    app.router.add_get("/", asset)
    app.router.add_get("/{name}", asset)
    return app


if __name__ == "__main__":
    load_dotenv(ROOT / ".env")
    logging.basicConfig(level=logging.INFO)
    settings = Settings.from_env()
    host = os.getenv("BIND_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "::1", "localhost"} and not settings.public_origin:
        raise ValueError("Non-loopback hosting requires PUBLIC_ORIGIN and a presenter access code.")
    web.run_app(create_app(settings), host=host, port=int(os.getenv("PORT", "8080")), access_log=None)
