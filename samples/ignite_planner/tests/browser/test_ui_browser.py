"""Preview-mode checks for the redesigned page and its Agent-driven animations (no Azure).

Agent behaviour is replayed with window.igniteDemo.simulateAgentCall, which sends a function call
through the same path as a real Agent call. Run with the test venv's Python (see README) while server.mjs runs.
"""

import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / "data" / "catalog.json").read_text())
ID = {session["code"]: session["id"] for session in CATALOG["sessions"]}
PREVIEW = {"voice_available": False, "voice": "en-US-AvaNeural", "busy": False, "local_only": True}


def open_page(browser, url, width=1600, height=1000, motion=True):
    page = browser.new_page(viewport={"width": width, "height": height}, reduced_motion="no-preference" if motion else "reduce")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
    page.route("**/api/config", lambda route: route.fulfill(json=PREVIEW))
    page.goto(url)
    page.wait_for_load_state("networkidle")
    return page, errors


def agent(page, name, args):
    return page.evaluate("([name, args]) => window.igniteDemo.simulateAgentCall(name, args)", [name, args])


def lit_pixels(page, canvas_id):
    return page.evaluate("""id => {
        const canvas = document.getElementById(id);
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        for (let index = 3; index < data.length; index += 4) if (data[index] > 40) lit++;
        return lit;
    }""", canvas_id)


def layout_and_art(browser, url, artifacts):
    page, errors = open_page(browser, url, 1440, 1000)
    expect(page.locator(".session-card")).to_have_count(24)
    cards = page.locator(".session-card")
    assert cards.nth(0).bounding_box()["y"] == cards.nth(1).bounding_box()["y"], "Two cards per desktop row"
    assert page.locator("main").bounding_box()["width"] >= 1400
    left, right = page.locator("#sessions").bounding_box(), page.locator("#agenda-view").bounding_box()
    assert right["x"] > left["x"] + left["width"], "Calendar stays on the right"
    page.wait_for_timeout(2600)
    assert lit_pixels(page, "hero-art") > 2000, "Hero Microsoft logo is drawn"
    assert lit_pixels(page, "launcher-orb") > 100, "Launcher orb is drawn"
    assert page.locator("#guide-launcher").bounding_box()["y"] < 64, "The launcher sits in the header"
    assert page.evaluate("window.igniteDemo.tools.length") == 10 and page.evaluate("window.igniteDemo.knowledgeTools.length") == 4
    expect(page.locator("#how-board")).to_be_hidden()
    page.screenshot(path=str(artifacts / "ui-home.png"))
    page.locator("#guide-launcher").click()
    expect(page.locator("#assistant-panel")).to_be_visible()
    assert page.evaluate("document.body.classList.contains('guide-open')")
    page.wait_for_timeout(700)
    # The island floats at the top and leaves the page where it was: full width, calendar unmoved.
    island = page.locator("#assistant-panel .island").bounding_box()
    assert island["y"] < 100 and island["width"] >= 1000, island
    assert page.locator("#agenda-view").bounding_box()["x"] == right["x"], "Opening the guide does not push the page"
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--guide-space')") != ""
    lit = lit_pixels(page, "agent-orb")
    assert lit > 600, f"Agent orb is drawn ({lit} lit pixels)"
    expect(page.locator("#agent-state")).to_have_text("OFFLINE")
    # Spoken words go to the large caption; there is no visible chat log, and typing is one click away.
    assert page.locator("#transcript").bounding_box()["width"] <= 1, "The conversation is for screen readers only"
    expect(page.locator("#live-caption")).to_be_visible()
    expect(page.locator("#message-form")).to_be_hidden()
    page.locator("#type-toggle").click()
    expect(page.locator("#message-form")).to_be_visible()
    expect(page.locator("#type-toggle")).to_have_attribute("aria-expanded", "true")
    # The stats strip opens the drawer with all 13 functions as the Agent sees them.
    expect(page.locator("#stat-sessions")).to_have_text("1,469")
    expect(page.locator("#function-count")).to_have_text("14")
    page.locator("#more-toggle").click()
    expect(page.locator("#island-more")).to_be_visible()
    expect(page.locator(".function-row")).to_have_count(14)
    expect(page.locator(".function-group").nth(0).locator(".function-row")).to_have_count(4)
    rank = page.locator('.function-row[data-tool="ignite_rank_sessions"]')
    rank.locator("summary").click()
    expect(rank.locator(".function-params span").first).to_have_text("interests")
    expect(rank.locator(".function-params span[data-optional='true']").first).to_have_text("related_terms?")
    page.screenshot(path=str(artifacts / "ui-drawer.png"))
    page.keyboard.press("Escape")
    expect(page.locator("#island-more")).to_be_hidden()
    expect(page.locator("#assistant-panel")).to_be_visible()
    page.locator("#test-speaker").click()
    expect(page.locator("#audio-status")).to_contain_text("Local test tone played")
    page.evaluate("window.igniteDemo.executeTool('eval', {code:'alert(1)'})")
    expect(page.locator("#error")).to_contain_text("Unsupported page action")
    page.locator("#close-guide").click()
    assert not page.evaluate("document.body.classList.contains('guide-open')")
    assert not errors, errors
    page.close()


