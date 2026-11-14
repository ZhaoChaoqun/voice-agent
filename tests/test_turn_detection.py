"""Offline coverage for turn detection and noise suppression configuration."""

import asyncio
import io
import os
import runpy
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from azure.ai.projects import models
from azure.ai.projects.models import VoiceAgentDefinition

SAMPLE = Path(__file__).resolve().parents[1] / "samples/turn_detection/create_turn_detection_agent.py"
TALK_SAMPLE = SAMPLE.with_name("talk_to_turn_detection_agent.py")
MODES = (
    "azure_deep_noise_suppression",
    "azure_deep_noise_suppression_headset",
    "azure_personal_noise_suppression",
)
PERSONAL = {"type": "azure_personal_noise_suppression"}


class TurnDetectionSampleTests(unittest.TestCase):
    def run_sample(self, arguments=(), saved_input=None):
        self.client = MagicMock()
        self.client.__enter__.return_value = self.client
        self.client.agents.create_version.return_value = SimpleNamespace(
            name="turn-detection-test", version="1",
        )

        def readback(**kwargs):
            stored = self.client.agents.create_version.call_args.kwargs["definition"].as_dict()
            for key, value in (saved_input or {}).items():
                if value is None:
                    stored["audio"]["input"].pop(key, None)
                else:
                    stored["audio"]["input"][key] = value
            return SimpleNamespace(definition=VoiceAgentDefinition(stored))

        self.client.agents.get_version.side_effect = readback
        self.output = io.StringIO()
        with (
            patch.dict(os.environ, {
                "FOUNDRY_PROJECT_ENDPOINT": "https://sample.services.ai.azure.com/api/projects/sample",
                "FOUNDRY_VOICE_AGENT_NAME": "turn-detection-test",
            }),
            patch.object(sys, "argv", [str(SAMPLE), *arguments]),
            patch("azure.identity.DefaultAzureCredential"),
            patch("azure.ai.projects.AIProjectClient", return_value=self.client),
            redirect_stdout(self.output),
            redirect_stderr(io.StringIO()),
        ):
            runpy.run_path(str(SAMPLE), run_name="__main__")
        return self.client.agents.create_version.call_args.kwargs["definition"].as_dict()

    def test_default_and_all_noise_modes_preserve_turn_detection(self):
        for mode in (None, *MODES, "none"):
            with self.subTest(mode=mode):
                arguments = () if mode is None else ("--noise-reduction", mode)
                stored = self.run_sample(arguments)
                audio_input = stored["audio"]["input"]
                if mode == "none":
                    self.assertNotIn("noise_reduction", audio_input)
                else:
                    self.assertEqual(audio_input["noise_reduction"], {"type": mode or MODES[0]})
                self.assertEqual(audio_input["echo_cancellation"], {"type": "server_echo_cancellation"})
                self.assertIn(f"noise_reduction.type: {mode or MODES[0]}\n", self.output.getvalue())
                self.assertIn("echo_cancellation.type: server_echo_cancellation\n", self.output.getvalue())
                self.assertEqual(audio_input["format"], {"type": "audio/pcm", "rate": 24000})
                self.assertEqual(audio_input["transcription"]["model"], "azure-speech-streaming")
                self.assertEqual(audio_input["turn_detection"]["type"], "azure_semantic_vad_multilingual")
                self.assertIn("speech_start_detection", audio_input["turn_detection"])
                self.assertEqual(
                    audio_input["turn_detection"]["end_of_utterance_detection"]["model"],
                    "microsoft-decision-1",
                )
                self.client.agents.create_version.assert_called_once()
                self.client.agents.get_version.assert_called_once_with(
                    agent_name="turn-detection-test", agent_version="1",
                )

    def test_invalid_noise_mode_fails_before_creation(self):
        with self.assertRaises(SystemExit) as error:
            self.run_sample(("--noise-reduction", "unknown"))
        self.assertEqual(error.exception.code, 2)
        self.client.agents.create_version.assert_not_called()

    def test_missing_or_changed_saved_audio_settings_are_rejected(self):
        for arguments, saved_input, message in (
            ((), {"noise_reduction": None}, "noise_reduction none"),
            ((), {"noise_reduction": PERSONAL}, "noise_reduction azure_personal_noise_suppression"),
            (
                ("--noise-reduction", "none"),
                {"noise_reduction": PERSONAL},
                "noise_reduction azure_personal_noise_suppression",
            ),
            ((), {"echo_cancellation": None}, "echo_cancellation"),
        ):
            with (
                self.subTest(arguments=arguments, saved_input=saved_input),
                self.assertRaisesRegex(RuntimeError, message),
            ):
                self.run_sample(arguments, saved_input)


class TalkSampleTests(unittest.TestCase):
    def session_ready_line(self, input_audio):
        with (
            patch.dict(sys.modules, {"pyaudio": MagicMock()}),
            patch("asyncio.run", side_effect=lambda coroutine: coroutine.close()),
        ):
            sample = runpy.run_path(str(TALK_SAMPLE))
        event = models.RealtimeServerEventSessionUpdated({
            "type": "session.updated",
            "event_id": "event-1",
            "session": {"audio": {"input": input_audio}},
        })
        connection = SimpleNamespace(recv=AsyncMock(return_value=event))
        with redirect_stdout(io.StringIO()) as output:
            asyncio.run(sample["wait_until_ready"](connection))
        return output.getvalue().strip()

    def test_session_ready_line_reports_noise_reduction(self):
        turn_detection = {
            "type": "azure_semantic_vad_multilingual",
            "speech_start_detection": {"while_assistant_speaking": {"num_words": 3}},
            "end_of_utterance_detection": {"model": "microsoft-decision-1"},
        }
        for noise_reduction, expected in (
            ({"noise_reduction": PERSONAL}, "azure_personal_noise_suppression"),
            ({"noise_reduction": None}, "off"),
            ({}, "not reported"),
        ):
            with self.subTest(expected=expected):
                self.assertEqual(
                    self.session_ready_line({"turn_detection": turn_detection, **noise_reduction}),
                    "Session ready: speech_start_detection on, "
                    "end_of_utterance_detection model microsoft-decision-1, "
                    f"noise_reduction {expected}",
                )


if __name__ == "__main__":
    unittest.main()
