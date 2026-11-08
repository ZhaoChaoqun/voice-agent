"""Real Azure checks for the browser-direct page. Uses Azure voice quota.

agenda:   the page's only voice WebSocket goes to Azure, and a typed batch request runs
          add_to_agenda once, then the in-page agenda review, keeping all three meetings.
voice:    an English WAV through the Chromium microphone path highlights BRK244 and is answered.
barge-in: speaking over a long reply stops playback, truncates unheard audio in Azure and
          the new spoken request still runs.
ranking:  "voice agents + contact centers on Thursday" runs ignite_rank_sessions, then
          show_ranked_sessions with the same order, and the page shows exactly that shortlist.
page-event: a clicked card becomes system context, so "is this one good?" resolves to it.
details:  "tell me more about BRK244 — who is speaking?" makes the Agent open the detail sheet.
speaker:  "e when wrong" (how a recogniser hears "Yiwen Rong") reaches find_speaker unchanged; the
          Agent asks instead of guessing, and the confirmed name lists her sessions.
free-time: with two saved Wednesday sessions, "what can I do with my free time on Wednesday?" marks
          the free windows and lists sessions that fit.
compare:  "BRK241 or BRK248?" finds both IDs, opens the side-by-side comparison and recommends one.
loose:    "computer vision and movies" has almost no direct matches, yet the page shows at least five
          sessions, the looser ones labeled, and the Agent says they are looser.
speaker-zh: "ding ding lou" (how a recogniser may hear "Dingding Lu") reaches find_speaker and lists her sessions.
explain:  "How do you control this web page?" opens the how-it-works board, walks the five steps in order and
          then proves it with real function calls that appear in the board's live trace.

Run with the test venv's Python (see README) while `node server.mjs --env-file ...` is running.
"""

import argparse
import base64
import json
import sys
import wave
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "artifacts"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from audio_fixture import AudioTrace, VOICE_SESSION_ID, connect, feed_microphone, install_microphone_fixture  # noqa: E402

CATALOG = json.loads((ROOT / "data" / "catalog.json").read_text())
IDS = {session["code"]: session["id"] for session in CATALOG["sessions"] if session["code"] in {"BRK241", "BRK248", "BRK246"}}
CATALOG_IDS = {session["code"]: session["id"] for session in CATALOG["sessions"]}
CODE_BY_ID = {session["id"]: session["code"] for session in CATALOG["sessions"]}
FIXTURES = [ARTIFACTS / "voice-command.wav"]
COMMAND = ("'Please highlight BRK244, Voice agents in Microsoft Foundry: Prototype to production "
           "in forty five minutes.'")


def type_to_agent(page, text):
    """Typing sits behind the island's keyboard button; open it once, then send."""
    if page.locator("#message-form").is_hidden():
        page.locator("#type-toggle").click()
    page.locator("#message").fill(text)
    page.locator("#send").click()


def watch_sockets(page):
    """Record every page WebSocket URL and the truncations the page sends to Azure."""
    seen = {"urls": [], "truncations": []}

    def sent(frame):
        if isinstance(frame, str) and "conversation.item.truncate" in frame:
            seen["truncations"].append(json.loads(frame))

    def attach(socket):
        seen["urls"].append(socket.url)
        socket.on("framesent", sent)

    page.on("websocket", attach)
    return seen


def assert_direct(seen):
    assert seen["urls"], "The page opened no WebSocket"
    for url in seen["urls"]:
        assert url.startswith("wss://") and ".services.ai.azure.com/" in url, url
        assert "127.0.0.1" not in url and "localhost" not in url, url


def wait_quiet(page, timeout=90000):
    page.wait_for_function(
        "() => !window.igniteDemo.getVoiceState().responding && !window.igniteDemo.getVoiceState().speaking || "
        "!document.getElementById('error').hidden", timeout=timeout,
    )
    expect(page.locator("#error")).to_be_hidden()