def ranking_flow(browser, url, artifacts):
    page, errors = open_page(browser, url)
    page.locator("#guide-launcher").click()
    interests = ["voice agents", "contact center"]
    ranked = agent(page, "ignite_rank_sessions", {"interests": interests, "limit": 10})
    ids = [row["id"] for row in ranked["sessions"]]
    box = page.locator("#agent-query")
    expect(box).to_be_visible()
    expect(box.locator(".agent-query-badge")).to_have_text("AGENT RANKING")
    expect(box).to_have_attribute("data-done", "true", timeout=3000)
    expect(page.locator("#agent-query-text")).to_have_text("voice agents + contact center")
    expect(page.locator("#agent-query-result")).to_contain_text("RANKED")
    shown = agent(page, "show_ranked_sessions", {"instance_ids": ids, "interests": interests})
    assert shown["ok"] and shown["mode"] == "ranked", shown
    assert page.locator(".fx-layer path.fx-beam").count() >= 1, "A beam runs from the orb to the shortlist"
    expect(page.locator(".session-card")).to_have_count(len(ids))
    assert page.locator(".session-card").evaluate_all("cards => cards.map(card => card.dataset.sessionId)") == ids
    expect(page.locator("#ranking-banner")).to_be_visible()
    expect(page.locator("#ranking-interests b")).to_have_count(2)
    expect(page.locator(".session-card").first.locator(".rank-badge")).to_contain_text("#1")
    expect(page.locator('.session-card[data-top-pick="true"]')).to_have_count(min(3, len(ids)))
    first_chips = page.locator(".session-card").first.locator(".interest-chips span").all_inner_texts()
    assert first_chips and set(first_chips) <= set(interests), first_chips
    expect(page.locator("#section-title")).to_have_text("Ranked for your interests.")
    expect(page.locator("#result-count")).to_contain_text(f"Top {len(ids)}")
    page.wait_for_timeout(900)
    agent(page, "highlight_session", {"instance_id": ids[0]})
    selected = page.locator('.session-card[data-highlighted="true"]')
    expect(selected).to_have_attribute("data-session-id", ids[0])
    expect(selected).to_have_css("border-top-width", "3px")
    expect(selected).to_have_css("animation-name", "border-flow")
    assert "conic-gradient" in selected.evaluate("element => getComputedStyle(element).backgroundImage")
    expect(selected.locator(".lock-reticle")).to_have_count(1)
    assert page.locator("#ranking-banner").is_visible(), "Highlighting inside the shortlist keeps it"
    page.screenshot(path=str(artifacts / "ui-ranked.png"))
    rows = page.locator("#tool-log li").evaluate_all("rows => rows.map(row => [row.dataset.source, row.dataset.tool])")
    assert rows[:3] == [["agent", "highlight_session"], ["agent", "show_ranked_sessions"], ["knowledge", "ignite_rank_sessions"]], rows
    expect(page.locator("#tool-log li").nth(1)).to_contain_text("Re-ranked the list")
    expect(page.locator("#last-action")).to_contain_text("Focused")
    calls = page.evaluate("window.igniteDemo.getFunctionCalls()")
    assert calls == {"ignite_rank_sessions": 1, "show_ranked_sessions": 1, "highlight_session": 1}, calls
    expect(page.locator('.function-row[data-tool="show_ranked_sessions"] .function-calls')).to_have_text("×1")
    page.locator("#clear-ranking").click()
    expect(page.locator("#ranking-banner")).to_be_hidden()
    expect(page.locator(".session-card")).to_have_count(24)
    agent(page, "show_ranked_sessions", {"instance_ids": ids[:3], "interests": interests})
    expect(page.locator(".session-card")).to_have_count(3)
    page.locator("#catalog-search").fill("BRK244")
    expect(page.locator("#ranking-banner")).to_be_hidden()
    expect(page.locator(".session-card")).to_have_count(1)
    page.locator("#catalog-search").fill("")
    agent(page, "show_ranked_sessions", {"instance_ids": ids[:3], "interests": interests})
    agent(page, "highlight_session", {"instance_id": ID["BRK101"]})
    expect(page.locator("#ranking-banner")).to_be_hidden()
    # Almost nothing is about movies: the Agent still gets five sessions, and the cards say they are looser.
    loose = agent(page, "ignite_rank_sessions", {"interests": ["movie"], "related_terms": ["video", "media", "streaming"]})
    assert len(loose["sessions"]) == 5 and loose["looser_matches_added"] == 5, loose
    agent(page, "show_ranked_sessions", {"instance_ids": [row["id"] for row in loose["sessions"]], "interests": ["movie"]})
    expect(page.locator(".session-card .interest-chips span.looser")).to_have_count(5)
    expect(page.locator("#ranking-eyebrow")).to_have_text("NO DIRECT MATCHES · CLOSEST SESSIONS")
    expect(page.locator("#tool-log li").nth(1)).to_contain_text("Ranked 0 matches + 5 looser")
    assert not errors, errors
    page.close()


