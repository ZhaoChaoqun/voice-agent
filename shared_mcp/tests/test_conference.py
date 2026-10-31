from __future__ import annotations

import asyncio
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
if APP.is_dir() and str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from mcp.server.fastmcp import FastMCP  # noqa: E402
from mcp.server.fastmcp.exceptions import ToolError  # noqa: E402

from shared_mcp.conference import pack  # noqa: E402
from shared_mcp.conference.dataset import DATA_ROOT, dataset_name, load_dataset  # noqa: E402
from shared_mcp.conference.refresh import trim  # noqa: E402
from shared_mcp.conference.server import register_tools  # noqa: E402
from shared_mcp.conference.service import ConferenceService  # noqa: E402

# Wednesday 2026-10-28, three weeks before the event.
BEFORE_EVENT = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)
# Session behavior is tested at a fixed event time: Wednesday November 18, 10:50 AM PT.
EVENT_NOW = {"CONFERENCE_NOW": "2026-11-18T10:50:00"}
# Thursday 2026-11-19 10:00 Pacific, during the event.
DURING_EVENT = datetime(2026, 11, 19, 18, 0, tzinfo=timezone.utc)
DATASET = load_dataset()
TOOLS = {
    "conference_get_event_info",
    "conference_search_sessions",
    "conference_get_session",
    "conference_sessions_starting_soon",
    "conference_get_session_changes",
    "conference_agenda_add",
    "conference_agenda_remove",
    "conference_agenda_list",
    "conference_get_faq",
    "conference_recommend_sessions",
    "conference_similar_sessions",
}


def build(now: datetime = BEFORE_EVENT, environment: dict[str, str] | None = None) -> FastMCP:
    mcp = FastMCP("conference")
    register_tools(mcp, ConferenceService(DATASET, clock=lambda: now, environment=EVENT_NOW if environment is None else environment))
    return mcp


