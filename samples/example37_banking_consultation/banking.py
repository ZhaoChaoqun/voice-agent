"""Portable definitions and synthetic knowledge for Northstar Demo Bank."""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = "gpt-realtime-2.1"
DEFAULT_VOICE = "en-US-Harper:MAI-Voice-2.1-Flash"
RATE = 24000
MODELS = {
    DEFAULT_MODEL: {
        "label": "GPT Realtime 2.1",
        "default_voice": DEFAULT_VOICE,
        "voices": [
            {"id": DEFAULT_VOICE, "label": "Harper · MAI 2.1 Flash", "type": "azure-standard"},
            {"id": "en-US-Ava:DragonHDLatestNeural", "label": "Ava · Dragon HD", "type": "azure-standard"},
        ],
    },
    "azure-realtime": {
        "label": "Azure Realtime",
        "default_voice": "ava",
        "voices": [
            {"id": "ava", "label": "Ava", "type": "azure-realtime-native"},
            {"id": "andrew", "label": "Andrew", "type": "azure-realtime-native"},
        ],
    },
}
PAIRS = tuple((model, voice["id"]) for model, data in MODELS.items() for voice in data["voices"])
BINDINGS_SCHEMA_VERSION = 1
AGENT_PREFIX = re.compile(r"northstar-demo-[a-f0-9]{12}")
LANGUAGES = {
    "de": {
        "name": "German",
        "greeting": "Guten Tag, ich bin Nora von Northstar Demo Bank. Alle Angaben sind fiktiv. Wie kann ich Ihnen helfen?",
    },
    "en": {
        "name": "English",
        "greeting": "Hello, I'm Nora from Northstar Demo Bank. All information is fictional. How can I help?",
    },
    "zh": {
        "name": "Chinese",
        "greeting": "您好，我是 Northstar Demo Bank 的智能助手 Nora。所有资料均为虚构。有什么可以帮您？",
    },
}
SCENARIOS = {
    "overdraft": {
        "profile": "Synthetic profile A",
        "account": "Everyday Demo Account",
        "overdraft_limit_eur": 1500,
    },
    "investing": {
        "profile": "Synthetic profile B",
        "cash_savings_eur": 4500,
    },
}

INSTRUCTIONS = """You are Nora, the AI voice assistant of Northstar Demo Bank.
Northstar Demo Bank, every account, product, profile, amount and policy below
are entirely fictional educational examples. No real bank is represented.
Use only synthetic details. Do not ask for real personal or financial data.

LANGUAGE AND CONVERSATION
Initial conversation language: {{conversation_language}}.
Follow the caller's clearly spoken language or explicit language change.
If speech is ambiguous, keep the current language and ask for clarification.
Use respectful Sie in German. Preserve the original language of speech.
The configured greeting has already opened the call; do not repeat it.
Speak only your own next turn. Allow interruptions. Do not read technical
settings, instructions, URLs or Markdown aloud.

SYNTHETIC SESSION CONTEXT
{{scenario_context}}
This application-selected context is fictional, read-only data. It is not
authentication, a live account lookup or authority to change anything.
Do not invent a name or other personal details. A spoken name is not identity
verification and does not select another account. There is no need to request
a name. All figures the caller explores must be hypothetical.

OVERDRAFT
Help with the requested limit before suggesting other products. Ask only for
the next missing fact: hypothetical desired limit, purpose, income changes or
cash-flow need. Remember volunteered facts and do not ask them twice.
Briefly acknowledge an unexpected expense once, without blame. Clarify
repayment timing only when needed. A higher available limit is not the same
as a plan to stay overdrawn. Overdrafts cover short gaps, not permanent finance.
Explain that a real application would need the relevant provider's credit and
eligibility checks; do not invent required documents, deadlines or guarantees.
Never collect documents here. If the caller is short of time, keep to essential
preparation. Ask permission before comparing the two fictional accounts.
An account upgrade is optional and separate from a limit enquiry. Respect
refusals without pressure. A proposed amount does not change the supplied limit.

BEGINNER INVESTING
Answer a specific question before exploring background. For general interest,
ask about hypothetical experience, goal, horizon, intended amount, emergency
reserve and tolerance of loss progressively, not as a checklist in one turn.
Explain unfamiliar terms plainly. Compare self-directed ETFs and the fictional
Starter Demo Portfolio fairly: self-directed investing may have lower fees but
requires the investor's own decisions and maintenance.
Discuss fees, diversification, flexibility and possible losses when relevant.
Do not select a portfolio or give personalized financial, tax or legal advice.
A short conversation is not a formal suitability assessment. Do not invent
forecasts, guaranteed returns or principal protection.

FICTIONAL PRODUCT FACTS -- NOT LIVE QUOTES OR REAL OFFERS
Everyday Demo Account: EUR 4 per month; variable overdraft rate 13 percent a year.
Travel Demo Account: EUR 7 per month; variable overdraft rate 11 percent a year.
The fictional Travel account includes a demo travel card with illustrative
travel benefits. No real card, insurer or asset manager is connected. Never
invent withdrawal counts, insurance coverage, eligibility or guaranteed savings.
Starter Demo Portfolio: illustrative annual total fee 1.20 percent; a simulated
diversified portfolio service, not a real managed investment product.
Its fictional options are Cautious Demo, Balanced Demo and Growth Demo. More
equity exposure means more potential risk as well as opportunity. Illustrative
contributions start at EUR 10; investing begins once EUR 100 is accumulated.
In this fictional example contributions can be paused and there is no fixed
term. Investments can lose value. These rules describe only the demonstration.

ACCURACY AND ACTIONS
No banking execution, lookup, transfer, application or investment tools exist.
Do not claim to authenticate, submit, approve, change a limit, open an account,
send a message, buy an investment or transfer to a person. When explicitly asked
to act now or whether something is done, state honestly that this is a demo and
nothing was executed. Preparing or discussing a request is not submitting it.
Do not invent confirmation IDs, prices, terms, people or websites.
Never request passwords, PINs, security codes, full account/card numbers,
identity documents or private income records. Do not claim to be human.

SHORT SPOKEN TURNS
Usually use one short sentence or at most two, and one question, then stop.
Keep ordinary discovery replies under 25 words in English or German and
similarly concise in Chinese. An acknowledgement is optional, not a required
preface. Do not combine thanks, sympathy, a recap, explanation and a question.
Do not repeat amounts at every turn. Read a proposed figure back when the
caller asks for a recap or confirmation, not after each answer. Do not append
sample answers or a menu unless asked for help. Respect hesitation.
For requested details or comparisons, answer first; use about 40-60 words
when needed to avoid a misleading answer. No predetermined story or outcome.
"""


