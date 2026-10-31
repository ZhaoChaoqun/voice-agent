"""Publish the Conference Concierge Template through a local Portal and run a scripted voice session.

    python verify_local.py --base-url http://127.0.0.1:9531 --agent yf-ignite-concierge \
        --output-dir ./evidence

The script uses only the local Portal's HTTP and WebSocket routes, as the browser does:
it checks the catalog card and the MCP probe, publishes the materialized Template as a
new version of --agent, opens a real Voice session, sends each turn as typed text, and
records the spoken transcript, MCP tool calls, handoffs, and audio volume per turn.
It creates or versions only the named Agent and never deletes anything.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit

import requests
from websockets.asyncio.client import connect

TEMPLATE_ID = "conference-concierge-example"
TURNS = (
    "What's on voice AI on Thursday afternoon?",
    "Add BRK244 to my schedule.",
    "Also add BRK284.",
    "What's next for me?",
    "I'm a developer building contact-center agents. What should I attend on Wednesday?",
    "What else is like BRK244? People who went there also went to what?",
    "I'm watching online from Beijing. When is BRK244 in Beijing time?",
    "What's starting in the next 15 minutes?",
    "Any room changes I should know about?",
    "Where do I pick up my badge?",
    "When do the shuttles run on Wednesday?",
    "Where's the nearest restroom?",
    "How much does a conference pass cost?",
    "Can I bring a guest?",
    "What's the Wi-Fi?",
    "Can you add BRK244 to my Outlook calendar?",
    "Can I bring my dog?",
    "请问周四下午有关于语音智能体的分会吗？",
    "When are the keynotes?",
    "Show me how you're built.",
    "Thanks, that's all. Bye!",
)
IDLE_SECONDS = 4.0
TURN_TIMEOUT = 90.0


def http_json(session: requests.Session, method: str, url: str, **kwargs):
    response = session.request(method, url, timeout=180, **kwargs)
    try:
        body = response.json()
    except ValueError as error:
        raise RuntimeError(f"{method} {url} returned HTTP {response.status_code}: {response.text[:300]}") from error
    if not response.ok:
        raise RuntimeError(f"{method} {url} failed HTTP {response.status_code}: {body}")
    return body


def publish(base: str, agent: str) -> dict:
    session = requests.Session()
    session.headers["Origin"] = base
    catalog = http_json(session, "GET", f"{base}/api/templates")
    card = next(card for card in catalog["templates"] if card["id"] == TEMPLATE_ID)
    probe = http_json(session, "GET", f"{base}/api/templates/{TEMPLATE_ID}/mcp/probe")
    if not probe.get("ok"):
        raise RuntimeError(f"MCP probe failed: {probe}")
    detail = http_json(session, "GET", f"{base}/api/templates/{TEMPLATE_ID}")
    definition = detail["definition"]
    config = http_json(session, "GET", f"{base}/config")
    api_version = config["apiVersion"]
    created = http_json(
        session, "POST",
        f"{base}/agents/{quote(agent, safe='')}/versions?{urlencode({'api-version': api_version})}",
        json={
            "description": f"Local acceptance of {TEMPLATE_ID} (Ignite 2026).",
            "metadata": {"source_template_id": TEMPLATE_ID},
            "definition": definition,
        },
    )
    readback = http_json(session, "GET", f"{base}/agents/{quote(agent, safe='')}?{urlencode({'api-version': api_version})}")
    latest = ((readback.get("versions") or {}).get("latest") or readback).get("definition") or {}
    servers = sorted({
        tool.get("server_url")
        for tool in [*(latest.get("tools") or []), *(
            tool for node in (latest.get("handoff") or {}).get("nodes") or []
            for tool in (node.get("config") or {}).get("tools") or []
        )]
        if tool.get("type") == "mcp"
    })
    return {
        "card": {key: card[key] for key in ("id", "name", "category", "node_count", "edge_count", "requires_mcp")},
        "probe": {key: probe.get(key) for key in ("ok", "server_url", "tools", "latency_ms")},
        "agent": agent,
        "version": created.get("version"),
        "model": latest.get("model"),
        "voice": ((latest.get("audio") or {}).get("output") or {}).get("voice"),
        "store": latest.get("store"),
        "mcp_server_urls": servers,
        "api_version": api_version,
    }


async def converse(base: str, agent: str, api_version: str, turns: tuple[str, ...]) -> dict:
    parsed = urlsplit(base)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    query = urlencode({"api-version": api_version, "agent_session_id": f"yf-ignite-{uuid.uuid4().hex[:10]}", "store": "false"})
    url = f"{scheme}://{parsed.netloc}/agents/{quote(agent, safe='')}/endpoint/protocols/voice?{query}"
    log: list[dict] = []
    errors: list = []
    started = time.monotonic()
    async with connect(url, origin=base, max_size=16 * 1024 * 1024, open_timeout=60, ping_interval=20, ping_timeout=60) as ws:
        current: dict = {"user": "(greeting)", "assistant": [], "tools": [], "handoffs": [], "audio_bytes": 0,
                         "responses": 0, "first_audio_ms": None}

        async def drain(turn: dict, sent_at: float) -> None:
            transcript = ""
            last_event = time.monotonic()
            responding = False
            deadline = time.monotonic() + TURN_TIMEOUT
            while time.monotonic() < deadline:
                try:
                    message = await asyncio.wait_for(ws.recv(), timeout=0.5)
                except asyncio.TimeoutError:
                    if turn["responses"] and not responding and time.monotonic() - last_event > IDLE_SECONDS:
                        return
                    continue
                last_event = time.monotonic()
                if isinstance(message, bytes):
                    turn["audio_bytes"] += len(message)
                    continue
                event = json.loads(message)
                kind = str(event.get("type") or "")
                if kind == "error" or kind == "portal_bridge_error":
                    errors.append(event.get("error") or event)
                elif kind == "response.created":
                    responding = True
                elif kind in {"response.audio.delta", "response.output_audio.delta"}:
                    delta = event.get("delta")
                    if isinstance(delta, str):
                        turn["audio_bytes"] += len(base64.b64decode(delta))
                        if turn["first_audio_ms"] is None:
                            turn["first_audio_ms"] = round((time.monotonic() - sent_at) * 1000)
                elif kind in {"response.audio_transcript.delta", "response.output_audio_transcript.delta",
                              "response.output_text.delta", "response.text.delta"}:
                    transcript += str(event.get("delta") or "")
                elif kind in {"response.audio_transcript.done", "response.output_audio_transcript.done"}:
                    text = str(event.get("transcript") or transcript).strip()
                    if text:
                        turn["assistant"].append(text)
                    transcript = ""
                elif kind == "response.output_item.done":
                    item = event.get("item") or {}
                    if item.get("type") == "mcp_call":
                        output = item.get("output")
                        try:
                            parsed_output = json.loads(output) if isinstance(output, str) else output
                        except ValueError:
                            parsed_output = output
                        turn["tools"].append({
                            "name": item.get("name"),
                            "arguments": item.get("arguments"),
                            "ok": (parsed_output or {}).get("ok") if isinstance(parsed_output, dict) else None,
                            "error": item.get("error") or ((parsed_output or {}).get("error") if isinstance(parsed_output, dict) else None),
                            "output_excerpt": (output if isinstance(output, str) else json.dumps(output or ""))[:600],
                        })
                elif kind.startswith("session.handoff."):
                    handoff = event.get("handoff") or event
                    turn["handoffs"].append({"event": kind, "target": handoff.get("target") or handoff.get("to") or event.get("target")})
                elif kind == "response.done":
                    responding = False
                    turn["responses"] += 1
                    response = event.get("response") or {}
                    if response.get("status") not in (None, "completed"):
                        turn.setdefault("response_status", []).append(response.get("status"))
                elif kind == "session.closed" or kind == "session.ended":
                    return

        await drain(current, time.monotonic())
        log.append(current)
        for text in turns:
            turn = {"user": text, "assistant": [], "tools": [], "handoffs": [], "audio_bytes": 0,
                    "responses": 0, "first_audio_ms": None}
            sent_at = time.monotonic()
            await ws.send(json.dumps({"type": "conversation.item.create", "item": {
                "type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}}))
            await ws.send(json.dumps({"type": "response.create"}))
            try:
                await drain(turn, sent_at)
            except Exception as error:  # connection closed after end_conversation
                turn["closed"] = f"{type(error).__name__}: {error}"
            log.append(turn)
            if turn.get("closed"):
                break
    return {"elapsed_seconds": round(time.monotonic() - started, 1), "errors": errors, "turns": log}


def markdown(report: dict) -> str:
    lines = [
        "# Conference Concierge local acceptance transcript",
        "",
        f"- Run (UTC): {report['started_utc']}",
        f"- Agent: `{report['publish']['agent']}` version {report['publish']['version']}, model `{report['publish']['model']}`",
        f"- MCP: {', '.join(report['publish']['mcp_server_urls'])}",
        f"- Errors: {report['session']['errors'] or 'none'}",
        "",
    ]
    for index, turn in enumerate(report["session"]["turns"]):
        lines.append(f"## Turn {index}: {turn['user']}")
        for call in turn["tools"]:
            lines.append(f"- tool `{call['name']}` {call['arguments']} -> ok={call['ok']} error={call['error']}")
        for handoff in turn["handoffs"]:
            lines.append(f"- handoff {handoff['event']} -> {handoff['target']}")
        lines.append(f"- audio bytes {turn['audio_bytes']}, first audio {turn['first_audio_ms']} ms after send")
        for text in turn["assistant"]:
            lines.append(f"> {text}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://127.0.0.1:9531")
    parser.add_argument("--agent", default="yf-ignite-concierge")
    parser.add_argument("--output-dir", type=Path, default=Path("evidence"))
    parser.add_argument("--turn", action="append", help="Override the scripted turns (repeatable).")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    report = {"started_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    report["publish"] = publish(base, args.agent)
    report["session"] = asyncio.run(converse(base, args.agent, report["publish"]["api_version"], tuple(args.turn or TURNS)))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    (args.output_dir / f"acceptance-{stamp}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output_dir / f"acceptance-{stamp}.md").write_text(markdown(report), encoding="utf-8")
    print(markdown(report))
    return 0 if not report["session"]["errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