def calendar_effects(browser, url, artifacts):
    page, errors = open_page(browser, url)
    page.locator("#guide-launcher").click()
    page.locator("#catalog-search").fill("BRK242")
    add = page.locator(f'.session-card[data-session-id="{ID["BRK242"]}"] .add-session')
    add.scroll_into_view_if_needed()
    timing = add.evaluate("""button => {
        button.click();
        const ghost = document.querySelector('.agenda-flight');
        const arrivals = Array.from(document.querySelectorAll('.calendar-event')).flatMap(e => e.getAnimations());
        return {flight: ghost?.getAnimations()[0]?.effect.getComputedTiming().duration,
                arrival: arrivals.at(-1)?.effect.getComputedTiming().duration};
    }""")
    assert timing == {"flight": 720, "arrival": 380}, timing
    expect(page.locator(".fx-ring")).to_have_count(1, timeout=1500)
    assert page.locator(".fx-particle").count() >= 6
    expect(page.locator("#tool-log li").first).to_have_attribute("data-source", "click")
    page.locator("#catalog-search").fill("")
    added = agent(page, "add_to_agenda", {"instance_ids": [ID["BRK241"], ID["BRK248"], ID["BRK246"]]})
    assert added["added_count"] == 3, added
    expect(page.locator(".calendar-event")).to_have_count(4)
    expect(page.locator('.calendar-event[data-overlap="true"]')).to_have_count(2)
    page.wait_for_timeout(200)
    assert page.locator(".fx-layer path.fx-beam").count() >= 1, "Agent additions beam into the calendar"
    review = agent(page, "ignite_validate_agenda", {"instance_ids": page.evaluate("window.igniteDemo.getState().agenda")})
    assert review["conflict_count"] == 1, review
    expect(page.locator("#calendar-grid")).to_have_attribute("data-review", "true")
    agent(page, "overview_agenda", {})
    expect(page.locator("#calendar-grid")).to_have_attribute("data-scan", "true")
    page.wait_for_timeout(500)
    page.screenshot(path=str(artifacts / "ui-calendar.png"))
    removal = page.evaluate("""id => {
        window.igniteDemo.simulateAgentCall('remove_from_agenda', {instance_id: id});
        const event = document.querySelector(`.calendar-event[data-session-id="${id}"]`);
        return {exiting: event.dataset.exiting, duration: event.getAnimations().at(-1).effect.getComputedTiming().duration};
    }""", ID["BRK242"])
    assert removal == {"exiting": "true", "duration": 300}, removal
    expect(page.locator(".fx-fragment").first).to_be_attached(timeout=1500)
    expect(page.locator(".calendar-event")).to_have_count(3)
    expect(page.locator("#agent-state")).to_have_attribute("data-state", "acting")
    assert not errors, errors
    page.close()


def reduced_motion_and_mobile(browser, url, artifacts):
    page, errors = open_page(browser, url, 1440, 1000, motion=False)
    agent(page, "add_to_agenda", {"instance_ids": [ID["BRK241"]]})
    agent(page, "highlight_session", {"instance_id": ID["BRK244"]})
    assert page.locator(".fx-layer *").count() <= 1, "No effect nodes when reduced motion is preferred"
    expect(page.locator(".lock-reticle")).to_have_count(0)
    for width, height in [(682, 850), (390, 844)]:
        page.set_viewport_size({"width": width, "height": height})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
    page.set_viewport_size({"width": 682, "height": 850})
    left, right = page.locator("#sessions").bounding_box(), page.locator("#agenda-view").bounding_box()
    assert right["x"] > left["x"] + left["width"]
    page.set_viewport_size({"width": 390, "height": 844})
    launcher = page.locator("#guide-launcher").bounding_box()
    assert launcher["x"] + launcher["width"] <= 390 and launcher["y"] < 58, launcher
    page.locator("#guide-launcher").click()
    expect(page.locator("#assistant-panel")).to_be_visible()
    island = page.locator("#assistant-panel .island").bounding_box()
    assert island["x"] >= 0 and island["x"] + island["width"] <= 390 and island["y"] < 80, island
    page.screenshot(path=str(artifacts / "ui-mobile-panel.png"))
    assert not errors, errors
    page.close()