def agenda(playwright, url):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1100}, reduced_motion="reduce")
    seen = watch_sockets(page)
    page.add_init_script("""
        window.__agendaFlow = [];
        window.addEventListener('ignite:tool-result', event => {
            if (event.detail.source === 'agent') window.__agendaFlow.push({type:'page', name:event.detail.name,
                arguments:event.detail.args, agenda:window.igniteDemo.getState().agenda.slice()});
        });
        window.addEventListener('ignite:mcp-result', event => window.__agendaFlow.push({
            type:'knowledge', name:event.detail.name, summary:event.detail.summary}));
    """)
    connect(page, url, microphone=False)
    type_to_agent(page, "Please add BRK241, BRK248 and BRK246 to my calendar.")
    page.wait_for_function(
        "() => window.__agendaFlow.some(event => event.name === 'ignite_validate_agenda') || "
        "!document.getElementById('error').hidden", timeout=120000,
    )
    expect(page.locator("#error")).to_be_hidden()
    page.wait_for_function("() => document.querySelectorAll('#transcript p[data-role=\"Guide\"]').length >= 2", timeout=90000)
    wait_quiet(page)
    flow = page.evaluate("window.__agendaFlow")
    additions = [event for event in flow if event["name"] == "add_to_agenda"]
    reviews = [event for event in flow if event["name"] == "ignite_validate_agenda"]
    assert len(additions) == 1 and set(additions[0]["arguments"]["instance_ids"]) == set(IDS.values()), flow
    assert set(additions[0]["agenda"]) == set(IDS.values()), flow
    assert flow.index(additions[0]) < flow.index(reviews[0]), flow
    assert reviews[0]["summary"]["conflict_count"] == 1 and reviews[0]["summary"]["mutates_calendar"] is False, reviews
    assert not any(event["name"] == "remove_from_agenda" for event in flow), flow
    expect(page.locator(".calendar-event")).to_have_count(3)
    final_text = page.locator('#transcript p[data-role="Guide"]').last.inner_text()
    assert "overlap" in final_text.lower() or "conflict" in final_text.lower(), final_text
    page.locator("#close-guide").click()
    records = page.evaluate("window.igniteDemo.getConversationLog()")
    kinds = [record["type"] for record in records]
    assert kinds[-1] == "session.closed" and "user.text" in kinds, kinds
    add_result = next(record for record in records if record["type"] == "tool.result" and record["data"]["name"] == "add_to_agenda")
    review_call = next(record for record in records if record["type"] == "tool.call" and record["data"]["name"] == "ignite_validate_agenda")
    assert add_result["sequence"] < review_call["sequence"] and review_call["data"]["executor"] == "page_knowledge"
    assert "delta" not in json.dumps(records) and "authorization" not in json.dumps(records).lower()
    assert_direct(seen)
    ARTIFACTS.mkdir(exist_ok=True)
    page.screenshot(path=str(ARTIFACTS / "js-batch-agenda.png"), animations="disabled")
    (ARTIFACTS / "js-batch-agenda-log.jsonl").write_text("".join(json.dumps(record) + "\n" for record in records))
    browser.close()
    print("PASS agenda: direct Azure WebSocket", seen["urls"][0].split("?")[0])
    print("FLOW:", json.dumps([{key: event.get(key) for key in ("type", "name")} for event in flow]))
    print("GUIDE:", final_text)


def flow_recorder(page):
    page.add_init_script("""
        window.__flow = [];
        window.__spotlight = [];
        window.addEventListener('ignite:tool-result', event => {
            if (event.detail.source === 'agent') window.__flow.push({name: event.detail.name, arguments: event.detail.args,
                ok: event.detail.result.ok, status: event.detail.result.status, at: performance.now()});
        });
        // When each card visibly lights up, and how much Agent audio had been heard by then.
        new MutationObserver(records => {
            for (const record of records) {
                if (record.attributeName === 'data-highlighted' && record.target.dataset.highlighted === 'true')
                    window.__spotlight.push({id: record.target.dataset.sessionId, at: performance.now(),
                        heard: window.igniteDemo?.getAudioState().renderedSeconds || 0});
            }
        }).observe(document, {subtree: true, attributes: true, attributeFilter: ['data-highlighted']});
        window.addEventListener('ignite:mcp-result', event => window.__flow.push({name: event.detail.name,
            arguments: JSON.parse(event.detail.arguments)}));
    """)


