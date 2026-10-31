"""Offline tests for the image input sample. No Azure calls, camera, or audio devices."""

from __future__ import annotations

import asyncio
import base64
import json
import unittest
from datetime import datetime, timezone
from unittest import mock

import image_input as ii
import voice_image_agent

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII="
)
JPEG_URL = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0fake-jpeg").decode()
PNG_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()


class MessageShapeTests(unittest.TestCase):
    def test_text_and_image_parts_are_ordered_with_string_image_url(self):
        item = ii.user_message("What color is the square?", [PNG_URL])
        self.assertEqual(item, {
            "type": "message", "role": "user",
            "content": [
                {"type": "input_text", "text": "What color is the square?"},
                {"type": "input_image", "image_url": PNG_URL, "detail": "low"},
            ],
        })
        event = ii.conversation_item_create(item)
        self.assertEqual(event["type"], "conversation.item.create")
        json.dumps(event)

    def test_image_without_text_uses_default_prompt(self):
        item = ii.user_message("  ", [PNG_URL])
        self.assertEqual(item["content"][0]["text"], ii.DEFAULT_IMAGE_PROMPT)

    def test_rejects_empty_turn_too_many_images_and_bad_detail(self):
        with self.assertRaises(ValueError):
            ii.user_message("")
        with self.assertRaises(ValueError):
            ii.user_message("x", [PNG_URL] * (ii.MAX_IMAGES_PER_TURN + 1))
        with self.assertRaises(ValueError):
            ii.user_message("x", [PNG_URL], detail="ultra")

    def test_redact_images_hides_data_urls(self):
        redacted = json.dumps(ii.redact_images(ii.conversation_item_create(ii.user_message("x", [PNG_URL]))))
        self.assertNotIn("base64", redacted)
        self.assertIn("image omitted", redacted)