def drag(page, source, target, dx=0, dy=0):
    """Real pointer drag (HTML5 drag and drop) from one element to a point inside another."""
    start, end = source.bounding_box(), target.bounding_box()
    page.mouse.move(start["x"] + start["width"] / 2, start["y"] + min(start["height"] / 2, 60))
    page.mouse.down()
    page.mouse.move(end["x"] + end["width"] / 2 + dx, end["y"] + min(end["height"] / 2, 200) + dy, steps=12)
    page.wait_for_timeout(150)
    page.mouse.up()


def details_and_drag(browser, url, artifacts):
    page, errors = open_page(browser, url)
    page.evaluate("id => window.igniteDemo.executeTool('add_to_agenda', {instance_ids: [id]}, 'test fixture')", ID["BRK248"])
    page.locator("#catalog-search").fill("BRK241")
    page.locator(f'.session-card[data-session-id="{ID["BRK241"]}"] .session-summary').click()
    sheet = page.locator("#detail-layer")
    expect(sheet).to_be_visible()
    expect(page.locator("#detail-title")).to_contain_text("SThree")
    expect(page.locator("#detail-code")).to_have_text("BRK241")
    expect(page.locator("#detail-note")).to_contain_text("Official description from the Ignite catalog")
    assert len(page.locator("#detail-summary").inner_text()) > 200, "The full official description is shown"
    expect(page.locator("#detail-time")).to_contain_text("Wednesday, Nov 18")
    expect(page.locator('#detail-plan .plan-item[data-kind="overlap"]')).to_contain_text("BRK248")
    expect(page.locator("#detail-speakers .speaker-card")).to_have_count(5)
    expect(page.locator("#detail-speakers")).to_contain_text("Director of AI · SThree")
    assert page.locator("#detail-related button").count() >= 1
    expect(page.locator("#tool-log li").first).to_have_attribute("data-tool", "open_session_details")
    expect(page.locator("#tool-log li").first).to_have_attribute("data-source", "click")
    page.screenshot(path=str(artifacts / "ui-detail.png"))
    page.locator("#detail-add").click()
    expect(page.locator(".calendar-event")).to_have_count(2)
    expect(page.locator("#detail-plan .plan-status")).to_have_text("✓ In your agenda")
    expect(page.locator("#detail-add")).to_have_text("Remove from agenda")
    first_related = page.locator("#detail-related button").first.inner_text().split("\n")[-1]
    page.locator("#detail-related button").first.click()
    expect(page.locator("#detail-title")).to_have_text(first_related)
    page.keyboard.press("Escape")
    expect(sheet).to_be_hidden()
    page.locator(f'.calendar-event[data-session-id="{ID["BRK248"]}"]').click()
    expect(sheet).to_be_visible()
    expect(page.locator("#detail-code")).to_have_text("BRK248")
    page.mouse.click(20, 500)
    expect(sheet).to_be_hidden()
    page.locator("#guide-launcher").click()
    page.wait_for_timeout(600)
    agent(page, "open_session_details", {"instance_id": ID["BRK244"]})
    expect(sheet).to_be_visible()
    expect(page.locator("#detail-speakers")).to_contain_text("Principal Product Manager · Microsoft")
    detail, island = page.locator("#detail-sheet").bounding_box(), page.locator("#assistant-panel .island").bounding_box()
    assert detail["y"] >= island["y"] + island["height"] - 1, "The detail sheet opens below the voice island"
    agent(page, "highlight_session", {"instance_id": ID["BRK243"]})
    expect(sheet).to_be_hidden()
    page.locator("#close-guide").click()
    page.locator("#catalog-search").fill("BRK101")
    page.evaluate("scrollTo(0, document.getElementById('program').offsetTop)")
    page.wait_for_timeout(300)
    card = page.locator(".session-card").first
    added_id = card.get_attribute("data-session-id")
    drag(page, card, page.locator("#calendar-grid"))
    expect(page.locator(f'.calendar-event[data-session-id="{added_id}"]')).to_have_count(1)
    expect(page.locator("#tool-log li").first).to_have_attribute("data-source", "drag")
    expect(page.locator(".calendar-preview")).to_have_count(0)
    assert not page.evaluate("document.body.dataset.dragging"), "Drag state is cleared after the drop"
    page.wait_for_timeout(400)
    drag(page, page.locator(f'.calendar-event[data-session-id="{added_id}"]'), page.locator("#sessions"), dy=-100)
    expect(page.locator(f'.calendar-event[data-session-id="{added_id}"]')).to_have_count(0)
    expect(page.locator("#tool-log li").first).to_have_attribute("data-tool", "remove_from_agenda")
    assert not errors, errors
    page.close()


