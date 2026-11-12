"""Explicit provisioning, separate from the public application."""

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import quote

import aiohttp
from dotenv import load_dotenv

from server import ROOT, Settings, AzureTokenProvider
from banking import MODEL, VOICE, tools


def definition():
    return {
        "kind": "voice", "model_type": "managed", "model": MODEL,
        "instructions": (ROOT / "prompt.md").read_text(encoding="utf-8"),
        "greeting": {"type": "llm_generated", "tool_choice": "none",
                     "prompt": "Say exactly: Hi, Commerzbank, you're through to AVA, your AI assistant for this demo. What can I do for you?"},
        "audio": {
            "input": {"format": {"type": "audio/pcm", "rate": 24000},
                      "noise_reduction": {"type": "azure_deep_noise_suppression_headset"},
                      "transcription": {"model": "mai-transcribe-2", "language": "en-US"},
                      "turn_detection": {"type": "azure_semantic_vad", "languages": ["en", "de"],
                                         "silence_duration_ms": 600, "create_response": True,
                                         "interrupt_response": True}},
            "output": {"format": {"type": "audio/pcm", "rate": 24000},
                       "voice": VOICE, "voice_type": "azure-standard"}},
        "output_modalities": ["text", "audio"], "tools": tools(), "tool_choice": "auto",
    }


async def provision(update=False):
    load_dotenv(ROOT / ".env")
    cfg = Settings.from_env()
    body = definition()
    digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    token = await AzureTokenProvider().get_token()
    headers = {"Authorization": f"Bearer {token}", "Foundry-Features": cfg.features}
    url = f"{cfg.endpoint}/agents/{quote(cfg.agent, safe='')}"
    params = {"api-version": cfg.api_version}
    async with aiohttp.ClientSession(headers=headers, timeout=aiohttp.ClientTimeout(total=60)) as client:
        async with client.get(url, params=params) as response:
            if response.status == 200:
                saved = (await response.json())["versions"]["latest"]
                if saved.get("metadata", {}).get("sample") != "banking_ava":
                    raise RuntimeError("Name belongs to another agent; select a new AZURE_VOICE_AGENT_NAME.")
                if saved.get("metadata", {}).get("definition_hash") == digest:
                    print(f"Agent unchanged: {cfg.agent}, version {saved['version']}")
                elif not update:
                    raise RuntimeError("Definition differs. Review the prompt, then run agent.py --update.")
                else:
                    saved = None
            elif response.status == 404:
                saved = None
            else:
                raise RuntimeError(f"Agent lookup failed: HTTP {response.status}")
        if saved is None:
            async with client.post(f"{url}/versions", params=params, json={
                "definition": body, "metadata": {"sample": "banking_ava", "definition_hash": digest},
            }) as response:
                if response.status not in {200, 201}:
                    # Provisioning is operator-only. Do not print raw response bodies or tokens.
                    raise RuntimeError(f"Agent publication failed: HTTP {response.status}; check model/voice availability and permissions.")
                version = (await response.json())["version"]
                print(f"Published {cfg.agent}, version {version}: {MODEL} / {VOICE}")
        async with client.post(f"{url}:enable", params=params) as response:
            if response.status != 204:
                raise RuntimeError(f"Agent enable failed: HTTP {response.status}")
    print("Agent enabled.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--update", action="store_true", help="Publish a revised definition for this sample's agent only.")
    asyncio.run(provision(parser.parse_args().update))
