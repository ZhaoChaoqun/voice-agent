"""Refresh a dataset's session snapshot from the public event catalog.

    python -m shared_mcp.conference.refresh                 # Ignite 2026 (default)
    python -m shared_mcp.conference.refresh --source raw.json

The catalog API needs no sign-in. Its startDateTime/endDateTime values are UTC
(suffix Z): KEY02 starts 2026-11-18T17:00:00Z, which is 9:00 AM Pacific. The
snapshot keeps only the fields the tools use and records when it was taken, so
the demo is deterministic and works offline.
"""

from __future__ import annotations

import argparse
import html
import json
import logging
import re
import threading
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .dataset import DATA_ROOT, DEFAULT_DATASET

DEFAULT_SOURCE = "https://ignite.microsoft.com/api/session/all/en-US"
logger = logging.getLogger("shared_mcp.conference")
DESCRIPTION_LIMIT = 400
_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")
_INVISIBLE = re.compile("[\u200b\u200c\u200d\u2060\ufeff]")


def _text(value: Any) -> str:
    text = _INVISIBLE.sub("", html.unescape(_TAG.sub(" ", str(value or ""))))
    return _SPACE.sub(" ", text).strip()


def _values(items: Any) -> list[str]:
    return [str(item.get("displayValue") or "").strip() for item in items or [] if item.get("displayValue")]


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(",;:") + "…"


def _recorded(options: list[str]) -> bool | None:
    if "Will be recorded" in options:
        return True
    if "Will not be recorded" in options:
        return False
    return None


def trim(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the tool fields and give repeated session codes a stable instance ID (CODE-1, CODE-2)."""
    by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in raw:
        code = str(item.get("sessionCode") or "").strip()
        if code:
            by_code[code].append(item)
    sessions = []
    for code, items in by_code.items():
        items.sort(key=lambda item: (item.get("startDateTime") or "9999", item.get("sessionInstanceId") or ""))
        for index, item in enumerate(items, 1):
            levels = _values(item.get("sessionLevel"))
            speakers = [name.strip() for name in str(item.get("speakerNames") or "").split(",") if name.strip()]
            sessions.append({
                "id": code if len(items) == 1 else f"{code}-{index}",
                "code": code,
                "title": _text(item.get("title")),
                "description": _clip(_text(item.get("description")), DESCRIPTION_LIMIT),
                "speakers": speakers,
                "start": item.get("startDateTime") or None,
                "end": item.get("endDateTime") or None,
                "duration_minutes": item.get("durationInMinutes") or None,
                "location": _text((item.get("location") or {}).get("displayValue")),
                "type": (item.get("sessionType") or {}).get("displayValue") or "",
                "level": levels[0] if levels else "",
                "topics": _values(item.get("topic")),
                "delivery": _values(item.get("deliveryTypes")),
                "recorded": _recorded(_values(item.get("viewingOptions"))),
                "audience": _values(item.get("audienceTypes")),
                "seating": str(item.get("seatingExperience") or ""),
                "last_update": item.get("lastUpdate") or None,
                # Stable across catalog versions; the readable id above can shift when instances change.
                "instance_id": item.get("sessionInstanceId") or None,
            })
    sessions.sort(key=lambda session: (session["start"] or "9999", session["id"]))
    return sessions


def write_snapshot(raw: list[dict[str, Any]], source: str, destination: Path) -> dict[str, Any]:
    sessions = trim(raw)
    header = {
        "source": source,
        "snapshot_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "catalog_last_update_max": max((item.get("lastUpdate") or "" for item in raw), default=""),
        "times": "start and end are UTC (ISO 8601, Z); convert to the event time zone before speaking.",
        "count": len(sessions),
    }
    lines = [json.dumps(session, ensure_ascii=False, separators=(",", ":")) for session in sessions]
    body = json.dumps(header, ensure_ascii=False, indent=2)[:-2]
    destination.write_text(
        body + ',\n  "sessions": [\n' + ",\n".join(lines) + "\n  ]\n}\n",
        encoding="utf-8",
        newline="\n",
    )
    return header


def fetch_catalog(url: str = DEFAULT_SOURCE, timeout: int = 120) -> list[dict[str, Any]]:
    request = urllib.request.Request(url, headers={"User-Agent": "voice-agent-conference-snapshot/1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = json.loads(response.read().decode("utf-8"))
    if not isinstance(raw, list) or not raw:
        raise ValueError("The catalog did not return a non-empty session list.")
    return raw


def start_live_refresh(service: Any, minutes: float, url: str = DEFAULT_SOURCE,
                       fetch: Callable[[str], list[dict[str, Any]]] | None = None) -> threading.Thread:
    """Refresh the service's sessions from the public catalog now and every `minutes`.

    A failed fetch keeps the sessions already loaded (the checked-in snapshot at first), so the
    tools never go down because the catalog is slow or unreachable.
    """
    fetch = fetch or fetch_catalog
    interval = max(1.0, float(minutes)) * 60

    def run() -> None:
        while True:
            try:
                raw = fetch(url)
                sessions = trim(raw)
                service.replace_sessions(sessions, {
                    "mode": "live",
                    "live_source": url,
                    "fetched_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                    "catalog_last_update_max": max((item.get("lastUpdate") or "" for item in raw), default=""),
                    "refresh_minutes": minutes,
                })
                logger.info("conference catalog refreshed: %d sessions", len(sessions))
            except Exception as error:  # keep serving the last good catalog
                service.catalog_status = {
                    **getattr(service, "catalog_status", {}),
                    "last_refresh_error": f"{type(error).__name__}: {error}"[:300],
                }
                logger.warning("conference catalog refresh failed: %s", error)
            time.sleep(interval)

    thread = threading.Thread(target=run, name="conference-catalog-refresh", daemon=True)
    thread.start()
    return thread


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", default=DEFAULT_DATASET)
    parser.add_argument("--url", default=DEFAULT_SOURCE, help="Public catalog URL.")
    parser.add_argument("--source", type=Path, help="Use an already downloaded catalog JSON file instead.")
    args = parser.parse_args()
    raw = json.loads(args.source.read_text(encoding="utf-8")) if args.source else fetch_catalog(args.url)
    if not isinstance(raw, list) or not raw:
        raise SystemExit("The catalog did not return a non-empty session list.")
    destination = DATA_ROOT / args.dataset / "sessions.json"
    header = write_snapshot(raw, args.url, destination)
    print(json.dumps({"written": str(destination), **header}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
