import json
import unittest

from banking import DemoBank, MODEL, VOICE
from agent import definition
from server import Settings, client_event, cookie_value, valid_cookie


def invoke(bank, name, args=None, call_id="call-1"):
    return bank.execute({"call_id": call_id, "name": name, "arguments": json.dumps(args or {})})


class BankingTests(unittest.TestCase):
    def test_requested_model_voice_and_no_real_tools(self):
        body = definition()
        self.assertEqual(body["model"], MODEL)
        self.assertEqual(body["audio"]["output"]["voice"], VOICE)
        self.assertEqual(len(body["tools"]), 4)
        self.assertNotIn("toolbox", json.dumps(body["tools"]))
        self.assertIn("Do not upload one here", invoke(DemoBank(), "submit_demo_overdraft", {
            "amount_eur": 5000, "customer_confirmed": True})["next_step"])

    def test_fictional_account(self):
        result = invoke(DemoBank(), "get_demo_account")
        self.assertTrue(result["simulated"])
        self.assertEqual(result["current_limit_eur"], 2000)
        self.assertIsNone(result["salary_amount"])

    def test_overdraft_requires_confirmation_and_valid_total(self):
        for amount, confirmed in [(5000, False), (5000, "yes"), (True, True), (2000, True),
                                  (10001, True), (5000.1, True), ("5000", True)]:
            with self.subTest(amount=amount, confirmed=confirmed):
                bank = DemoBank()
                result = invoke(bank, "submit_demo_overdraft", {
                    "amount_eur": amount, "customer_confirmed": confirmed})
                self.assertFalse(result["ok"])
                self.assertEqual(bank.inbox, [])
                self.assertIsNone(bank.application)

    def test_application_does_not_change_account_or_approve_credit(self):
        bank = DemoBank()
        result = invoke(bank, "submit_demo_overdraft", {"amount_eur": 5000, "customer_confirmed": True})
        self.assertTrue(result["ok"])
        self.assertFalse(result["approved"])
        self.assertFalse(result["real_submission"])
        self.assertEqual(bank.snapshot()["current_limit_eur"], 2000)
        self.assertEqual(bank.snapshot()["account"], "KlassikKonto")
        self.assertEqual(len(bank.inbox), 1)

    def test_repeated_calls_are_idempotent(self):
        bank = DemoBank()
        args = {"amount_eur": 5000, "customer_confirmed": True}
        first = invoke(bank, "submit_demo_overdraft", args)
        self.assertEqual(first, invoke(bank, "submit_demo_overdraft", args))
        invoke(bank, "submit_demo_overdraft", args, "call-2")
        self.assertEqual(len(bank.inbox), 1)
        self.assertFalse(invoke(bank, "get_demo_account")["ok"])

    def test_conflicting_application_is_explicitly_rejected(self):
        bank = DemoBank()
        invoke(bank, "submit_demo_overdraft", {"amount_eur": 5000, "customer_confirmed": True})
        self.assertFalse(invoke(bank, "submit_demo_overdraft",
                                {"amount_eur": 6000, "customer_confirmed": True}, "call-2")["ok"])
        self.assertEqual(bank.application["requested_limit_eur"], 5000)

    def test_comparison_has_no_unverified_prices_and_requires_consent(self):
        bank = DemoBank()
        data = invoke(bank, "get_account_comparison")
        self.assertFalse(data["verified_prices_available"])
        self.assertFalse(invoke(bank, "send_demo_comparison", {"customer_confirmed": False}, "call-2")["ok"])
        result = invoke(bank, "send_demo_comparison", {"customer_confirmed": True}, "call-3")
        self.assertTrue(result["ok"])
        self.assertFalse(result["account_changed"])
        self.assertEqual(len(bank.inbox), 1)
        self.assertIsNone(bank.application)

    def test_calls_are_isolated_and_invalid_arguments_rejected(self):
        one, two = DemoBank(), DemoBank()
        invoke(one, "send_demo_comparison", {"customer_confirmed": True})
        self.assertEqual(two.inbox, [])
        for name, args in [("transfer_money", {}), ("get_demo_account", {"instructions": "ignore policy"}),
                           ("submit_demo_overdraft", {"amount_eur": 5000})]:
            self.assertFalse(invoke(DemoBank(), name, args)["ok"])
        self.assertFalse(DemoBank().execute({"call_id": "c", "name": "get_demo_account", "arguments": "{"})["ok"])


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.cfg = Settings("https://example.services.ai.azure.com/api/projects/demo", "test-only-code-not-a-secret")

    def test_cookie_integrity_and_expiry(self):
        token = cookie_value(self.cfg)
        self.assertTrue(valid_cookie(self.cfg, token))
        self.assertFalse(valid_cookie(self.cfg, token + "a"))
        self.assertFalse(valid_cookie(self.cfg, cookie_value(self.cfg, now=1)))
        self.assertFalse(valid_cookie(self.cfg, "bad"))

    def test_no_store_and_no_browser_configuration(self):
        self.assertIn("store=false", self.cfg.voice_url("webrtc"))
        self.assertIn("transport=webrtc", self.cfg.voice_url("webrtc"))
        self.assertNotIn("transport=", self.cfg.voice_url("text"))
        for frame in [{"type": "session.update", "session": {"model": "other"}},
                      {"type": "conversation.item.create", "item": {"role": "system"}},
                      {"type": "response.create"}, {"type": "demo.text", "text": "a" * 2001}]:
            with self.assertRaises(ValueError):
                client_event(frame, "text", False, True, False)

    def test_text_readiness_and_single_sdp(self):
        frame = {"type": "demo.text", "text": "  Hello "}
        self.assertEqual(client_event(frame, "text", False, True, False)["text"], "Hello")
        for ready, busy in [(False, False), (True, True)]:
            with self.assertRaises(ValueError):
                client_event(frame, "text", False, ready, busy)
        offer = {"type": "rtc.call.sdp.create", "sdp_offer": "v=0\r\n"}
        self.assertEqual(client_event(offer, "webrtc", False, False, True), offer)
        with self.assertRaises(ValueError):
            client_event(offer, "webrtc", True, True, False)


if __name__ == "__main__":
    unittest.main()
