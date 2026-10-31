"""Stateless conference concierge logic over one dataset.

Nothing a caller sends is stored. The personal agenda is a list of session IDs that
the agent keeps in the conversation and passes to every agenda tool; each call returns
the updated list.
"""

from __future__ import annotations

import contextvars
import math
import os
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable, Mapping

from .dataset import Dataset, words

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]

AGENDA_LIMIT = 30
SEARCH_LIMIT = 10
OFFICIAL = "public catalog snapshot"

STOP_WORDS = frozenset(
    "a an and any about are at be by can could do does find for from get give have i in into is it its "
    "let look looking me my near of on or please session sessions show talk talks tell that the there "
    "this to want what whats which who will with would you your".split()
)
EXPANSIONS = {
    "voice": ("speech", "audio", "realtime", "real-time", "conversational"),
    "speech": ("voice", "audio"),
    "agent": ("agentic",),
    "agentic": ("agent",),
    "llm": ("model", "models"),
    "genai": ("generative",),
    "contact": ("call", "customer"),
}
PARTS_OF_DAY = {"morning": (0, 12), "afternoon": (12, 17), "evening": (17, 24)}
LEVELS = {
    "100": "(100) Foundational", "foundational": "(100) Foundational", "beginner": "(100) Foundational",
    "intro": "(100) Foundational", "introductory": "(100) Foundational",
    "200": "(200) Intermediate", "intermediate": "(200) Intermediate",
    "300": "(300) Advanced", "advanced": "(300) Advanced",
    "400": "(400) Expert", "expert": "(400) Expert", "deep": "(400) Expert",
}
SESSION_TYPES = (
    (("hands-on", "hands on", "lab", "labs", "workshop"), ("Lab", "Digital Lab")),
    (("lightning",), ("Lightning Talk",)),
    (("table", "roundtable", "round table"), ("Table Talk",)),
    (("theater", "theatre"), ("Theater",)),
    (("keynote",), ("Keynote",)),
    (("pre-recorded", "prerecorded", "recorded", "on demand", "on-demand"), ("Pre-recorded",)),
    (("broadcast",), ("Broadcast Stage",)),
    (("innovation",), ("Innovation Session",)),
    (("breakout",), ("Breakout",)),
)
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
MONTHS = ("january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december")
# Relative days in a few attendee languages; the model is asked for English, but this keeps one slip harmless.
RELATIVE_DAYS = {
    0: ("today", "now", "tonight", "今天", "今日", "今晚", "hoy", "aujourd'hui", "heute", "oggi", "hoje", "오늘"),
    1: ("tomorrow", "明天", "明日", "mañana", "manana", "demain", "morgen", "domani", "amanhã", "amanha", "내일"),
    2: ("day after tomorrow", "后天", "後天", "明後日", "pasado mañana", "après-demain", "übermorgen", "모레"),
    -1: ("yesterday", "昨天", "昨日", "ayer", "hier", "gestern", "ieri", "ontem", "어제"),
}
USER_ZONE_ALIASES = {
    "beijing": "Asia/Shanghai", "china": "Asia/Shanghai", "shanghai": "Asia/Shanghai", "北京": "Asia/Shanghai",
    "北京时间": "Asia/Shanghai", "中国": "Asia/Shanghai", "上海": "Asia/Shanghai", "hong kong": "Asia/Hong_Kong",
    "taipei": "Asia/Taipei", "singapore": "Asia/Singapore", "tokyo": "Asia/Tokyo", "japan": "Asia/Tokyo",
    "seoul": "Asia/Seoul", "korea": "Asia/Seoul", "india": "Asia/Kolkata", "bangalore": "Asia/Kolkata",
    "hyderabad": "Asia/Kolkata", "delhi": "Asia/Kolkata", "sydney": "Australia/Sydney", "london": "Europe/London",
    "uk": "Europe/London", "dublin": "Europe/Dublin", "paris": "Europe/Paris", "berlin": "Europe/Berlin",
    "munich": "Europe/Berlin", "germany": "Europe/Berlin", "madrid": "Europe/Madrid", "amsterdam": "Europe/Amsterdam",
    "seattle": "America/Los_Angeles", "redmond": "America/Los_Angeles", "san francisco": "America/Los_Angeles",
    "pacific": "America/Los_Angeles", "pt": "America/Los_Angeles", "new york": "America/New_York",
    "eastern": "America/New_York", "et": "America/New_York", "chicago": "America/Chicago", "central": "America/Chicago",
    "toronto": "America/Toronto", "mexico city": "America/Mexico_City", "sao paulo": "America/Sao_Paulo",
    "utc": "UTC", "gmt": "UTC",
}
_USER_ZONE: contextvars.ContextVar[tuple[Any, str] | None] = contextvars.ContextVar("conference_user_zone", default=None)
CJK_WEEKDAYS = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}


def _stem(token: str) -> str:
    return token[:-1] if len(token) > 3 and token.endswith("s") and not token.endswith("ss") else token


def _stems(text: str) -> set[str]:
    return {_stem(token) for token in words(text)}


def _error(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, **extra}


def _clock_text(value: datetime) -> str:
    hour = value.hour % 12 or 12
    suffix = "AM" if value.hour < 12 else "PM"
    return f"{hour}:{value.minute:02d} {suffix}"


def _day_text(value: datetime | date) -> str:
    return f"{WEEKDAYS[value.weekday()].title()}, {MONTHS[value.month - 1].title()} {value.day}"