def ranking(playwright, url):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    seen = watch_sockets(page)
    flow_recorder(page)
    connect(page, url, microphone=False)
    type_to_agent(page, "I build voice agents and I care about contact centers. What should I see on Thursday?")
    page.wait_for_function("() => window.__flow.some(event => event.name === 'show_ranked_sessions') || "
                           "!document.getElementById('error').hidden", timeout=120000)
    expect(page.locator("#error")).to_be_hidden()
    page.wait_for_function("() => document.querySelectorAll('#transcript p[data-role=\"Guide\"]').length >= 2", timeout=90000)
    wait_quiet(page)
    flow = page.evaluate("window.__flow")
    names = [event["name"] for event in flow]
    rank = next(event for event in flow if event["name"] == "ignite_rank_sessions")
    show = next(event for event in flow if event["name"] == "show_ranked_sessions")
    assert names.index("ignite_rank_sessions") < names.index("show_ranked_sessions"), names
    assert rank["arguments"].get("date") == "2026-11-19", rank
    assert any("voice" in interest.lower() for interest in rank["arguments"]["interests"]), rank
    ranked = page.evaluate("args => window.igniteDemo.executeKnowledge('ignite_rank_sessions', args)", rank["arguments"])
    expected = [row["id"] for row in ranked["sessions"]]
    assert show["arguments"]["instance_ids"] == expected[:len(show["arguments"]["instance_ids"])], (show, expected)
    shown = page.locator(".session-card").evaluate_all("cards => cards.map(card => card.dataset.sessionId)")
    assert shown == show["arguments"]["instance_ids"], (shown, show)
    expect(page.locator("#ranking-banner")).to_be_visible()
    calls = [event for event in flow if event["name"] == "highlight_session"]
    called = [event["arguments"]["instance_id"] for event in calls]
    assert called[:3] == shown[:3], ("The guide spotlights #1, #2, #3 in order", called, shown[:3])
    spots = page.evaluate("window.__spotlight")
    lit = [spot for spot in spots if spot["id"] in shown[:3]]
    order = []
    for spot in lit:
        if not order or order[-1]["id"] != spot["id"]:
            order.append(spot)
    assert [spot["id"] for spot in order][:3] == shown[:3], order
    for index in (1, 2):
        call_at = calls[index]["at"]
        assert order[index]["at"] - call_at > 400, ("Spotlight waited for the previous sentence to be heard", index, order[index]["at"] - call_at)
        assert order[index]["heard"] - order[index - 1]["heard"] > 1.5, ("Speech between spotlights", order)
    final_text = page.locator('#transcript p[data-role="Guide"]').last.inner_text()
    spoken_codes = [row["code"] for row in ranked["sessions"][:5] if row["title"].split(":")[0].split("|")[0].strip().lower()[:18] in final_text.lower()]
    page.screenshot(path=str(ARTIFACTS / "js-live-ranking.png"), animations="disabled")
    assert_direct(seen)
    page.locator("#close-guide").click()
    browser.close()
    print("PASS ranking: rank -> show_ranked_sessions with the same order -> page re-dealt", len(shown), "cards")
    print("FLOW:", json.dumps([[event["name"], event.get("arguments")] for event in flow])[:900])
    print("TOP OF PAGE:", [row["code"] for row in ranked["sessions"][:len(shown)]])
    print("SESSIONS NAMED IN THE REPLY (by title):", spoken_codes)
    print("SPOTLIGHT (call -> visible delay s, audio heard s):", [
        (CODE_BY_ID[spot["id"]], round((spot["at"] - calls[index]["at"]) / 1000, 2), round(spot["heard"], 1))
        for index, spot in enumerate(order[:3])])
    print("GUIDE:", final_text)


