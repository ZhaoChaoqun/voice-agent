from __future__ import annotations

from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field

from .service import ConferenceService



class ConferenceError(BaseModel):
    code: str
    message: str


class ConferenceResult(BaseModel):
    """Common fields of every conference tool result; the rest depends on the tool."""

    model_config = ConfigDict(extra="allow")

    tool: str
    ok: bool
    error: ConferenceError | None


def _result(payload: dict[str, Any]) -> ConferenceResult:
    return ConferenceResult.model_validate(payload)


SessionCode = Annotated[
    str,
    Field(min_length=2, max_length=40, description="Session code or id from a previous result, for example BRK244 or LAB512-2."),
]
# Required and unconstrained on purpose: Voice Live (2026-10) dispatched conference_agenda_add as a
# plain function_call instead of an MCP call while this array was optional with item/size limits.
# The service enforces the size limit instead.
Agenda = Annotated[
    list[str],
    Field(
        description=(
            "The attendee's current agenda: exactly the agenda list returned by the last agenda tool in this "
            "conversation, or [] if none yet. The service stores nothing."
        ),
    ),
]
Text = Annotated[str, Field(max_length=200)]
TimeZone = Annotated[
    str,
    Field(
        max_length=64,
        description=(
            "Optional: the attendee's own time zone when they ask for times in it, for example Asia/Shanghai, "
            "Beijing, Europe/London, or UTC+8. Results then add your_time next to the event time (PT)."
        ),
    ),
]


