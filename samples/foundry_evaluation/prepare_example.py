"""Prepare local portal inputs without calling Azure or creating cloud resources."""

import argparse
import json
import shutil
from pathlib import Path, PurePosixPath


SAMPLE_DIR = Path(__file__).resolve().parent
COPY_FILES = (
    "airline_lookup_default.py",
    "scenarios.jsonl",
    "rubric.json",
    "evaluation_settings.json",
)


def validate_inputs() -> tuple[str, dict]:
    for name in (*COPY_FILES, "agent_prompt.md"):
        if not (SAMPLE_DIR / name).is_file():
            raise ValueError(f"Required file is missing: {name}")
    prompt = (SAMPLE_DIR / "agent_prompt.md").read_text(encoding="utf-8")
    if prompt.count("<UPLOADED_PYTHON_PATH>") != 1:
        raise ValueError("agent_prompt.md must contain exactly one path placeholder")
    rubric = json.loads((SAMPLE_DIR / "rubric.json").read_text(encoding="utf-8"))
    settings = json.loads(
        (SAMPLE_DIR / "evaluation_settings.json").read_text(encoding="utf-8")
    )
    if rubric["pass_score_threshold"] != settings["evaluator"]["pass_score_threshold"]:
        raise ValueError("Rubric and evaluation pass thresholds must match")
    dimensions = rubric["dimensions"]
    if not dimensions or len({item["id"] for item in dimensions}) != len(dimensions):
        raise ValueError("Rubric dimension IDs must be nonempty and unique")
    if not all(
        item["id"] and item["description"] and item["weight"] > 0
        for item in dimensions
    ):
        raise ValueError("Each rubric dimension needs an ID, description, and positive weight")
    scenarios = [
        json.loads(line)
        for line in (SAMPLE_DIR / "scenarios.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not scenarios:
        raise ValueError("scenarios.jsonl must contain at least one scenario")
    for scenario in scenarios:
        if not scenario["test_case_id"] or not scenario["test_case_description"]:
            raise ValueError("Each scenario needs a test case ID and description")
        turns = scenario["simulation_configuration"]["desired_num_turns"]
        if not 1 <= turns <= settings["simulation"]["max_num_turns"]:
            raise ValueError("Scenario turns must fit the configured maximum turn count")
    return prompt, rubric


def prepare_example(
    uploaded_python_path: str, toolbox_name: str, output_dir: Path
) -> None:
    prompt, rubric = validate_inputs()
    mounted = PurePosixPath(uploaded_python_path)
    if (
        not uploaded_python_path.startswith("/mnt/data/")
        or ".." in mounted.parts
        or mounted.suffix != ".py"
        or any(char in uploaded_python_path for char in "<>\r\n\\")
    ):
        raise ValueError("Use the actual uploaded .py path under /mnt/data/, not a placeholder")
    if not toolbox_name.strip() or any(char in toolbox_name for char in "\r\n"):
        raise ValueError("Toolbox name must be nonempty and on one line")
    rendered = prompt.replace("<UPLOADED_PYTHON_PATH>", uploaded_python_path)
    rendered = rendered.replace("airline_refund_python", toolbox_name)
    output_dir.mkdir(parents=True, exist_ok=False)
    for name in COPY_FILES:
        shutil.copyfile(SAMPLE_DIR / name, output_dir / name)
    settings_path = output_dir / "evaluation_settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    settings["agent"]["toolbox"]["name"] = toolbox_name
    settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    (output_dir / "agent_prompt.txt").write_text(rendered, encoding="utf-8")
    (output_dir / "rubric_generation_prompt.txt").write_text(
        rubric["generation_prompt"] + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Validate the input files only")
    mode.add_argument("--uploaded-python-path", help="Exact mounted Code Interpreter .py path")
    parser.add_argument("--toolbox-name", default="airline-refund-python")
    parser.add_argument("--output", type=Path, default=SAMPLE_DIR / ".generated")
    args = parser.parse_args()
    try:
        if args.check:
            validate_inputs()
            print("Example inputs are valid. No Azure calls were made.")
        else:
            prepare_example(args.uploaded_python_path, args.toolbox_name, args.output)
            print(f"Portal inputs written to: {args.output.resolve()}")
            print("No files were uploaded and no cloud resources or runs were created.")
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