def page_event(playwright, url):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    flow_recorder(page)
    connect(page, url, microphone=False)
    target = CATALOG_IDS["BRK244"]
    page.locator("#catalog-search").fill("BRK244")
    page.locator(f'.session-card[data-session-id="{target}"] .session-title').click()
    page.wait_for_timeout(400)
    notes = [record for record in page.evaluate("window.igniteDemo.getConversationLog()") if record["type"] == "page.note"]
    assert notes and target in notes[-1]["data"]["text"], notes
    expect(page.locator("#error")).to_be_hidden()
    type_to_agent(page, "Is this one a good fit for a developer? Answer in one sentence.")
    page.wait_for_function("() => document.querySelectorAll('#transcript p[data-role=\"Guide\"]').length >= 2 || "
                           "!document.getElementById('error').hidden", timeout=90000)
    wait_quiet(page)
    expect(page.locator("#error")).to_be_hidden()
    flow = page.evaluate("window.__flow")
    final_text = page.locator('#transcript p[data-role="Guide"]').last.inner_text()
    referenced = any(target in json.dumps(event.get("arguments")) for event in flow) or "voice agents" in final_text.lower() or "brk244" in final_text.lower()
    assert referenced, (flow, final_text)
    page.locator("#close-guide").click()
    browser.close()
    print("PASS page event: the click became context; 'this one' resolved to BRK244 without an error.")
    print("FLOW:", json.dumps([[event["name"], event.get("arguments")] for event in flow]))
    print("GUIDE:", final_text)


def details(playwright, url):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    flow_recorder(page)
    connect(page, url, microphone=False)
    target = CATALOG_IDS["BRK244"]
    type_to_agent(page, "Tell me more about BRK244. Who is speaking and what do they do?")
    page.wait_for_function("() => window.__flow.some(event => event.name === 'open_session_details') || "
                           "!document.getElementById('error').hidden", timeout=120000)
    expect(page.locator("#error")).to_be_hidden()
    page.wait_for_function("() => document.querySelectorAll('#transcript p[data-role=\"Guide\"]').length >= 2", timeout=90000)
    wait_quiet(page)
    flow = page.evaluate("window.__flow")
    opened = [event for event in flow if event["name"] == "open_session_details"]
    assert opened and opened[0]["arguments"]["instance_id"] == target, flow
    expect(page.locator("#detail-layer")).to_be_visible()
    expect(page.locator("#detail-code")).to_have_text("BRK244")
    expect(page.locator("#detail-speakers")).to_contain_text("Principal Product Manager")
    final_text = page.locator('#transcript p[data-role="Guide"]').last.inner_text()
    page.screenshot(path=str(ARTIFACTS / "js-live-details.png"), animations="disabled")
    page.locator("#close-guide").click()
    browser.close()
    print("PASS details: the Agent opened BRK244's detail sheet before describing its speakers.")
    print("FLOW:", json.dumps([[event["name"], event.get("arguments")] for event in flow]))
    print("GUIDE:", final_text)


def ask(page, text, until, timeout=120000):
    """Type one request, wait for the function call it should cause and for the reply to finish."""
    replies = page.locator('#transcript p[data-role="Guide"]').count()
    type_to_agent(page, text)
    page.wait_for_function(f"() => window.__flow.some(event => {until}) || !document.getElementById('error').hidden", timeout=timeout)
    expect(page.locator("#error")).to_be_hidden()
    page.wait_for_function(f"() => document.querySelectorAll('#transcript p[data-role=\"Guide\"]').length > {replies}", timeout=90000)
    wait_quiet(page)
    return page.locator('#transcript p[data-role="Guide"]').last.inner_text()


