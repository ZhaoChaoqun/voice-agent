"""Save factual metadata from Ignite's anonymous, public website endpoints into data/.

    python3 tools/refresh_snapshot.py

Afterwards rebuild data/catalog.json with tools/session_catalog.py --build.
"""

import csv
import hashlib
import html
import io
import json
import re
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser
from zoneinfo import ZoneInfo

BASE = "https://ignite.microsoft.com"
USER_AGENT = "Ignite2026PublicMetadataSnapshot/1.0"
OUTPUT = Path(__file__).resolve().parent.parent / "data"
URLS = {
    "robots": f"{BASE}/robots.txt",
    "sitemap": f"{BASE}/sitemap.xml",
    "sessions": f"{BASE}/api/session/all/en-US",
    "speakers": f"{BASE}/api/speaker/all/en-US",
    "home": f"{BASE}/en-US/home",
}


def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=90) as response:
        body = response.read()
        metadata = {
            "url": url,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "http_status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "response_bytes": len(body),
            "response_sha256": hashlib.sha256(body).hexdigest(),
        }
    return body, metadata


class PageContext(HTMLParser):
    def __init__(self):
        super().__init__()
        self.capture = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("id") == "vike_pageContext":
            self.capture = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.capture = False

    def handle_data(self, data):
        if self.capture:
            self.parts.append(data)


def page_context(body):
    parser = PageContext()
    parser.feed(body.decode("utf-8"))
    if not parser.parts:
        raise ValueError("The official page no longer contains vike_pageContext")
    return json.loads("".join(parser.parts))


def display(value):
    if value is None:
        return None
    if isinstance(value, str):
        return value or None
    if isinstance(value, dict):
        return value.get("displayValue") or None
    raise TypeError(f"Unexpected display field: {type(value).__name__}")


def labels(values):
    if values is None:
        return []
    if not isinstance(values, list):
        raise TypeError("Expected a list of public catalog labels")
    return [label for value in values if (label := display(value)) is not None]


def local_time(value, event_timezone):
    if value is None:
        return None
    instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if instant.utcoffset() is None:
        raise ValueError(f"Timestamp has no timezone: {value}")
    return instant.astimezone(ZoneInfo(event_timezone)).isoformat()


def normalize_session(row, event_timezone):
    start, end = row["startDateTime"], row["endDateTime"]
    start_local = local_time(start, event_timezone)
    end_local = local_time(end, event_timezone)
    if (start is None) != (end is None):
        raise ValueError(f"Incomplete time range: {row['sessionInstanceId']}")
    if start is not None and datetime.fromisoformat(end) <= datetime.fromisoformat(start):
        raise ValueError(f"Invalid time range: {row['sessionInstanceId']}")
    for key in ("sessionCode", "sessionId", "sessionInstanceId", "title"):
        if not row[key]:
            raise ValueError(f"Missing {key} in public session record")
    return {
        "session_code": row["sessionCode"],
        "session_id": row["sessionId"],
        "instance_id": row["sessionInstanceId"],
        "time_id": row.get("sessionTimeId"),
        "title": row["title"],
        "start_utc": start,
        "end_utc": end,
        "start_local": start_local,
        "end_local": end_local,
        "duration_minutes": row.get("durationInMinutes"),
        "location": display(row.get("location")),
        "speaker_names_text": row.get("speakerNames") or None,
        "speaker_ids": row.get("speakerIds", []),
        "session_type": display(row.get("sessionType")),
        "levels": labels(row.get("sessionLevel")),
        "topics": labels(row.get("topic")),
        "target_audience": row.get("targetAudience") or None,
        "delivery_types": labels(row.get("deliveryTypes")),
        "viewing_options": labels(row.get("viewingOptions")),
        "seating_experience": row.get("seatingExperience") or None,
        "source_last_updated_at": row.get("lastUpdate"),
        "source_url": f"{BASE}/en-US/sessions/{quote(row['sessionInstanceId'])}",
    }


