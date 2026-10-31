# Copyright (c) Microsoft. All rights reserved.
"""Voice Live metadata plus a reproducible Azure Speech reference catalog."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

import requests

try:
    from .common import AZURE_VOICES, AgentsConfig
except ImportError:
    from common import AZURE_VOICES, AgentsConfig

REFERENCE_PATH = Path(__file__).parent / "static" / "handoff" / "azure-voices.json"
NATIVE_REFERENCE_PATH = REFERENCE_PATH.with_name("native-voices.json")
SPEECH_SCOPE = "https://cognitiveservices.azure.com/.default"


def _account_json(cfg: AgentsConfig, path: str, **params: str) -> Any:
    token = cfg.credential().get_token(SPEECH_SCOPE).token
    response = requests.get(
        f"https://{cfg.account}.cognitiveservices.azure.com{path}",
        params=params,
        headers={"Authorization": f"Bearer {token}"},
        timeout=(3, 5),
        allow_redirects=False,
    )
    response.raise_for_status()
    if response.status_code != 200:
        raise ValueError(f"Voice discovery returned HTTP {response.status_code}.")
    return response.json()


def speech_voices(payload: Any) -> list[dict[str, str]]:
    if not isinstance(payload, list) or not payload:
        raise ValueError("Azure Speech returned an empty or invalid voices list.")
    voices = {}
    for item in payload:
        if not isinstance(item, dict) or not all(
            isinstance(item.get(key), str) and item[key].strip()
            for key in ("ShortName", "Locale")
        ):
            raise ValueError("Azure Speech voice metadata is missing ShortName or Locale.")
        name = item["ShortName"]
        voices[name] = {
            "id": name,
            "type": "azure-standard",
            "locale": item["Locale"],
            "label": item.get("DisplayName") or name,
            "localeName": item.get("LocaleName") or item["Locale"],
        }
    return [voices[name] for name in sorted(voices)]


def build_voice_catalog(
    capabilities: Any, reference: dict[str, Any], configured_voices: list[str] | None = None,
) -> dict[str, Any]:
    if not isinstance(capabilities, dict) or not isinstance(capabilities.get("voices"), dict):
        raise ValueError("Voice Live capabilities did not return a voices map.")
    if reference.get("schema_version") != 1 or not reference.get("voices"):
        raise ValueError("The Azure Speech reference catalog is invalid.")
    voices = {item["id"]: dict(item) for item in reference["voices"]}
    advertised_names = {name.casefold(): name for name in voices}
    for name in configured_voices or []:
        advertised = advertised_names.get(name.casefold())
        if advertised and advertised != name:
            metadata = voices.pop(advertised)
            metadata.update(id=name, advertisedId=advertised)
            voices[name] = metadata
    for voice_type in ("openai", "azure-realtime-native"):
        entries = capabilities["voices"].get(voice_type)
        if not isinstance(entries, list):
            raise ValueError(f"Voice Live capabilities is missing {voice_type} voices.")
        for item in entries:
            metadata = {"name": item} if isinstance(item, str) else item
            if not isinstance(metadata, dict) or not isinstance(metadata.get("name"), str):
                raise ValueError("Voice Live returned invalid voice metadata.")
            name = metadata["name"]
            locales = str(metadata.get("locale") or "").split(" / ")
            voices[name] = {
                "id": name,
                "type": voice_type,
                "label": name.capitalize(),
                "locale": locales[0],
                "secondaryLocales": locales[1:],
            }
    return {
        "source": "live",
        "voices": list(voices.values()),
        "sources": {
            "native": "Voice Live capabilities v1 (current project)",
            "azureSpeech": {
                "region": reference["region"],
                "fetchedAt": reference["fetched_at"],
                "url": reference["source"],
            },
        },
        "notice": (
            "Native voice locales come from this project's live capabilities. "
            f"Azure Speech voices use a full reference catalog from {reference['region']} "
            f"({reference['fetched_at'][:10]}), not a region-specific availability guarantee. "
            "Service rejections remain visible when a voice is used."
        ),
    }


def load_default_voice_catalog() -> dict[str, Any]:
    reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
    native = json.loads(NATIVE_REFERENCE_PATH.read_text(encoding="utf-8"))
    if native.get("schema_version") != 1:
        raise ValueError("The native voice reference catalog is invalid.")
    catalog = build_voice_catalog(native, reference, AZURE_VOICES)
    catalog["source"] = "bundled"
    catalog["sources"]["native"] = {
        "source": native["source"],
        "region": native["region"],
        "fetchedAt": native["fetched_at"],
    }
    catalog["notice"] = (
        "Using bundled reference voices; live discovery is optional. "
        f"Native voice metadata was captured in {native['region']} ({native['fetched_at'][:10]}). "
        f"Azure Speech metadata was captured in {reference['region']} ({reference['fetched_at'][:10]}). "
        "This list does not verify availability in your project or region. "
        "Service rejections remain visible when a voice is used."
    )
    return catalog


def load_voice_catalog(cfg: AgentsConfig) -> dict[str, Any]:
    capabilities = _account_json(cfg, "/voice-live/capabilities", **{"api-version": "v1"})
    reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
    return build_voice_catalog(capabilities, reference, AZURE_VOICES)


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh the full Azure Speech reference catalog.")
    parser.add_argument("--project-endpoint", required=True)
    parser.add_argument("--reference-region", required=True)
    parser.add_argument("--credential-mode", choices=("cli", "default"), default="cli")
    args = parser.parse_args()
    cfg = AgentsConfig.from_endpoint(args.project_endpoint, credential_mode=args.credential_mode)
    voices = speech_voices(_account_json(cfg, "/tts/cognitiveservices/voices/list"))
    document = {
        "schema_version": 1,
        "source": f"https://{args.reference_region}.tts.speech.microsoft.com/cognitiveservices/voices/list",
        "region": args.reference_region,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "voices": voices,
    }
    REFERENCE_PATH.write_text(json.dumps(document, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"Saved {len(voices)} voices across {len({item['locale'] for item in voices})} locales.")


if __name__ == "__main__":
    main()