def speaker(playwright, url):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    flow_recorder(page)
    connect(page, url, microphone=False)
    first = ask(page, "Which sessions is e when wrong speaking in?", "event.name === 'find_speaker'")
    flow = page.evaluate("window.__flow")
    finds = [event for event in flow if event["name"] == "find_speaker"]
    assert "when wrong" in finds[0]["arguments"]["name"].lower(), ("The heard name is passed on unchanged", finds)
    assert not any(event.get("status") == "one_match" for event in finds), ("Never resolved by guessing", finds)
    expect(page.locator("#speaker-choice")).to_be_visible()
    expect(page.locator("#ranking-banner")).to_be_hidden()
    assert "yiwen" in first.lower() and "?" in first, ("The Agent asks which person", first)
    page.screenshot(path=str(ARTIFACTS / "js-live-speaker-ask.png"), animations="disabled")
    second = ask(page, "Yes, Yiwen Rong.", "event.name === 'find_speaker' && event.status === 'one_match'")
    flow = page.evaluate("window.__flow")
    confirmed = [event for event in flow if event.get("status") == "one_match"]
    assert confirmed[0]["arguments"]["name"].lower() == "yiwen rong", confirmed
    expect(page.locator("#ranking-banner")).to_have_attribute("data-mode", "speaker")
    expect(page.locator("#ranking-interests")).to_contain_text("Yiwen Rong")
    expect(page.locator("#speaker-choice")).to_be_hidden()
    page.screenshot(path=str(ARTIFACTS / "js-live-speaker.png"), animations="disabled")
    page.locator("#close-guide").click()
    browser.close()
    print("PASS speaker: 'e when wrong' passed on unchanged, the Agent asked, the confirmed name listed her sessions.")
    print("FLOW:", json.dumps([[event["name"], event.get("arguments"), event.get("status")] for event in flow]))
    print("GUIDE (ask):", first)
    print("GUIDE (confirmed):", second)


def free_time(playwright, url):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    flow_recorder(page)
    connect(page, url, microphone=False)
    page.evaluate("ids => window.igniteDemo.executeTool('add_to_agenda', {instance_ids: ids}, 'click')", [IDS["BRK241"], IDS["BRK246"]])
    reply = ask(page, "What can I do with my free time on Wednesday?", "event.name === 'fill_free_time'")
    flow = page.evaluate("window.__flow")
    call = next(event for event in flow if event["name"] == "fill_free_time")
    assert call["arguments"]["date"] == "2026-11-18" and call["ok"], call
    expect(page.locator(".calendar-gap")).to_have_count(3)
    expect(page.locator("#ranking-banner")).to_have_attribute("data-mode", "free-time")
    assert page.evaluate("window.igniteDemo.getState().agenda.length") == 2, "Free time never changes the agenda by itself"
    page.screenshot(path=str(ARTIFACTS / "js-live-free-time.png"), animations="disabled")
    page.locator("#close-guide").click()
    browser.close()
    print("PASS free time: Wednesday -> fill_free_time(2026-11-18), three windows marked, agenda unchanged.")
    print("FLOW:", json.dumps([[event["name"], event.get("arguments")] for event in flow]))
    print("GUIDE:", reply)


def compare(playwright, url):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    flow_recorder(page)
    connect(page, url, microphone=False)
    reply = ask(page, "BRK241 and BRK248 are at the same time. Which one should I pick? I hire engineers.",
                "event.name === 'compare_sessions'")
    flow = page.evaluate("window.__flow")
    call = next(event for event in flow if event["name"] == "compare_sessions")
    assert set(call["arguments"]["instance_ids"]) == {IDS["BRK241"], IDS["BRK248"]} and call["ok"], call
    expect(page.locator("#compare-layer")).to_be_visible()
    expect(page.locator("#compare-grid .compare-code")).to_have_count(2)
    assert "BRK241" in reply or "BRK248" in reply or "recruit" in reply.lower() or "hiring" in reply.lower(), reply
    page.screenshot(path=str(ARTIFACTS / "js-live-compare.png"), animations="disabled")
    page.locator("#close-guide").click()
    browser.close()
    print("PASS compare: both exact IDs -> compare_sessions -> side-by-side sheet, then a recommendation.")
    print("FLOW:", json.dumps([[event["name"], event.get("arguments")] for event in flow]))
    print("GUIDE:", reply)


