"""Create a mock airline Voice Agent, simulate conversations, and score a custom rubric."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import re
import sys
import time
import uuid
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from prepare_example import validate_inputs

if TYPE_CHECKING:
    from azure.ai.projects import AIProjectClient
    from openai import OpenAI

HERE = Path(__file__).resolve().parent
API_VERSION = "2025-11-15-preview"
TERMINAL_STATES = {"completed", "failed", "canceled", "cancelled"}


def write_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(value, indent=2, ensure_ascii=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def endpoint_url(value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not re.fullmatch(r"[a-z0-9-]+\.services\.ai\.azure\.com", parsed.hostname or "")
        or not re.fullmatch(r"/api/projects/[A-Za-z0-9._-]+", parsed.path)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Set AZURE_AI_PROJECT_ENDPOINT to an HTTPS Foundry project endpoint.")
    return value


def deployment(value: str, label: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?", value):
        raise ValueError(f"Set {label} to an existing deployment or connection/deployment name.")
    return value


def positive_seconds(value: str) -> float:
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("Use a finite number greater than zero.")
    return number


def build_plan(args: argparse.Namespace, *, run_key: str | None = None) -> dict[str, Any]:
    prompt, rubric = validate_inputs()
    settings = json.loads((HERE / "evaluation_settings.json").read_text(encoding="utf-8"))
    endpoint = endpoint_url(os.environ.get("AZURE_AI_PROJECT_ENDPOINT", "").rstrip("/"))
    simulator = deployment(
        args.simulator_model or os.environ.get("AZURE_AI_SIMULATOR_MODEL", ""),
        "AZURE_AI_SIMULATOR_MODEL / --simulator-model",
    )
    judge = deployment(
        args.judge_model or os.environ.get("AZURE_AI_MODEL_DEPLOYMENT_NAME", ""),
        "AZURE_AI_MODEL_DEPLOYMENT_NAME / --judge-model",
    )
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,30}", args.name_prefix):
        raise ValueError("--name-prefix must start with a lowercase letter and use 1-31 letters/digits/hyphens.")
    agent_model = args.agent_model or settings["agent"]["model"]
    agent_voice = args.agent_voice or settings["agent"]["voice"]
    caller_voice = args.caller_voice or settings["simulation"]["voice_model"]["name"]
    if not re.fullmatch(r"[A-Za-z0-9._-]+", agent_model):
        raise ValueError("Use an explicit managed Voice Agent model identifier.")
    if not re.fullmatch(r"[A-Za-z0-9:-]+", agent_voice):
        raise ValueError("Invalid agent voice name.")
    if not re.fullmatch(r"[A-Za-z0-9:-]+Neural", caller_voice):
        raise ValueError("Use an Azure standard neural simulated-caller voice name.")
    scenarios = []
    seen = set()
    for line in args.scenarios.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict) or set(row) != {
            "test_case_id", "test_case_description", "simulation_configuration"
        }:
            raise ValueError("Each scenario must contain test_case_id, test_case_description, and simulation_configuration.")
        identifier, description = row["test_case_id"], row["test_case_description"]
        if (
            not isinstance(identifier, str)
            or not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", identifier)
            or identifier in seen
            or not isinstance(description, str)
            or not description.strip()
            or len(description) > 2500
        ):
            raise ValueError("Invalid or duplicate scenario ID/description.")
        configuration = row["simulation_configuration"]
        if not isinstance(configuration, dict) or set(configuration) != {"desired_num_turns"}:
            raise ValueError("This runner supports only desired_num_turns per scenario; use run-wide budgets for other settings.")
        turns = configuration["desired_num_turns"]
        if type(turns) is not int or not 1 <= turns <= args.max_turns:
            raise ValueError("Scenario desired_num_turns must be between 1 and --max-turns.")
        scenarios.append(row)
        seen.add(identifier)
    expected = len(scenarios) * args.repetitions
    if not 1 <= expected <= 20:
        raise ValueError("This sample requires 1-20 conversations per run.")
    dimensions = []
    for dimension in rubric["dimensions"]:
        if (
            not re.fullmatch(r"[a-z][a-z0-9_]*", dimension["id"])
            or type(dimension["weight"]) is not int
            or not 1 <= dimension["weight"] <= 10
        ):
            raise ValueError("Rubric IDs must be snake_case and weights integers from 1 through 10.")
        entry = {key: dimension[key] for key in ("id", "description", "weight")}
        applicability = dimension.get("applicability")
        if applicability == "Always applicable":
            entry["always_applicable"] = True
        elif applicability is not None:
            raise ValueError(f"Unsupported applicability for {dimension['id']}.")
        dimensions.append(entry)
    threshold = rubric["pass_score_threshold"]
    if type(threshold) not in (int, float) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError("The rubric pass threshold must be a finite number between 0 and 1.")
    prefix = f"{args.name_prefix}-{run_key or uuid.uuid4().hex[:8]}"
    toolbox_name, agent_name, evaluator_name = (
        f"{prefix}-tools", f"{prefix}-agent", f"{prefix}-rubric"
    )
    instructions = prompt.replace("airline_refund_python", toolbox_name)
    return {
        "endpoint": endpoint,
        "expected_conversations": expected,
        "pass_threshold": threshold,
        "file": {
            "name": "airline_lookup_default.py",
            "purpose": "assistants",
            "sha256": hashlib.sha256((HERE / "airline_lookup_default.py").read_bytes()).hexdigest(),
        },
        "container": {"name": prefix, "file_ids": ["$FILE_ID"]},
        "toolbox": {
            "name": toolbox_name,
            "tools": [{"type": "code_interpreter", "container": "$CONTAINER_ID"}],
        },
        "agent": {
            "agent_name": agent_name,
            "definition": {
                "kind": "voice",
                "model_type": "managed",
                "model": agent_model,
                "instructions": instructions.replace("<UPLOADED_PYTHON_PATH>", "$UPLOADED_PYTHON_PATH"),
                "audio": {"output": {"voice": agent_voice, "voice_type": args.agent_voice_type}},
                "output_modalities": ["audio"],
                "tools": [{
                    "type": "toolbox",
                    "toolbox_name": toolbox_name,
                    "toolbox_version": "$TOOLBOX_VERSION",
                }],
                "store": True,
            },
        },
        "evaluator": {
            "name": evaluator_name,
            "evaluator_version": {
                "name": evaluator_name,
                "display_name": "Airline cancellation eligibility rubric",
                "description": "Sample five-dimension conversation rubric; mock reservations only.",
                "categories": ["quality"],
                "definition": {
                    "type": "rubric", "dimensions": dimensions, "pass_threshold": threshold,
                },
            },
        },
        "evaluation": {
            "name": f"{prefix}-evaluation",
            "data_source_config": {
                "type": "custom",
                "item_schema": {
                    "type": "object",
                    "properties": {
                        "messages": {"type": "array"}, "tool_definitions": {"type": "array"},
                    },
                    "required": ["messages"],
                },
                "include_sample_schema": True,
            },
            "testing_criteria": [{
                "type": "azure_ai_evaluator",
                "name": rubric["evaluator_name"],
                "evaluator_name": evaluator_name,
                "evaluator_version": "$EVALUATOR_VERSION",
                "initialization_parameters": {"deployment_name": judge},
                "data_mapping": settings["evaluator"]["data_mapping"],
            }],
        },
        "run": {
            "name": f"{prefix}-run",
            "evaluation_level": "conversation",
            "data_source": {
                "type": "azure_ai_user_conversation_simulation",
                "source": {"type": "inline_user_conversation_simulation", "test_cases": scenarios},
                "target": {
                    "type": "azure_ai_agent", "name": agent_name, "version": "$AGENT_VERSION",
                },
                "model_configuration": {
                    "model": simulator,
                    "voice_model": {"type": "azure-standard", "name": caller_voice},
                },
                "default_simulation_configuration": {
                    "max_num_turns": args.max_turns,
                    "conversation_repetitions": args.repetitions,
                    "enable_conversation_dataset_generation": args.save_conversations,
                },
            },
        },
    }


def wait_for_file(client: OpenAI, file_id: str, output: Path, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while True:
        file = client.files.retrieve(file_id)
        write_json(output / "file.json", file.to_dict())
        if file.status == "processed":
            return
        if file.status in {"error", "deleted"}:
            raise RuntimeError(f"Uploaded file ended in status {file.status}; inspect file.json.")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("File processing timed out; inspect the saved file ID before another run.")
        time.sleep(min(2, remaining))


def container_path(client: OpenAI, container_id: str, expected_hash: str, output: Path) -> str:
    files = list(client.containers.files.list(container_id))
    write_json(output / "container_files.json", [file.to_dict() for file in files])
    matches = [
        file for file in files
        if PurePosixPath(file.path).name.endswith("airline_lookup_default.py")
    ]
    if len(matches) != 1:
        raise RuntimeError("The container must expose exactly one sample Python file; no mounted path was guessed.")
    file = matches[0]
    path = PurePosixPath(file.path)
    if not file.path.startswith("/mnt/data/") or ".." in path.parts or any(
        character in file.path for character in "\r\n\\"
    ):
        raise RuntimeError("The service returned an unexpected mounted Python path.")
    content = client.containers.files.content.retrieve(file_id=file.id, container_id=container_id).read()
    if hashlib.sha256(content).hexdigest() != expected_hash:
        raise RuntimeError("The mounted Python content differs from the uploaded sample.")
    return file.path


def verify_agent(actual: dict[str, Any], requested: dict[str, Any]) -> None:
    for key in ("kind", "model", "model_type", "instructions", "store"):
        if actual.get(key) != requested[key]:
            raise RuntimeError(f"Saved agent readback differs at {key}.")
    tools = actual.get("tools", [])
    if len(tools) != 1 or any(
        tools[0].get(key) != value for key, value in requested["tools"][0].items()
    ):
        raise RuntimeError("Saved agent readback differs at the pinned toolbox.")
    output = actual.get("audio", {}).get("output", {})
    expected_voice = requested["audio"]["output"]
    voice = output.get("voice")
    if isinstance(voice, dict):
        voice_name, voice_type = voice.get("name"), voice.get("type")
    else:
        voice_name, voice_type = voice, output.get("voice_type")
    if voice_name != expected_voice["voice"] or voice_type != expected_voice["voice_type"]:
        raise RuntimeError("Saved agent readback differs at the output voice.")


def provision_and_submit(
    project: AIProjectClient, client: OpenAI, plan: dict[str, Any], output: Path, timeout: float
) -> dict[str, Any]:
    from azure.ai.projects.models import CodeInterpreterToolboxTool, VoiceAgentDefinition

    receipt = {
        "endpoint": plan["endpoint"],
        "expected_conversations": plan["expected_conversations"],
        "pass_threshold": plan["pass_threshold"],
        "criterion_name": plan["evaluation"]["testing_criteria"][0]["name"],
        "agent_name": plan["agent"]["agent_name"],
        "toolbox_name": plan["toolbox"]["name"],
        "evaluator_name": plan["evaluator"]["name"],
        "eval_id": None,
        "run_id": None,
    }

    def stage(name: str, **created: Any) -> None:
        receipt.update(created)
        receipt["stage"] = name
        write_json(output / "receipt.json", receipt)
        print(f"Stage: {name}", flush=True)

    request = copy.deepcopy(plan)
    stage("uploading_file")
    with (HERE / plan["file"]["name"]).open("rb") as file:
        uploaded = client.files.create(file=file, purpose="assistants")
    stage("processing_file", file_id=uploaded.id)
    wait_for_file(client, uploaded.id, output, timeout)
    stage("creating_container")
    request["container"]["file_ids"] = [uploaded.id]
    container = client.containers.create(**request["container"])
    stage("resolving_mounted_path", container_id=container.id)
    mounted_path = container_path(client, container.id, plan["file"]["sha256"], output)
    stage("creating_toolbox", uploaded_python_path=mounted_path)
    request["toolbox"]["tools"][0]["container"] = container.id
    toolbox = project.toolboxes.create_version(
        name=request["toolbox"]["name"],
        tools=[CodeInterpreterToolboxTool(request["toolbox"]["tools"][0])],
    )
    stage("creating_agent", toolbox_version=toolbox.version)
    definition = request["agent"]["definition"]
    definition["instructions"] = definition["instructions"].replace("$UPLOADED_PYTHON_PATH", mounted_path)
    definition["tools"][0]["toolbox_version"] = toolbox.version
    (output / "agent_prompt.txt").write_text(definition["instructions"], encoding="utf-8")
    created = project.agents.create_version(
        agent_name=receipt["agent_name"], definition=VoiceAgentDefinition(definition),
    )
    stage("enabling_agent", agent_version=created.version)
    saved = project.agents.get_version(
        agent_name=receipt["agent_name"], agent_version=created.version,
    )
    verify_agent(saved.definition.as_dict(), definition)
    project.agents.enable(agent_name=receipt["agent_name"])
    stage("creating_rubric")
    evaluator = project.evaluators.create_version(**request["evaluator"])
    stage("creating_evaluation", evaluator_version=evaluator.version)
    actual_rubric = evaluator.definition.as_dict()
    expected_dimensions = request["evaluator"]["evaluator_version"]["definition"]["dimensions"]
    actual_dimensions = actual_rubric.get("dimensions", [])
    if len(actual_dimensions) != len(expected_dimensions) or any(
        any(actual.get(key) != expected[key] for key in ("id", "description", "weight"))
        or actual.get("always_applicable", False) != expected.get("always_applicable", False)
        for actual, expected in zip(actual_dimensions, expected_dimensions)
    ):
        raise RuntimeError("The registered rubric dimensions differ from the requested rubric.")
    if actual_rubric.get("pass_threshold") != plan["pass_threshold"]:
        raise RuntimeError("The registered rubric pass threshold differs from the requested threshold.")
    request["evaluation"]["testing_criteria"][0]["evaluator_version"] = evaluator.version
    request["run"]["data_source"]["target"]["version"] = created.version
    write_json(output / "resolved_request.json", request)
    evaluation = client.evals.create(**request["evaluation"])
    stage("creating_run", eval_id=evaluation.id)
    run = client.evals.runs.create(
        eval_id=evaluation.id,
        name=request["run"]["name"],
        data_source=request["run"]["data_source"],
        extra_body={"evaluation_level": "conversation"},
    )
    stage("run_submitted", run_id=run.id)
    print(f"Evaluation: {evaluation.id}; run: {run.id}", flush=True)
    return receipt


def collect_results(client: OpenAI, receipt: dict[str, Any], output: Path, timeout: float) -> None:
    eval_id, run_id = receipt["eval_id"], receipt["run_id"]
    deadline = time.monotonic() + timeout
    while True:
        run = client.evals.runs.retrieve(eval_id=eval_id, run_id=run_id)
        write_json(output / "run.json", run.to_dict())
        if run.status in TERMINAL_STATES:
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(
                f"Stopped waiting; the cloud run is NOT canceled. Resume with results --receipt "
                f"\"{output / 'receipt.json'}\". Do not start run again."
            )
        time.sleep(min(5, remaining))
    items = [
        item.to_dict()
        for item in client.evals.runs.output_items.list(eval_id=eval_id, run_id=run_id)
    ]
    write_json(output / "output_items.json", items)
    if run.status != "completed":
        raise RuntimeError(f"Evaluation ended in {run.status}; raw results were retained.")
    if run.result_counts is None:
        raise RuntimeError("The completed run has no result counts; raw results were retained.")
    counts = run.result_counts.to_dict()
    if (
        counts.get("total") != receipt["expected_conversations"]
        or len(items) != receipt["expected_conversations"]
        or len({item.get("id") for item in items}) != len(items)
        or any(type(counts.get(key)) is not int for key in ("total", "passed", "failed", "errored"))
        or counts.get("passed") != counts.get("total")
        or any(counts.get(key, 0) != 0 for key in ("failed", "errored", "skipped"))
    ):
        raise RuntimeError("Missing, failed, errored, or skipped conversations; inspect run.json and output_items.json.")
    scores = []
    for item in items:
        results = [
            result for result in item.get("results", [])
            if result.get("name") == receipt["criterion_name"]
        ]
        if item.get("status") not in {"pass", "completed"} or len(results) != 1:
            raise RuntimeError("An output item is incomplete or does not contain exactly one expected rubric result.")
        result = results[0]
        score = result.get("score")
        if (
            type(score) not in (int, float)
            or not math.isfinite(score)
            or not 0 <= score <= 1
            or result.get("passed") is not True
            or score < receipt["pass_threshold"]
        ):
            raise RuntimeError("A rubric result is missing, invalid, or failing; inspect output_items.json.")
        scores.append({"item_id": item["id"], "score": score, "reason": result.get("reason")})
    summary = {"status": run.status, "counts": counts, "scores": scores, "report_url": run.report_url}
    write_json(output / "summary.json", summary)
    print(json.dumps(summary, indent=2))
    print(f"Artifacts: {output.resolve()}", flush=True)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    for name in ("plan", "run", "results"):
        command = commands.add_parser(name)
        if name != "results":
            command.add_argument("--name-prefix", default="airline-eval")
            command.add_argument("--agent-model")
            command.add_argument("--agent-voice")
            command.add_argument("--agent-voice-type", choices=("openai", "azure-standard", "azure-realtime-native"), default="openai")
            command.add_argument("--simulator-model")
            command.add_argument("--judge-model")
            command.add_argument("--caller-voice")
            command.add_argument("--scenarios", type=Path, default=HERE / "scenarios.jsonl")
            command.add_argument("--max-turns", type=int, choices=range(1, 21), default=10)
            command.add_argument("--repetitions", type=int, choices=range(1, 6), default=1)
            command.add_argument("--save-conversations", action="store_true")
        else:
            command.add_argument("--receipt", type=Path, required=True)
        if name != "plan":
            command.add_argument("--output", type=Path)
            command.add_argument("--timeout-seconds", type=positive_seconds, default=600)
    return result


def main(argv: list[str] | None = None) -> None:
    args = parser().parse_args(argv)
    plan = build_plan(args) if args.command != "results" else None
    if args.command == "plan":
        print(json.dumps(plan, indent=2))
        return
    receipt = None
    if args.command == "results":
        receipt = json.loads(args.receipt.read_text(encoding="utf-8"))
        endpoint = endpoint_url(receipt["endpoint"])
        if (
            any(
                not isinstance(receipt.get(key), str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", receipt[key])
                for key in ("eval_id", "run_id")
            )
            or type(receipt.get("expected_conversations")) is not int
            or not 1 <= receipt["expected_conversations"] <= 20
            or not isinstance(receipt.get("criterion_name"), str)
            or not receipt["criterion_name"].strip()
            or type(receipt.get("pass_threshold")) not in (int, float)
            or not math.isfinite(receipt["pass_threshold"])
            or not 0 <= receipt["pass_threshold"] <= 1
        ):
            raise ValueError("The receipt must identify a submitted run, expected count, rubric name, and threshold.")
    else:
        endpoint = plan["endpoint"]
    from azure.ai.projects import AIProjectClient
    from azure.core.exceptions import AzureError
    from azure.identity import DefaultAzureCredential
    from openai import OpenAIError

    output = args.output or Path("voice-agent-output") / f"foundry-evaluation-{uuid.uuid4().hex}"
    output.mkdir(parents=True, exist_ok=False)
    print(f"Artifacts: {output.resolve()}", flush=True)
    if plan is not None:
        write_json(output / "request.json", plan)
    else:
        write_json(output / "receipt.json", receipt)
    try:
        with (
            DefaultAzureCredential() as credential,
            AIProjectClient(
                endpoint=endpoint, credential=credential, allow_preview=True,
                retry_total=0, connection_timeout=30, read_timeout=30,
            ) as project,
            project.get_openai_client(
                base_url=f"{endpoint}/openai",
                default_query={"api-version": API_VERSION}, timeout=30, max_retries=0,
            ) as client,
        ):
            if plan is not None:
                receipt = provision_and_submit(project, client, plan, output, args.timeout_seconds)
            collect_results(client, receipt, output, args.timeout_seconds)
    except (AzureError, OpenAIError) as error:
        raise RuntimeError(
            f"Foundry request failed: {error}\nResources are NOT deleted and creation is NOT retried. "
            f"Inspect {output / 'receipt.json'} and Foundry before starting another run."
        ) from error


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, TimeoutError, KeyError, TypeError, ImportError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