def speakers(browser, url, artifacts):
    page, errors = open_page(browser, url)
    page.locator("#guide-launcher").click()
    page.wait_for_timeout(600)
    choice, banner = page.locator("#speaker-choice"), page.locator("#ranking-banner")
    # A misheard name is never acted on: the page asks, the feed stays as it was.
    result = agent(page, "find_speaker", {"name": "e when wrong"})
    assert result["status"] == "no_match" and result["did_you_mean"][0]["name"] == "Yiwen Rong", result
    expect(choice).to_be_visible()
    expect(page.locator("#speaker-choice-heard")).to_have_text("Heard “e when wrong”")
    expect(page.locator("#speaker-choice-eyebrow")).to_contain_text("DID YOU MEAN")
    expect(page.locator(".speaker-option").first).to_contain_text("Principal Product Manager · Microsoft")
    expect(banner).to_be_hidden()
    expect(page.locator(".session-card")).to_have_count(24)
    page.wait_for_timeout(500)
    page.screenshot(path=str(artifacts / "ui-speaker-choice.png"))
    page.locator(".speaker-option").first.click()
    expect(choice).to_be_hidden()
    expect(banner).to_have_attribute("data-mode", "speaker")
    expect(page.locator("#ranking-interests")).to_contain_text("Yiwen Rong")
    count = page.evaluate("window.igniteDemo.getState().ranking.instance_ids.length")
    assert count >= 1
    expect(page.locator(".session-card")).to_have_count(count)
    expect(page.locator("#tool-log li").first).to_have_attribute("data-source", "click")
    # A bare shared surname asks which person; dismissing leaves the feed alone.
    result = agent(page, "find_speaker", {"name": "shah"})
    assert result["status"] == "multiple_matches" and len(result["matches"]) >= 2, result
    expect(page.locator("#speaker-choice-eyebrow")).to_contain_text("SEVERAL SPEAKERS FIT")
    page.locator("#speaker-choice-dismiss").click()
    expect(choice).to_be_hidden()
    # A confident match lists that person's sessions with how the name was heard.
    result = agent(page, "find_speaker", {"name": "satya nadela"})
    assert result["status"] == "one_match" and result["speaker"]["name"] == "Satya Nadella", result
    expect(page.locator("#ranking-interests")).to_contain_text("heard “satya nadela”")
    expect(page.locator(".session-card")).to_have_count(len(result["sessions"]))
    page.wait_for_timeout(500)
    page.screenshot(path=str(artifacts / "ui-speaker-sessions.png"))
    # A speaker card in the detail sheet lists that person's sessions.
    page.locator("#close-guide").click()
    page.locator("#clear-ranking").click()
    page.locator("#catalog-search").fill("BRK244")
    page.locator(".session-card .session-summary").first.click()
    page.locator("#detail-speakers button.speaker-card").first.click()
    expect(page.locator("#detail-layer")).to_be_hidden()
    expect(banner).to_have_attribute("data-mode", "speaker")
    expect(page.locator("#ranking-interests")).to_contain_text("Yiwen Rong")
    assert not errors, errors
    page.close()


