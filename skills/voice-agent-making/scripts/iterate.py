"""Compare one-change variants of an agent against an exact copy of it.

Example:
    python iterate.py --base ../examples/customer_support/agent.json \
        --variants variants.json --scenarios ../examples/customer_support/scenarios.json \
        --prefix support-exp --runs 10

variants.json:
    {"variants": [{"name": "ask-name-first", "why": "caller name is often missing",
                   "patches": [{"node": "identify_issue", "find": "old text", "replace": "new text"},
                               {"node": "troubleshoot", "set": {"tool_choice": "auto"}}]}]}
    "node" is a node id, or "$base" for the shared top-level instructions.
    "find" must occur exactly once in that node's instructions, or the run stops.

The control agent <prefix>-base is published from the base file unchanged, so its
fingerprint equals the base file's. Each variant is published as <prefix>-<name>.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import time
from pathlib import Path
from typing import Any

from run_tests import load_scenarios, report, run_scenario
from va_common import fingerprint, load_agent, publish

ALPHA = 0.05


def apply_patches(definition: dict[str, Any], patches: list[dict[str, Any]]) -> dict[str, Any]:
    result = copy.deepcopy(definition)
    nodes = {n["id"]: n for n in (result.get("subagent_config") or {}).get("subagents") or []}
    for patch in patches:
        target = result if patch["node"] == "$base" else nodes.get(patch["node"])
        if target is None:
            raise SystemExit(f"Unknown node {patch['node']!r}; nodes are {sorted(nodes)}.")
        if "find" in patch:
            count = target.get("instructions", "").count(patch["find"])
            if count != 1:
                raise SystemExit(f"{patch['node']}: text to replace occurs {count} times, expected 1:\n  {patch['find']!r}")
            target["instructions"] = target["instructions"].replace(patch["find"], patch["replace"])
        target.update(patch.get("set", {}))
    return result


def fisher_less(base_fail: int, base_n: int, var_fail: int, var_n: int) -> float:
    """One-sided Fisher exact p: chance of a gap this large if the variant were no better."""
    total, fails = base_n + var_n, base_fail + var_fail
    denominator = math.comb(total, base_n)
    return sum(
        math.comb(fails, x) * math.comb(total - fails, base_n - x)
        for x in range(base_fail, min(fails, base_n) + 1)
    ) / denominator


def runs_needed(failure_rate: float) -> int:
    """Calls per arm so a useless change shows zero failures less than 5% of the time."""
    return math.ceil(math.log(ALPHA) / math.log(1 - failure_rate))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", type=Path, help="Current agent.json (the version callers use).")
    parser.add_argument("--variants", type=Path)
    parser.add_argument("--scenarios", type=Path)
    parser.add_argument("--prefix", help="Experiment agent name prefix, for example support-exp.")
    parser.add_argument("--runs", type=int, default=10, help="Rounds; each round runs every scenario on every agent.")
    parser.add_argument("--only", action="append", help="Use only this scenario; repeatable.")
    parser.add_argument("--skip-publish", action="store_true", help="Reuse already published experiment agents.")
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--out", type=Path, default=Path("iteration_results.jsonl"))
    parser.add_argument("--plan", type=float, help="Print calls needed for this baseline failure rate, then exit.")
    args = parser.parse_args()

    if args.plan:
        print(f"baseline failure rate {args.plan:.0%}: run at least {runs_needed(args.plan)} calls per agent")
        return
    if not all([args.base, args.variants, args.scenarios, args.prefix]):
        parser.error("--base, --variants, --scenarios and --prefix are required.")

    base_name, description, base = load_agent(args.base)
    arms = {f"{args.prefix}-base": base}
    for variant in json.loads(args.variants.read_text(encoding="utf-8"))["variants"]:
        arms[f"{args.prefix}-{variant['name']}"] = apply_patches(base, variant["patches"])
    if base_name in arms:
        raise SystemExit(f"Refusing to publish over {base_name!r}: choose a different --prefix.")
    scenarios = load_scenarios(args.scenarios, args.only)

    print(f"pass rule (fixed before running): a variant is adopted only if it fails fewer calls than "
          f"{args.prefix}-base with one-sided Fisher p < {ALPHA}, and no scenario gets worse.")
    for name, definition in arms.items():
        print(f"  {name:40s} fingerprint {fingerprint(definition)}")
        if not args.skip_publish:
            print(f"    published version {publish(name, definition, description)}")

    results: dict[str, list[dict[str, Any]]] = {name: [] for name in arms}
    names = list(arms)
    for round_index in range(args.runs):
        order = names[round_index % len(names):] + names[:round_index % len(names)]
        for scenario in scenarios:
            for name in order:  # alternate agents so load changes hit every arm equally
                result = run_scenario(name, scenario, args.timeout)
                result["round"], result["time"] = round_index, time.time()
                results[name].append(result)
                report(result, verbose=False)
                with args.out.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(result) + "\n")

    def fails(name: str, scenario: str | None = None) -> tuple[int, int]:
        rows = [r for r in results[name] if scenario in (None, r["scenario"])]
        return sum(not r["passed"] for r in rows), len(rows)

    control = names[0]
    print("\nagent                                    failed calls   p vs base   decision")
    for name in names:
        failed, total = fails(name)
        if name == control:
            print(f"{name:40s} {failed:3d}/{total:<3d}")
            continue
        p = fisher_less(*fails(control), failed, total)
        worse = [s["name"] for s in scenarios if fails(name, s["name"])[0] > fails(control, s["name"])[0]]
        decision = "adopt" if p < ALPHA and not worse else "reject" if failed > fails(control)[0] else "no evidence"
        detail = f" (worse: {', '.join(worse)})" if worse else ""
        print(f"{name:40s} {failed:3d}/{total:<3d}        {p:8.4f}   {decision}{detail}")
    print(f"\nEvery call with its transcript is in {args.out}; read the failed ones before trusting a count.")


if __name__ == "__main__":
    main()