class ValidationTests(unittest.TestCase):
    def test_valid_data_urls(self):
        self.assertEqual(ii.validate_image_data_url(PNG_URL), PNG_URL)
        self.assertEqual(ii.data_url_from_bytes(PNG), PNG_URL)

    def test_rejects_mismatched_type_bad_base64_remote_urls_and_oversize(self):
        for value in (
            "data:image/jpeg;base64," + base64.b64encode(PNG).decode(),
            "data:image/png;base64,@@@",
            "https://example.com/a.png",
            "data:image/gif;base64,R0lGOD",
            None,
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ii.validate_image_data_url(value)
        with self.assertRaises(ValueError):
            ii.validate_image_data_url(PNG_URL, max_bytes=len(PNG) - 1)
        with self.assertRaises(ValueError):
            ii.data_url_from_bytes(b"GIF89a")

    def test_endpoint_and_agent_name(self):
        endpoint = "https://contoso.services.ai.azure.com/api/projects/demo"
        self.assertEqual(ii.project_endpoint(endpoint + "/"), endpoint)
        for bad in ("http://contoso.services.ai.azure.com/api/projects/demo", "https://example.com/api/projects/x", ""):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                ii.project_endpoint(bad)
        self.assertTrue(ii.new_agent_name("demo-image").startswith("demo-image-"))
        with self.assertRaises(ValueError):
            ii.agent_name("bad name")

    def test_definition_uses_semantic_vad_with_azure_speech(self):
        definition = ii.agent_definition("gpt-realtime", "en-US-AvaNeural")
        audio_input = definition["audio"]["input"]
        self.assertEqual(definition["kind"], "voice")
        self.assertEqual(audio_input["transcription"]["model"], "azure-speech")
        self.assertTrue(audio_input["turn_detection"]["type"].startswith("azure_semantic_vad"))
        self.assertFalse(definition["store"])


class CameraContextTests(unittest.TestCase):
    def setUp(self):
        self.ids = iter(f"item_camera_{n}" for n in range(1, 100))
        self.camera = ii.CameraContext(max_frames=2, id_factory=lambda _n: next(self.ids))
        self.at = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def test_frame_event_shape(self):
        [event] = self.camera.queue_frame(JPEG_URL, self.at)
        self.assertEqual(event["type"], "conversation.item.create")
        self.assertEqual(event["event_id"], "event_camera_create_1")
        self.assertEqual(event["item"]["id"], "item_camera_1")
        self.assertIn("Camera frame 1, captured at 2026-01-01T00:00:00.000Z", event["item"]["content"][0]["text"])
        self.assertEqual(event["item"]["content"][1], {"type": "input_image", "image_url": JPEG_URL, "detail": "low"})

    def test_only_jpeg_frames(self):
        with self.assertRaises(ValueError):
            self.camera.queue_frame(PNG_URL)

    def test_sliding_window_deletes_oldest_before_adding(self):
        self.camera.queue_frame(JPEG_URL, self.at)
        self.camera.on_created("item_camera_1")
        self.camera.queue_frame(JPEG_URL, self.at)
        self.camera.on_created("item_camera_2")
        self.assertEqual(self.camera.retained, ["item_camera_1", "item_camera_2"])
        [delete] = self.camera.queue_frame(JPEG_URL, self.at)
        self.assertEqual(delete, {
            "type": "conversation.item.delete", "event_id": "event_camera_delete_1", "item_id": "item_camera_1",
        })
        [create] = self.camera.on_deleted("item_camera_1")
        self.assertEqual(create["item"]["id"], "item_camera_3")
        self.camera.on_created("item_camera_3")
        self.assertEqual(self.camera.retained, ["item_camera_2", "item_camera_3"])

    def test_one_operation_in_flight_and_latest_queued_frame_wins(self):
        self.assertEqual(len(self.camera.queue_frame(JPEG_URL, self.at)), 1)
        self.assertEqual(self.camera.queue_frame(JPEG_URL, self.at), [])
        self.assertEqual(self.camera.queue_frame(JPEG_URL, self.at), [])
        [event] = self.camera.on_created("item_camera_1")
        self.assertIn("Camera frame 3,", event["item"]["content"][0]["text"])

    def test_updates_pause_during_response(self):
        self.camera.set_response_active(True)
        self.assertEqual(self.camera.queue_frame(JPEG_URL, self.at), [])
        self.assertEqual(len(self.camera.set_response_active(False)), 1)

    def test_clear_deletes_all_and_errors_halt(self):
        self.camera.queue_frame(JPEG_URL, self.at)
        self.camera.on_created("item_camera_1")
        [delete] = self.camera.clear()
        self.assertEqual(delete["item_id"], "item_camera_1")
        self.assertEqual(self.camera.on_deleted("item_camera_1"), [])
        self.assertEqual(self.camera.retained, [])
        self.camera.queue_frame(JPEG_URL, self.at)
        error = {"type": "error", "error": {"event_id": "event_camera_create_2", "message": "nope"}}
        self.assertTrue(self.camera.on_error(error))
        self.assertEqual(self.camera.snapshot()["state"], "error")
        self.assertEqual(self.camera.queue_frame(JPEG_URL, self.at), [])
        self.assertFalse(self.camera.on_error({"type": "error", "error": {"event_id": "other"}}))

    def test_retained_frame_bounds(self):
        for bad in (0, 6, True, "3"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.camera.set_max_frames(bad)


class FakeConnection:
    def __init__(self, events):
        self.events = list(events)
        self.sent = []
        self.response = mock.Mock()
        self.response.create = mock.AsyncMock(side_effect=lambda **_: self.sent.append({"type": "response.create"}))

    async def send(self, event):
        self.sent.append(event)

    async def recv(self):
        return self.events.pop(0)


class AskTests(unittest.TestCase):
    def test_ask_sends_item_then_one_response_and_collects_reply(self):
        audio = base64.b64encode(b"\x00\x01" * 10).decode()
        connection = FakeConnection([
            {"type": "conversation.item.created", "item": {"id": "item_1"}},
            {"type": "response.created", "response": {"id": "resp_1"}},
            {"type": "response.output_audio_transcript.delta", "delta": "A red "},
            {"type": "response.output_audio.delta", "delta": audio},
            {"type": "response.output_audio_transcript.delta", "delta": "square."},
            {"type": "response.done", "response": {"status": "completed", "usage": {"total_tokens": 9}}},
        ])
        result = asyncio.run(voice_image_agent.ask(connection, ii.user_message("Color?", [PNG_URL])))
        self.assertEqual([event["type"] for event in connection.sent], ["conversation.item.create", "response.create"])
        self.assertEqual(result["text"], "A red square.")
        self.assertEqual(len(result["audio"]), 20)
        self.assertIn("first_audio_ms", result["timings_ms"])

    def test_ask_raises_on_error_or_failed_response(self):
        for event in (
            {"type": "error", "error": {"message": "image not supported"}},
            {"type": "response.done", "response": {"status": "failed"}},
        ):
            with self.subTest(event=event["type"]), self.assertRaises(RuntimeError):
                asyncio.run(voice_image_agent.ask(FakeConnection([event]), ii.user_message("hi")))

    def test_cli_argument_limits(self):
        with self.assertRaises(SystemExit):
            voice_image_agent.parse_args(["--image", "a.png"] * 6)
        with self.assertRaises(SystemExit):
            voice_image_agent.parse_args([])
        self.assertTrue(voice_image_agent.parse_args(["--create-only"]).create_only)


class RelayTests(unittest.TestCase):
    def setUp(self):
        import server

        self.connection = FakeConnection([])
        self.connection.input_audio_buffer = mock.Mock(append=mock.AsyncMock())
        self.notices = []
        self.audio = []

        async def notify(message):
            self.notices.append(message)

        async def send_audio(delta):
            self.audio.append(delta)

        self.relay = server.Relay(self.connection, notify, send_audio)

    def test_image_packet_becomes_item_and_response(self):
        asyncio.run(self.relay.from_browser({"type": "image", "text": "What is it?", "images": [PNG_URL]}))
        self.assertEqual(self.connection.sent[0]["item"]["content"][1]["image_url"], PNG_URL)
        self.assertEqual(self.connection.sent[1], {"type": "response.create"})

    def test_rejects_invalid_browser_packets(self):
        for packet in (
            {"type": "image", "images": []},
            {"type": "image", "images": ["https://example.com/a.png"]},
            {"type": "session.update"},
        ):
            with self.subTest(packet=packet), self.assertRaises(ValueError):
                asyncio.run(self.relay.from_browser(packet))
        self.assertEqual(self.connection.sent, [])

    def test_camera_frames_wait_for_active_response(self):
        asyncio.run(self.relay.from_cloud({"type": "response.created"}))
        asyncio.run(self.relay.from_browser({"type": "camera_frame", "image": JPEG_URL}))
        self.assertEqual(self.connection.sent, [])
        asyncio.run(self.relay.from_cloud({"type": "response.done", "response": {"status": "completed"}}))
        self.assertEqual(self.connection.sent[0]["type"], "conversation.item.create")
        self.assertTrue(self.connection.sent[0]["item"]["id"].startswith("item_camera_"))

    def test_audio_and_transcripts_are_forwarded(self):
        asyncio.run(self.relay.from_cloud({"type": "response.output_audio.delta", "delta": "AAA="}))
        asyncio.run(self.relay.from_cloud({"type": "response.output_audio_transcript.delta", "delta": "hi"}))
        self.assertEqual(self.audio, ["AAA="])
        self.assertIn({"type": "assistant_delta", "delta": "hi"}, self.notices)


class ServerHttpTests(unittest.IsolatedAsyncioTestCase):
    async def test_loopback_origin_and_static_allowlist(self):
        import socket

        from aiohttp.test_utils import TestClient, TestServer

        import server

        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        app = server.create_app(port, with_cloud=False)
        async with TestClient(TestServer(app, port=port, host="127.0.0.1")) as client:
            self.assertEqual((await client.get("/healthz")).status, 200)
            self.assertEqual((await client.get("/static/app.js")).status, 200)
            self.assertEqual((await client.get("/static/..%2Fserver.py")).status, 404)
            forbidden = await client.get("/api/config", headers={"Origin": "https://evil.example"})
            self.assertEqual(forbidden.status, 403)
            config = await (await client.get("/api/config")).json()
            self.assertEqual(config["max_images"], ii.MAX_IMAGES_PER_TURN)


if __name__ == "__main__":
    unittest.main()