def normalize_speaker(row):
    if not row["speakerId"] or not row["displayName"]:
        raise ValueError("Speaker record is missing its public ID or display name")
    return {
        "speaker_id": row["speakerId"],
        "localized_id": row.get("localizedId"),
        "name": row["displayName"],
        "job_title": row.get("jobTitle") or None,
        "company": row.get("company") or None,
        "source_session_keys": row.get("sessionsPresenting", []),
        "source_url": f"{BASE}/en-US/speakers/{quote(row['speakerId'])}",
    }


def agenda_items(context, event_timezone):
    translations = context["initialI18nStore"]["en-US"]["translation"]

    def resolve(key):
        value = translations
        for part in key.split("."):
            value = value[part]
        return re.sub(r"<[^>]*>", "", html.unescape(value.replace("\\/", "/"))).strip()

    def find(value):
        if isinstance(value, dict):
            if value.get("component") == "agendaReimagine":
                return value
            for child in value.values():
                found = find(child)
                if found is not None:
                    return found
        elif isinstance(value, list):
            for child in value:
                found = find(child)
                if found is not None:
                    return found
        return None

    content = [
        query["state"]["data"]
        for query in context["dehydratedReactQueryState"]["queries"]
        if query["queryKey"][0] == "content"
    ]
    component = find(content)
    if component is None:
        raise ValueError("Official homepage agenda component was not found")
    groups = component["props"]["groups"]
    if not groups or groups[0].get("requireScope"):
        raise ValueError("Expected the first agenda group to be publicly displayed")
    return [
        {
            "title": resolve(item["itemTextBlock"]["heading"]),
            "start_utc": item["dateTimeIsoStampStart"],
            "end_utc": item["dateTimeIsoStampEnd"],
            "start_local": local_time(item["dateTimeIsoStampStart"], event_timezone),
            "end_local": local_time(item["dateTimeIsoStampEnd"], event_timezone),
            "source_url": URLS["home"],
        }
        for item in groups[0]["items"]
    ]


def validate(sessions, speakers, sitemap_urls):
    instance_ids = [row["instance_id"] for row in sessions]
    if not sessions or len(instance_ids) != len(set(instance_ids)):
        raise ValueError("Catalog is empty or contains duplicate session instance IDs")
    if not speakers:
        raise ValueError("Public speaker directory is empty")
    sitemap_session_urls = [url for url in sitemap_urls if "/sessions/" in url]
    sitemap_ids = {url.rsplit("/", 1)[1] for url in sitemap_session_urls}
    catalog_ids = {row["session_id"] for row in sessions}
    if catalog_ids != sitemap_ids:
        raise ValueError("Catalog session IDs do not match the official sitemap")
    speaker_counts = Counter(row["speaker_id"] for row in speakers)
    referenced_speakers = {key for row in sessions for key in row["speaker_ids"]}
    missing_speakers = sorted(referenced_speakers - speaker_counts.keys())
    return {
        "session_instances": len(sessions),
        "distinct_session_codes": len({row["session_code"] for row in sessions}),
        "scheduled_instances": sum(row["start_utc"] is not None for row in sessions),
        "unscheduled_instances": sum(row["start_utc"] is None for row in sessions),
        "unscheduled_by_type": dict(Counter(
            row["session_type"] for row in sessions if row["start_utc"] is None
        )),
        "instances_without_location": sum(row["location"] is None for row in sessions),
        "instances_without_speaker_names": sum(
            row["speaker_names_text"] is None for row in sessions
        ),
        "speaker_records": len(speakers),
        "distinct_speaker_ids": len(speaker_counts),
        "duplicate_speaker_ids": {
            key: count for key, count in sorted(speaker_counts.items()) if count > 1
        },
        "referenced_speaker_ids": len(referenced_speakers),
        "unresolved_speaker_ids": missing_speakers,
        "instances_with_unresolved_speaker_ids": sum(
            bool(set(row["speaker_ids"]) & set(missing_speakers)) for row in sessions
        ),
        "sitemap_session_entries": len(sitemap_session_urls),
        "sitemap_distinct_session_urls": len(sitemap_ids),
        "catalog_session_ids_match_sitemap": True,
    }


