"""Hindi speech evidence must pass the same business gates as English."""

import unittest
import tempfile
from pathlib import Path

from shared_mcp.finance_handoff.config import ServerConfig
from shared_mcp.finance_handoff.server import build_service

from shared_mcp.finance_handoff.service import (
    _classify_bureau_response,
    _classify_offer_response,
    _explicit_end_request,
    _month_day,
    _normalise_spoken_words,
)


class HindiEvidenceTests(unittest.TestCase):
    def test_hindi_evidence_reaches_the_real_service_gates(self):
        with tempfile.TemporaryDirectory() as directory:
            config = ServerConfig.from_environment({
                "FINANCE_MCP_STATE_DIR": str(Path(directory) / "handoff"),
            })
            service = build_service(config)
            started = service.start_call(
                config.lead_id, config.campaign_id, config.ivr_menu_id,
                "start-hindi", config.agent_persona_ref,
            )
            call_id = started["call_id"]
            mismatch = service.confirm_right_party(
                call_id, "wrong-date", "मेरी जन्मतिथि दो जनवरी है।"
            )
            self.assertEqual("date_of_birth_does_not_match", mismatch["error"])
            verified = service.confirm_right_party(
                call_id, "correct-date", "मेरी जन्मतिथि एक जनवरी है।"
            )
            self.assertTrue(verified["confirmed"])
            rejected = service.set_disposition(
                call_id, "ambiguous-end", "customer_ended", "अलविदा", "अलविदा"
            )
            self.assertEqual("customer_end_not_confirmed", rejected["error"])
            ended = service.set_disposition(
                call_id, "explicit-end", "customer_ended",
                "ग्राहक ने कॉल समाप्त करने को कहा।", "कॉल बंद कर दीजिए।",
            )
            self.assertTrue(ended["recorded"])
            self.assertEqual("customer_ended", ended["disposition"])

    def test_spoken_dates(self):
        for spoken, expected in (
            ("एक जनवरी", (1, 1)),
            ("मेरा जन्मदिन एक जनवरी है", (1, 1)),
            ("मेरी जन्मतिथि एक जनवरी है।", (1, 1)),
            ("१ जनवरी", (1, 1)),
            ("1 जनवरी", (1, 1)),
            ("इकतीस दिसंबर", (12, 31)),
            ("पाँच फ़रवरी", (2, 5)),
            ("पांच फरवरी", (2, 5)),
            ("बारह सितम्बर", (9, 12)),
            ("पहली जनवरी", (1, 1)),
            ("first of January", (1, 1)),
            ("1990-01-01", (1, 1)),
        ):
            with self.subTest(spoken=spoken):
                self.assertEqual(expected, _month_day(spoken))
        for spoken in ("जनवरी", "हाँ", "एक"):
            self.assertIsNone(_month_day(spoken))

    def test_explicit_decisions_and_vague_answers(self):
        for classifier, affirmative in (
            (_classify_offer_response, "मैं स्वीकार करता हूँ"),
            (_classify_bureau_response, "मैं सहमति देता हूँ"),
        ):
            self.assertEqual("explicit_yes", classifier(affirmative))
            self.assertEqual("explicit_no", classifier("मैं अस्वीकार करता हूँ"))
            for vague in ("हाँ", "ठीक है", "हम्म", "आगे बताइए"):
                self.assertEqual("unclear", classifier(vague))
        self.assertEqual(
            "explicit_no", _classify_bureau_response("मैं सहमति नहीं देता हूँ")
        )

    def test_only_explicit_end_requests_close_the_call(self):
        for spoken in (
            "कॉल बंद कर दीजिए।", "कृपया कॉल समाप्त करें।",
            "इस कॉल को बंद मत कीजिए", "कॉल बंद मत कीजिए", "अलविदा", "धन्यवाद",
            "end the call", "stop the call",
        ):
            with self.subTest(spoken=spoken):
                expected = spoken in (
                    "कॉल बंद कर दीजिए।", "कृपया कॉल समाप्त करें।",
                    "end the call", "stop the call",
                )
                self.assertEqual(
                    expected, _explicit_end_request(_normalise_spoken_words(spoken))
                )