def command_audio(playwright, url):
    for path in FIXTURES:
        if path.exists():
            with wave.open(str(path)) as wav:
                assert wav.getframerate() == 24000 and wav.getnchannels() == 1 and wav.getsampwidth() == 2
                return wav.readframes(wav.getnframes())
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(reduced_motion="reduce")
    trace = AudioTrace()
    trace.attach(page)
    connect(page, url, microphone=False)
    trace.pcm.clear()
    type_to_agent(page, f"For a speech-input test only, say exactly {COMMAND} Do not perform the action or use tools.")
    page.wait_for_function("() => document.querySelectorAll('#transcript p[data-role=\"Guide\"]').length >= 2", timeout=60000)
    wait_quiet(page)
    trace.assert_speech()
    browser.close()
    FIXTURES[0].parent.mkdir(exist_ok=True)
    with wave.open(str(FIXTURES[0]), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(bytes(trace.pcm))
    return bytes(trace.pcm)


def voice(playwright, url, pcm):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(reduced_motion="reduce")
    install_microphone_fixture(page)
    seen = watch_sockets(page)
    trace = AudioTrace()
    trace.attach(page)
    connect(page, url, microphone=True)
    trace.pcm.clear()
    feed_microphone(page, pcm)
    page.wait_for_function(
        "id => window.igniteDemo.getState().highlighted === id || !document.getElementById('error').hidden",
        arg=VOICE_SESSION_ID, timeout=90000,
    )
    expect(page.locator("#error")).to_be_hidden()
    page.wait_for_function(
        "() => window.__audioAtHighlight !== undefined && "
        "window.igniteDemo.getAudioState().receivedSeconds > window.__audioAtHighlight + .2", timeout=60000,
    )
    wait_quiet(page)
    metrics = trace.assert_speech()
    recognized = " ".join(trace.input_transcripts)
    assert "voice" in recognized.lower(), recognized
    assert_direct(seen)
    page.screenshot(path=str(ARTIFACTS / "js-voice-highlight.png"), animations="disabled")
    page.locator("#close-guide").click()
    page.evaluate("window.__testMic.context.close()")
    browser.close()
    print("PASS voice: microphone -> Azure transcription -> in-page BRK244 highlight -> spoken reply", json.dumps(metrics))
    print("RECOGNIZED:", recognized)


def barge_in(playwright, url, pcm):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(reduced_motion="reduce")
    install_microphone_fixture(page)
    seen = watch_sockets(page)
    trace = AudioTrace()
    trace.attach(page)
    delivered = {}

    def count(frame):
        if isinstance(frame, str) and 'audio.delta"' in frame:
            event = json.loads(frame)
            if event.get("type") in {"response.output_audio.delta", "response.audio.delta"}:
                delivered[event["item_id"]] = delivered.get(event["item_id"], 0) + len(base64.b64decode(event["delta"])) // 2

    page.on("websocket", lambda socket: socket.on("framereceived", count))
    connect(page, url, microphone=True)
    type_to_agent(
        page,
        "Please give me a detailed spoken introduction to planning a conference week, covering interests, "
        "networking, breaks, and choosing between overlapping sessions. Do not use tools yet.")
    page.wait_for_function(
        "() => window.igniteDemo.getVoiceState().speaking && window.igniteDemo.getAudioState().pendingSources >= 3",
        timeout=60000,
    )
    before = page.evaluate("window.igniteDemo.getAudioState()")
    feed_microphone(page, pcm)
    page.wait_for_function(
        "id => window.igniteDemo.getState().highlighted === id || !document.getElementById('error').hidden",
        arg=VOICE_SESSION_ID, timeout=90000,
    )
    expect(page.locator("#error")).to_be_hidden()
    page.wait_for_function(
        "() => window.__audioAtHighlight !== undefined && "
        "window.igniteDemo.getAudioState().receivedSeconds > window.__audioAtHighlight + .2", timeout=60000,
    )
    wait_quiet(page)
    after = page.evaluate("window.igniteDemo.getAudioState()")
    assert after["interruptions"] >= 1, after
    assert trace.events["conversation.item.truncated"] >= 1, trace.events
    assert any(item["audio_end_ms"] < delivered[item["item_id"]] * 1000 // 24000 for item in seen["truncations"]), seen["truncations"]
    assert any("voice" in text.lower() for text in trace.input_transcripts), trace.input_transcripts
    assert not trace.errors, trace.errors
    assert_direct(seen)
    page.locator("#close-guide").click()
    page.evaluate("window.__testMic.context.close()")
    browser.close()
    print("PASS barge-in: playback stopped, Azure acknowledged truncation, and the new spoken request ran.")
    print("BEFORE:", json.dumps({key: before[key] for key in ("receivedSeconds", "renderedSeconds", "pendingSources")}))
    print("TRUNCATIONS SENT BY THE PAGE:", json.dumps(seen["truncations"]))
    print("NEW SPOKEN REQUEST:", trace.input_transcripts)

def loose(playwright, url):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    flow_recorder(page)
    connect(page, url, microphone=False)
    reply = ask(page, "I'm into computer vision and movies. What should I see at Ignite?", "event.name === 'show_ranked_sessions'")
    flow = page.evaluate("window.__flow")
    ranks = [event for event in flow if event["name"] == "ignite_rank_sessions"]
    shown = next(event for event in flow if event["name"] == "show_ranked_sessions")
    assert len(shown["arguments"]["instance_ids"]) >= 5, ("At least five sessions on the page", shown)
    expect(page.locator(".session-card")).to_have_count(len(shown["arguments"]["instance_ids"]))
    looser = page.locator(".interest-chips span.looser").count()
    reply = " ".join(page.locator('#transcript p[data-role="Guide"]').all_inner_texts()[1:])
    page.screenshot(path=str(ARTIFACTS / "js-live-loose.png"), animations="disabled")
    page.locator("#close-guide").click()
    browser.close()
    print(f"PASS loose: {len(shown['arguments']['instance_ids'])} sessions shown, {looser} labeled as looser matches.")
    print("RANK CALLS:", json.dumps([event["arguments"] for event in ranks]))
    print("GUIDE:", reply)


def speaker_zh(playwright, url):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    flow_recorder(page)
    connect(page, url, microphone=False)
    reply = ask(page, "Which sessions is ding ding lou speaking in?", "event.name === 'find_speaker'")
    flow = page.evaluate("window.__flow")
    finds = [event for event in flow if event["name"] == "find_speaker"]
    assert "ding" in finds[0]["arguments"]["name"].lower(), ("The heard name is passed on", finds)
    assert any(event.get("status") == "one_match" for event in finds), finds
    expect(page.locator("#ranking-banner")).to_have_attribute("data-mode", "speaker")
    expect(page.locator("#ranking-interests")).to_contain_text("Dingding Lu")
    codes = sorted(set(page.locator(".session-card .session-code").all_inner_texts()))
    assert codes == ["LAB692", "TT1865"], codes
    page.screenshot(path=str(ARTIFACTS / "js-live-speaker-zh.png"), animations="disabled")
    page.locator("#close-guide").click()
    browser.close()
    print(f"PASS speaker-zh: 'ding ding lou' -> Dingding Lu, sessions {codes}.")
    print("FLOW:", json.dumps([[event["name"], event.get("arguments"), event.get("status")] for event in finds]))
    print("GUIDE:", reply)

def explain(playwright, url):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce")
    flow_recorder(page)
    connect(page, url, microphone=False)
    greeting = page.locator('#transcript p[data-role="Guide"]').count()
    explained = ask(page, "How do you control this web page? Walk me through it.", "event.name === 'show_how_it_works'", timeout=120000)
    flow = page.evaluate("window.__flow")
    print("FIRST TURN CALLS:", [event["name"] for event in flow], flush=True)
    assert [event["name"] for event in flow] == ["show_how_it_works"], ("The explanation turn calls nothing else", flow)
    expect(page.locator("#how-board")).to_be_visible()
    narration = " ".join(page.locator('#transcript p[data-role="Guide"]').all_inner_texts()[greeting:])
    print("EXPLAINED:", narration, flush=True)
    # The board followed the five spoken sentences to the last step.
    try:
        expect(page.locator("#how-board")).to_have_attribute("data-step", "together", timeout=15000)
    except AssertionError:
        print("BOARD STEP:", page.evaluate("document.getElementById('how-board').dataset.step"), flush=True)
        raise
    page.screenshot(path=str(ARTIFACTS / "js-live-explain.png"), animations="disabled")
    proof_reply = ask(page, "Yes, show me live.", "event.name === 'highlight_session'", timeout=120000)
    flow = page.evaluate("window.__flow")
    proof = [event["name"] for event in flow[1:]]
    trace = page.locator("#how-board .how-trace li").all_inner_texts()
    assert "highlight_session" in proof and any("highlight_session" in row for row in trace), (proof, trace)
    order = page.evaluate("""() => window.igniteDemo.getConversationLog()
      .filter(record => record.type === 'tool.call' || record.type === 'assistant.generated_text')
      .map(record => record.type === 'tool.call'
        ? `CALL ${record.data.name}${record.data.arguments?.step ? ':' + record.data.arguments.step : ''}`
        : `SAY ${record.data.text.slice(0, 50)}`)""")
    page.locator("#close-guide").click()
    browser.close()
    print(f"PASS explain: one show_how_it_works call, the board followed the sentences to 'together'; then live proof {proof}, traced on the board.")
    print("PROOF:", proof_reply)
    print("ORDER:", json.dumps(order, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8768")
    parser.add_argument("--scenario", choices=["all", "agenda", "ranking", "page-event", "details", "speaker", "free-time", "compare",
                                               "loose", "speaker-zh", "explain", "voice", "barge-in"], default="all")
    args = parser.parse_args()
    ARTIFACTS.mkdir(exist_ok=True)
    with sync_playwright() as playwright:
        if args.scenario in {"all", "agenda"}:
            agenda(playwright, args.url)
        if args.scenario in {"all", "ranking"}:
            ranking(playwright, args.url)
        if args.scenario in {"all", "page-event"}:
            page_event(playwright, args.url)
        if args.scenario in {"all", "details"}:
            details(playwright, args.url)
        if args.scenario in {"all", "speaker"}:
            speaker(playwright, args.url)
        if args.scenario in {"all", "free-time"}:
            free_time(playwright, args.url)
        if args.scenario in {"all", "compare"}:
            compare(playwright, args.url)
        if args.scenario in {"all", "loose"}:
            loose(playwright, args.url)
        if args.scenario in {"all", "speaker-zh"}:
            speaker_zh(playwright, args.url)
        if args.scenario in {"all", "explain"}:
            explain(playwright, args.url)
        if args.scenario in {"all", "voice", "barge-in"}:
            pcm = command_audio(playwright, args.url)
            if args.scenario in {"all", "voice"}:
                voice(playwright, args.url, pcm)
            if args.scenario in {"all", "barge-in"}:
                barge_in(playwright, args.url, pcm)


if __name__ == "__main__":
    main()
