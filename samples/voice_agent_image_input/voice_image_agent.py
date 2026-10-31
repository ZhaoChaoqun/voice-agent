"""Ask a Foundry Voice Agent about one to five images and hear or save the spoken answer."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import sys
import time
import wave
from pathlib import Path
from typing import Any

from image_input import (
    DETAIL_VALUES,
    MAX_IMAGES_PER_TURN,
    agent_definition,
    conversation_item_create,
    data_url_from_file,
    new_agent_name,
    project_endpoint,
    redact_images,
    user_message,
)
from image_input import (
    agent_name as validate_agent_name,
)

SAMPLE_DIR = Path(__file__).resolve().parent


def configure_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def event_payload(event: Any) -> dict[str, Any]:
    return event.as_dict() if hasattr(event, "as_dict") else dict(event)


def credential_for(mode: str):
    from azure.identity.aio import AzureCliCredential, DefaultAzureCredential

    if mode not in {"cli", "default"}:
        raise ValueError("AZURE_CREDENTIAL_MODE must be cli or default.")
    return AzureCliCredential() if mode == "cli" else DefaultAzureCredential()


async def ensure_agent(client: Any, name: str | None, *, model: str, voice: str, prefix: str) -> str:
    """Reuse an existing agent unchanged, or create and enable a uniquely named one."""
    from azure.ai.projects.models import VoiceAgentDefinition

    if name:
        await client.agents.get(agent_name=validate_agent_name(name))
        return name
    name = new_agent_name(prefix)
    await client.agents.create_version(
        agent_name=name,
        description="Voice Agent that answers questions about images and camera frames.",
        definition=VoiceAgentDefinition(agent_definition(model, voice)),
    )
    await client.agents.enable(name)
    return name


async def wait_for_session(connection: Any, timeout: float = 30) -> dict[str, Any]:
    async with asyncio.timeout(timeout):
        while True:
            event = event_payload(await connection.recv())
            if event.get("type") == "error":
                raise RuntimeError(f"Voice session error: {json.dumps(event.get('error'))}")
            if event.get("type") == "session.updated":
                return event


async def ask(connection: Any, item: dict[str, Any], timeout: float = 60) -> dict[str, Any]:
    """Send one user item and one response.create; return transcript, audio, and timings."""
    started = time.perf_counter()
    marks: dict[str, float] = {}
    text_parts: list[str] = []
    audio = bytearray()

    def mark(name: str) -> None:
        marks.setdefault(name, round((time.perf_counter() - started) * 1000))

    # Events are processed in order, so response.create need not wait for the item acknowledgement.
    await connection.send(conversation_item_create(item))
    await connection.response.create()
    async with asyncio.timeout(timeout):
        while True:
            event = event_payload(await connection.recv())
            kind = event.get("type")
            if kind == "error":
                raise RuntimeError(f"Voice session error: {json.dumps(event.get('error'))}")
            if kind == "conversation.item.created":
                mark("item_created_ms")
            elif kind in {"response.output_audio_transcript.delta", "response.output_text.delta"}:
                mark("first_text_ms")
                text_parts.append(event.get("delta") or "")
            elif kind == "response.output_audio.delta":
                mark("first_audio_ms")
                delta = event.get("delta")
                audio.extend(delta if isinstance(delta, bytes) else base64.b64decode(delta or ""))
            elif kind == "response.done":
                mark("response_done_ms")
                response = event.get("response") or {}
                status = response.get("status")
                if status != "completed":
                    details = response.get("status_details")
                    raise RuntimeError(f"Response {status}: {json.dumps(details)}")
                usage = response.get("usage") or {}
                return {
                    "text": "".join(text_parts).strip(), "audio": bytes(audio),
                    "timings_ms": marks, "usage": usage,
                }


def write_wav(path: Path, pcm: bytes, rate: int = 24000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)


async def run(args: argparse.Namespace) -> int:
    from azure.ai.projects.aio import AIProjectClient

    endpoint = project_endpoint(args.endpoint or "")
    images = [data_url_from_file(path) for path in args.image]
    item = None if args.create_only else user_message(args.text, images, args.detail)
    if item and args.show_event:
        print(json.dumps(conversation_item_create(redact_images(item)), indent=2))
    async with credential_for(args.credential_mode) as credential, AIProjectClient(
        endpoint=endpoint, credential=credential, allow_preview=True,
    ) as client:
        name = await ensure_agent(
            client, args.agent_name, model=args.model, voice=args.voice, prefix=args.agent_prefix,
        )
        print(f"Agent: {name} (retained; delete it in Foundry when finished)")
        if item is None:
            return 0
        results = []
        async with client.beta.voice_agents.realtime.connect(agent_name=name) as connection:
            await wait_for_session(connection)
            for run_index in range(args.repeat):
                print(f"You: {item['content'][0]['text']}  [+{len(images)} image(s), detail={args.detail}]")
                result = await ask(connection, item)
                print(f"Assistant: {result['text']}")
                print(f"Timings (ms from conversation.item.create): {json.dumps(result['timings_ms'])}")
                if args.save_audio and result["audio"]:
                    path = Path(args.save_audio)
                    if args.repeat > 1:
                        path = path.with_name(f"{path.stem}-{run_index + 1}{path.suffix}")
                    write_wav(path, result["audio"])
                    print(f"Saved reply audio: {path}")
                results.append({
                    "text": result["text"], "timings_ms": result["timings_ms"],
                    "usage": result["usage"], "audio_bytes": len(result["audio"]),
                })
        if args.json_out:
            Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
            Path(args.json_out).write_text(json.dumps({
                "agent": name, "model": None if args.agent_name else args.model,
                "images": len(images), "image_bytes": [len(url) * 3 // 4 for url in images],
                "detail": args.detail, "question": item["content"][0]["text"], "runs": results,
            }, indent=2), encoding="utf-8")
            print(f"Saved summary: {args.json_out}")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    from dotenv import load_dotenv

    load_dotenv(SAMPLE_DIR / ".env", override=False)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", action="append", default=[],
                        help=f"JPEG/PNG/WebP file, repeatable up to {MAX_IMAGES_PER_TURN}.")
    parser.add_argument("--text", default="", help="Question to ask. Defaults to a short description request.")
    parser.add_argument("--detail", choices=DETAIL_VALUES, default="low", help="Image detail hint (default: low).")
    parser.add_argument("--agent-name", default=os.getenv("AZURE_VOICE_AGENTS_AGENT_NAME") or None,
                        help="Reuse an existing image-capable agent without modifying it.")
    parser.add_argument("--agent-prefix", default=os.getenv("AZURE_VOICE_AGENTS_AGENT_PREFIX", "voice-image-input"))
    parser.add_argument("--endpoint", default=os.getenv("AZURE_VOICE_AGENTS_ENDPOINT"))
    parser.add_argument("--model", default=os.getenv("AZURE_VOICE_AGENTS_MODEL", "gpt-realtime"))
    parser.add_argument("--voice", default=os.getenv("AZURE_VOICE_AGENTS_VOICE", "en-US-AvaNeural"))
    parser.add_argument("--credential-mode", choices=["cli", "default"], default=os.getenv("AZURE_CREDENTIAL_MODE", "cli"))
    parser.add_argument("--create-only", action="store_true", help="Create and enable the agent, then exit.")
    parser.add_argument("--repeat", type=int, default=1, help="Ask the same question N times in one session (1-10).")
    parser.add_argument("--save-audio", help="Write the spoken reply to this WAV path.")
    parser.add_argument("--json-out", help="Write transcript, timings, and usage to this JSON path.")
    parser.add_argument("--show-event", action="store_true", help="Print the event shape with image data redacted.")
    args = parser.parse_args(argv)
    if len(args.image) > MAX_IMAGES_PER_TURN:
        parser.error(f"Use at most {MAX_IMAGES_PER_TURN} --image values.")
    if not 1 <= args.repeat <= 10:
        parser.error("--repeat must be from 1 to 10.")
    if not args.create_only and not args.image and not args.text.strip():
        parser.error("Provide --image, --text, or both.")
    return args


def main(argv: list[str] | None = None) -> None:
    from azure.core.exceptions import AzureError

    configure_console()
    args = parse_args(argv)
    try:
        raise SystemExit(asyncio.run(run(args)))
    except KeyboardInterrupt:
        print("\nStopped.")
    except (ValueError, RuntimeError, TimeoutError, OSError, AzureError) as error:
        raise SystemExit(f"Error: {str(error)[:500]}") from None


if __name__ == "__main__":
    main()