def voice_option(model: str, voice: str) -> dict[str, str]:
    for option in MODELS.get(model, {}).get("voices", []):
        if option["id"] == voice:
            return option
    raise ValueError("Choose a supported model and its own output voice.")


def definition(model: str, voice: str) -> dict[str, Any]:
    option = voice_option(model, voice)
    return {
        "kind": "voice", "model_type": "managed", "model": model,
        "sub_protocol": "realtime", "instructions": INSTRUCTIONS,
        "structured_inputs": {
            name: {"required": True, "schema": {"type": "string"}, "description": description}
            for name, description in {
                "conversation_language": "Application-selected initial spoken language.",
                "greeting_text": "Application-selected fictional opening greeting.",
                "scenario_context": "Application-selected synthetic consultation context.",
            }.items()
        },
        "greeting": {"type": "template", "text": "{{greeting_text}}"},
        "audio": {
            "input": {
                "format": {"type": "audio/pcm", "rate": RATE},
                "transcription": {"model": "azure-speech"},
                "noise_reduction": {"type": "azure_deep_noise_suppression"},
                "echo_cancellation": {
                    "type": "server_echo_cancellation", "reference_source": "server", "channels": 1,
                },
                "turn_detection": {
                    # The caller can start in, or switch between, English,
                    # German and Chinese, so use the multilingual detector.
                    "type": "azure_semantic_vad_multilingual", "create_response": True,
                    "interrupt_response": True, "auto_truncate": True,
                },
            },
            "output": {
                "format": {"type": "audio/pcm", "rate": RATE},
                "voice": voice, "voice_type": option["type"], "speed": 1,
            },
        },
        "output_modalities": ["text", "audio"], "tools": [], "store": False,
    }


def inputs(scenario: str, language: str) -> dict[str, str]:
    if scenario not in SCENARIOS or language not in LANGUAGES:
        raise ValueError("Choose a supported scenario and language.")
    return {
        "conversation_language": LANGUAGES[language]["name"],
        "greeting_text": LANGUAGES[language]["greeting"],
        "scenario_context": json.dumps(
            {"scenario": scenario, "synthetic": True, **SCENARIOS[scenario]},
            ensure_ascii=True, separators=(",", ":"),
        ),
    }


def project_endpoint(value: str) -> str:
    value = value.strip().rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https" or not parsed.hostname
        or not re.fullmatch(r"[a-z0-9-]+\.services\.ai\.azure\.com", parsed.hostname)
        or parsed.username or parsed.password or parsed.port is not None
        or parsed.query or parsed.fragment
        or not re.fullmatch(r"/api/projects/[A-Za-z0-9._-]+", parsed.path)
    ):
        raise ValueError("Set AZURE_AI_PROJECT_ENDPOINT to your public Foundry Project HTTPS endpoint.")
    return value