def call(mcp: FastMCP, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    result = asyncio.run(mcp.call_tool(name, arguments or {}))
    if isinstance(result, tuple):
        content, structured = result
        if structured is not None:
            return structured
        return json.loads(content[0].text)
    if isinstance(result, dict):
        return result
    return json.loads(result[0].text)


class DatasetTests(unittest.TestCase):
    def test_snapshot_is_trimmed_utc_catalog_with_unique_ids(self) -> None:
        self.assertGreater(len(DATASET.sessions), 1000)
        self.assertEqual("https://ignite.microsoft.com/api/session/all/en-US", DATASET.snapshot["source"])
        self.assertTrue(DATASET.snapshot["snapshot_utc"].endswith("Z"))
        ids = [session["id"] for session in DATASET.sessions]
        self.assertEqual(len(ids), len(set(ids)))
        for session in DATASET.sessions:
            self.assertNotIn("embeddingContent", session)
            self.assertLessEqual(len(session["description"]), 401)
            if session["start"]:
                self.assertTrue(session["start"].endswith("Z"), session["id"])

    def test_catalog_times_are_utc_and_convert_to_pacific(self) -> None:
        service = ConferenceService(DATASET, clock=lambda: BEFORE_EVENT, environment={})
        keynote = service.brief(DATASET.by_id["KEY02"])
        self.assertEqual(("Wednesday, November 18", "9:00 AM"), (keynote["day"], keynote["start"]))
        brk244 = service.brief(DATASET.by_id["BRK244"])
        self.assertEqual(("Thursday, November 19", "5:15 PM", "6:00 PM"), (brk244["day"], brk244["start"], brk244["end"]))

    def test_trim_numbers_repeated_codes_and_strips_markup(self) -> None:
        raw = [
            {"sessionCode": "LAB1", "title": "Lab<b>\u200b</b> one", "startDateTime": "2026-11-18T18:00:00Z",
             "description": "x " * 400, "viewingOptions": [{"displayValue": "Will be recorded"}]},
            {"sessionCode": "LAB1", "title": "Lab one", "startDateTime": "2026-11-17T18:00:00Z"},
            {"sessionCode": "BRK1", "title": "Talk", "speakerNames": "A B, C D"},
        ]
        trimmed = {session["id"]: session for session in trim(raw)}
        self.assertEqual({"LAB1-1", "LAB1-2", "BRK1"}, set(trimmed))
        self.assertEqual("2026-11-17T18:00:00Z", trimmed["LAB1-1"]["start"])
        self.assertEqual("Lab one", trimmed["LAB1-2"]["title"])
        self.assertTrue(trimmed["LAB1-2"]["recorded"])
        self.assertTrue(trimmed["LAB1-2"]["description"].endswith("…"))
        self.assertEqual(["A B", "C D"], trimmed["BRK1"]["speakers"])

    def test_dataset_ships_only_official_data(self) -> None:
        folder = DATA_ROOT / "ignite2026"
        for name in ("venue.json", "changes.json"):
            self.assertFalse((folder / name).exists(), name)
        faq = json.loads((folder / "faq.json").read_text(encoding="utf-8"))
        self.assertTrue(faq["entries"])
        for entry in faq["entries"]:
            self.assertEqual("official", entry["source"], entry["id"])
            self.assertRegex(entry["url"], r"^https://(ignite|wayfinding\.event)\.microsoft\.com/", entry["id"])
        for name in ("faq.json", "event.json"):
            self.assertNotIn("SAMPLE", (folder / name).read_text(encoding="utf-8"), name)
        self.assertNotIn("demo_clock", json.loads((folder / "event.json").read_text(encoding="utf-8")))

    def test_dataset_name_comes_from_environment(self) -> None:
        self.assertEqual("ignite2026", dataset_name({}))
        self.assertEqual("other_event", dataset_name({"CONFERENCE_DATASET": "Other_Event"}))
        with self.assertRaises(ValueError):
            dataset_name({"CONFERENCE_DATASET": "../secrets"})
        with self.assertRaises(FileNotFoundError):
            load_dataset("missing-event")


class ToolSurfaceTests(unittest.TestCase):
    def test_pack_registers_the_conference_tools(self) -> None:
        mcp = FastMCP("conference")
        with patch.dict("os.environ", {}, clear=False):
            pack.register(mcp)
        names = {tool.name for tool in asyncio.run(mcp.list_tools())}
        self.assertEqual(TOOLS, names)

    def test_schema_rejects_oversized_input(self) -> None:
        mcp = build()
        long_agenda = call(mcp, "conference_agenda_list", {"agenda": [f"BRK2{index:02d}" for index in range(35)]})
        self.assertLessEqual(len(long_agenda["agenda"]), 30)
        self.assertGreaterEqual(len(long_agenda["ignored"]), 5)
        with self.assertRaises(ToolError):
            call(mcp, "conference_agenda_add", {"session_code": "BRK244"})
        with self.assertRaises(ToolError):
            call(mcp, "conference_search_sessions", {"query": "agents", "limit": 11})
        with self.assertRaises(ToolError):
            call(mcp, "conference_search_sessions", {"attendance": "hybrid"})


class ClockTests(unittest.TestCase):
    def test_before_the_event_uses_the_real_time_and_says_so(self) -> None:
        info = call(build(environment={}), "conference_get_event_info")
        self.assertFalse(info["clock"]["simulated"])
        self.assertEqual("2026-10-28", info["clock"]["date"])
        self.assertEqual("before_event", info["clock"]["event_phase"])
        self.assertEqual(["KEY01", "KEY02"], [keynote["id"] for keynote in info["keynotes"]])
        self.assertEqual("Chase Center", info["keynotes"][0]["location"])
        self.assertTrue(all("overflow" not in keynote for keynote in info["keynotes"]))
        self.assertEqual("BRK244", info["dev_mode"]["session_code"])
        self.assertNotIn("SAMPLE", info["data_notes"])
        self.assertNotIn("on_site_logistics", info)
        soon = call(build(environment={}), "conference_sessions_starting_soon", {"within_minutes": 60})
        self.assertEqual([], soon["sessions"])
        self.assertEqual("before_event", soon["clock"]["event_phase"])
        self.assertTrue(soon["next_start"].startswith("Monday, November 16") or soon["next_start"].startswith("Tuesday, November 17"))

    def test_during_and_after_the_event_and_the_override(self) -> None:
        during = call(build(DURING_EVENT, environment={}), "conference_get_event_info")["clock"]
        self.assertFalse(during["simulated"])
        self.assertEqual(("Thursday, November 19, 10:00 AM PT", "during_event"), (during["now_local"], during["event_phase"]))
        after = call(build(datetime(2026, 11, 22, 18, 0, tzinfo=timezone.utc), environment={}), "conference_get_event_info")["clock"]
        self.assertEqual("after_event", after["event_phase"])
        fixed = call(build(environment={"CONFERENCE_NOW": "2026-11-19T16:00:00"}), "conference_get_event_info")["clock"]
        self.assertEqual(("Thursday, November 19, 4:00 PM PT", True), (fixed["now_local"], fixed["simulated"]))


class SessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mcp = build()

    def test_natural_language_search_with_relative_day_and_part_of_day(self) -> None:
        result = call(self.mcp, "conference_search_sessions", {
            "query": "voice AI", "day": "tomorrow", "part_of_day": "afternoon",
        })
        self.assertTrue(result["ok"])
        self.assertEqual("Thursday, November 19", result["filters"]["day"])
        self.assertEqual("LTG1358-2", result["sessions"][0]["id"])
        self.assertIn("TT1668", [session["id"] for session in result["sessions"]])
        for session in result["sessions"]:
            self.assertEqual("Thursday, November 19", session["day"])
            self.assertTrue(session["start"].endswith("PM"))

    def test_filters_type_attendance_level_speaker_and_recording(self) -> None:
        labs = call(self.mcp, "conference_search_sessions", {
            "query": "Foundry agents", "session_type": "hands-on lab", "attendance": "in_person", "limit": 10,
        })
        self.assertTrue(labs["sessions"])
        for session in labs["sessions"]:
            self.assertEqual("Lab", session["type"])
            self.assertTrue(session["in_person"])
        speaker = call(self.mcp, "conference_search_sessions", {"speaker": "Satya Nadella"})
        self.assertEqual(["KEY01"], [session["id"] for session in speaker["sessions"]])
        advanced = call(self.mcp, "conference_search_sessions", {
            "query": "security", "day": "Thursday", "level": "300", "recorded": True,
        })
        for session in advanced["sessions"]:
            self.assertEqual("(300) Advanced", session["level"])
            self.assertTrue(session["recorded"])
        online = call(self.mcp, "conference_search_sessions", {"query": "voice", "attendance": "online"})
        self.assertTrue(all(session["online"] for session in online["sessions"]))
        unknown_topic = call(self.mcp, "conference_search_sessions", {"topic": "voice agents"})
        self.assertEqual("voice agents", unknown_topic["filters"]["query"].strip())
        self.assertNotIn("topic", unknown_topic["filters"])
        track = call(self.mcp, "conference_search_sessions", {"topic": "security", "limit": 3})
        self.assertEqual(["Security"], track["filters"]["topic"])

    def test_relative_days_in_other_languages_and_english_keywords(self) -> None:
        for day, expected in (("明天", "Thursday, November 19"), ("mañana", "Thursday, November 19"),
                              ("今天", "Wednesday, November 18"), ("星期二", "Tuesday, November 17")):
            with self.subTest(day=day):
                result = call(self.mcp, "conference_search_sessions", {"query": "agents", "day": day})
                self.assertEqual(expected, result["filters"]["day"])
        chinese = call(self.mcp, "conference_search_sessions", {"query": "语音智能体", "day": "tomorrow"})
        self.assertFalse(chinese["ok"])
        self.assertEqual("english_keywords_required", chinese["error"]["code"])

    def test_common_words_alone_do_not_match_a_specific_query(self) -> None:
        result = call(self.mcp, "conference_search_sessions", {"query": "voice agents", "limit": 10})
        for session in result["sessions"]:
            self.assertRegex(session["title"].lower(), r"voice|speech|audio|real-?time|conversational")

    def test_invalid_filters_are_business_errors(self) -> None:
        for arguments, code in (
            ({"level": "500"}, "invalid_level"),
            ({"day": "someday"}, "invalid_day"),
            ({"start_after": "lunchtime"}, "invalid_time"),
            ({"session_type": "concert"}, "invalid_session_type"),
        ):
            with self.subTest(arguments=arguments):
                result = call(self.mcp, "conference_search_sessions", arguments)
                self.assertFalse(result["ok"])
                self.assertEqual(code, result["error"]["code"])

    def test_get_session_details_instances_and_unknown_codes(self) -> None:
        brk244 = call(self.mcp, "conference_get_session", {"session_code": "brk 244"})["session"]
        self.assertEqual("Voice agents in Microsoft Foundry: Prototype to production in 45 mins", brk244["title"])
        self.assertEqual("AMC Metreon | Level 3, Theater 12", brk244["location"])
        self.assertIn("Yiwen Rong", brk244["speakers"])
        repeated = next(code for code, items in DATASET.by_code.items() if len(items) > 1)
        detail = call(self.mcp, "conference_get_session", {"session_code": repeated})
        self.assertGreater(len(detail["instances"]), 1)
        missing = call(self.mcp, "conference_get_session", {"session_code": "XYZ999"})
        self.assertEqual("session_not_found", missing["error"]["code"])

    def test_starting_soon_uses_the_event_clock(self) -> None:
        result = call(self.mcp, "conference_sessions_starting_soon", {"within_minutes": 15, "limit": 10})
        self.assertTrue(result["sessions"])
        starts = [session["starts_in_minutes"] for session in result["sessions"]]
        self.assertEqual(sorted(starts), starts)
        for session in result["sessions"]:
            self.assertLessEqual(session["starts_in_minutes"], 15)
            self.assertEqual("scheduled", session["status"])
            self.assertNotIn("walk_minutes", session)
        self.assertNotIn("changes", result)
        later = call(self.mcp, "conference_sessions_starting_soon", {"within_minutes": 5, "topic": "Agent Platform"})
        self.assertEqual([], later["sessions"])
        self.assertEqual("Wednesday, November 18, 11:00 AM PT", later["next_start"])
        keynote = call(self.mcp, "conference_sessions_starting_soon", {"within_minutes": 240, "topic": "keynote"})
        self.assertEqual([], keynote["sessions"])
        self.assertNotIn("next_start", keynote)

    def test_changes_are_official_only_and_empty_without_the_live_catalog(self) -> None:
        result = call(self.mcp, "conference_get_session_changes")
        self.assertEqual(0, result["official_changes"]["total"])
        self.assertIn("not been loaded", result["official_changes"]["note"])
        self.assertNotIn("sample_changes", result)
        self.assertNotIn("SAMPLE", result["notice"])
        for code in ("BRK247", "THR983"):
            self.assertEqual("scheduled", call(self.mcp, "conference_get_session", {"session_code": code})["session"]["status"])
        none = call(self.mcp, "conference_get_session_changes", {"session_code": "BRK244"})
        self.assertIn("as scheduled", none["message"])

    def test_official_changes_come_from_comparing_catalog_versions(self) -> None:
        service = ConferenceService(load_dataset(), clock=lambda: BEFORE_EVENT, environment={})
        live = [dict(session) for session in DATASET.sessions]
        by_id = {session["id"]: session for session in live}
        by_id["BRK540"]["location"] = "Moscone West | Level 2, Room 2001"
        by_id["BRK244"]["start"], by_id["BRK244"]["end"] = "2026-11-20T00:15:00Z", "2026-11-20T01:00:00Z"
        removed = by_id["BRK284"]
        live.remove(removed)
        live.append({**by_id["BRK249"], "id": "NEW900", "code": "NEW900", "instance_id": "new-instance", "title": "Brand new session"})
        service.replace_sessions(live, {"mode": "live"})
        result = service.get_session_changes(limit=20)
        self.assertEqual({"room_change": 1, "time_change": 1, "removed": 1, "added": 1}, result["official_changes"]["counts"])
        items = {item["id"]: item for item in result["official_changes"]["items"]}
        self.assertEqual("Moscone West | Level 3, Room 3005", items["BRK540"]["original_location"])
        self.assertEqual("room_change", items["BRK540"]["status"])
        self.assertEqual("Thursday, November 19, 5:15 PM", items["BRK244"]["original_time"])
        self.assertEqual(("time_change", "4:15 PM"), (items["BRK244"]["status"], items["BRK244"]["start"]))
        self.assertEqual("removed_from_catalog", items["BRK284"]["status"])
        self.assertIn("may be cancelled, merged, or renumbered", items["BRK284"]["note"])
        self.assertEqual("new_in_catalog", items["NEW900"]["status"])
        self.assertEqual("NEW900", result["official_changes"]["items"][-1]["id"])
        self.assertEqual("official catalog", service.get_session("BRK244")["session"]["change_data"])
        self.assertEqual("session_removed", service.agenda_add("BRK284", ["BRK244"])["error"]["code"])
        removed_detail = service.get_session("BRK284")
        self.assertEqual("removed_from_catalog", removed_detail["session"]["status"])
        self.assertIn("alternatives", removed_detail)
        listed = service.agenda_list(["BRK244", "BRK284"])
        self.assertEqual(["time_change", "removed_from_catalog"], [item["status"] for item in listed["items"]])
        one = service.get_session_changes("BRK540")
        self.assertEqual(["BRK540"], [item["id"] for item in one["official_changes"]["items"]])
        detected = items["BRK540"]["detected_utc"]
        service.replace_sessions(live, {"mode": "live"})
        again = {item["id"]: item for item in service.get_session_changes(limit=20)["official_changes"]["items"]}
        self.assertEqual(detected, again["BRK540"]["detected_utc"])


class AgendaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mcp = build()

    def test_add_detects_clashes_and_suggests_the_recording(self) -> None:
        first = call(self.mcp, "conference_agenda_add", {"session_code": "BRK244", "agenda": []})
        self.assertEqual(["BRK244"], first["agenda"])
        self.assertEqual([], first["conflicts"])
        second = call(self.mcp, "conference_agenda_add", {"session_code": "BRK284", "agenda": first["agenda"]})
        self.assertEqual(["BRK244", "BRK284"], second["agenda"])
        conflict = second["conflicts"][0]
        self.assertEqual({"BRK244", "BRK284"}, set(conflict["sessions"]))
        self.assertEqual(45, conflict["overlap_minutes"])
        self.assertIn("on demand", conflict["suggestion"])
        again = call(self.mcp, "conference_agenda_add", {"session_code": "BRK244", "agenda": second["agenda"]})
        self.assertTrue(again["already_in_agenda"])
        self.assertEqual(second["agenda"], again["agenda"])

    def test_list_orders_items_and_finds_whats_next(self) -> None:
        listed = call(self.mcp, "conference_agenda_list", {"agenda": ["BRK244", "KEY02", "BRK249", "nonsense"]})
        self.assertEqual(["KEY02", "BRK249", "BRK244"], listed["agenda"])
        self.assertEqual(["nonsense"], listed["ignored"])
        self.assertEqual("BRK249", listed["next_up"]["id"])
        self.assertEqual(40, listed["next_up"]["starts_in_minutes"])
        self.assertEqual("AMC Metreon | Level 3, Theater 11", listed["items"][1]["location"])

    def test_remove_and_ambiguous_sessions(self) -> None:
        removed = call(self.mcp, "conference_agenda_remove", {"session_code": "BRK284", "agenda": ["BRK244", "BRK284"]})
        self.assertEqual(["BRK244"], removed["agenda"])
        missing = call(self.mcp, "conference_agenda_remove", {"session_code": "BRK284", "agenda": ["BRK244"]})
        self.assertEqual("not_in_agenda", missing["error"]["code"])
        repeated = next(code for code, items in DATASET.by_code.items() if len(items) > 1)
        ambiguous = call(self.mcp, "conference_agenda_add", {"session_code": repeated, "agenda": []})
        self.assertEqual("choose_instance", ambiguous["error"]["code"])
        self.assertGreater(len(ambiguous["options"]), 1)
        chosen = call(self.mcp, "conference_agenda_add", {"session_code": ambiguous["options"][1]["id"], "agenda": []})
        self.assertEqual([ambiguous["options"][1]["id"]], chosen["agenda"])
        removed_by_code = call(self.mcp, "conference_agenda_remove", {"session_code": repeated, "agenda": chosen["agenda"]})
        self.assertEqual([], removed_by_code["agenda"])

    def test_agenda_is_never_stored_by_the_service(self) -> None:
        call(self.mcp, "conference_agenda_add", {"session_code": "BRK244", "agenda": []})
        self.assertEqual([], call(self.mcp, "conference_agenda_list", {"agenda": []})["agenda"])


class FaqTests(unittest.TestCase):
    def test_answers_only_from_the_faq(self) -> None:
        mcp = build()
        wifi = call(mcp, "conference_get_faq", {"question": "What's the Wi-Fi password?"})
        self.assertFalse(wifi["found"])
        cost = call(mcp, "conference_get_faq", {"question": "How much does a conference pass cost?"})
        self.assertEqual("official", cost["answers"][0]["source"])
        self.assertIn("2,325", cost["answers"][0]["answer"])
        recorded = call(mcp, "conference_get_faq", {"question": "Will sessions be recorded?"})
        self.assertEqual("Recordings and on demand", recorded["answers"][0]["topic"])
        for question, topic, fact in (
            ("Where do I pick up my badge?", "Badge pickup locations and hours", "Moscone West Lobby"),
            ("When do the shuttles run on Wednesday?", "Daily shuttle schedule", "6:15 to 7:30 PM"),
            ("Which shuttle route is my hotel, Hotel Kabuki?", "Shuttle routes and boarding locations", "Blue route"),
            ("Can I park at Moscone?", "Parking", "99 Warriors Way"),
            ("Can I bring my suitcase?", "Security screening, ID, and bags", "luggage"),
            ("When is the celebration with Gwen Stefani?", "Microsoft Ignite Celebration", "7 to 9 PM"),
            ("Where can I charge my laptop?", "Charging and lounges", "Moscone South, Level 2"),
            ("Where is the nearest restroom?", "Venue maps and directions", "wayfinding.event.microsoft.com/ignite"),
            ("Is there halal food at lunch?", "Lunch and preordered meals", "Metreon Dining Terrace"),
            ("Can I bring a guest?", "How to attend and register", "register individually"),
            ("Can I get a discount for my team?", "How to attend and register", "no bundle pricing"),
            ("Is Digital Pass optional?", "Digital Pass facial authentication details", "optional"),
            ("I can't sign in to the app with my work account", "Signing in to the mobile app with a work account", "Intune"),
            ("How do I turn off notifications?", "Push notifications", "unsubscribe"),
            ("How can my company become a sponsor?", "Sponsorship", "sponsor@microsoft.com"),
            ("Which hotels are in the Advantage pass?", "Advantage pass hotels", "Palace Hotel"),
            ("I registered for digital but want to come in person", "Viewing or changing your registration", "support team"),
            ("I'm going to the AI Tour, should I also go to Ignite?", "Microsoft AI Tour and Ignite", "complement"),
            ("How do I make my profile public?", "Profile and attendee directory", "attendee directory"),
        ):
            with self.subTest(question=question):
                answer = call(mcp, "conference_get_faq", {"question": question})
                self.assertTrue(answer["found"])
                self.assertEqual(topic, answer["answers"][0]["topic"])
                self.assertIn(fact, answer["answers"][0]["answer"])
                self.assertTrue(all(item["source"] == "official" for item in answer["answers"]))
        unknown = call(mcp, "conference_get_faq", {"question": "Can I bring my dog?"})
        self.assertFalse(unknown["found"])
        self.assertEqual([], unknown["answers"])


class PersonalizationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mcp = build()

    def test_user_time_zone_adds_local_time(self) -> None:
        beijing = call(self.mcp, "conference_get_session", {"session_code": "BRK244", "time_zone": "Beijing"})
        self.assertEqual("Asia/Shanghai", beijing["user_time_zone"])
        self.assertEqual("Friday, November 20, 9:15 AM (Asia/Shanghai)", beijing["session"]["your_time"])
        self.assertEqual("5:15 PM", beijing["session"]["start"])
        offset = call(self.mcp, "conference_search_sessions", {"speaker": "Satya Nadella", "time_zone": "UTC+8"})
        self.assertEqual("Wednesday, November 18, 2:00 AM (UTC+8)", offset["sessions"][0]["your_time"])
        plain = call(self.mcp, "conference_get_session", {"session_code": "BRK244"})
        self.assertNotIn("your_time", plain["session"])
        bad = call(self.mcp, "conference_get_session", {"session_code": "BRK244", "time_zone": "Atlantis"})
        self.assertEqual("unknown_time_zone", bad["error"]["code"])

    def test_recommendations_are_relevant_and_never_overlap(self) -> None:
        result = call(self.mcp, "conference_recommend_sessions", {
            "role": "developer building contact center agents",
            "interests": "voice agents contact center real-time speech",
            "agenda": ["BRK244"], "per_day": 3,
        })
        self.assertTrue(result["ok"])
        self.assertEqual(["developer"], result["role_profile"])
        self.assertGreaterEqual(len(result["plan"]), 3)
        picked = [session for day in result["plan"] for session in day["sessions"]]
        self.assertNotIn("BRK244", [session["code"] for session in picked])
        self.assertTrue(any("voice" in session["title"].lower() for session in picked))
        service = ConferenceService(DATASET, clock=lambda: BEFORE_EVENT, environment={})
        chosen = [DATASET.by_id[session["id"]] for session in picked] + [DATASET.by_id["BRK244"]]
        for index, first in enumerate(chosen):
            for second in chosen[index + 1:]:
                self.assertEqual(0, service._overlap(first, second), (first["id"], second["id"]))
        thursday = call(self.mcp, "conference_recommend_sessions", {
            "role": "IT admin", "interests": "security", "agenda": [], "days": "Thursday", "per_day": 2,
        })
        self.assertEqual(["Thursday, November 19"], [day["day"] for day in thursday["plan"]])
        self.assertLessEqual(len(thursday["plan"][0]["sessions"]), 2)
        empty = call(self.mcp, "conference_recommend_sessions", {"role": "", "interests": "", "agenda": []})
        self.assertEqual("need_role_or_interests", empty["error"]["code"])

    def test_similar_sessions_are_labelled_as_content_similarity(self) -> None:
        result = call(self.mcp, "conference_similar_sessions", {"session_code": "BRK244"})
        codes = [session["code"] for session in result["similar"]]
        self.assertNotIn("BRK244", codes)
        self.assertIn("TT1663", codes)
        self.assertIn("no attendance data", result["basis"])


class LiveRefreshTests(unittest.TestCase):
    def test_refresh_swaps_sessions_and_failures_keep_the_snapshot(self) -> None:
        from shared_mcp.conference.refresh import start_live_refresh

        service = ConferenceService(load_dataset(), clock=lambda: BEFORE_EVENT, environment={})
        raw = [{"sessionCode": "NEW1", "title": "Brand new voice session", "startDateTime": "2026-11-18T19:00:00Z",
                "endDateTime": "2026-11-18T19:45:00Z", "lastUpdate": "2026-11-01T00:00:00Z",
                "deliveryTypes": [{"displayValue": "In-person"}]}]
        calls = []

        def fetch(url: str):
            calls.append(url)
            if len(calls) > 1:
                raise OSError("catalog unreachable")
            return raw

        with patch("shared_mcp.conference.refresh.time.sleep", side_effect=[None, SystemExit]):
            thread = start_live_refresh(service, 1, fetch=fetch)
            thread.join(5)
        self.assertEqual(["NEW1"], [session["id"] for session in service.data.sessions])
        status = service.get_event_info()["catalog_snapshot"]
        self.assertEqual("live", status["mode"])
        self.assertIn("catalog unreachable", status["last_refresh_error"])
        self.assertEqual("Brand new voice session", service.get_session("NEW1")["session"]["title"])


class LocalServerTests(unittest.TestCase):
    def test_local_route_answers_initialize_and_tools_list_without_auth(self) -> None:
        from starlette.testclient import TestClient

        from shared_mcp.conference.__main__ import ROUTE, build_app

        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        with TestClient(build_app([]), base_url="http://127.0.0.1:8787") as client:
            self.assertEqual({"status": "ok", "route": ROUTE}, client.get("/healthz").json())
            initialize = client.post(ROUTE, headers=headers, json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                           "clientInfo": {"name": "test", "version": "1"}},
            })
            self.assertEqual(200, initialize.status_code, initialize.text)
            listed = client.post(ROUTE, headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
            self.assertEqual(TOOLS, {tool["name"] for tool in listed.json()["result"]["tools"]})
            rejected = client.post(ROUTE, headers={**headers, "Host": "evil.example"}, json={
                "jsonrpc": "2.0", "id": 3, "method": "tools/list"})
            self.assertEqual(421, rejected.status_code)


if __name__ == "__main__":
    unittest.main()
