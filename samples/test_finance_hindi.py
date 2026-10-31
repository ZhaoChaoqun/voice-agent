"""Offline contracts for the independent Hindi Finance samples."""

import copy
import json
from pathlib import Path
import unittest

from voice_agent_sdk_common import load_materialized_agent


ROOT = Path(__file__).resolve().parent


class HindiFinanceSampleTests(unittest.TestCase):
    def test_hindi_samples_preserve_business_graph_and_runtime_behavior(self):
        for pipeline in ("cascade", "realtime"):
            with self.subTest(pipeline=pipeline):
                original_dir = ROOT / f"example1_finance_with_handoff_{pipeline}"
                hindi_dir = ROOT / f"example1_finance_with_handoff_{pipeline}_hi_in"
                original = json.loads((original_dir / "agent.json").read_text())
                document = json.loads((hindi_dir / "agent.json").read_text())
                self.assertNotEqual(original["name"], document["name"])
                definition = document["definition"]
                self.assertEqual(
                    {"model": "azure-speech", "language": "hi-IN"},
                    definition["audio"]["input"]["transcription"],
                )
                self.assertEqual(
                    "hi-IN-SwaraNeural", definition["audio"]["output"]["voice"]["name"]
                )
                configs = [
                    definition,
                    *(node["config"] for node in definition["handoff"]["nodes"]),
                ]
                for config in configs:
                    self.assertIn("Speak natural Hindi (India, hi-IN)", config["instructions"])
                    self.assertIn("## GLOBAL CALL POLICY", config["instructions"])
                    self.assertIn("## CURRENT STAGE", config["instructions"])
                    self.assertNotIn("Speak natural Indian English", config["instructions"])
                for edge in definition["handoff"]["edges"]:
                    if "transfer_message" in edge:
                        self.assertRegex(edge["transfer_message"], r"[\u0900-\u097f]")
                self.assertRegex(definition["greeting"]["text"], r"[\u0900-\u097f]")
                expected = copy.deepcopy(original["definition"])
                actual = copy.deepcopy(definition)
                for value in (expected, actual):
                    value.pop("instructions")
                    value.pop("greeting")
                    value["audio"]["input"].pop("transcription")
                    value["audio"]["output"].pop("voice")
                    for node in value["handoff"]["nodes"]:
                        node["config"].pop("instructions")
                        interim = node["config"].get("interim_response")
                        if interim:
                            interim.pop("texts")
                    for edge in value["handoff"]["edges"]:
                        edge.pop("description")
                        edge.pop("transfer_message", None)
                self.assertEqual(expected, actual)
                for name in (".env.example", ".gitignore", "requirements.txt"):
                    self.assertEqual(
                        (original_dir / name).read_bytes(), (hindi_dir / name).read_bytes()
                    )

    def test_sdk_materialization_keeps_hindi_locale_and_distinct_name(self):
        for pipeline in ("cascade", "realtime"):
            sample = ROOT / f"example1_finance_with_handoff_{pipeline}_hi_in"
            name, _, definition = load_materialized_agent(sample, {
                "VOICE_AGENT_MCP_SERVER_URL": "https://tools.example/mcp/finance-handoff",
                "VOICE_AGENT_MCP_CONNECTION_ID": "finance-hindi-test",
            })
            self.assertEqual(f"finance-example-{pipeline}-hi-in", name)
            self.assertEqual("hi-IN", definition["audio"]["input"]["transcription"]["language"])
            self.assertEqual("hi-IN-SwaraNeural", definition["audio"]["output"]["voice"]["name"])


if __name__ == "__main__":
    unittest.main()