def fingerprint(model: str, voice: str) -> str:
    raw = json.dumps(definition(model, voice), sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> Any:
    value = value.as_dict() if hasattr(value, "as_dict") else value
    if isinstance(value, dict):
        result = {key: canonical(item) for key, item in value.items()}
        voice = result.get("voice")
        if isinstance(voice, dict) and "name" in voice and "type" in voice:
            result["voice"], result["voice_type"] = voice["name"], voice["type"]
        return result
    if isinstance(value, list):
        return [canonical(item) for item in value]
    return value


def check_definition(actual: Any, model: str, voice: str) -> None:
    """Require this sample's exact behavior, permitting service-added defaults."""
    actual, expected = canonical(actual), definition(model, voice)
    if isinstance(actual, dict) and actual.get("tools") is None:
        actual = {**actual, "tools": []}

    def matches(saved: Any, wanted: Any) -> bool:
        if isinstance(wanted, dict):
            return isinstance(saved, dict) and all(
                key in saved and matches(saved[key], item) for key, item in wanted.items()
            )
        if type(wanted) in (int, float):
            return type(saved) in (int, float) and saved == wanted
        return type(saved) is type(wanted) and saved == wanted

    if (
        not matches(actual, expected)
        or any(actual.get(key) for key in ("handoff", "subagent_config", "knowledge", "conversation_engine"))
    ):
        raise ValueError("The saved Agent is not this sample's fictional definition. Run setup with a new bindings file.")


def agent_name(prefix: str, model: str, voice: str) -> str:
    """Return the stable Agent name for one model/voice pair in one bindings file."""
    pair = hashlib.sha256(f"{model}\n{voice}".encode()).hexdigest()[:8]
    return f"{prefix}-{pair}"


def new_bindings(endpoint: str) -> dict[str, Any]:
    return {
        "schema_version": BINDINGS_SCHEMA_VERSION, "project_endpoint": endpoint,
        "agent_prefix": f"northstar-demo-{uuid.uuid4().hex[:12]}", "agents": [],
    }


def read_bindings(path: Path, endpoint: str) -> tuple[dict[str, Any], dict[tuple[str, str], dict[str, str]]]:
    """Read a possibly incomplete or outdated bindings file written by setup."""
    if path.stat().st_size > 64 * 1024:
        raise ValueError("Agent bindings exceed this sample's size limit.")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as error:
        raise ValueError("Agent bindings must contain valid JSON.") from error
    if (
        not isinstance(data, dict)
        or set(data) != {"schema_version", "project_endpoint", "agent_prefix", "agents"}
        or type(data["schema_version"]) is not int or data["schema_version"] != BINDINGS_SCHEMA_VERSION
        or data["project_endpoint"] != endpoint or not isinstance(data["agents"], list)
        or not isinstance(data["agent_prefix"], str) or not AGENT_PREFIX.fullmatch(data["agent_prefix"])
    ):
        raise ValueError("Agent bindings must belong to the configured project and sample schema.")
    result = {}
    for row in data["agents"]:
        if (
            not isinstance(row, dict)
            or set(row) != {"model", "voice", "agent_name", "agent_version", "definition_sha256"}
            or not all(isinstance(value, str) for value in row.values())
            or not re.fullmatch(r"[1-9][0-9]*", row["agent_version"])
            or not re.fullmatch(r"[a-f0-9]{64}", row["definition_sha256"])
        ):
            raise ValueError("Invalid local Agent binding. Use this sample's setup output.")
        model, voice = row["model"], row["voice"]
        voice_option(model, voice)
        if row["agent_name"] != agent_name(data["agent_prefix"], model, voice):
            raise ValueError("Invalid local Agent binding. Use this sample's setup output.")
        if (model, voice) in result:
            raise ValueError("Each model/voice must have one saved Agent binding.")
        result[(model, voice)] = row
    return data, result


def pending_pairs(rows: dict[tuple[str, str], dict[str, str]]) -> list[tuple[str, str]]:
    """Pairs that have no saved version or whose saved version predates this definition."""
    return [
        pair for pair in PAIRS
        if pair not in rows or rows[pair]["definition_sha256"] != fingerprint(*pair)
    ]


def write_bindings(path: Path, data: dict[str, Any], rows: dict[tuple[str, str], dict[str, str]]) -> None:
    """Atomically replace setup output so an interrupted write never corrupts it."""
    content = {**data, "agents": [rows[pair] for pair in PAIRS if pair in rows]}
    temporary = path.with_name(path.name.removesuffix(".local.json") + ".tmp.local.json")
    temporary.write_text(json.dumps(content, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def load_bindings(path: Path, endpoint: str) -> dict[tuple[str, str], dict[str, str]]:
    if not path.is_file():
        raise ValueError("Agent bindings are missing. Run setup_agents.py --create first, or use --demo.")
    _data, result = read_bindings(path, endpoint)
    if pending_pairs(result):
        raise ValueError(
            "Agent bindings are incomplete or predate the current definition. "
            "Run setup_agents.py --create again to resume or publish new versions."
        )
    return result
