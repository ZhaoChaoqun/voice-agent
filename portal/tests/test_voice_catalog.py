# Copyright (c) Microsoft. All rights reserved.
"""Voice discovery, reference provenance and locale metadata regression tests."""
import json
import unittest
from unittest.mock import Mock, patch

from common import AgentsConfig
import voice_catalog


class VoiceCatalogTests(unittest.TestCase):
    def test_bundled_catalog_needs_no_live_permission_and_has_default_and_hindi_voices(self):
        with patch.object(voice_catalog, "_account_json") as upstream:
            catalog = voice_catalog.load_default_voice_catalog()
        upstream.assert_not_called()
        self.assertEqual("bundled", catalog["source"])
        self.assertGreaterEqual(len(catalog["voices"]), 900)
        voices = {item["id"]: item for item in catalog["voices"]}
        self.assertIn("hi-IN-SwaraNeural", voices)
        self.assertIn("en-US-Ava:DragonHDLatestNeural", voices)
        self.assertIn("alloy", voices)
        self.assertEqual("en-US", voices["emma"]["locale"])
        self.assertEqual("hi-IN", voices["diya"]["locale"])
        self.assertEqual(["en-IN"], voices["diya"]["secondaryLocales"])
        self.assertEqual(34, sum(voice["type"] == "azure-realtime-native" for voice in voices.values()))
        self.assertIn("does not verify availability", catalog["notice"])

    def test_reference_has_full_locale_coverage_and_reproducible_provenance(self):
        reference = json.loads(voice_catalog.REFERENCE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(1, reference["schema_version"])
        self.assertIn("cognitiveservices/voices/list", reference["source"])
        self.assertGreaterEqual(len(reference["voices"]), 900)
        self.assertGreaterEqual(len({item["locale"] for item in reference["voices"]}), 150)
        names = {item["id"] for item in reference["voices"]}
        self.assertTrue({
            "en-us-emma:DragonHDOmniLatestNeural",
            "en-US-Brian:DragonHDOmniLatestNeural",
            "hi-IN-SwaraNeural",
            "ta-IN-PallaviNeural",
            "fr-FR-DeniseNeural",
            "ja-JP-NanamiNeural",
        } <= names)

    def test_live_native_locales_are_not_guessed_from_short_names(self):
        reference = {"schema_version": 1, "voices": [{"id": "fr-FR-DeniseNeural", "locale": "fr-FR"}],
                     "region": "southeastasia", "source": "official-api", "fetched_at": "2026-10-27"}
        catalog = voice_catalog.build_voice_catalog(
            {"voices": {
                "openai": ["alloy"],
                "azure-realtime-native": [
                    {"name": "emma", "locale": "en-US"},
                    {"name": "diya", "locale": "hi-IN / en-IN"},
                ],
            }},
            reference,
        )
        voices = {item["id"]: item for item in catalog["voices"]}
        self.assertEqual("en-US", voices["emma"]["locale"])
        self.assertEqual("hi-IN", voices["diya"]["locale"])
        self.assertEqual(["en-IN"], voices["diya"]["secondaryLocales"])
        self.assertEqual("", voices["alloy"]["locale"])
        self.assertIn("not a region-specific availability guarantee", catalog["notice"])

    def test_speech_list_normalizes_names_without_dropping_non_english_voices(self):
        result = voice_catalog.speech_voices([
            {"ShortName": "hi-IN-SwaraNeural", "Locale": "hi-IN", "DisplayName": "Swara"},
            {"ShortName": "fr-FR-DeniseNeural", "Locale": "fr-FR"},
        ])
        self.assertEqual(["fr-FR", "hi-IN"], [item["locale"] for item in result])
        self.assertTrue(all(item["type"] == "azure-standard" for item in result))
        for invalid in (None, {}, [], [{"Locale": "hi-IN"}]):
            with self.subTest(payload=invalid), self.assertRaises(ValueError):
                voice_catalog.speech_voices(invalid)

    def test_invalid_capabilities_fail_explicitly(self):
        reference = {"schema_version": 1, "voices": [{"id": "voice"}]}
        for invalid in (None, {}, {"voices": {}}, {"voices": {"openai": [42]}}):
            with self.subTest(payload=invalid), self.assertRaises(ValueError):
                voice_catalog.build_voice_catalog(invalid, reference)

    def test_discovery_uses_the_selected_account_and_speech_token_scope(self):
        cfg = AgentsConfig.from_endpoint(
            "https://sample.services.ai.azure.com/api/projects/sample-project",
        )
        cfg._credential = Mock()
        cfg._credential.get_token.return_value.token = "fixture-token"
        response = Mock(status_code=200)
        response.json.return_value = {"voices": {"openai": [], "azure-realtime-native": []}}
        with patch.object(voice_catalog.requests, "get", return_value=response) as get:
            catalog = voice_catalog.load_voice_catalog(cfg)
        self.assertGreaterEqual(len(catalog["voices"]), 900)
        cfg._credential.get_token.assert_called_once_with(voice_catalog.SPEECH_SCOPE)
        self.assertEqual(
            "https://sample.cognitiveservices.azure.com/voice-live/capabilities",
            get.call_args.args[0],
        )
        self.assertEqual({"api-version": "v1"}, get.call_args.kwargs["params"])
        self.assertFalse(get.call_args.kwargs["allow_redirects"])
        voices = {item["id"]: item for item in catalog["voices"]}
        self.assertEqual(
            "en-us-emma:DragonHDOmniLatestNeural",
            voices["en-US-Emma:DragonHDOmniLatestNeural"]["advertisedId"],
        )