def session_csv(sessions):
    fields = [
        "session_code", "instance_id", "title", "start_utc", "end_utc",
        "start_local", "end_local", "duration_minutes", "location",
        "speaker_names_text", "session_type", "levels", "topics",
        "delivery_types", "viewing_options", "seating_experience",
        "source_url", "source_last_updated_at",
    ]
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in sessions:
        writer.writerow({
            key: "; ".join(value) if isinstance(value, list) else value
            for key, value in row.items()
        })
    return stream.getvalue()


def main():
    responses, sources = {}, {}
    robots_body, sources["robots"] = fetch(URLS["robots"])
    robots = RobotFileParser(URLS["robots"])
    robots.parse(robots_body.decode("utf-8").splitlines())
    for name in ("sitemap", "sessions", "speakers", "home"):
        if not robots.can_fetch(USER_AGENT, URLS[name]):
            raise PermissionError(f"robots.txt disallows {URLS[name]}")
        responses[name], sources[name] = fetch(URLS[name])
    context = page_context(responses["home"])
    settings = next(
        query["state"]["data"]
        for query in context["dehydratedReactQueryState"]["queries"]
        if query["queryKey"] == ["settings", "load"]
    )
    event_timezone = settings["timezones"]["eventTimezone"].replace("\\/", "/")
    sessions = [
        normalize_session(row, event_timezone)
        for row in json.loads(responses["sessions"])
    ]
    speakers = [normalize_speaker(row) for row in json.loads(responses["speakers"])]
    sessions.sort(key=lambda row: (
        row["start_utc"] is None, row["start_utc"] or "", row["instance_id"]
    ))
    sitemap_urls = [
        element.text for element in ET.fromstring(responses["sitemap"]).findall(".//{*}loc")
    ]
    quality = validate(sessions, speakers, sitemap_urls)
    snapshot_at = sources["sessions"]["retrieved_at"]
    common = {"snapshot_at": snapshot_at, "event_timezone": event_timezone}
    documents = {
        "sessions.json": {
            **common, "source_url": URLS["sessions"], "sessions": sessions,
        },
        "speakers.json": {
            **common, "source_url": URLS["speakers"],
            "retrieved_at": sources["speakers"]["retrieved_at"], "speakers": speakers,
        },
        "agenda.json": {
            **common, "source_url": URLS["home"],
            "retrieved_at": sources["home"]["retrieved_at"],
            "items": agenda_items(context, event_timezone),
        },
        "sources.json": {
            **common, "sources": sources, "quality": quality,
            "notes": [
                "Public factual metadata only; no abstracts, biographies or attendee lists.",
                "Website endpoints are not a documented third-party API contract.",
                "Null timestamps and duplicate speaker IDs are preserved, not repaired.",
                "Speaker names text is not split or assumed to align positionally with IDs.",
                "Snapshot is not live occupancy, registration or reservation data.",
                "Homepage agenda blocks and individual sessions may have different end times.",
            ],
        },
    }
    for filename, document in documents.items():
        (OUTPUT / filename).write_text(
            json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    (OUTPUT / "sessions.csv").write_text(session_csv(sessions), encoding="utf-8")
    print(json.dumps(quality, ensure_ascii=False, indent=2))
    print(f"Saved public metadata snapshot to {OUTPUT}")
    if quality["duplicate_speaker_ids"] or quality["unresolved_speaker_ids"]:
        print("WARNING: upstream speaker data has duplicates/unresolved IDs; see sources.json.")


if __name__ == "__main__":
    main()
