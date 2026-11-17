"""Run scripted text calls against a published agent and check each turn.

Example:
    python run_tests.py --agent my-support-agent --scenarios ../examples/customer_support/scenarios.json --runs 3

Per-turn checks in scenarios.json (all optional):
    node       node that must be active when the agent finishes the turn
    tools      tool names (suffix match) that must be called in the turn
    no_tools   tool names that must not be called; ["*"] means no tool at all
    says_any   at least one of these phrases must be spoken (case-insensitive)
    says_none  none of these phrases may be spoken
    ends       true when the call is expected to end in this turn
Per-scenario checks:
    must_call  tools that must run somewhere in the call (an outcome may land a turn later)
    max_calls  {"tool_suffix": n}: the tool may run at most n times in the call
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from va_common import print_turn, run_session


def _matches(name: str, wanted: str) -> bool:
    return name == wanted or name.endswith("_" + wanted)


def check_turn(index: int, record: dict[str, Any], expect: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    tools, text = record["tools"], record["agent"].lower()
    allowed = {"ok", "ended"} if expect.get("ends") else {"ok"}
    if record["outcome"] not in allowed:
        failures.append(f"turn {index}: call {record['outcome']}")
    if expect.get("ends") and record["outcome"] != "ended" and not any(_matches(t, "end_conversation") for t in tools):
        failures.append(f"turn {index}: expected the call to end")
    if "node" in expect and record["node"] != expect["node"]:
        failures.append(f"turn {index}: node {record['node']!r}, expected {expect['node']!r}")
    for wanted in expect.get("tools", []):
        if not any(_matches(t, wanted) for t in tools):
            failures.append(f"turn {index}: {wanted} not called (called {tools})")
    for banned in expect.get("no_tools", []):
        hits = tools if banned == "*" else [t for t in tools if _matches(t, banned)]
        if hits:
            failures.append(f"turn {index}: must not call {hits}")
    phrases = expect.get("says_any", [])
    if phrases and not any(p.lower() in text for p in phrases):
        failures.append(f"turn {index}: said none of {phrases}")
    for phrase in expect.get("says_none", []):
        if phrase.lower() in text:
            failures.append(f"turn {index}: said {phrase!r}")
    return failures


def check_session(scenario: dict[str, Any], session: dict[str, Any]) -> list[str]:
    turns = session["turns"]
    failures: list[str] = []
    for index, spec in enumerate(scenario["turns"], start=1):
        if index >= len(turns):
            failures.append(f"turn {index}: not reached (call ended or stalled earlier)")
            break
        failures += check_turn(index, turns[index], spec.get("expect", {}))
    calls = [name for turn in turns for name in turn["tools"]]
    for wanted in scenario.get("must_call", []):
        if not any(_matches(name, wanted) for name in calls):
            failures.append(f"call: {wanted} never ran")
    for wanted, limit in scenario.get("max_calls", {}).items():
        count = sum(_matches(name, wanted) for name in calls)
        if count > limit:
            failures.append(f"call: {wanted} ran {count} times, limit {limit}")
    return failures


def run_scenario(agent: str, scenario: dict[str, Any], timeout: float) -> dict[str, Any]:
    says = [turn["say"] for turn in scenario["turns"]]
    try:
        session = asyncio.run(run_session(agent, says, timeout=timeout))
        failures = check_session(scenario, session)
    except Exception as error:  # a broken session is a failed run, not a crash
        session, failures = {"conversation_id": None, "turns": []}, [f"session error: {error}"]
    return {
        "agent": agent,
        "scenario": scenario["name"],
        "conversation_id": session["conversation_id"],
        "passed": not failures,
        "failures": failures,
        "turns": session["turns"],
    }


def report(result: dict[str, Any], verbose: bool) -> None:
    status = "PASS" if result["passed"] else "FAIL"
    print(f"{status} {result['agent']} / {result['scenario']} ({result['conversation_id']})")
    for failure in result["failures"]:
        print(f"    - {failure}")
    if verbose or not result["passed"]:
        for index, record in enumerate(result["turns"]):
            print_turn(index, record)
        print()


def load_scenarios(path: Path, only: list[str] | None = None) -> list[dict[str, Any]]:
    scenarios = json.loads(path.read_text(encoding="utf-8"))["scenarios"]
    return [s for s in scenarios if not only or s["name"] in only]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--scenarios", type=Path, required=True)
    parser.add_argument("--only", action="append", help="Run only this scenario; repeatable.")
    parser.add_argument("--runs", type=int, default=1, help="Calls per scenario.")
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--out", type=Path, help="Append one JSON line per call.")
    parser.add_argument("--verbose", action="store_true", help="Print transcripts of passing calls too.")
    args = parser.parse_args()

    totals: dict[str, list[int]] = {}
    for _ in range(args.runs):
        for scenario in load_scenarios(args.scenarios, args.only):
            result = run_scenario(args.agent, scenario, args.timeout)
            report(result, args.verbose)
            totals.setdefault(scenario["name"], [0, 0])
            totals[scenario["name"]][0] += result["passed"]
            totals[scenario["name"]][1] += 1
            if args.out:
                with args.out.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(result) + "\n")
    print("\nscenario                         passed")
    for name, (passed, total) in totals.items():
        print(f"{name:32s} {passed}/{total}")


if __name__ == "__main__":
    main()