def free_time_and_compare(browser, url, artifacts):
    page, errors = open_page(browser, url)
    page.evaluate("ids => window.igniteDemo.executeTool('add_to_agenda', {instance_ids: ids}, 'test fixture')", [ID["BRK241"], ID["BRK246"]])
    page.locator('.day-free[data-free-date="2026-11-18"]').click()
    gaps = page.locator(".calendar-gap")
    expect(gaps).to_have_count(3)
    expect(gaps.first).to_contain_text("09:00–10:15")
    expect(page.locator("#ranking-banner")).to_have_attribute("data-mode", "free-time")
    expect(page.locator("#ranking-eyebrow")).to_contain_text("WED 18")
    expect(page.locator('.day-free[data-free-date="2026-11-18"]')).to_have_attribute("data-active", "true")
    state = page.evaluate("window.igniteDemo.getState()")
    expect(page.locator(".session-card")).to_have_count(len(state["ranking"]["instance_ids"]))
    page.wait_for_timeout(700)
    page.screenshot(path=str(artifacts / "ui-free-time.png"))
    page.locator("#clear-ranking").click()
    expect(gaps).to_have_count(0)
    # Card toggles collect sessions in the tray; Compare opens them side by side.
    toggles = page.locator(".session-card .compare-toggle")
    toggles.nth(0).click()
    expect(page.locator("#compare-tray")).to_be_visible()
    expect(page.locator("#compare-go")).to_be_disabled()
    toggles.nth(1).click()
    expect(page.locator("#compare-tray-text")).to_contain_text(" vs ")
    page.locator("#compare-go").click()
    layer = page.locator("#compare-layer")
    expect(layer).to_be_visible()
    expect(page.locator("#compare-grid .compare-head .compare-code")).to_have_count(2)
    expect(page.locator("#tool-log li").first).to_have_attribute("data-tool", "compare_sessions")
    page.keyboard.press("Escape")
    expect(layer).to_be_hidden()
    # The overlap warning in a detail sheet compares the two clashing sessions.
    page.evaluate("id => window.igniteDemo.executeTool('add_to_agenda', {instance_ids: [id]}, 'test fixture')", ID["BRK248"])
    page.locator(f'.calendar-event[data-session-id="{ID["BRK241"]}"]').click()
    page.locator("#detail-plan .plan-compare").first.click()
    expect(page.locator("#detail-layer")).to_be_hidden()
    expect(layer).to_be_visible()
    expect(page.locator("#compare-note")).to_contain_text("same time")
    # The Agent compares too; differing rows are marked; Escape closes the comparison before the panel.
    page.keyboard.press("Escape")
    page.locator("#guide-launcher").click()
    page.wait_for_timeout(600)
    result = agent(page, "compare_sessions", {"instance_ids": [ID["BRK244"], ID["BRK101"]]})
    assert result["ok"] and "time" in result["differences"], result
    expect(layer).to_be_visible()
    differs = page.locator('.compare-row[data-differs="true"] .compare-label').all_inner_texts()
    assert [label.upper() for label in differs] == ["WHEN", "WHERE", "FORMAT", "TOPICS"], differs
    page.wait_for_timeout(900)
    page.screenshot(path=str(artifacts / "ui-compare.png"))
    page.keyboard.press("Escape")
    expect(layer).to_be_hidden()
    expect(page.locator("#assistant-panel")).to_be_visible()
    assert not errors, errors
    page.close()


def explainer(browser, url, artifacts):
    """The "how it works" board: hidden until asked, steps lit by the Agent, functions runnable by click."""
    page, errors = open_page(browser, url)
    page.locator("#guide-launcher").click()
    board = page.locator("#how-board")
    expect(board).to_be_hidden()
    walk = agent(page, "show_how_it_works", {})
    assert walk["walkthrough"] and [row["step"] for row in walk["steps"]] == ["connect", "register", "call", "execute", "together"], walk
    assert walk["steps"][0]["transport"].startswith("One WebSocket") and "exactly five short sentences" in walk["next_step"], walk
    expect(board).to_be_visible()
    expect(board).to_have_attribute("data-step", "connect")
    result = agent(page, "show_how_it_works", {"step": "connect"})
    assert result["transport"].startswith("One WebSocket") and "one or two short sentences" in result["next_step"], result
    expect(board.locator(".how-caption")).to_contain_text("WebSocket")
    expect(board.locator(".how-chip")).to_have_count(14)
    registered = agent(page, "show_how_it_works", {"step": "register"})
    assert len(registered["page_functions"]) == 10 and len(registered["knowledge_functions"]) == 4, registered
    last = agent(page, "show_how_it_works", {"step": "together"})
    assert last["next"] is None and "page events" in last["how"], last
    expect(board.locator('.how-dots button[aria-pressed="true"]')).to_have_text("5 Together")
    expect(board.locator(".how-trace li").first).to_contain_text('show_how_it_works({"step":"together"})')
    # Clicking a function on the board runs it the way the Agent would, and the trace shows who ran it.
    board.locator('.how-chip[data-tool="highlight_session"]').click()
    expect(page.locator('.session-card[data-highlighted="true"]')).to_have_attribute("data-session-id", ID["BRK244"])
    expect(board.locator(".how-trace li").first).to_have_attribute("data-source", "demo")
    page.wait_for_timeout(700)
    page.screenshot(path=str(artifacts / "ui-how-board.png"))
    # The drawer's run button closes the drawer first, then runs the function with example arguments.
    page.locator("#more-toggle").click()
    page.locator('.function-row[data-tool="find_speaker"] .function-run').click()
    expect(page.locator("#island-more")).to_be_hidden()
    expect(page.locator("#ranking-interests")).to_contain_text("Dingding Lu")
    expect(page.locator('.function-row[data-tool="find_speaker"] .function-demo code').first).to_contain_text('find_speaker({"name":"ding ding lou"})')
    expect(page.locator("#tool-log li").first).to_contain_text("DEMO")
    # A detail sheet would cover the board, so opening the board closes it.
    agent(page, "open_session_details", {"instance_id": ID["BRK241"]})
    expect(page.locator("#detail-layer")).to_be_visible()
    agent(page, "show_how_it_works", {"step": "call"})
    expect(page.locator("#detail-layer")).to_be_hidden()
    expect(board).to_have_attribute("data-step", "call")
    # Escape closes the board before it would end the conversation; the Agent can close it too.
    page.keyboard.press("Escape")
    expect(board).to_be_hidden()
    expect(page.locator("#assistant-panel")).to_be_visible()
    page.locator("#more-toggle").click()
    page.locator("#open-how").click()
    expect(board).to_be_visible()
    agent(page, "show_how_it_works", {"step": "close"})
    expect(board).to_be_hidden()
    assert not errors, errors
    page.close()