class ConferenceService:
    def __init__(
        self,
        dataset: Dataset,
        *,
        clock: Callable[[], datetime] | None = None,
        environment: Mapping[str, str] | None = None,
    ) -> None:
        self.event = dataset.event
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._environment = os.environ if environment is None else environment
        self.zone = self._zone()
        self.zone_label = str(self.event.get("time_zone_label") or "")
        self.catalog_status: dict[str, Any] = {"mode": "snapshot"}
        self._baseline = list(dataset.sessions)
        self._first_seen: dict[str, tuple[Any, str]] = {}
        self._catalog_changes: dict[str, dict[str, Any]] = {}
        self._removed: dict[str, dict[str, Any]] = {}
        self._load(dataset)

    def _load(self, dataset: Dataset) -> None:
        """Index a dataset; called again when the live catalog refresh swaps in new sessions."""
        self.data = dataset
        self._index = {
            session["id"]: {
                "title": _stems(session["title"]),
                "description": _stems(session.get("description") or ""),
                "topics": _stems(" ".join(session.get("topics") or [])),
                "speakers": _stems(" ".join(session.get("speakers") or [])),
                "type": _stems(session.get("type") or ""),
            }
            for session in dataset.sessions
        }
        frequency: dict[str, int] = {}
        for fields in self._index.values():
            for token in set().union(*fields.values()):
                frequency[token] = frequency.get(token, 0) + 1
        total = max(1, len(dataset.sessions))
        self._idf = {token: math.log(1 + total / count) for token, count in frequency.items()}
        self._topics = sorted({topic for session in dataset.sessions for topic in session.get("topics") or []})
        self._types = sorted({session["type"] for session in dataset.sessions if session.get("type")})
        self._detect_catalog_changes()

    def replace_sessions(self, sessions: list[dict[str, Any]], status: dict[str, Any]) -> None:
        """Swap in a freshly fetched catalog; the FAQ stays as it is."""
        snapshot = {**self.data.snapshot, "count": len(sessions)}
        self._load(Dataset(
            name=self.data.name, event=self.data.event, snapshot=snapshot, sessions=sessions, faq=self.data.faq,
        ))
        self.catalog_status = status

    # ------------------------------------------------------------------ attendee time zone

    def resolve_user_zone(self, text: str) -> tuple[Any, str] | None:
        """An attendee's time zone from an IANA name, a common city or country name, or UTC+8 style offset."""
        value = str(text or "").strip()
        if not value:
            return None
        alias = USER_ZONE_ALIASES.get(value.lower().replace("_", " "))
        if alias:
            value = alias
        match = re.fullmatch(r"(?i)(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?", value)
        if match:
            sign = -1 if match.group(1) == "-" else 1
            offset = timedelta(hours=int(match.group(2)), minutes=int(match.group(3) or 0))
            return timezone(sign * offset), f"UTC{match.group(1)}{int(match.group(2))}"
        if ZoneInfo is not None:
            try:
                return ZoneInfo(value), value
            except Exception:
                return None
        return None

    def with_user_zone(self, time_zone: str, call: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        """Run a tool call so that every session it returns also carries the attendee's local time."""
        if not str(time_zone or "").strip():
            return call()
        resolved = self.resolve_user_zone(time_zone)
        if resolved is None:
            return {"tool": "", "ok": False, "error": _error(
                "unknown_time_zone",
                "Use an IANA name such as Asia/Shanghai or Europe/London, a city such as Beijing, or UTC+8."),
            }
        token = _USER_ZONE.set(resolved)
        try:
            result = call()
        finally:
            _USER_ZONE.reset(token)
        result["user_time_zone"] = resolved[1]
        return result

    # ------------------------------------------------------------------ clock and time

    def _zone(self) -> timezone | Any:
        name = str(self.event.get("time_zone") or "UTC")
        if ZoneInfo is not None:
            try:
                return ZoneInfo(name)
            except Exception:
                pass
        match = re.fullmatch(r"([+-])(\d{2}):(\d{2})", str(self.event.get("utc_offset_fallback") or "+00:00"))
        if not match:
            return timezone.utc
        sign = -1 if match.group(1) == "-" else 1
        return timezone(sign * timedelta(hours=int(match.group(2)), minutes=int(match.group(3))))

    def _event_dates(self) -> tuple[date, date]:
        dates = self.event.get("dates") or {}
        return date.fromisoformat(dates["start"]), date.fromisoformat(dates["end"])

    def _parse_local(self, value: str) -> datetime:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=self.zone)
        return parsed.astimezone(self.zone)

    def clock(self) -> dict[str, Any]:
        """The real time in the event time zone; CONFERENCE_NOW fixes it for tests and rehearsals."""
        override = str(self._environment.get("CONFERENCE_NOW") or "").strip()
        if override:
            return {"now": self._parse_local(override), "simulated": True, "note": "Set by CONFERENCE_NOW."}
        return {"now": self._clock().astimezone(self.zone), "simulated": False, "note": ""}

    def _event_phase(self, now: datetime) -> str:
        first, last = self._event_dates()
        if now.date() < first:
            return "before_event"
        return "after_event" if now.date() > last else "during_event"

    def now(self) -> datetime:
        return self.clock()["now"]

    def _local(self, value: str | None) -> datetime | None:
        if not value:
            return None
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(self.zone)

    def _when(self, value: datetime) -> str:
        return f"{_day_text(value)}, {_clock_text(value)} {self.zone_label}".strip()

    def _clock_view(self) -> dict[str, Any]:
        clock = self.clock()
        view = {
            "now_local": self._when(clock["now"]),
            "date": clock["now"].date().isoformat(),
            "event_phase": self._event_phase(clock["now"]),
            "simulated": clock["simulated"],
        }
        if clock["note"]:
            view["note"] = clock["note"]
        user_zone = _USER_ZONE.get()
        if user_zone:
            local = clock["now"].astimezone(user_zone[0])
            view["now_your_time"] = f"{_day_text(local)}, {_clock_text(local)} ({user_zone[1]})"
        return view

    def _parse_day(self, text: str) -> date | None:
        value = text.strip().lower().replace(",", " ")
        if not value:
            return None
        today = self.now().date()
        for offset, names in sorted(RELATIVE_DAYS.items(), key=lambda item: -item[0]):
            if value in names:
                return today + timedelta(days=offset)
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            pass
        first, last = self._event_dates()
        match = re.fullmatch(r"(?:星期|周|週|礼拜|禮拜)([一二三四五六日天])", value)
        if match:
            index = CJK_WEEKDAYS[match.group(1)]
            for offset in range((last - first).days + 1):
                candidate = first + timedelta(days=offset)
                if candidate.weekday() == index:
                    return candidate
        for index, name in enumerate(WEEKDAYS):
            if value == name or value == name[:3] or value.startswith(name):
                for offset in range((last - first).days + 1):
                    candidate = first + timedelta(days=offset)
                    if candidate.weekday() == index:
                        return candidate
                ahead = (index - today.weekday()) % 7
                return today + timedelta(days=ahead)
        match = re.search(r"(\d{1,2})", value)
        if match:
            month = next(
                (number for number, name in enumerate(MONTHS, 1) if name[:3] in value),
                first.month,
            )
            try:
                return date(first.year, month, int(match.group(1)))
            except ValueError:
                return None
        return None

    @staticmethod
    def _parse_time(text: str) -> time | None:
        value = text.strip().lower().replace(".", "")
        if not value:
            return None
        if value in {"noon", "midday"}:
            return time(12, 0)
        match = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?", value)
        if not match:
            try:
                return time.fromisoformat(value)
            except ValueError:
                return None
        hour, minute = int(match.group(1)), int(match.group(2) or 0)
        suffix = match.group(3) or ""
        if suffix.startswith("p") and hour < 12:
            hour += 12
        if suffix.startswith("a") and hour == 12:
            hour = 0
        if hour > 23 or minute > 59:
            return None
        return time(hour, minute)

    # ------------------------------------------------------------------ sessions

    def _catalog_change(self, session: dict[str, Any]) -> dict[str, Any] | None:
        """A change detected by comparing the live catalog with the snapshot baseline, if any."""
        instance = session.get("instance_id")
        return self._catalog_changes.get(instance) if instance else None

    def _status(self, session: dict[str, Any]) -> str:
        detected = self._catalog_change(session)
        if detected and detected["kind"] == "removed":
            return "removed_from_catalog"
        if detected and detected["kind"] in {"room_change", "time_change"}:
            return "room_and_time_change" if detected.get("also") else str(detected["kind"])
        return "scheduled"

    @staticmethod
    def _location(session: dict[str, Any]) -> str:
        return session.get("location") or ""

    def _session_index(self, session: dict[str, Any]) -> dict[str, set[str]]:
        """Search tokens of a session, including one that is no longer in the loaded catalog."""
        return self._index.get(session["id"]) or {
            "title": _stems(session["title"]),
            "description": _stems(session.get("description") or ""),
            "topics": _stems(" ".join(session.get("topics") or [])),
            "speakers": _stems(" ".join(session.get("speakers") or [])),
            "type": _stems(session.get("type") or ""),
        }

    def _detect_catalog_changes(self) -> None:
        """Compare the loaded catalog with the snapshot baseline by the stable catalog instance ID.

        Room and time changes, new sessions, and sessions removed from the catalog are real
        official data. A removal is not necessarily a cancellation; the session may have been
        merged or renumbered.
        """
        baseline = {item["instance_id"]: item for item in self._baseline if item.get("instance_id")}
        live = {item["instance_id"]: item for item in self.data.sessions if item.get("instance_id")}
        detected: dict[str, dict[str, Any]] = {}
        now = self._clock().astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        for instance, session in live.items():
            before = baseline.get(instance)
            if before is None:
                detected[instance] = {"kind": "added", "session": session}
                continue
            moved = bool(before.get("location") and session.get("location") and before["location"] != session["location"])
            retimed = bool(before.get("start") and session.get("start") and before["start"] != session["start"])
            if moved or retimed:
                change = {"kind": "room_change" if moved else "time_change", "session": session, "before": before}
                if moved and retimed:
                    change["also"] = "time_change"
                detected[instance] = change
        for instance, before in baseline.items():
            if instance not in live:
                detected[instance] = {"kind": "removed", "session": before, "before": before}
        for instance, change in detected.items():
            signature = (change["kind"], change["session"].get("location"), change["session"].get("start"))
            first = self._first_seen.get(instance)
            if first is None or first[0] != signature:
                self._first_seen[instance] = (signature, now)
            change["detected_utc"] = self._first_seen[instance][1]
        self._catalog_changes = detected
        self._removed = {
            change["session"]["id"].upper(): change["session"]
            for change in detected.values() if change["kind"] == "removed"
        }

    def _catalog_change_view(self, change: dict[str, Any]) -> dict[str, Any]:
        session = change["session"]
        view = self.brief(session)
        view["change_source"] = "official catalog (detected by comparing catalog versions)"
        view["detected_utc"] = change.get("detected_utc")
        if change["kind"] == "removed":
            view["note"] = "No longer in the official catalog; it may be cancelled, merged, or renumbered."
            view["alternatives"] = [self.brief(item) for item in self._alternatives(session)]
        if change["kind"] == "added":
            view["status"] = "new_in_catalog"
        return view

    def brief(self, session: dict[str, Any]) -> dict[str, Any]:
        start, end = self._local(session.get("start")), self._local(session.get("end"))
        delivery = session.get("delivery") or []
        view: dict[str, Any] = {
            "id": session["id"],
            "code": session["code"],
            "title": session["title"],
            "day": _day_text(start) if start else "On demand",
            "start": _clock_text(start) if start else None,
            "end": _clock_text(end) if end else None,
            "location": self._location(session) or ("Online" if "Online" in delivery else ""),
            "type": session.get("type") or "",
            "level": session.get("level") or "",
            "speakers": (session.get("speakers") or [])[:3],
            "in_person": "In-person" in delivery,
            "online": "Online" in delivery,
            "recorded": session.get("recorded"),
            "status": self._status(session),
        }
        user_zone = _USER_ZONE.get()
        if user_zone and start:
            local_start = start.astimezone(user_zone[0])
            view["your_time"] = f"{_day_text(local_start)}, {_clock_text(local_start)} ({user_zone[1]})"
        detected = self._catalog_change(session)
        if detected and detected["kind"] != "added":
            before = detected.get("before") or {}
            if before.get("location") and before.get("location") != session.get("location"):
                view["original_location"] = before["location"]
            if before.get("start") and before.get("start") != session.get("start"):
                old = self._local(before.get("start"))
                view["original_time"] = f"{_day_text(old)}, {_clock_text(old)}" if old else ""
            view["change_data"] = "official catalog"
        return view

    def detail(self, session: dict[str, Any]) -> dict[str, Any]:
        view = self.brief(session)
        view.update({
            "description": session.get("description") or "",
            "speakers": session.get("speakers") or [],
            "topics": session.get("topics") or [],
            "audience": session.get("audience") or [],
            "seating": session.get("seating") or "",
            "duration_minutes": session.get("duration_minutes"),
            "catalog_last_update": session.get("last_update"),
        })
        return view

    def _resolve(self, code: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        key = re.sub(r"[\s_]+", "", str(code or "")).upper()
        if key in self.data.by_id:
            return self.data.by_id[key], []
        instances = self.data.by_code.get(key) or []
        if len(instances) == 1:
            return instances[0], []
        if not instances:
            # Sessions that have disappeared from the live catalog stay resolvable so the agent can say so.
            if key in self._removed:
                return self._removed[key], []
            removed = [session for session in self._removed.values() if session["code"].upper() == key]
            if len(removed) == 1:
                return removed[0], []
        return None, instances

    def _not_found(self, tool: str, code: str) -> dict[str, Any]:
        return self._result(tool, ok=False, error=_error(
            "session_not_found",
            f"No session with code {code!r} is in the catalog. Search by topic or title instead.",
        ))

    def _choose_instance(self, tool: str, code: str, instances: list[dict[str, Any]]) -> dict[str, Any]:
        return self._result(tool, ok=False, error=_error(
            "choose_instance",
            f"{code} runs {len(instances)} times; ask which one and pass its id.",
        ), options=[self.brief(item) for item in instances])

    @staticmethod
    def _result(tool: str, *, ok: bool = True, error: dict[str, Any] | None = None, **fields: Any) -> dict[str, Any]:
        return {"tool": tool, "ok": ok, "error": error, **fields}

    def _type_filter(self, text: str) -> tuple[str, ...] | None:
        value = text.strip().lower()
        for names, types in SESSION_TYPES:
            if any(name in value for name in names):
                return types
        exact = [kind for kind in self._types if kind.lower() == value]
        return tuple(exact) or None

    def _topic_filter(self, text: str) -> list[str]:
        value = text.strip().lower()
        return [topic for topic in self._topics if value and (value in topic.lower() or topic.lower() in value)]

    def _score(self, session: dict[str, Any], tokens: list[str], phrase: str) -> float:
        if not tokens:
            return 1.0
        index = self._session_index(session)
        score = 0.0
        for token in tokens:
            if token == session["code"].lower() or token == session["id"].lower():
                score += 20
            weights = (("title", 3.0), ("speakers", 3.0), ("topics", 2.0), ("type", 2.0), ("description", 1.0))
            hit = self._idf.get(token, 0.0) * max(
                (weight for field, weight in weights if token in index[field]), default=0.0,
            )
            if not hit:
                hit = 0.5 * max(
                    (
                        self._idf.get(_stem(expansion), 0.0) * weight
                        for expansion in EXPANSIONS.get(token, ())
                        for field, weight in weights
                        if _stem(expansion) in index[field]
                    ),
                    default=0.0,
                )
            score += hit
        if phrase and len(tokens) > 1 and phrase in session["title"].lower():
            score += 5
        return score

    def search_sessions(
        self,
        query: str = "",
        day: str = "",
        part_of_day: str = "",
        start_after: str = "",
        start_before: str = "",
        topic: str = "",
        level: str = "",
        session_type: str = "",
        speaker: str = "",
        attendance: str = "",
        recorded: bool | None = None,
        limit: int = 3,
    ) -> dict[str, Any]:
        tool = "conference_search_sessions"
        filters: dict[str, Any] = {}
        terms = query
        wanted_day = self._parse_day(day)
        if day.strip() and wanted_day is None:
            return self._result(tool, ok=False, error=_error(
                "invalid_day", "Use a date (YYYY-MM-DD), a weekday, today, or tomorrow."))
        if wanted_day:
            filters["day"] = _day_text(wanted_day)
        hours = PARTS_OF_DAY.get(part_of_day.strip().lower()) if part_of_day.strip() else None
        if part_of_day.strip() and hours is None:
            return self._result(tool, ok=False, error=_error(
                "invalid_part_of_day", "Use morning, afternoon, or evening."))
        if hours:
            filters["part_of_day"] = part_of_day.strip().lower()
        after, before = self._parse_time(start_after), self._parse_time(start_before)
        if (start_after.strip() and after is None) or (start_before.strip() and before is None):
            return self._result(tool, ok=False, error=_error("invalid_time", "Use times such as 14:00 or 2 PM."))
        if after:
            filters["start_after"] = _clock_text(datetime.combine(date.today(), after))
        if before:
            filters["start_before"] = _clock_text(datetime.combine(date.today(), before))
        topics = self._topic_filter(topic) if topic.strip() else []
        if topic.strip() and not topics:
            terms = f"{terms} {topic}"
        if topics:
            filters["topic"] = topics
        wanted_level = None
        if level.strip():
            wanted_level = next(
                (value for key, value in LEVELS.items() if key in words(level) or key == level.strip().lower()),
                None,
            )
            if wanted_level is None:
                return self._result(tool, ok=False, error=_error(
                    "invalid_level", "Use 100 Foundational, 200 Intermediate, 300 Advanced, or 400 Expert."))
            filters["level"] = wanted_level
        types = self._type_filter(session_type) if session_type.strip() else None
        if session_type.strip() and types is None:
            return self._result(tool, ok=False, error=_error(
                "invalid_session_type", "Valid session types: " + ", ".join(self._types)))
        if types:
            filters["session_type"] = list(types)
        speaker_tokens = words(speaker)
        if speaker_tokens:
            filters["speaker"] = speaker.strip()
        mode = attendance.strip().lower().replace("-", "_").replace(" ", "_")
        if mode in {"digital", "virtual", "remote"}:
            mode = "online"
        if mode and mode not in {"in_person", "online"}:
            return self._result(tool, ok=False, error=_error("invalid_attendance", "Use in_person or online."))
        if mode:
            filters["attendance"] = mode
        if recorded is not None:
            filters["recorded"] = recorded
        tokens = [_stem(token) for token in words(terms) if token not in STOP_WORDS]
        if not tokens and any(ord(char) > 127 and char.isalpha() for char in terms):
            return self._result(tool, ok=False, error=_error(
                "english_keywords_required",
                "The catalog is in English. Translate the search words into English keywords and search again."))
        if tokens:
            filters["query"] = " ".join(words(terms))
        phrase = " ".join(words(query))
        matches = []
        for session in self.data.sessions:
            start = self._local(session.get("start"))
            if wanted_day and (start is None or start.date() != wanted_day):
                continue
            if (hours or after or before) and start is None:
                continue
            if hours and not hours[0] <= start.hour < hours[1]:
                continue
            if after and start.time() < after:
                continue
            if before and start.time() > before:
                continue
            if topics and not set(topics) & set(session.get("topics") or []):
                continue
            if wanted_level and session.get("level") != wanted_level:
                continue
            if types and session.get("type") not in types:
                continue
            if speaker_tokens:
                names = [set(words(name)) for name in session.get("speakers") or []]
                if not any(set(speaker_tokens) <= name for name in names):
                    continue
            delivery = session.get("delivery") or []
            if mode == "in_person" and "In-person" not in delivery:
                continue
            if mode == "online" and "Online" not in delivery:
                continue
            if recorded is not None and bool(session.get("recorded")) != recorded:
                continue
            score = self._score(session, tokens, phrase)
            if score <= 0:
                continue
            matches.append((-score, session.get("start") or "9999", session["id"], session))
        if tokens and matches:
            # Keep relevant matches only: a session matching just a common word is noise.
            best = max(-item[0] for item in matches)
            matches = [item for item in matches if -item[0] >= best * 0.4]
        matches.sort(key=lambda item: item[:3])
        count = max(1, min(int(limit or 3), SEARCH_LIMIT))
        result = self._result(
            tool,
            total_matches=len(matches),
            returned=min(count, len(matches)),
            filters=filters,
            sessions=[self.brief(item[-1]) for item in matches[:count]],
            data_source=OFFICIAL,
        )
        if wanted_day or not matches:
            result["clock"] = self._clock_view()
        return result

    def get_session(self, session_code: str) -> dict[str, Any]:
        tool = "conference_get_session"
        session, instances = self._resolve(session_code)
        if session is None and not instances:
            return self._not_found(tool, session_code)
        if session is None:
            return self._result(
                tool,
                session=self.detail(instances[0]),
                instances=[self.brief(item) for item in instances],
                note=f"{session_code.upper()} runs {len(instances)} times; ids are listed in instances.",
                data_source=OFFICIAL,
            )
        result = self._result(tool, session=self.detail(session), data_source=OFFICIAL)
        if self._status(session) == "removed_from_catalog":
            result["alternatives"] = [self.brief(item) for item in self._alternatives(session)]
        return result

    def _alternatives(self, session: dict[str, Any], count: int = 2) -> list[dict[str, Any]]:
        start = self._local(session.get("start"))
        if start is None:
            return []
        topics = set(session.get("topics") or [])
        title = self._session_index(session)["title"] - STOP_WORDS
        scored = []
        for other in self.data.sessions:
            if other["id"] == session["id"] or other["code"] == session["code"]:
                continue
            other_start = self._local(other.get("start"))
            if other_start is None or "In-person" not in (other.get("delivery") or []):
                continue
            offset = (other_start - start).total_seconds() / 60
            if not -15 <= offset <= 45:
                continue
            shared = 2 * len(topics & set(other.get("topics") or [])) + len(title & self._index[other["id"]]["title"])
            if shared:
                scored.append((-shared, abs(offset), other["id"], other))
        scored.sort(key=lambda item: item[:3])
        return [item[-1] for item in scored[:count]]

    def sessions_starting_soon(self, within_minutes: int = 15, topic: str = "", limit: int = 3) -> dict[str, Any]:
        tool = "conference_sessions_starting_soon"
        now = self.now()
        window_end = now + timedelta(minutes=max(1, min(int(within_minutes or 15), 240)))
        topics = self._topic_filter(topic) if topic.strip() else []
        topic_tokens = [_stem(token) for token in words(topic) if token not in STOP_WORDS] if topic.strip() and not topics else []
        upcoming = []
        next_start: datetime | None = None
        for session in self.data.sessions:
            start = self._local(session.get("start"))
            if start is None or start < now or not self._location(session):
                continue
            if topics and not set(topics) & set(session.get("topics") or []):
                continue
            if topic_tokens and self._score(session, topic_tokens, "") <= 0:
                continue
            if start > window_end:
                if next_start is None or start < next_start:
                    next_start = start
                continue
            upcoming.append((start, session["id"], session))
        upcoming.sort(key=lambda item: item[:2])
        count = max(1, min(int(limit or 3), SEARCH_LIMIT))
        sessions = []
        for start, _, session in upcoming[:count]:
            view = self.brief(session)
            view["starts_in_minutes"] = max(0, round((start - now).total_seconds() / 60))
            sessions.append(view)
        result = self._result(
            tool,
            clock=self._clock_view(),
            within_minutes=int((window_end - now).total_seconds() // 60),
            total_matches=len(upcoming),
            sessions=sessions,
            data_source=OFFICIAL,
        )
        if not upcoming and next_start:
            result["next_start"] = self._when(next_start)
        return result

    def get_session_changes(self, session_code: str = "", limit: int = 5) -> dict[str, Any]:
        tool = "conference_get_session_changes"
        selected = None
        if session_code.strip():
            selected, instances = self._resolve(session_code)
            if selected is None and not instances:
                return self._not_found(tool, session_code)
            chosen = [selected] if selected else instances
            instance_ids = {item.get("instance_id") for item in chosen if item.get("instance_id")}
        # Official changes: the live catalog compared with the snapshot baseline.
        official = []
        counts: dict[str, int] = {}
        now = self.now()
        for instance, change in self._catalog_changes.items():
            if session_code.strip() and instance not in instance_ids:
                continue
            counts[change["kind"]] = counts.get(change["kind"], 0) + 1
            start = self._local(change["session"].get("start"))
            upcoming = start is not None and start >= now
            order = (change["kind"] == "added", not upcoming, change["session"].get("start") or "9999", change["session"]["id"])
            official.append((order, change))
        official.sort(key=lambda item: item[0])
        count = max(1, min(int(limit or 5), 20))
        result = self._result(
            tool,
            official_changes={
                "counts": counts,
                "total": sum(counts.values()),
                "items": [self._catalog_change_view(change) for _, change in official[:count]],
                "since": self.data.snapshot.get("snapshot_utc"),
                "source": "official catalog: the live catalog compared with the snapshot",
            },
            notice=(
                "These are real room, time, and listing changes in the official catalog. There is no official feed "
                "for full rooms or cancellations; a session removed from the catalog may be cancelled, merged, or renumbered."
            ),
        )
        if self.catalog_status.get("mode") != "live":
            result["official_changes"]["note"] = "The live catalog has not been loaded, so no official changes are known yet."
        if session_code.strip() and not official:
            result["message"] = "No known change for this session; it runs as scheduled."
        return result

    # ------------------------------------------------------------------ recommendations

    def _role_profile(self, role: str) -> dict[str, Any]:
        tokens = set(words(role))
        profile: dict[str, Any] = {"audience": set(), "types": set(), "levels": set(), "label": []}
        if tokens & {"developer", "dev", "engineer", "programmer", "coder", "architect", "builder", "maker"}:
            profile["audience"] |= {"Technical Practitioner"}
            profile["types"] |= {"Lab", "Breakout", "Theater"}
            profile["levels"] |= {"(300) Advanced", "(400) Expert", "(200) Intermediate"}
            profile["label"].append("developer")
        if tokens & {"it", "admin", "administrator", "ops", "operations", "sre", "devops", "security", "analyst"}:
            profile["audience"] |= {"Technical Practitioner", "Technical Decision Maker"}
            profile["types"] |= {"Breakout", "Lab", "Theater"}
            profile["label"].append("IT practitioner")
        if tokens & {"manager", "lead", "leader", "director", "executive", "cto", "cio", "ceo", "vp", "business",
                     "decision", "product", "pm", "sales", "marketing"}:
            profile["audience"] |= {"Business Decision Maker", "Technical Decision Maker"}
            profile["types"] |= {"Breakout", "Innovation Session", "Keynote", "Table Talk"}
            profile["levels"] |= {"(100) Foundational", "(200) Intermediate"}
            profile["label"].append("decision maker")
        if tokens & {"partner", "partners", "reseller", "isv", "csp", "consultant", "consulting"}:
            profile["audience"] |= {"Partner Business"}
            profile["label"].append("partner")
        return profile

    def _interest_score(self, session: dict[str, Any], tokens: list[str], phrase: str, profile: dict[str, Any]) -> float:
        score = self._score(session, tokens, phrase) if tokens else 0.0
        if tokens and score <= 0:
            return 0.0
        if profile["audience"] & set(session.get("audience") or []):
            score += 2
        if session.get("type") in profile["types"]:
            score += 1.5
        if session.get("level") in profile["levels"]:
            score += 1
        if session.get("type") == "Keynote":
            score += 3
        return score

    def recommend_sessions(
        self,
        role: str = "",
        interests: str = "",
        days: str = "",
        attendance: str = "in_person",
        per_day: int = 3,
        agenda: list[str] | None = None,
    ) -> dict[str, Any]:
        tool = "conference_recommend_sessions"
        first, last = self._event_dates()
        wanted_days: list[date] = []
        for part in [part.strip() for part in re.split(r"[,;/]| and ", str(days or "")) if part.strip()]:
            parsed = self._parse_day(part)
            if parsed is None:
                return self._result(tool, ok=False, error=_error(
                    "invalid_day", "Use dates (YYYY-MM-DD), weekdays, today, or tomorrow, separated by commas."))
            wanted_days.append(parsed)
        if not wanted_days:
            wanted_days = [first + timedelta(days=offset) for offset in range((last - first).days + 1)]
        tokens = [_stem(token) for token in words(interests) if token not in STOP_WORDS]
        if not tokens and not str(role or "").strip():
            return self._result(tool, ok=False, error=_error(
                "need_role_or_interests", "Ask the attendee for their role and what they want to learn."))
        if not tokens and any(ord(char) > 127 and char.isalpha() for char in interests):
            return self._result(tool, ok=False, error=_error(
                "english_keywords_required", "Translate the interests into English keywords and call again."))
        mode = str(attendance or "in_person").strip().lower().replace("-", "_").replace(" ", "_")
        mode = "online" if mode in {"online", "digital", "virtual", "remote"} else "in_person"
        profile = self._role_profile(role)
        phrase = " ".join(words(interests))
        booked, _ = self._agenda(agenda or [])
        count = max(1, min(int(per_day or 3), 6))
        plan = []
        for day in sorted(set(wanted_days)):
            candidates = []
            for session in self.data.sessions:
                start = self._local(session.get("start"))
                if start is None or start.date() != day:
                    continue
                delivery = session.get("delivery") or []
                if mode == "in_person" and "In-person" not in delivery:
                    continue
                if mode == "online" and "Online" not in delivery:
                    continue
                score = self._interest_score(session, tokens, phrase, profile)
                if score > 0:
                    candidates.append((-score, session.get("start") or "", session["id"], session))
            candidates.sort(key=lambda item: item[:3])
            chosen: list[dict[str, Any]] = []
            seen_codes = {session["code"] for session in booked}
            for _, _, _, session in candidates:
                if session["code"] in seen_codes:
                    continue
                if any(self._overlap(session, other) for other in [*chosen, *booked]):
                    continue
                chosen.append(session)
                seen_codes.add(session["code"])
                if len(chosen) >= count:
                    break
            chosen.sort(key=lambda item: item.get("start") or "")
            if chosen:
                plan.append({"day": _day_text(day), "sessions": [self.brief(session) for session in chosen]})
        return self._result(
            tool,
            role_profile=profile["label"] or ["general"],
            interests=phrase,
            attendance=mode,
            plan=plan,
            basis="Ranked from the official catalog by interest keywords, role, audience, type, and level, with no time overlaps "
                  "with each other or with the agenda passed in.",
            data_source=OFFICIAL,
        )

    def similar_sessions(self, session_code: str, limit: int = 3) -> dict[str, Any]:
        tool = "conference_similar_sessions"
        session, instances = self._resolve(session_code)
        if session is None and not instances:
            return self._not_found(tool, session_code)
        session = session or instances[0]
        base = self._session_index(session)
        content = (base["title"] | base["description"]) - STOP_WORDS
        speakers = set(session.get("speakers") or [])
        topics = set(session.get("topics") or [])
        scored = []
        for other in self.data.sessions:
            if other["code"] == session["code"]:
                continue
            index = self._index[other["id"]]
            shared = content & (index["title"] | index["description"])
            score = sum(self._idf.get(token, 0.0) for token in shared)
            score += 3 * len(topics & set(other.get("topics") or []))
            score += 6 * len(speakers & set(other.get("speakers") or []))
            if score > 0:
                scored.append((-score, other.get("start") or "9999", other["id"], other))
        scored.sort(key=lambda item: item[:3])
        picked, codes = [], set()
        for *_, other in scored:
            if other["code"] in codes:
                continue
            codes.add(other["code"])
            picked.append(other)
            if len(picked) >= max(1, min(int(limit or 3), 6)):
                break
        return self._result(
            tool,
            session=self.brief(session),
            similar=[self.brief(item) for item in picked],
            basis="Similar topics, speakers, and content in the official catalog. There is no attendance data, so this "
                  "is not who-attended-what; say these are similar sessions.",
            data_source=OFFICIAL,
        )

    # ------------------------------------------------------------------ event info

    def get_event_info(self) -> dict[str, Any]:
        first, last = self._event_dates()
        keynotes = [self.brief(session) for session in self.data.sessions if session.get("type") == "Keynote"]
        days = []
        for offset in range((last - first).days + 1):
            day = first + timedelta(days=offset)
            count = sum(
                1 for session in self.data.sessions
                if (start := self._local(session.get("start"))) and start.date() == day
            )
            days.append({"date": day.isoformat(), "day": _day_text(day), "sessions": count})
        return self._result(
            "conference_get_event_info",
            event=self.event.get("name"),
            city=self.event.get("city"),
            venue=self.event.get("venue_summary"),
            dates={"start": _day_text(first), "end": _day_text(last)},
            time_zone=self.zone_label or str(self.event.get("time_zone")),
            official_site=self.event.get("official_site"),
            clock=self._clock_view(),
            days=days,
            keynotes=keynotes,
            topics=self._topics,
            session_types=self._types,
            levels=sorted(set(LEVELS.values())),
            data_notes=self.event.get("facts_source"),
            catalog_snapshot={
                "taken_utc": self.data.snapshot.get("snapshot_utc"),
                "sessions": self.data.snapshot.get("count"),
                "source": self.data.snapshot.get("source"),
                **self.catalog_status,
            },
            dev_mode=self.event.get("dev_mode") or {},
        )

    # ------------------------------------------------------------------ agenda (stateless)

    def _agenda(self, agenda: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
        sessions, ignored, seen = [], [], set()
        items = [str(item)[:40] for item in agenda or []]
        if len(items) > AGENDA_LIMIT:
            ignored = items[AGENDA_LIMIT:]
            items = items[:AGENDA_LIMIT]
        for item in items:
            session, _ = self._resolve(item)
            if session is None:
                ignored.append(str(item))
            elif session["id"] not in seen:
                seen.add(session["id"])
                sessions.append(session)
        sessions.sort(key=lambda session: (session.get("start") or "9999", session["id"]))
        return sessions, ignored

    def _overlap(self, first: dict[str, Any], second: dict[str, Any]) -> int:
        a_start, a_end = self._local(first.get("start")), self._local(first.get("end"))
        b_start, b_end = self._local(second.get("start")), self._local(second.get("end"))
        if not (a_start and a_end and b_start and b_end):
            return 0
        return max(0, int((min(a_end, b_end) - max(a_start, b_start)).total_seconds() // 60))

    def _conflicts(self, sessions: list[dict[str, Any]], focus: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        conflicts = []
        for index, first in enumerate(sessions):
            for second in sessions[index + 1:]:
                if focus is not None and focus["id"] not in {first["id"], second["id"]}:
                    continue
                minutes = self._overlap(first, second)
                if minutes:
                    recorded = [item["id"] for item in (first, second) if item.get("recorded")]
                    conflict = {
                        "sessions": [first["id"], second["id"]],
                        "titles": [first["title"], second["title"]],
                        "overlap_minutes": minutes,
                        "recorded": recorded,
                    }
                    if recorded:
                        conflict["suggestion"] = (
                            f"Attend the other one live and watch {recorded[-1]} on demand later."
                            if len(recorded) == 1 else
                            "Both are recorded; attend one live and watch the other on demand."
                        )
                    else:
                        conflict["suggestion"] = "Neither is recorded; the attendee has to pick one."
                    conflicts.append(conflict)
        return conflicts

    def _agenda_view(self, tool: str, sessions: list[dict[str, Any]], ignored: list[str], **fields: Any) -> dict[str, Any]:
        result = self._result(
            tool,
            agenda=[session["id"] for session in sessions],
            items=[self.brief(session) for session in sessions],
            **fields,
        )
        if ignored:
            result["ignored"] = ignored
        return result

    def agenda_add(self, session_code: str, agenda: list[str]) -> dict[str, Any]:
        tool = "conference_agenda_add"
        sessions, ignored = self._agenda(agenda)
        session, instances = self._resolve(session_code)
        if session is None and not instances:
            return self._not_found(tool, session_code)
        if session is None:
            return self._choose_instance(tool, session_code.upper(), instances)
        if self._status(session) == "removed_from_catalog":
            error = _error("session_removed", f"{session['id']} is no longer in the official catalog.")
            return self._result(tool, ok=False, error=error,
                agenda=[item["id"] for item in sessions],
                alternatives=[self.brief(item) for item in self._alternatives(session)])
        already = any(item["id"] == session["id"] for item in sessions)
        if not already:
            if len(sessions) >= AGENDA_LIMIT:
                return self._result(tool, ok=False, error=_error(
                    "agenda_full", f"An agenda holds at most {AGENDA_LIMIT} sessions."),
                    agenda=[item["id"] for item in sessions])
            sessions.append(session)
            sessions.sort(key=lambda item: (item.get("start") or "9999", item["id"]))
        return self._agenda_view(
            tool, sessions, ignored,
            added=self.brief(session),
            already_in_agenda=already,
            conflicts=self._conflicts(sessions, focus=session),
        )

    def agenda_remove(self, session_code: str, agenda: list[str]) -> dict[str, Any]:
        tool = "conference_agenda_remove"
        sessions, ignored = self._agenda(agenda)
        key = re.sub(r"[\s_]+", "", str(session_code or "")).upper()
        kept = [item for item in sessions if key not in {item["id"].upper(), item["code"].upper()}]
        removed = [item for item in sessions if item not in kept]
        if not removed:
            return self._result(tool, ok=False, error=_error(
                "not_in_agenda", f"{session_code} is not in the agenda."),
                agenda=[item["id"] for item in sessions])
        return self._agenda_view(tool, kept, ignored, removed=[self.brief(item) for item in removed])

    def agenda_list(self, agenda: list[str]) -> dict[str, Any]:
        sessions, ignored = self._agenda(agenda)
        now = self.now()
        next_up = None
        for session in sessions:
            start, end = self._local(session.get("start")), self._local(session.get("end"))
            if start and end and end > now:
                next_up = self.brief(session)
                next_up["starts_in_minutes"] = round((start - now).total_seconds() / 60)
                next_up["in_progress"] = start <= now
                break
        return self._agenda_view(
            "conference_agenda_list", sessions, ignored,
            conflicts=self._conflicts(sessions),
            next_up=next_up,
            clock=self._clock_view(),
        )

    # ------------------------------------------------------------------ FAQ

    @staticmethod
    def _alias_hit(text: str, alias: str) -> bool:
        return bool(re.search(r"(?<![a-z0-9])" + re.escape(alias.lower()) + r"(?![a-z0-9])", text))

    def get_faq(self, question: str) -> dict[str, Any]:
        tool = "conference_get_faq"
        tokens = {_stem(token) for token in words(question) if token not in STOP_WORDS | {"where", "how", "when"}}
        text = str(question or "").lower()
        scored = []
        for entry in self.data.faq:
            keywords = {keyword.lower() for keyword in entry.get("keywords") or []}
            phrases = {keyword for keyword in keywords if not keyword.isalnum()}
            score = len(tokens & {_stem(keyword) for keyword in keywords - phrases})
            score += sum(2 for phrase in phrases if self._alias_hit(text, phrase))
            if score:
                scored.append((-score, entry["id"], entry))
        scored.sort(key=lambda item: item[:2])
        if not scored:
            return self._result(
                tool, found=False, answers=[],
                message="Not covered by the event FAQ. Say you don't know and point to the Information desk or the official site.",
                official_site=self.event.get("official_site"),
            )
        answers = []
        for _, _, entry in scored[:2]:
            answer = {"topic": entry["topic"], "answer": entry["answer"], "source": "official"}
            if entry.get("url"):
                answer["url"] = entry["url"]
            answers.append(answer)
        return self._result(
            tool,
            found=True,
            answers=answers,
            notice="Answers come from the official event FAQ.",
        )
