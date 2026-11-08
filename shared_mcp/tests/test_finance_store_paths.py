from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from shared_mcp.finance_handoff.domain import CallSession as HandoffSession
from shared_mcp.finance_handoff.store import CallStore
from shared_mcp.finance_otp_officer.domain import CallSession as OtpSession
from shared_mcp.finance_otp_officer.store import SessionStore


class FinanceStorePathTests:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / "active"
        self.store = self.store_type(self.state)

    def operations(self, store, identifier):
        session = self.session(identifier)
        actions = [
            lambda: store.get(identifier),
            lambda: store.create(session),
            lambda: store.save(session),
            lambda: store.cached_operation(identifier, "op"),
            lambda: store.remember_operation(identifier, "op", {"ok": True}),
        ]
        if isinstance(store, SessionStore):
            actions.append(lambda: store.delete(identifier))
        return actions

    def test_invalid_identifiers_rejected_before_memory_or_disk_changes(self):
        for state_dir in (None, self.state):
            store = self.store_type(state_dir)
            for identifier in (
                "", ".", "..", "../archive/fixture-id", r"..\archive\fixture-id",
                "/absolute", r"\rooted", r"C:\absolute", "C:relative",
                r"\\server\share\fixture", r"\\?\C:\fixture", "a/b", r"a\b",
                "a:b", "a\x00b", "a\nb", " leading", "trailing ", "CON",
                "con.extra", "NUL", "AUX", "PRN", "COM1", "lpt9", "\u2026",
            ):
                for action in self.operations(store, identifier):
                    with self.subTest(state_dir=state_dir, identifier=identifier):
                        with self.assertRaisesRegex(ValueError, "^invalid_identifier$"):
                            action()
            self.assertEqual({}, store._operations)
            cache = store._calls if isinstance(store, CallStore) else store._sessions
            self.assertEqual({}, cache)
        self.assertEqual([], list(self.state.iterdir()))

    def test_sibling_session_cannot_be_read_overwritten_or_deleted(self):
        archive = self.root / "archive"
        self.store_type(archive).create(self.session("fixture-id"))
        original = (archive / "fixture-id.json").read_bytes()
        for identifier in ("../archive/fixture-id", r"..\archive\fixture-id"):
            for action in self.operations(self.store, identifier):
                with self.assertRaisesRegex(ValueError, "^invalid_identifier$"):
                    action()
                self.assertEqual(original, (archive / "fixture-id.json").read_bytes())
        self.assertEqual([], list(self.state.iterdir()))

    def test_native_absolute_path_rejected(self):
        identifier = str(self.root / "outside")
        for action in self.operations(self.store, identifier):
            with self.assertRaisesRegex(ValueError, "^invalid_identifier$"):
                action()
        self.assertFalse((self.root / "outside.json").exists())

    def test_valid_identifiers_round_trip_and_replay(self):
        for state_dir in (None, self.state):
            store = self.store_type(state_dir)
            for identifier in ("call-0123456789ab", "finance-0123456789ab", "call-1",
                               "fixture_id", "v1.fixture-2", "a"):
                with self.subTest(state_dir=state_dir, identifier=identifier):
                    self.assertIsNone(store.get(identifier))
                    session = self.session(identifier)
                    store.create(session)
                    self.assertIs(session, store.get(identifier))
                    store.remember_operation(identifier, "op", {"ok": True})
                    self.assertEqual({"ok": True}, store.cached_operation(identifier, "op"))
                    session.state_version = 2
                    store.save(session)
                    if state_dir is not None:
                        restarted = self.store_type(state_dir)
                        self.assertEqual(2, restarted.get(identifier).state_version)
                        self.assertEqual(
                            identifier, getattr(restarted.get(identifier), self.id_field)
                        )
                    if isinstance(store, SessionStore):
                        self.assertTrue(store.delete(identifier))
                        self.assertIsNone(store.get(identifier))
                        self.assertIsNone(store.cached_operation(identifier, "op"))
                        self.assertFalse(store.delete(identifier))

    def make_symlink(self, target, link):
        try:
            link.symlink_to(target)
        except OSError as error:
            if error.errno in (1, 13) or getattr(error, "winerror", None) == 1314:
                self.skipTest("Creating symlinks requires platform permission")
            raise

    def test_existing_symlink_rejected_even_for_cached_sessions(self):
        archive = self.root / "archive"
        self.store_type(archive).create(self.session("fixture-id"))
        target = archive / "fixture-id.json"
        original = target.read_bytes()
        self.store.create(self.session("fixture-id"))
        self.store.remember_operation("fixture-id", "op", {"ok": True})
        link = self.state / "fixture-id.json"
        link.unlink()
        self.make_symlink(target, link)
        for store in (self.store, self.store_type(self.state)):
            for action in self.operations(store, "fixture-id"):
                with self.assertRaisesRegex(ValueError, "^invalid_session_path$"):
                    action()
                self.assertEqual(original, target.read_bytes())
                self.assertTrue(link.is_symlink())

    def test_dangling_symlink_cannot_create_outside_file(self):
        target = self.root / "outside.json"
        link = self.state / "fixture-id.json"
        self.make_symlink(target, link)
        for action in self.operations(self.store, "fixture-id"):
            with self.assertRaisesRegex(ValueError, "^invalid_session_path$"):
                action()
        self.assertFalse(target.exists())

    def test_persisted_identifier_must_match_lookup(self):
        self.store.create(self.session("fixture-id"))
        (self.state / "fixture-id.json").rename(self.state / "different-id.json")
        restarted = self.store_type(self.state)
        with self.assertRaisesRegex(ValueError, "^session_identifier_mismatch$"):
            restarted.get("different-id")
        self.assertEqual({}, restarted._operations)


class HandoffStorePathTests(FinanceStorePathTests, unittest.TestCase):
    store_type = CallStore
    id_field = "call_id"

    @staticmethod
    def session(identifier):
        return HandoffSession(
            call_id=identifier, lead_id="fixture-lead", campaign_id="fixture-campaign",
            ivr_menu_id="fixture-menu",
        )


class OtpStorePathTests(FinanceStorePathTests, unittest.TestCase):
    store_type = SessionStore
    id_field = "session_id"

    @staticmethod
    def session(identifier):
        return OtpSession(
            session_id=identifier, caller_id="fixture-caller", directory_id="fixture-directory"
        )
