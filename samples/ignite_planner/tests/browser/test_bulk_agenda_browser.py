"""Verify batch-add-first semantics and that both overlapping choices stay visible (no Azure).

The live version of this flow is test_live_browser.py --scenario agenda.
"""

import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / "data" / "catalog.json").read_text())
IDS = {session["code"]: session["id"] for session in CATALOG["sessions"] if session["code"] in {"BRK241", "BRK248", "BRK246"}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8768")
    args = parser.parse_args()
    (ROOT / "artifacts").mkdir(exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1100}, reduced_motion="reduce")
        page.route("**/api/config", lambda route: route.fulfill(json={
            "voice_available": False, "voice": "en-US-AvaNeural", "busy": False, "local_only": True,
        }))
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url)
        page.wait_for_load_state("networkidle")
        result = page.evaluate(
            "ids => window.igniteDemo.executeTool('add_to_agenda',{instance_ids:ids},'test fixture')",
            list(IDS.values()),
        )
        assert result["ok"] and result["added_count"] == 3, result
        assert result["validation_pending"]
        expect(page.locator(".calendar-event")).to_have_count(3)
        expect(page.locator('.calendar-event[data-overlap="true"]')).to_have_count(2)
        first = page.locator(f'.calendar-event[data-session-id="{IDS["BRK241"]}"]').bounding_box()
        second = page.locator(f'.calendar-event[data-session-id="{IDS["BRK248"]}"]').bounding_box()
        assert abs(first["y"] - second["y"]) < 1
        assert first["x"] + first["width"] <= second["x"] + 1, (first, second)
        page.screenshot(path=str(ROOT / "artifacts" / "batch-overlap-calendar.png"), animations="disabled")
        assert not errors, errors
        browser.close()
        print("PASS: all three meetings added in one operation; both overlapping choices stay visible.")


if __name__ == "__main__":
    main()