def export_agenda(browser, url, artifacts):
    """Export my agenda: an .ics download for Outlook/Google, with the flight-and-pack animation."""
    page, errors = open_page(browser, url)
    button = page.locator("#export-agenda")
    expect(button).to_contain_text("Export my agenda")
    button.click()
    expect(page.locator("#toast")).to_contain_text("Your agenda is empty")
    page.evaluate("ids => window.igniteDemo.executeTool('add_to_agenda', {instance_ids: ids}, 'test fixture')", [ID["BRK244"], ID["BRK241"]])
    expect(page.locator("#agenda-count")).to_have_text("2")
    with page.expect_download() as info:
        button.click()
    download = info.value
    assert download.suggested_filename == "ignite-2026-my-agenda.ics", download.suggested_filename
    text = Path(download.path()).read_bytes().decode("utf-8")  # read_text would turn CRLF into LF
    unfolded = text.replace("\r\n ", "")
    assert text.startswith("BEGIN:VCALENDAR\r\n") and unfolded.count("BEGIN:VEVENT") == 2, text[:200]
    assert "DTSTART:20261120T011500Z" in unfolded and "SUMMARY:BRK244 · Voice agents in Microsoft Foundry" in unfolded
    assert "Yiwen Rong\\, Principal Product Manager\\, Microsoft" in unfolded, "Speaker roles come from the directory"
    expect(page.locator(".fx-export-ghost").first).to_be_attached(timeout=1500)
    expect(page.locator(".fx-export-file")).to_be_attached(timeout=3000)
    page.wait_for_timeout(500)
    page.screenshot(path=str(artifacts / "ui-export.png"))
    expect(page.locator("#toast")).to_contain_text("Exported 2 sessions to ignite-2026-my-agenda.ics")
    expect(page.locator("#tool-log li").first).to_contain_text("Exported 2 sessions")
    expect(page.locator(".fx-export-file")).to_have_count(0, timeout=6000)
    assert not errors, errors
    page.close()


def themes(browser, url, artifacts):
    page, errors = open_page(browser, url)
    color = lambda name: page.evaluate("name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()", name)
    assert page.evaluate("document.documentElement.dataset.theme") == "aurora", "Aurora is the default theme"
    page.locator("#theme-toggle").click()
    expect(page.locator("#theme-menu")).to_be_visible()
    expect(page.locator("[data-theme-option]")).to_have_count(4)
    expect(page.locator("[data-calendar-option]")).to_have_count(4)
    page.locator('[data-theme-option="ember"]').click()
    assert page.evaluate("document.documentElement.dataset.theme") == "ember"
    assert color("--c1") == "#ffb347", color("--c1")
    page.locator('[data-calendar-option="mint"]').click()
    assert color("--cal-a") == "#3ff2c8" and color("--c1") == "#ffb347", "Calendar palette is independent of the page theme"
    expect(page.locator('[data-theme-option="ember"]')).to_have_attribute("aria-pressed", "true")
    page.wait_for_timeout(300)
    page.screenshot(path=str(artifacts / "ui-theme-menu.png"))
    page.reload()
    page.wait_for_load_state("networkidle")
    assert page.evaluate("[document.documentElement.dataset.theme, document.documentElement.dataset.calendar]") == ["ember", "mint"]
    page.goto(f"{url}/?theme=neon&calendar=sunrise")
    page.wait_for_load_state("networkidle")
    assert color("--c1") == "#46e0d4" and color("--cal-a") == "#ffb347", "URL parameters select the original Neon look"
    page.wait_for_timeout(400)
    assert lit_pixels(page, "hero-art") > 2000
    assert not errors, errors
    page.close()


