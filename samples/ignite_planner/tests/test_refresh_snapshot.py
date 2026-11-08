"""Offline checks for tools/refresh_snapshot.py.

    python3 -m unittest discover -s tests -p 'test_*.py'
"""

import csv
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from refresh_snapshot import local_time, normalize_session, normalize_speaker, session_csv, validate  # noqa: E402


def session(**changes):
    row = {
        "sessionCode": "BRK244",
        "sessionId": "content",
        "sessionInstanceId": "content-instance",
        "title": "Voice agents",
        "startDateTime": "2026-11-20T01:15:00Z",
        "endDateTime": "2026-11-20T02:00:00Z",
        "speakerNames": "Example speaker",
        "speakerIds": ["speaker"],
        "location": {"displayValue": "Theater 12"},
        "sessionType": {"displayValue": "Breakout"},
    }
    return normalize_session({**row, **changes}, "America/Los_Angeles")


class SnapshotTests(unittest.TestCase):
    def test_timezone_conversion_preserves_local_date_and_dst(self):
        self.assertEqual(
            local_time("2026-11-20T01:15:00Z", "America/Los_Angeles"),
            "2026-11-19T17:15:00-08:00",
        )
        self.assertEqual(
            local_time("2026-10-28T13:00:00Z", "America/Los_Angeles"),
            "2026-10-28T06:00:00-07:00",
        )
        with self.assertRaises(ValueError):
            local_time("2026-11-20T01:15:00", "America/Los_Angeles")

    def test_unscheduled_content_stays_null(self):
        row = session(startDateTime=None, endDateTime=None, location={})
        self.assertIsNone(row["start_utc"])
        self.assertIsNone(row["start_local"])
        self.assertIsNone(row["location"])

    def test_invalid_time_ranges_fail_explicitly(self):
        with self.assertRaises(ValueError):
            session(endDateTime=None)
        with self.assertRaises(ValueError):
            session(endDateTime="2026-11-20T01:00:00Z")

    def test_distinct_instances_of_one_code_are_kept(self):
        rows = [session(), session(sessionInstanceId="content-repeat")]
        quality = validate(rows, [{"speaker_id": "speaker"}], [
            "https://ignite.microsoft.com/en-US/sessions/content"
        ])
        self.assertEqual(quality["session_instances"], 2)
        self.assertEqual(quality["distinct_session_codes"], 1)

    def test_upstream_speaker_issues_are_reported(self):
        quality = validate([session()], [
            {"speaker_id": "other"}, {"speaker_id": "other"},
        ], ["https://ignite.microsoft.com/en-US/sessions/content"])
        self.assertEqual(quality["duplicate_speaker_ids"], {"other": 2})
        self.assertEqual(quality["unresolved_speaker_ids"], ["speaker"])
        self.assertEqual(quality["instances_with_unresolved_speaker_ids"], 1)

    def test_incomplete_or_duplicate_catalog_fails(self):
        with self.assertRaises(ValueError):
            validate([session(), session()], [{"speaker_id": "speaker"}], [])
        with self.assertRaises(ValueError):
            validate([session()], [{"speaker_id": "speaker"}], [])

    def test_csv_quotes_titles_and_preserves_every_instance(self):
        rows = [session(title='Voice, "agents"'), session(sessionInstanceId="repeat")]
        parsed = list(csv.DictReader(io.StringIO(session_csv(rows))))
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["title"], 'Voice, "agents"')
        self.assertEqual(parsed[1]["instance_id"], "repeat")

    def test_speaker_projection_excludes_biographies_and_contact_data(self):
        row = normalize_speaker({
            "speakerId": "speaker", "displayName": "Example speaker",
            "company": "Example", "jobTitle": "Engineer", "bio": "Not exported",
            "email": "not-exported@example.com",
        })
        self.assertNotIn("bio", row)
        self.assertNotIn("email", row)


if __name__ == "__main__":
    unittest.main()
