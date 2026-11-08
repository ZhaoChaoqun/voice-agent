"""Verify automatic scrolling, stable cards, and direct selection of unloaded meetings."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

CATALOG = json.loads((Path(__file__).resolve().parents[2] / "data" / "catalog.json").read_text())
TARGET = next(session for session in CATALOG["sessions"] if session["code"] == "BRK244")


def scroll_to_more(page):
    return page.evaluate("""() => {
        document.getElementById('scroll-sentinel').scrollIntoView({block:'end',behavior:'instant'});
        return scrollY;
    }""")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8768")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, reduced_motion="reduce")
        page.route("**/api/config", lambda route: route.fulfill(json={
            "voice_available": False, "voice": "en-US-AvaNeural", "busy": False, "local_only": True,
        }))
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url)
        page.wait_for_load_state("networkidle")
        expect(page.locator(".session-card")).to_have_count(24)
        expect(page.locator("#previous-page, #next-page")).to_have_count(0)
        assert page.locator("main").bounding_box()["width"] >= 1900, "Do not retain the old 1840px width cap"
        cards = page.locator(".session-card")
        assert cards.nth(0).bounding_box()["y"] == cards.nth(1).bounding_box()["y"]
        page.evaluate("window.__originalSessionCard = document.querySelector('.session-card')")
        for expected in (48, 72):
            position = scroll_to_more(page)
            expect(page.locator(".session-card")).to_have_count(expected)
            assert page.evaluate("document.querySelector('.session-card') === window.__originalSessionCard")
            assert abs(page.evaluate("scrollY") - position) < 3, "Loading more must not jump the reading position"
        assert not page.locator(f'.session-card[data-session-id="{TARGET["id"]}"]').count()

        selected = page.evaluate("""id => {
            const result = window.igniteDemo.executeTool('highlight_session',{instance_id:id},'test fixture');
            window.__discussedSessionCard = document.querySelector('.session-card[data-highlighted="true"]');
            return {ok:result.ok,count:document.querySelectorAll('.session-card').length};
        }""", TARGET["id"])
        assert selected == {"ok": True, "count": 73}, selected
        discussed = page.locator('.session-card[data-highlighted="true"]')
        expect(discussed).to_have_attribute("data-session-id", TARGET["id"])
        expect(discussed).to_have_css("border-top-width", "3px")
        assert discussed.bounding_box()["y"] < 1080, "The selected meeting must be brought into view"
        assert page.evaluate("document.querySelectorAll('.session-card').length < 100"), "Do not render the entire catalog to find one item"

        discussed.locator(".add-session").click()
        expect(page.locator(".calendar-event")).to_have_count(1)
        assert page.evaluate("document.querySelector('.session-card[data-highlighted=\"true\"]') === window.__discussedSessionCard")
        scroll_to_more(page)
        expect(page.locator(".session-card")).to_have_count(97)
        assert page.evaluate("document.querySelector('.session-card[data-highlighted=\"true\"]') === window.__discussedSessionCard")
        expect(page.locator(".calendar-event")).to_have_count(1)
        assert page.evaluate("""() => {
            const ids=Array.from(document.querySelectorAll('.session-card'),card=>card.dataset.sessionId);
            return new Set(ids).size === ids.length;
        }""")

        page.locator("#catalog-search").fill("BRK244")
        expect(page.locator(".session-card")).to_have_count(1)
        expect(page.locator("#scroll-status")).to_have_text("All matching sessions loaded.")
        expect(page.locator("#load-more")).to_be_hidden()
        page.locator(".session-card .add-session").click()
        expect(page.locator(".calendar-event")).to_have_count(0)
        assert page.evaluate("document.activeElement === document.querySelector('.session-card .add-session')"), "Keep keyboard focus on the existing action"
        page.locator(".session-card .add-session").click()
        expect(page.locator(".calendar-event")).to_have_count(1)
        scroll_to_more(page)
        page.wait_for_timeout(150)
        expect(page.locator(".session-card")).to_have_count(1)
        page.locator("#catalog-search").fill("no-such-session-xyz-912345")
        expect(page.locator(".session-card")).to_have_count(0)
        expect(page.locator("#result-count")).to_contain_text("No matching sessions")
        page.locator("#catalog-search").fill("")
        expect(page.locator(".session-card")).to_have_count(24)
        page.locator('[data-day="18"]').click()
        expect(page.locator(".session-card")).to_have_count(24)
        expected_day = sum((session.get("local_start") or "").startswith("2026-11-18") for session in CATALOG["sessions"])
        expect(page.locator("#result-count")).to_contain_text(f"{expected_day:,}")
        page.locator('[data-day="all"]').click()
        page.locator("#load-more").click()
        expect(page.locator(".session-card")).to_have_count(48)
        expect(page.locator(".calendar-event")).to_have_count(1)

        page.set_viewport_size({"width": 682, "height": 850})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not errors, errors
        browser.close()
        print("PASS: scroll 24→48→72 without replacing cards or jumping; unloaded Agent target appears immediately.")
        print("PASS: discussion remains pinned, no duplicates, calendar preserved, filters/end/empty states, full-width and mobile.")


if __name__ == "__main__":
    main()