def spectrum(browser, url):
    page, errors = open_page(browser, url)
    page.evaluate("""() => {
        const start = document.createElement('button');
        start.id = 'spectrum-start'; start.textContent = 'spectrum'; start.style.position = 'fixed'; start.style.top = '0'; start.style.zIndex = '999';
        start.onclick = async () => {
            const {VoiceAudio} = await import('/audio.mjs');
            const player = new VoiceAudio(() => {}, () => {}, error => { window.__spectrumError = error.message; });
            await player.resumed;
            const tone = (hz, seconds, id) => {
                const bytes = new Uint8Array(24000 * seconds * 2), view = new DataView(bytes.buffer);
                for (let index = 0; index < bytes.length / 2; index++) view.setInt16(index * 2, Math.round(9000 * Math.sin(2 * Math.PI * hz * index / 24000)), true);
                let text = '';
                for (let offset = 0; offset < bytes.length; offset += 4800) text = String.fromCharCode(...bytes.subarray(offset, offset + 4800)), player.play(btoa(text), {item_id: id, response_id: id, content_index: 0});
            };
            // Read every ~16 ms like the orb does: the analyser smooths across successive readings.
            const reading = setInterval(() => player.spectrum('output'), 16);
            const sample = () => { const result = player.spectrum('output'); return {low: result.low, high: result.high, centroid: result.centroid}; };
            const drained = async () => { while (player.snapshot().bufferedSeconds > 0) await new Promise(resolve => setTimeout(resolve, 50)); };
            tone(150, 1, 'bass');
            await new Promise(resolve => setTimeout(resolve, 600));
            window.__bass = sample();
            await drained();
            await new Promise(resolve => setTimeout(resolve, 300));
            tone(4000, 1, 'treble');
            await new Promise(resolve => setTimeout(resolve, 600));
            window.__treble = sample();
            clearInterval(reading);
            await player.dispose();
        };
        document.body.append(start);
    }""")
    page.locator("#spectrum-start").click()
    page.wait_for_function("() => window.__treble || window.__spectrumError", timeout=10000)
    bass, treble = page.evaluate("[window.__bass, window.__treble]")
    assert bass["low"] > .5 and bass["low"] > bass["high"] * 3, (bass, treble)
    assert treble["high"] > .25 and treble["high"] > treble["low"] * 3 and treble["centroid"] > bass["centroid"], (bass, treble)
    assert not errors, errors
    page.close()
    return bass, treble


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8768")
    args = parser.parse_args()
    artifacts = ROOT / "artifacts"
    artifacts.mkdir(exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        layout_and_art(browser, args.url, artifacts)
        print("PASS layout: two cards per row, calendar right, hero logo and orbs drawn; the voice island floats at the top without "
              "moving the page, shows a caption instead of a chat log, and its stats open all 13 functions.")
        ranking_flow(browser, args.url, artifacts)
        print("PASS ranking: typed agent query, ranked shortlist in exact order with badges and interest chips, highlight kept, clearing restores the catalog.")
        calendar_effects(browser, args.url, artifacts)
        print("PASS calendar: flight 720 ms / arrival 380 ms / removal 300 ms kept; bursts, beams, review flash, scan and shatter effects.")
        details_and_drag(browser, args.url, artifacts)
        print("PASS details & drag: click opens the sheet (speakers' roles, overlap warning, related); add, related, Escape, "
              "calendar click, backdrop; Agent opens it below the voice island; drag a card into the calendar and a block back out.")
        speakers(browser, args.url, artifacts)
        print("PASS speakers: a misheard name asks (did you mean), a shared surname asks which person, a confident match lists "
              "their sessions with the heard name; detail speaker cards list a person's sessions.")
        free_time_and_compare(browser, args.url, artifacts)
        print("PASS free time & compare: day button marks 3 free windows and lists what fits; card toggles, overlap warning "
              "and the Agent open the side-by-side comparison; Escape closes it before the panel.")
        explainer(browser, args.url, artifacts)
        print("PASS explainer: board hidden until asked; the Agent lights the five steps with real facts; a click on the board or the "
              "drawer runs a function with example arguments and is traced; Escape and the Agent close it.")
        export_agenda(browser, args.url, artifacts)
        print("PASS export: empty agenda says so; two saved sessions download as ignite-2026-my-agenda.ics (2 events, UTC times, "
              "speaker roles) while the blocks fly into the button and a calendar file is packed and sent off.")
        themes(browser, args.url, artifacts)
        print("PASS themes: Aurora default, menu switches page theme and calendar palette independently, choice persists, ?theme=neon keeps the original.")
        bass, treble = spectrum(browser, args.url)
        print("PASS spectrum: 150 Hz tone lights the bass bands", {k: round(v, 2) for k, v in bass.items()},
              "and 4 kHz the treble bands", {k: round(v, 2) for k, v in treble.items()})
        reduced_motion_and_mobile(browser, args.url, artifacts)
        print("PASS reduced motion and mobile: no effect nodes, no horizontal overflow, header launcher and top island within 390 px.")
        browser.close()


if __name__ == "__main__":
    main()
