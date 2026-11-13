"""Plan or explicitly create four reader-owned fictional Voice Agents."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

from banking import MODELS, ROOT, check_definition, definition, fingerprint, load_bindings, project_endpoint


async def create_agents(endpoint: str, path: Path, mode: str) -> None:
    from azure.ai.projects.aio import AIProjectClient
    from azure.ai.projects.models import VoiceAgentDefinition
    from azure.core.exceptions import AzureError
    from azure.identity.aio import AzureCliCredential, DefaultAzureCredential

    rows = []
    # Create the output exclusively before any cloud write; never overwrite a
    # reader's mappings or accidentally republish another sample's Agent.
    with path.open("x", encoding="utf-8") as output:
        async with (
            AzureCliCredential() if mode == "cli" else DefaultAzureCredential()
        ) as credential, AIProjectClient(
            endpoint=endpoint, credential=credential, allow_preview=True,
        ) as client:
            for model, data in MODELS.items():
                for voice in data["voices"]:
                    name = f"northstar-demo-{uuid.uuid4().hex[:16]}"
                    try:
                        async with asyncio.timeout(90):
                            created = await client.agents.create_version(
                                agent_name=name,
                                definition=VoiceAgentDefinition(definition(model, voice["id"])),
                                description="Fictional banking voice sample; synthetic data, no banking tools.",
                            )
                            saved = await client.agents.get_version(
                                agent_name=name, agent_version=created.version,
                            )
                            check_definition(saved.definition, model, voice["id"])
                            await client.agents.enable(name)
                    except (AzureError, ValueError, TimeoutError) as error:
                        raise RuntimeError(
                            f"Setup failed for {name} ({type(error).__name__}). "
                            "An Agent may already exist; inspect/delete it in Foundry. "
                            "Partial bindings are not runnable. Use a new output file to retry."
                        ) from None
                    rows.append({
                        "model": model, "voice": voice["id"], "agent_name": name,
                        "agent_version": str(created.version),
                        "definition_sha256": fingerprint(model, voice["id"]),
                    })
                    output.seek(0)
                    json.dump({
                        "schema_version": 1, "project_endpoint": endpoint, "agents": rows,
                    }, output, indent=2)
                    output.write("\n")
                    output.truncate()
                    output.flush()
                    print(f"Created and enabled {model} / {voice['label']}: {name}, version {created.version}")
    load_bindings(path, endpoint)


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true", help="Explicitly permit Agent creation and enablement.")
    parser.add_argument("--output", type=Path, default=Path(os.getenv("BANKING_AGENT_BINDINGS", "bindings.local.json")))
    args = parser.parse_args()
    mode = os.getenv("AZURE_CREDENTIAL_MODE", "cli")
    if mode not in {"cli", "default"}:
        parser.error("AZURE_CREDENTIAL_MODE must be cli or default.")
    path = args.output if args.output.is_absolute() else ROOT / args.output
    if not path.name.endswith(".local.json"):
        parser.error("Use an ignored *.local.json output file, not a publishable config file.")
    if not args.create:
        for model, data in MODELS.items():
            for voice in data["voices"]:
                print(f"Plan: one managed Voice Agent for {model} / {voice['label']}")
        print("No Azure request made. --create creates/enables four Agents in your existing project; no infrastructure or model deployments.")
        return
    try:
        endpoint = project_endpoint(os.getenv("AZURE_AI_PROJECT_ENDPOINT", ""))
        if path.exists():
            load_bindings(path, endpoint)
            print("Complete local bindings already exist. No Azure changes made; the server checks each saved version before use.")
            return
        asyncio.run(create_agents(endpoint, path, mode))
        print("Keep the local bindings private. Agents are retained; delete them in Foundry when no longer needed.")
    except KeyboardInterrupt:
        raise SystemExit("Setup interrupted. Inspect Foundry for partial Agents before retrying.") from None
    except (OSError, ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
