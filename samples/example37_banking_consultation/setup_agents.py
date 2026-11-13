"""Plan, create, resume or update four reader-owned banking Voice Agents."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from banking import (
    PAIRS, ROOT, agent_name, check_definition, definition, fingerprint,
    new_bindings, pending_pairs, project_endpoint, read_bindings, voice_option, write_bindings,
)


def start_bindings(path: Path, endpoint: str):
    """Return existing setup output, or create it before any cloud write."""
    if path.exists():
        return read_bindings(path, endpoint)
    data = new_bindings(endpoint)
    # Persist the Agent-name prefix first. If setup stops after a cloud write,
    # the next run reuses the same names instead of leaving unknown Agents.
    with path.open("x", encoding="utf-8"):
        pass
    write_bindings(path, data, {})
    return data, {}


def label(model: str, voice: str) -> str:
    return f"{model} / {voice_option(model, voice)['label']}"


async def create_agents(endpoint: str, path: Path, mode: str) -> None:
    data, rows = start_bindings(path, endpoint)
    pending = pending_pairs(rows)
    if not pending:
        print("All four local bindings are current. No Azure changes made.")
        return

    from azure.ai.projects.aio import AIProjectClient
    from azure.ai.projects.models import VoiceAgentDefinition
    from azure.core.exceptions import AzureError
    from azure.identity.aio import AzureCliCredential, DefaultAzureCredential

    async with (
        AzureCliCredential() if mode == "cli" else DefaultAzureCredential()
    ) as credential, AIProjectClient(
        endpoint=endpoint, credential=credential, allow_preview=True,
    ) as client:
        for model, voice in pending:
            name = agent_name(data["agent_prefix"], model, voice)
            try:
                async with asyncio.timeout(90):
                    created = await client.agents.create_version(
                        agent_name=name,
                        definition=VoiceAgentDefinition(definition(model, voice)),
                        description="Banking consultation voice sample; synthetic data, no banking tools.",
                    )
                    saved = await client.agents.get_version(
                        agent_name=name, agent_version=created.version,
                    )
                    check_definition(saved.definition, model, voice)
                    await client.agents.enable(name)
            except (AzureError, ValueError, TimeoutError) as error:
                raise RuntimeError(
                    f"Setup stopped at {label(model, voice)} ({type(error).__name__}). "
                    f"Completed pairs are saved in {path.name}. Rerun the same command to "
                    "resume; it reuses the same Agent names."
                ) from None
            action = "Published a new version of" if (model, voice) in rows else "Created"
            rows[(model, voice)] = {
                "model": model, "voice": voice, "agent_name": name,
                "agent_version": str(created.version),
                "definition_sha256": fingerprint(model, voice),
            }
            write_bindings(path, data, rows)
            print(f"{action} {label(model, voice)}: {name}, version {created.version}")


def print_plan(path: Path) -> None:
    rows = {}
    if path.exists():
        try:
            endpoint = project_endpoint(os.getenv("AZURE_AI_PROJECT_ENDPOINT", ""))
            _data, rows = read_bindings(path, endpoint)
        except (OSError, ValueError) as error:
            print(f"Local bindings were not read: {error}")
    pending = set(pending_pairs(rows))
    for model, voice in PAIRS:
        if (model, voice) not in pending:
            state = "current; no change"
        elif (model, voice) in rows:
            state = "publish a new version of the existing Agent"
        else:
            state = "create and enable one managed Voice Agent"
        print(f"Plan for {label(model, voice)}: {state}")
    print("No Azure request made. --create changes only the Agents listed above; no infrastructure or model deployments.")


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true", help="Explicitly permit Agent creation, updates and enablement.")
    parser.add_argument("--output", type=Path, default=Path(os.getenv("BANKING_AGENT_BINDINGS", "bindings.local.json")))
    args = parser.parse_args()
    mode = os.getenv("AZURE_CREDENTIAL_MODE", "cli")
    if mode not in {"cli", "default"}:
        parser.error("AZURE_CREDENTIAL_MODE must be cli or default.")
    path = args.output if args.output.is_absolute() else ROOT / args.output
    if not path.name.endswith(".local.json") or path.name.endswith(".tmp.local.json"):
        parser.error("Use an ignored *.local.json output file, not a publishable config file.")
    if not args.create:
        print_plan(path)
        return
    try:
        endpoint = project_endpoint(os.getenv("AZURE_AI_PROJECT_ENDPOINT", ""))
        if path.exists() and not pending_pairs(read_bindings(path, endpoint)[1]):
            print("All four local bindings are current. No Azure changes made.")
            return
        asyncio.run(create_agents(endpoint, path, mode))
        print("Keep the local bindings private. Agents are retained; delete them in Foundry when no longer needed.")
    except KeyboardInterrupt:
        raise SystemExit("Setup interrupted. Rerun the same command to resume.") from None
    except (OSError, ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
