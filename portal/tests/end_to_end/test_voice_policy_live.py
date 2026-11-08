"""Opt-in real catalogs, project region discovery, and audible Voice Agent output."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import sys
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

import aiohttp
import pytest
from azure.ai.projects import AIProjectClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from common import FOUNDRY_FEATURES, AgentsConfig
from template_portal import TemplateCatalog, discover_projects, materialize_template
from voice_policy import VoicePolicy, select_voice

# Live tests are explicit opt-in; the normal unit suite never calls Azure.
pytestmark = pytest.mark.skipif(os.getenv("VOICE_POLICY_LIVE_TESTS") != "1", reason="Set VOICE_POLICY_LIVE_TESTS=1.")
# Maximum wait for a short greeting to produce at least one real PCM audio chunk.
AUDIO_TIMEOUT_SECONDS = 60
# Allow follow-on handoff responses to settle after response.done.
RESPONSE_SETTLE_SECONDS = 2
# Accept PCM response frames without an unbounded WebSocket message buffer.
MAX_WEBSOCKET_MESSAGE_BYTES = 16 * 1024 * 1024
# Speak actual locale-specific text rather than testing only catalog membership.
GREETINGS = {
    "en-US": "Hello, this is a short voice selection test.",
    "hi-IN": "नमस्ते, मैं आपकी सहायता के लिए यहाँ हूँ।",
    "zh-CN": "你好，我可以为您提供帮助。",
}


async def receive_audio(cfg: AgentsConfig, name: str) -> int:
    """Read real PCM output.

    Parameters
    ----------
    cfg : AgentsConfig
        Live project.
    name : str
        Test Agent name.

    Returns
    -------
    int
        Number of bytes in the first audio chunk.
    """
    async with _voice_socket(cfg, name) as socket, asyncio.timeout(AUDIO_TIMEOUT_SECONDS):
        async for message in socket:
            if message.type != aiohttp.WSMsgType.TEXT:
                continue
            event = json.loads(message.data)
            assert event["type"] != "error", event.get("error", {}).get("code", "Voice Agent error")
            if event["type"] in {"response.output_audio.delta", "response.audio.delta"}:
                return len(base64.b64decode(event["delta"]))
    raise AssertionError("Voice session closed without audio")


@asynccontextmanager
async def _voice_socket(cfg: AgentsConfig, name: str) -> AsyncIterator[aiohttp.ClientWebSocketResponse]:
    url = f"{cfg.ws_agents_base}/agents/{name}/endpoint/protocols/voice?api-version=v1"
    async with (
        aiohttp.ClientSession() as session,
        session.ws_connect(url, headers=cfg.ws_headers(), max_msg_size=MAX_WEBSOCKET_MESSAGE_BYTES) as socket,
    ):
        yield socket


@contextmanager
def published_test_agent(cfg: AgentsConfig, definition: dict) -> Iterator[str]:
    """Publish an isolated test agent and delete it even if validation fails.

    Parameters
    ----------
    cfg : AgentsConfig
        Live project.
    definition : dict
        Test-only definition with conversation storage disabled.

    Yields
    ------
    str
        Unique test Agent name.
    """
    name = f"voice-policy-test-{uuid.uuid4().hex[:10]}"
    headers = {"Foundry-Features": FOUNDRY_FEATURES}
    with AIProjectClient(endpoint=cfg.host, credential=cfg.credential(), allow_preview=True) as client:
        client.agents.create_version(name, {"definition": definition}, headers=headers)
        try:
            client.agents.enable(name, headers=headers)
            yield name
        finally:
            client.agents.delete(name, headers=headers)


async def _response_events(socket: aiohttp.ClientWebSocketResponse) -> list[dict]:
    events = []
    done = False
    async with asyncio.timeout(AUDIO_TIMEOUT_SECONDS):
        while True:
            try:
                message = await socket.receive(timeout=RESPONSE_SETTLE_SECONDS if done else AUDIO_TIMEOUT_SECONDS)
            except TimeoutError:
                if done:
                    return events
                raise
            assert message.type == aiohttp.WSMsgType.TEXT, "Voice session closed unexpectedly"
            event = json.loads(message.data)
            assert event["type"] != "error", event.get("error", {}).get("code")
            events.append(event)
            done = done or event["type"] == "response.done"


def _transcript(events: list[dict]) -> str:
    return " ".join(
        event.get("transcript") or event.get("text") or ""
        for event in events
        if event["type"] in {"response.output_audio_transcript.done", "response.output_text.done"}
    )


async def _send_text(socket: aiohttp.ClientWebSocketResponse, text: str) -> list[dict]:
    await socket.send_json(
        {
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": text}],
            },
        }
    )
    await socket.send_json({"type": "response.create"})
    return await _response_events(socket)


async def _check_customer_readback(cfg: AgentsConfig, name: str) -> None:
    async with _voice_socket(cfg, name) as socket:
        assert "Amanda" in _transcript(await _response_events(socket))
        await _send_text(socket, "I have a question about a charge on my bill.")
        readback = await _send_text(socket, "My email address is meganb@contoso.com.")
        text = _transcript(readback).lower()
        compact = re.sub(r"[^a-z0-9]", "", text)
        assert "meganb" in compact and "contoso" in compact, "The email was not actually read back"
        assert any(word in text for word in ["correct", "right", "confirm"])
        assert "capture is next" not in text and "verification is the next" not in text
        assert not any(
            event.get("item", {}).get("type") == "mcp_call"
            and event["item"].get("name", "").endswith("salesforce_search")
            for event in readback
        )
        confirmed = await _send_text(socket, "Yes, that email address is correct.")
        calls = [
            event["item"]
            for event in confirmed
            if event["type"] == "response.output_item.done" and event.get("item", {}).get("type") == "mcp_call"
        ]
        assert any(item["name"].endswith("salesforce_search") for item in calls)


class TestVoicePolicyLive:
    @pytest.mark.parametrize("region", ["westus2", "centralindia"])
    @pytest.mark.parametrize("language", ["en-US", "en-IN", "hi-IN", "zh-CN"])
    @pytest.mark.parametrize("gender", ["Female", "Male"])
    def test_catalog_language_has_a_selected_voice(self, region: str, language: str, gender: str) -> None:
        voices = VoicePolicy(discover_projects).catalog(region)
        selected = select_voice(voices, language=language, gender=gender, automatic=True).selected
        assert any(str(voice["ShortName"]).casefold() == selected.casefold() for voice in voices)
        if region == "centralindia" and language in {"hi-IN", "zh-CN"}:
            assert "Dragon" not in selected

    def test_selected_project_region_discovery(self) -> None:
        cfg = AgentsConfig.from_endpoint(credential_mode="cli")
        assert VoicePolicy(discover_projects).region(cfg) == os.environ["VOICE_POLICY_EXPECTED_REGION"]

    @pytest.mark.parametrize("language", ["en-US", "hi-IN", "zh-CN"])
    def test_selected_voice_produces_live_audio(self, language: str) -> None:
        cfg = AgentsConfig.from_endpoint(credential_mode="cli")
        policy = VoicePolicy(discover_projects)
        catalog_region = "centralindia" if language != "en-US" else policy.region(cfg)
        voice = select_voice(policy.catalog(catalog_region), language=language, automatic=True).selected
        definition = {
            "kind": "voice",
            "model_type": "managed",
            "model": "gpt-realtime",
            "store": False,
            "instructions": "Read the greeting naturally. Do not call any tools.",
            "greeting": {"type": "template", "text": GREETINGS[language]},
            "audio": {
                "output": {
                    "voice": voice,
                    "voice_type": "azure-standard",
                    "format": {"type": "audio/pcm", "rate": 24000},
                }
            },
            "output_modalities": ["audio"],
        }
        with published_test_agent(cfg, definition) as name:
            assert asyncio.run(receive_audio(cfg, name)) > 0

    def test_customer_support_live_greeting_and_readback(self) -> None:
        cfg = AgentsConfig.from_endpoint(credential_mode="cli")
        document = TemplateCatalog().document("customer-support-example")
        assert document is not None
        definition = materialize_template(
            document,
            model="",
            voice="",
            mcp_connection_id="",
            mcp_public=True,
            mcp_server_url="https://voice-agent-noauth-mcp.lemonsky-36682081.westus2.azurecontainerapps.io/mcp/mock-tool-call",
        )
        definition = VoicePolicy(discover_projects).resolve(cfg, {"definition": definition})["definition"]
        with published_test_agent(cfg, definition) as name:
            asyncio.run(_check_customer_readback(cfg, name))
