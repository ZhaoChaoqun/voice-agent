"""Add the official session descriptions to the existing snapshot, without refreshing it.

refresh_snapshot.py keeps facts only and drops the catalog's `description` field. This script reads the
same anonymous endpoint (or a saved copy of its response), converts each description from HTML
to plain text and writes data/descriptions.json keyed by this snapshot's instance IDs. sessions.json
and the other snapshot files are not changed, so IDs, times and counts stay as they are.

    python3 tools/add_descriptions.py                    # fetch /api/session/all/en-US
    python3 tools/add_descriptions.py --from saved.json  # use a saved response instead
"""

import argparse
import html
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.robotparser import RobotFileParser

from refresh_snapshot import OUTPUT, URLS, USER_AGENT, fetch


class PlainText(HTMLParser):
    """Paragraphs and line breaks become new lines, list items become bullets, tags are dropped."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "li":
            self.parts.append("\n• ")
        elif tag in ("br", "p", "div", "ul", "ol"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("p", "div", "ul", "ol"):
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def plain(value):
    parser = PlainText()
    parser.feed(html.unescape(value or ""))
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in "".join(parser.parts).splitlines()]
    return "\n".join(line for line in lines if line)


def official_rows(saved):
    if saved:
        path = Path(saved)
        modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
        return json.loads(path.read_text(encoding="utf-8")), {"file": str(path), "retrieved_at": modified}
    robots_body, _ = fetch(URLS["robots"])
    robots = RobotFileParser(URLS["robots"])
    robots.parse(robots_body.decode("utf-8").splitlines())
    if not robots.can_fetch(USER_AGENT, URLS["sessions"]):
        raise PermissionError(f"robots.txt disallows {URLS['sessions']}")
    body, source = fetch(URLS["sessions"])
    return json.loads(body), source


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from", dest="saved", help="saved JSON response of /api/session/all/en-US")
    args = parser.parse_args()
    rows, source = official_rows(args.saved)
    snapshot = json.loads((OUTPUT / "sessions.json").read_text(encoding="utf-8"))
    by_instance = {row["sessionInstanceId"]: plain(row.get("description")) for row in rows}
    # Every time slot of one session shares its description, so a code match is a safe fallback
    # for instances whose IDs changed since the snapshot.
    by_code = {}
    for row in rows:
        by_code.setdefault(row["sessionCode"], plain(row.get("description")))
    descriptions, via_code, missing = {}, [], []
    for session in snapshot["sessions"]:
        text = by_instance.get(session["instance_id"])
        if not text and by_code.get(session["session_code"]):
            text = by_code[session["session_code"]]
            via_code.append(session["session_code"])
        if text:
            descriptions[session["instance_id"]] = text
        else:
            missing.append(session["session_code"])
    document = {
        "snapshot_at": snapshot["snapshot_at"],
        "retrieved_at": source["retrieved_at"],
        "source_url": URLS["sessions"],
        "source": source,
        "notice": "Official public session descriptions from the Ignite catalog, converted from HTML to "
                  "plain text and matched to this snapshot by instance ID, or by session code when the "
                  "instance ID changed. Descriptions describe content; they are not schedules or seat availability.",
        "matched": len(descriptions),
        "matched_by_code": sorted(set(via_code)),
        "without_description": sorted(set(missing)),
        "descriptions": descriptions,
    }
    (OUTPUT / "descriptions.json").write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(descriptions)} of {len(snapshot['sessions'])} snapshot sessions have a description "
          f"({len(set(via_code))} codes matched by session code; {len(set(missing))} codes without one).")


if __name__ == "__main__":
    main()