def register_tools(mcp: FastMCP, service: ConferenceService) -> None:
    @mcp.tool(
        name="conference_get_event_info",
        description=(
            "Event basics: name, dates, time zone, the current event time and event_phase (before_event, "
            "during_event, after_event), keynote times and rooms, topics, session types, levels, catalog snapshot "
            "date, and dev-mode facts. "
            "Call it first when you need today's date, keynotes, or valid filter values."
        ),
    )
    def conference_get_event_info(time_zone: TimeZone = "") -> ConferenceResult:
        return _result(service.with_user_zone(time_zone, service.get_event_info))

    @mcp.tool(
        name="conference_search_sessions",
        description=(
            "Search the official session catalog by keywords and filters. Times are local event time. "
            "Returns the best matches first with id, title, day, start, end, room, type, level, speakers, "
            "in-person/online, recorded, and status (scheduled, room_change, time_change, room_and_time_change)."
        ),
    )
    def conference_search_sessions(
        query: Annotated[str, Field(max_length=200, description="Keywords such as 'voice agents Foundry'. Leave empty to list by time.")] = "",
        day: Annotated[str, Field(max_length=40, description="YYYY-MM-DD, weekday name, today, or tomorrow.")] = "",
        part_of_day: Annotated[Literal["", "morning", "afternoon", "evening"], Field(description="Morning before 12, afternoon 12-17, evening after 17.")] = "",
        start_after: Annotated[str, Field(max_length=20, description="Earliest start time, such as 13:00 or 1 PM.")] = "",
        start_before: Annotated[str, Field(max_length=20, description="Latest start time, such as 16:30.")] = "",
        topic: Annotated[str, Field(max_length=80, description="Catalog topic or track, such as Agent Platform or Security.")] = "",
        level: Annotated[str, Field(max_length=40, description="100, 200, 300, 400 or Foundational, Intermediate, Advanced, Expert.")] = "",
        session_type: Annotated[str, Field(max_length=40, description="Breakout, Lab (hands-on), Theater, Lightning Talk, Table Talk, Keynote, Pre-recorded.")] = "",
        speaker: Annotated[str, Field(max_length=80, description="Speaker name or last name.")] = "",
        attendance: Annotated[Literal["", "in_person", "online"], Field(description="in_person for Moscone sessions, online for digital attendees.")] = "",
        recorded: Annotated[bool | None, Field(description="true for sessions that will be recorded.")] = None,
        limit: Annotated[int, Field(ge=1, le=10)] = 3,
        time_zone: TimeZone = "",
    ) -> ConferenceResult:
        return _result(service.with_user_zone(time_zone, lambda: service.search_sessions(
            query, day, part_of_day, start_after, start_before, topic, level, session_type, speaker,
            attendance, recorded, limit,
        )))

    @mcp.tool(
        name="conference_get_session",
        description=(
            "Full details of one session by code: description, all speakers, room, time, recording, and any official "
            "catalog change, with alternatives when the session is no longer in the catalog."
        ),
    )
    def conference_get_session(session_code: SessionCode, time_zone: TimeZone = "") -> ConferenceResult:
        return _result(service.with_user_zone(time_zone, lambda: service.get_session(session_code)))

    @mcp.tool(
        name="conference_recommend_sessions",
        description=(
            "Personalized path through the week: given the attendee's role (such as developer building contact-center "
            "agents, IT admin, business leader, partner) and interests as English keywords, returns a few non-overlapping "
            "sessions per day from the official catalog. Pass the current agenda so picks avoid clashes with it."
        ),
    )
    def conference_recommend_sessions(
        role: Annotated[str, Field(max_length=120, description="The attendee's role in their own words.")],
        interests: Annotated[str, Field(max_length=200, description="English keywords, such as voice agents contact center Foundry.")],
        agenda: Agenda,
        days: Annotated[str, Field(max_length=80, description="Optional days, comma-separated: weekday names, dates, today, tomorrow. Empty for the whole event.")] = "",
        attendance: Annotated[Literal["in_person", "online"], Field(description="in_person or online.")] = "in_person",
        per_day: Annotated[int, Field(ge=1, le=6)] = 3,
        time_zone: TimeZone = "",
    ) -> ConferenceResult:
        return _result(service.with_user_zone(time_zone, lambda: service.recommend_sessions(
            role, interests, days, attendance, per_day, list(agenda),
        )))

    @mcp.tool(
        name="conference_similar_sessions",
        description=(
            "Sessions similar to one session by topic, speakers, and content, for questions like what else to see "
            "after a session. The catalog has no attendance data, so present these as similar sessions, not as "
            "what other attendees chose."
        ),
    )
    def conference_similar_sessions(
        session_code: SessionCode,
        limit: Annotated[int, Field(ge=1, le=6)] = 3,
        time_zone: TimeZone = "",
    ) -> ConferenceResult:
        return _result(service.with_user_zone(time_zone, lambda: service.similar_sessions(session_code, limit)))

    @mcp.tool(
        name="conference_sessions_starting_soon",
        description="In-person sessions starting within the next N minutes of the current event time, soonest first.",
    )
    def conference_sessions_starting_soon(
        within_minutes: Annotated[int, Field(ge=1, le=240)] = 15,
        topic: Text = "",
        limit: Annotated[int, Field(ge=1, le=10)] = 3,
    ) -> ConferenceResult:
        return _result(service.sessions_starting_soon(within_minutes, topic, limit))

    @mcp.tool(
        name="conference_get_session_changes",
        description=(
            "Session changes. official_changes are real room changes, time changes, and sessions added to or "
            "removed from the official catalog, found by comparing the live catalog with the snapshot; items "
            "list the soonest upcoming first with original_location or original_time. Pass a session code to check "
            "one session."
        ),
    )
    def conference_get_session_changes(
        session_code: Annotated[str, Field(max_length=40)] = "",
        limit: Annotated[int, Field(ge=1, le=20)] = 5,
        time_zone: TimeZone = "",
    ) -> ConferenceResult:
        return _result(service.with_user_zone(time_zone, lambda: service.get_session_changes(session_code, limit)))

    @mcp.tool(
        name="conference_agenda_add",
        description=(
            "Add a session to the attendee's agenda. Returns the new agenda list, its items, and any time "
            "conflicts with a suggestion to watch a recorded session instead. Stateless: pass the current agenda."
        ),
    )
    def conference_agenda_add(session_code: SessionCode, agenda: Agenda, time_zone: TimeZone = "") -> ConferenceResult:
        return _result(service.with_user_zone(time_zone, lambda: service.agenda_add(session_code, list(agenda))))

    @mcp.tool(
        name="conference_agenda_remove",
        description="Remove a session from the attendee's agenda and return the new agenda. Stateless: pass the current agenda.",
    )
    def conference_agenda_remove(session_code: SessionCode, agenda: Agenda) -> ConferenceResult:
        return _result(service.agenda_remove(session_code, list(agenda)))

    @mcp.tool(
        name="conference_agenda_list",
        description="List the attendee's agenda in time order with conflicts and the next session (what's next for me). Stateless: pass the current agenda.",
    )
    def conference_agenda_list(agenda: Agenda, time_zone: TimeZone = "") -> ConferenceResult:
        return _result(service.with_user_zone(time_zone, lambda: service.agenda_list(list(agenda))))

    @mcp.tool(
        name="conference_get_faq",
        description=(
            "Answer attendee questions from the official event FAQ and event guide only: registration, passes and "
            "prices, online access, recordings, hotels, accessibility, health and safety, Digital Pass and ID, the "
            "mobile app, transfers and cancellations, badge pickup, shuttles, parking, security and bags, lunch, the "
            "Celebration, charging lounges, coffee, and where to find venue maps. found=false means it is not covered."
        ),
    )
    def conference_get_faq(question: Annotated[str, Field(min_length=2, max_length=300)]) -> ConferenceResult:
        return _result(service.get_faq(question))

