"""Build data/catalog.json from the public snapshot, plus the reference session index.

SessionIndex is the Python original of web/session-index.mjs; tests/test_session_index.mjs checks
the browser port against it result by result.

    python3 tools/session_catalog.py --build
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections import Counter
from datetime import date, datetime, time
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
PLURALS = {"agents": "agent", "models": "model", "sessions": "session",
           "developers": "developer", "tools": "tool", "applications": "application"}


def tokens(text: str) -> list[str]:
    return [PLURALS.get(word, word) for word in re.findall(r"[a-z0-9]+", text.casefold())]


def build_catalog() -> dict:
    source = json.loads((DATA / "sessions.json").read_text())
    directory = json.loads((DATA / "speakers.json").read_text())
    featured = {
        row["instance_id"]: row
        for row in json.loads((DATA / "featured-sessions.json").read_text())["sessions"]
    }
    names: dict[str, set[str]] = {}
    for row in directory["speakers"]:
        names.setdefault(row["speaker_id"], set()).add(row["name"])
    sessions = []
    for row in source["sessions"]:
        editorial = featured.get(row["instance_id"], {})
        speakers = [
            next(iter(names[key])) for key in row["speaker_ids"]
            if key in names and len(names[key]) == 1
        ]
        sessions.append({
            "id": row["instance_id"], "code": row["session_code"],
            "title": row["title"], "start": row["start_utc"], "end": row["end_utc"],
            "local_start": row["start_local"], "local_end": row["end_local"],
            "location": row["location"], "speakers": speakers,
            "speaker_names_text": row["speaker_names_text"],
            "summary": editorial.get("summary", " · ".join(
                item for item in [row["session_type"], *row["topics"]] if item
            )),
            "summary_kind": "editorial" if editorial else "metadata",
            "takeaway": editorial.get("takeaway", ""),
            "tags": row["topics"], "session_type": row["session_type"],
            "levels": row["levels"], "duration_minutes": row["duration_minutes"],
            "delivery_types": row["delivery_types"], "viewing_options": row["viewing_options"],
            "url": row["source_url"],
        })
    catalog = {
        "verified": source["snapshot_at"][:10], "snapshot_at": source["snapshot_at"],
        "timezone": source["event_timezone"],
        "notice": "Public Ignite snapshot, not live availability. This tab's demo agenda "
                  "does not reserve seats or update your official Ignite schedule.",
        "source_url": source["source_url"], "sessions": sessions,
    }
    catalog["version"] = hashlib.sha256(
        json.dumps(catalog, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    (DATA / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    return catalog


class SessionIndex:
    def __init__(self, catalog: dict):
        self.catalog = catalog
        self.rows = catalog["sessions"]
        self.by_id = {row["id"]: row for row in self.rows}
        if not self.rows or len(self.by_id) != len(self.rows):
            raise ValueError("Catalog must contain unique session instance IDs")
        self.documents: list[Counter] = []
        self.frequencies: Counter = Counter()
        for row in self.rows:
            document: Counter = Counter()
            for value, weight in (
                (row["code"], 10), (row["title"], 5), (" ".join(row["tags"]), 3),
                (row["speaker_names_text"] or "", 3), (row["summary"], 1),
            ):
                document.update({term: count * weight for term, count in Counter(tokens(value)).items()})
            self.documents.append(document)
            self.frequencies.update(document.keys())
        self.average_length = sum(sum(doc.values()) for doc in self.documents) / len(self.rows)

    @classmethod
    def load(cls, path: Path = DATA / "catalog.json") -> SessionIndex:
        return cls(json.loads(path.read_text()))

    def validate_agenda(self, instance_ids: list[str]) -> dict:
        if (not isinstance(instance_ids, list) or len(instance_ids) > 2000
                or any(not isinstance(value, str) or not value or len(value) > 150 for value in instance_ids)):
            raise ValueError("Supply at most 2000 exact instance IDs.")
        ids = list(dict.fromkeys(instance_ids))
        unknown = [value for value in ids if value not in self.by_id]
        untimed, scheduled = [], []
        fields = ("id", "code", "title", "start", "end", "local_start", "local_end", "location")
        for value in ids:
            row = self.by_id.get(value)
            if row is None:
                continue
            if not row["start"] or not row["end"]:
                untimed.append(value)
                continue
            start = datetime.fromisoformat(row["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(row["end"].replace("Z", "+00:00"))
            if end <= start:
                untimed.append(value)
                continue
            scheduled.append((start, end, {field: row[field] for field in fields}))
        scheduled.sort(key=lambda entry: (entry[0], entry[2]["id"]))
        conflicts, transfers = [], []
        conflict_count = transfer_count = 0
        limit = 100
        for index, (start, end, row) in enumerate(scheduled):
            for other_start, other_end, other in scheduled[index + 1:]:
                if other_start >= end:
                    break
                conflict_count += 1
                if len(conflicts) < limit:
                    conflicts.append({
                        "sessions": [row, other],
                        "overlap_start": max(start, other_start).isoformat(),
                        "overlap_end": min(end, other_end).isoformat(),
                        "overlap_minutes": (min(end, other_end) - max(start, other_start)).total_seconds() / 60,
                    })
        for previous, current in zip(scheduled, scheduled[1:]):
            start, end, row = previous
            next_start, _, other = current
            if row["local_start"][:10] != other["local_start"][:10] or next_start < end:
                continue
            venue = lambda item: re.split(r"[|,]", item["location"] or "", maxsplit=1)[0].strip()
            origin, destination = venue(row), venue(other)
            if origin and destination and origin != destination:
                transfer_count += 1
                if len(transfers) < limit:
                    transfers.append({
                        "from": row, "to": other, "from_venue": origin, "to_venue": destination,
                        "gap_minutes": (next_start - end).total_seconds() / 60,
                        "note": "Time between meetings, not a verified walking time or guaranteed connection.",
                    })
        return {
            "catalog_version": self.catalog["version"], "snapshot_at": self.catalog["snapshot_at"],
            "timezone": self.catalog["timezone"], "agenda_count": len(ids), "checked_count": len(scheduled),
            "unknown_instance_ids": unknown, "unscheduled_instance_ids": untimed,
            "checked_all": not unknown and not untimed, "has_time_conflicts": conflict_count > 0,
            "conflict_count": conflict_count, "conflicts": conflicts,
            "transfer_count": transfer_count, "transfers": transfers, "findings_limit": limit,
            "conflicts_truncated": conflict_count > limit, "transfers_truncated": transfer_count > limit,
            "mutates_calendar": False,
            "notice": "Read-only review of the submitted Ignite draft. This tool does not save, block, remove or move meetings; calendar state belongs to the browser.",
        }

    def search(self, keywords: list[str] | None = None, date_filter: str | None = None,
               start_after: str | None = None, end_before: str | None = None,
               speaker: str | None = None, delivery: str | None = None,
               scheduled_only: bool = True, limit: int = 5, offset: int = 0) -> dict:
        keywords = [] if keywords is None else keywords
        if (not isinstance(keywords, list) or len(keywords) > 12
                or any(not isinstance(word, str) or not word.strip() or len(word) > 80 for word in keywords)):
            raise ValueError("Supply at most 12 nonempty English keywords or phrases, each at most 80 characters")
        if type(limit) is not int or not 1 <= limit <= 50 or type(offset) is not int or not 0 <= offset <= 10000:
            raise ValueError("limit must be 1–50 and offset must be 0–10000")
        if type(scheduled_only) is not bool:
            raise ValueError("scheduled_only must be boolean")
        if date_filter is not None:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_filter):
                raise ValueError("date must be YYYY-MM-DD in Pacific time")
            date.fromisoformat(date_filter)
        for value in (start_after, end_before):
            if value is not None and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
                raise ValueError("Time filters must be HH:MM in Pacific time")
        if start_after and end_before and time.fromisoformat(start_after) >= time.fromisoformat(end_before):
            raise ValueError("start_after must be earlier than end_before")
        if speaker is not None and (not isinstance(speaker, str) or not speaker.strip() or len(speaker) > 120):
            raise ValueError("speaker must contain 1–120 characters")
        if delivery not in (None, "In-person", "Online"):
            raise ValueError("delivery must be In-person or Online")
        terms = set(tokens(" ".join(keywords)))
        if keywords and not terms:
            raise ValueError("Use searchable English words or session codes")
        candidates = []
        for row, document in zip(self.rows, self.documents):
            if (scheduled_only or date_filter or start_after or end_before) and not row["start"]:
                continue
            if date_filter and row["local_start"][:10] != date_filter:
                continue
            if start_after and row["local_start"][11:16] < start_after:
                continue
            if end_before and row["local_end"][11:16] > end_before:
                continue
            if speaker and speaker.casefold() not in (row["speaker_names_text"] or "").casefold():
                continue
            if delivery and delivery not in row["delivery_types"]:
                continue
            matched = sorted(terms & document.keys())
            if terms and not matched:
                continue
            score = 0.0
            length = sum(document.values())
            for term in matched:
                frequency = document[term]
                idf = math.log(1 + (len(self.rows) - self.frequencies[term] + .5)
                               / (self.frequencies[term] + .5))
                score += idf * frequency * 2.2 / (
                    frequency + 1.2 * (.25 + .75 * length / self.average_length)
                )
            if row["code"].casefold() in {word.casefold() for word in keywords}:
                score += 30
            candidates.append({
                **row, "lexical_score": round(score, 6),
                "relevance_score": round(score / (1 + score), 6) if terms else None,
                "matched_terms": matched,
            })
        candidates.sort(key=lambda row: (
            -row["lexical_score"], row["start"] is None, row["start"] or "", row["id"]
        ))
        selected = candidates[offset:offset + limit]
        more = offset + len(selected) < len(candidates)
        return {
            "catalog_version": self.catalog["version"], "snapshot_at": self.catalog["snapshot_at"],
            "timezone": self.catalog["timezone"], "total": len(candidates),
            "offset": offset, "has_more": more,
            "next_offset": offset + len(selected) if more else None,
            "ranking": "weighted_bm25" if terms else "chronological",
            "score_notice": "Lexical ranking score, not correctness, confidence or a probability. "
                            "Scores from different keyword queries are not directly comparable.",
            "notice": self.catalog["notice"], "sessions": selected,
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true")
    args = parser.parse_args()
    if not args.build:
        parser.error("Use --build to regenerate catalog.json from the saved public snapshot")
    result = build_catalog()
    print(f"Built {len(result['sessions'])} instances; catalog version {result['version']}")
