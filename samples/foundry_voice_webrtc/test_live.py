"""GPT Live versioning, transport and event isolation regressions."""

import asyncio
import copy
import json
from pathlib import Path
import re
import unittest
from unittest.mock import AsyncMock, patch

import aiohttp
from aiohttp.test_utils import TestClient, TestServer

from check_websocket import check_live
from live import (LiveSessionError, connect_live, live_client_frame,
                  live_definition, personalization_events, relay_live)
from server import (ACTIVE, DOWNLOAD_SECRET, SETTINGS, Settings, create_app,
                    verify_download_token)
from test_agent_creation import Response
from test_model_management import ServiceClient


async def frames(events):
    for event in events:
        yield aiohttp.WSMessage(aiohttp.WSMsgType.TEXT, json.dumps(event), "")


class LiveTests(unittest.IsolatedAsyncioTestCase):
    def definition(self):
        return json.loads(Path(__file__).with_name("personalized-agent.json").read_text())

    def test_live_voice_control_only_offers_saved_voice(self):
        page = Path(__file__).with_name("public").joinpath("index.html").read_text(encoding="utf-8")
        select = re.search(r'<select id="live-voice".*?</select>', page, re.S).group()
        self.assertEqual(re.findall(r'<option value="([^"]*)"', select), [""])
        self.assertIn("disabled", select.split(">")[0])
        self.assertIn("Saved Agent voice (configured in Foundry)", select)

    def test_live_definition_uses_deployments_and_no_realtime_only_fields(self):
        source = self.definition()
        before = copy.deepcopy(source)
        live = live_definition(source, "gpt-live-1-test", "gpt-5.4")
        self.assertEqual(source, before)
        self.assertEqual(live["model_type"], "self_deployed")
        self.assertEqual(live["sub_protocol"], "live")
        self.assertEqual(live["model"], "gpt-live-1-test")
        self.assertEqual(live["audio"]["output"], {"voice": "marin"})
        self.assertNotIn("input", live["audio"])
        self.assertNotIn("tools", live)
        self.assertNotIn("greeting", live)
        self.assertNotIn("output_modalities", live)
        backend = live["delegation"]["responses"]
        self.assertEqual(backend["model"], "gpt-5.4")
        self.assertEqual(backend["tools"], [{"type": "web_search"}])
        self.assertNotIn("{{", backend["instructions"])
        self.assertIn("web search on any topic", live["instructions"])
        self.assertIn("search is not limited to weather or current events", backend["instructions"])
        self.assertIn("only when the requested search needs it", backend["instructions"])

    def test_personalization_is_trusted_policy_then_bounded_untrusted_context(self):
        values = {"language_policy": "Use English.", "display_name": "A", "client_language": "en-US",
                  "user_context": "\u4e2d" * 2000}
        events = personalization_events(values)
        self.assertEqual(events[0], {"type": "session.instructions.append",
                                    "delegation_id": None, "content": "Use English."})
        self.assertTrue(all(event["type"] == "session.thinking.append" for event in events[1:]))
        self.assertTrue(all(len(event["content"].encode("utf-8")) < 500 for event in events))
        self.assertEqual(personalization_events(None), [])

    def saved(self, definition, version="1", metadata=None):
        return {"versions": {"latest": {"version": version, "definition": definition,
                                      "metadata": metadata or {}}}}

    def config(self, **kwargs):
        return Settings("https://example.services.ai.azure.com/api/projects/demo", "demo-agent", **kwargs)

    def companion(self, cfg, definition, version="1"):
        return self.saved(definition, version, {"sample": "foundry_voice_webrtc",
                                               "voice_companion_for": cfg.agent})

    async def test_switch_to_live_creates_separate_agent_without_changing_original(self):
        source = self.definition()
        before = copy.deepcopy(source)
        live = live_definition(source, "live-deploy", "reasoning-deploy")
        cfg = self.config(live_deployment="live-deploy", live_backend_deployment="reasoning-deploy")
        service = ServiceClient([Response(200, self.saved(source, metadata={"custom": "keep"})),
                                 Response(404), Response(200), Response(200, self.companion(cfg, live))],
                                [Response(200, {"version": "1"}), Response(204)])
        app = create_app(cfg, AsyncMock())
        async with TestClient(TestServer(app)) as client:
            with patch("server.aiohttp.ClientSession", return_value=service):
                response = await client.post("/api/agent/model",
                    headers={"Origin": str(client.make_url("")).rstrip("/")},
                    json={"model": "gpt-live-1", "version": "1"})
                result = await response.json()
        self.assertEqual(response.status, 200, result)
        self.assertEqual(result["model"], "live-deploy")
        self.assertEqual(result["modelChoice"], "gpt-live-1")
        self.assertIsNone(result["transcriptionModel"])
        self.assertEqual(result["agent"], "demo-agent-live")
        self.assertTrue(result["switchedAgent"])
        self.assertFalse(result["personalizationRequired"])
        self.assertEqual(app[SETTINGS], cfg)
        self.assertEqual(source, before)
        payload = service.writes[0][1]["json"]
        self.assertEqual(payload["definition"], live)
        for instructions in (payload["definition"]["instructions"],
                             payload["definition"]["delegation"]["responses"]["instructions"]):
            self.assertIn("current time in a city", instructions)
            self.assertIn("Do not claim you lack real-time access without attempting the lookup", instructions)
            self.assertIn("If the lookup fails, explain that honestly.", instructions)
        self.assertIn("Handle greetings and casual conversation yourself.", payload["definition"]["instructions"])
        self.assertEqual(payload["definition"]["delegation"]["responses"]["instructions"].count(
            "\n\nWEB SEARCH\n"), 1)
        self.assertEqual(payload["metadata"], {"sample": "foundry_voice_webrtc",
            "voice_companion_for": cfg.agent, "realtime_source_version": "1"})
        self.assertTrue(service.writes[0][0].endswith("/agents/demo-agent-live/versions"))
        self.assertTrue(service.writes[1][0].endswith("/agents/demo-agent-live:enable"))
        self.assertEqual(service.removals, [])

    async def test_switch_back_selects_latest_original_without_republishing_or_deleting(self):
        cfg = self.config()
        source = self.definition()
        source["instructions"] = "Custom instructions edited after creating the companion."
        source["audio"]["input"]["transcription"]["model"] = "whisper-1"
        live = live_definition(source, "live-deploy", "backend")
        original = self.saved(source, "7", {"custom": "keep"})
        before = copy.deepcopy(original)
        service = ServiceClient([Response(200, self.companion(cfg, live, "2")),
                                 Response(200, original), Response(200, original)], [Response(204)])
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            with patch("server.aiohttp.ClientSession", return_value=service):
                response = await client.post("/api/agent/model?agent=demo-agent-live",
                    headers={"Origin": str(client.make_url("")).rstrip("/")},
                    json={"model": source["model"], "version": "2"})
                result = await response.json()
        self.assertEqual(response.status, 200, result)
        self.assertEqual(result["agent"], cfg.agent)
        self.assertEqual(result["version"], "7")
        self.assertEqual(result["transcriptionModel"], "whisper-1")
        self.assertTrue(result["personalizationRequired"])
        self.assertEqual(original, before)
        self.assertEqual(len(service.writes), 1)
        self.assertTrue(service.writes[0][0].endswith("/agents/demo-agent:enable"))
        self.assertEqual(service.removals, [])

    async def test_repeated_switch_reuses_companion_across_app_restarts(self):
        cfg = self.config()
        source = self.definition()
        live = live_definition(source, "custom-live-deployment", "custom-backend")
        live["instructions"] = "Keep independently edited speaker instructions."
        saved = self.companion(cfg, live, "4")
        for selected in (cfg.agent, cfg.agent, cfg.live_companion().agent):
            with self.subTest(selected=selected):
                reads = ([Response(200, self.saved(source, "3"))] if selected == cfg.agent else [])
                service = ServiceClient([*reads, Response(200, saved), Response(200, saved)], [Response(204)])
                async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
                    with patch("server.aiohttp.ClientSession", return_value=service):
                        response = await client.post(f"/api/agent/model?agent={selected}",
                            headers={"Origin": str(client.make_url("")).rstrip("/")},
                            json={"model": "gpt-live-1", "version": "3" if selected == cfg.agent else "4"})
                        result = await response.json()
                self.assertEqual(response.status, 200, result)
                self.assertEqual(result["version"], "4")
                self.assertEqual(result["model"], "custom-live-deployment")
                self.assertEqual(len(service.writes), 1)
                self.assertTrue(service.writes[0][0].endswith("/agents/demo-agent-live:enable"))
                self.assertEqual(service.removals, [])

    async def test_switch_back_with_explicit_changes_publishes_only_to_original_realtime_agent(self):
        cfg = self.config()
        source = self.definition()
        live = live_definition(source, "live", "backend")
        changed = copy.deepcopy(source)
        changed["model"] = "gpt-realtime-2.1-mini"
        changed["audio"]["input"]["transcription"]["model"] = "whisper-1"
        service = ServiceClient([Response(200, self.companion(cfg, live, "2")),
                                 Response(200, self.saved(source, "7", {"custom": "keep"})),
                                 Response(200, self.saved(changed, "8"))],
                                [Response(201, {"version": "8"}), Response(204)])
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            with patch("server.aiohttp.ClientSession", return_value=service):
                response = await client.post("/api/agent/model?agent=demo-agent-live",
                    headers={"Origin": str(client.make_url("")).rstrip("/")},
                    json={"model": "gpt-realtime-2.1-mini", "version": "2", "transcriptionModel": "whisper-1"})
                result = await response.json()
        self.assertEqual(response.status, 200, result)
        self.assertEqual(result["agent"], cfg.agent)
        self.assertTrue(service.writes[0][0].endswith("/agents/demo-agent/versions"))
        self.assertEqual(service.writes[0][1]["json"], {"definition": changed, "metadata": {"custom": "keep"}})
        self.assertEqual(service.removals, [])

    async def test_directly_configured_live_agent_cannot_be_reset_to_realtime(self):
        cfg = self.config(allow_agent_recreate=True)
        live = live_definition(self.definition(), "live", "backend")
        service = ServiceClient([Response(200, self.saved(live, metadata={"sample": "foundry_voice_webrtc"}))])
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            with patch("server.aiohttp.ClientSession", return_value=service):
                response = await client.post("/api/agent/recreate",
                    headers={"Origin": str(client.make_url("")).rstrip("/")},
                    json={"confirm_agent": cfg.agent})
                result = await response.json()
        self.assertEqual(response.status, 502)
        self.assertIn("Reset is unavailable for GPT Live", result["error"])
        self.assertEqual(service.writes, [])
        self.assertEqual(service.removals, [])

    async def test_unrelated_companion_is_not_overwritten_or_enabled(self):
        cfg = self.config()
        source = self.definition()
        live = live_definition(source, "live", "backend")
        for definition, metadata in ((live, {}), (live, {"voice_companion_for": "another-agent"}),
                (source, {"voice_companion_for": cfg.agent}),
                (live, {"sample": "foundry_voice_webrtc", "companion_of": "another-agent"}),
                (live, {"companion_of": cfg.agent}),
                (live, {"sample": "foundry_voice_webrtc", "companion_of": cfg.agent,
                        "voice_companion_for": "another-agent"})):
            service = ServiceClient([Response(200, self.saved(source)),
                                     Response(200, self.saved(definition, metadata=metadata))])
            async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
                with patch("server.aiohttp.ClientSession", return_value=service):
                    response = await client.post("/api/agent/model",
                        headers={"Origin": str(client.make_url("")).rstrip("/")},
                        json={"model": "gpt-live-1", "version": "1"})
                    result = await response.json()
            self.assertEqual(response.status, 502, result)
            self.assertIn("unrelated Agent", result["error"])
            self.assertEqual(service.writes, [])
            self.assertEqual(service.removals, [])

    async def test_legacy_sample_companion_is_reused_without_republishing_or_metadata_changes(self):
        cfg = self.config()
        source = self.definition()
        live = live_definition(source, "saved-live-deployment", "saved-backend")
        saved = self.saved(live, "5", {"sample": "foundry_voice_webrtc", "companion_of": cfg.agent})
        before = copy.deepcopy(saved)
        service = ServiceClient([Response(200, self.saved(source)), Response(200, saved), Response(200, saved)],
                                [Response(204)])
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            with patch("server.aiohttp.ClientSession", return_value=service):
                response = await client.post("/api/agent/model",
                    headers={"Origin": str(client.make_url("")).rstrip("/")},
                    json={"model": "gpt-live-1", "version": "1"})
                result = await response.json()
        self.assertEqual(response.status, 200, result)
        self.assertEqual(result["agent"], "demo-agent-live")
        self.assertEqual(result["version"], "5")
        self.assertEqual(saved, before)
        self.assertEqual(len(service.writes), 1)
        self.assertTrue(service.writes[0][0].endswith("/agents/demo-agent-live:enable"))
        self.assertEqual(service.removals, [])

    async def test_switch_rejects_stale_version_and_active_call_before_any_write(self):
        cfg = self.config()
        for active in (False, True):
            service = ServiceClient([Response(200, self.saved(self.definition(), "3"))])
            app = create_app(cfg, AsyncMock())
            app[ACTIVE].active = active
            async with TestClient(TestServer(app)) as client:
                with patch("server.aiohttp.ClientSession", return_value=service):
                    response = await client.post("/api/agent/model",
                        headers={"Origin": str(client.make_url("")).rstrip("/")},
                        json={"model": "gpt-live-1", "version": "1"})
            self.assertEqual(response.status, 409)
            self.assertEqual(service.writes, [])

    async def test_failed_companion_publish_preserves_both_agents_and_reports_request_id(self):
        cfg = self.config()
        service = ServiceClient([Response(200, self.saved(self.definition())), Response(404), Response(200)],
            [Response(400, {"error": {"message": "Do not disclose this raw upstream payload.",
                                     "additionalInfo": {"request_id": "request-123"}}})])
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            with patch("server.aiohttp.ClientSession", return_value=service):
                response = await client.post("/api/agent/model",
                    headers={"Origin": str(client.make_url("")).rstrip("/")},
                    json={"model": "gpt-live-1", "version": "1"})
                result = await response.json()
        self.assertEqual(response.status, 502, result)
        self.assertIn("request-123", result["error"])
        self.assertNotIn("raw upstream", result["error"])
        self.assertEqual(len(service.writes), 1)
        self.assertIn("/agents/demo-agent-live/versions", service.writes[0][0])
        self.assertEqual(service.removals, [])

    async def test_companion_status_settings_and_preparation_route_to_selected_agent(self):
        cfg = self.config(personalization_required=True)
        live = live_definition(self.definition(), "live-deploy", "backend")
        saved = self.companion(cfg, live, "4")
        service = ServiceClient([Response(200, saved) for _ in range(3)], [Response(204)])
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            origin = {"Origin": str(client.make_url("")).rstrip("/")}
            with patch("server.aiohttp.ClientSession", return_value=service), patch.object(
                    service, "get", wraps=service.get) as reads:
                response = await client.get("/api/agent?agent=demo-agent-live")
                result = await response.json()
                self.assertEqual(result["agent"], "demo-agent-live")
                self.assertFalse(result["personalizationRequired"])
                response = await client.get("/api/agent/settings?agent=demo-agent-live")
                self.assertIn("name: demo-agent-live", (await response.json())["yaml"])
                response = await client.post("/api/agent/prepare?agent=demo-agent-live", headers=origin)
                self.assertEqual(response.status, 200, await response.text())
                response = await client.post("/api/agent/recreate?agent=demo-agent-live", headers=origin,
                                              json={"confirm_agent": "demo-agent-live"})
                self.assertEqual(response.status, 409)
                for read in reads.call_args_list:
                    self.assertIn("/agents/demo-agent-live?", read.args[0])
        self.assertEqual(len(service.writes), 1)
        self.assertIn("/agents/demo-agent-live:enable?", service.writes[0][0])
        self.assertEqual(service.removals, [])

    async def test_missing_companion_is_not_created_from_realtime_template_during_preparation(self):
        cfg = self.config()
        service = ServiceClient([Response(404), Response(200)])
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            with patch("server.aiohttp.ClientSession", return_value=service):
                response = await client.post("/api/agent/prepare?agent=demo-agent-live",
                    headers={"Origin": str(client.make_url("")).rstrip("/")})
                result = await response.json()
        self.assertEqual(response.status, 502)
        self.assertIn("companion is missing", result["error"])
        self.assertEqual(service.writes, [])

    async def test_arbitrary_agent_selection_is_rejected_before_authentication(self):
        tokens = AsyncMock()
        async with TestClient(TestServer(create_app(self.config(), tokens))) as client:
            response = await client.get("/api/agent?agent=unrelated-agent")
            self.assertEqual(response.status, 400)
        tokens.get_token.assert_not_awaited()

    async def test_live_bridge_routes_to_companion_and_binds_download_token_to_it(self):
        cfg = self.config(personalization_required=True)
        live = live_definition(self.definition(), "live", "backend")
        service = ServiceClient([Response(200, self.companion(cfg, live, "4"))])
        app = create_app(cfg, AsyncMock())
        async def connect(client, browser, selected, headers, transport, version, announce, values):
            self.assertEqual(selected.agent, "demo-agent-live")
            self.assertEqual(version, "4")
            self.assertIsNone(values)
            self.assertNotIn("x-ms-voice-session-override", headers)
            await announce("conv_live")
        async with TestClient(TestServer(app)) as client:
            with patch("server.aiohttp.ClientSession", return_value=service), patch("server.connect_live", connect):
                async with client.ws_connect("/api/voice?transport=websocket&protocol=live&agent=demo-agent-live",
                        headers={"Origin": str(client.make_url("")).rstrip("/")}) as ws:
                    event = await ws.receive_json()
        self.assertEqual(event["agent"], "demo-agent-live")
        self.assertEqual(verify_download_token(app[DOWNLOAD_SECRET], "demo-agent-live",
                                              event["downloadToken"]), "conv_live")

    async def test_browser_live_voice_and_personalization_do_not_send_realtime_override(self):
        cfg = self.config(personalization_required=True)
        live = live_definition(self.definition(), "live", "backend")
        for voice in ("", "marin"):
            service = ServiceClient([Response(200, self.companion(cfg, live))])
            async def connect(client, browser, selected, headers, transport, version, announce, values):
                self.assertNotIn("x-ms-voice-session-override", headers)
                self.assertNotIn("x-ms-voice-structured-inputs", headers)
                self.assertEqual(values["display_name"], "Test")
                self.assertEqual(values["client_language"], "en-US")
                self.assertIn("entire conversation in English", values["language_policy"])
                await browser.send_json({"type": "bridge.ready", "protocol": "live"})
            async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
                with patch("server.aiohttp.ClientSession", return_value=service), patch("server.connect_live", connect):
                    async with client.ws_connect(
                            "/api/voice?transport=websocket&protocol=live&agent=demo-agent-live"
                            f"&personalize=true&voice={voice}",
                            headers={"Origin": str(client.make_url("")).rstrip("/")}) as ws:
                        await ws.send_json({"type": "bridge.personalize", "display_name": "Test",
                            "user_context": "", "client_language": "en-US", "english_only": True})
                        self.assertEqual((await ws.receive_json())["type"], "bridge.ready")
            self.assertEqual(service.writes, [])

    async def test_different_live_voice_fails_explicitly_without_changing_saved_agent(self):
        cfg = self.config()
        live = live_definition(self.definition(), "live", "backend")
        saved = self.companion(cfg, live)
        before = copy.deepcopy(saved)
        service = ServiceClient([Response(200, saved)])
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            with patch("server.aiohttp.ClientSession", return_value=service), patch(
                    "server.connect_live", AsyncMock()) as connect:
                async with client.ws_connect(
                        "/api/voice?transport=websocket&protocol=live&agent=demo-agent-live&voice=alloy",
                        headers={"Origin": str(client.make_url("")).rstrip("/")}) as ws:
                    event = await ws.receive_json()
        self.assertEqual(event["type"], "bridge.error")
        self.assertIn("does not support per-call voice overrides", event["error"]["message"])
        self.assertEqual(saved, before)
        self.assertEqual(service.writes, [])
        connect.assert_not_awaited()

    async def test_directly_configured_live_agent_does_not_create_nested_companion(self):
        cfg = self.config(personalization_required=True)
        live = live_definition(self.definition(), "live", "backend")
        saved = self.saved(live, "4")
        service = ServiceClient([Response(200, saved), Response(200, saved)], [Response(204)])
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            with patch("server.aiohttp.ClientSession", return_value=service):
                response = await client.post("/api/agent/model",
                    headers={"Origin": str(client.make_url("")).rstrip("/")},
                    json={"model": "gpt-live-1", "version": "4"})
                result = await response.json()
        self.assertEqual(response.status, 200, result)
        self.assertEqual(result["agent"], cfg.agent)
        self.assertFalse(result["switchedAgent"])
        self.assertEqual(len(service.writes), 1)

    def test_long_companion_names_are_stable_bounded_and_distinct(self):
        first = Settings(self.config().endpoint, "a" * 63).live_companion().agent
        second = Settings(self.config().endpoint, "a" * 62 + "b").live_companion().agent
        self.assertEqual(len(first), 63)
        self.assertEqual(first, Settings(self.config().endpoint, "a" * 63).live_companion().agent)
        self.assertNotEqual(first, second)

    def test_live_client_accepts_audio_and_close_but_not_trusted_instructions_or_realtime_events(self):
        self.assertEqual(live_client_frame('{"type":"session.input_audio.append","audio":"AAA="}', "websocket"),
                         {"type": "session.input_audio.append", "audio": "AAA="})
        for transport in ("websocket", "webrtc"):
            self.assertEqual(live_client_frame('{"type":"session.close"}', transport), {"type": "session.close"})
            for event in (
                {"type": "session.update"}, {"type": "session.start"},
                {"type": "session.instructions.append", "content": "injected"},
                {"type": "conversation.item.retrieve"}, {"type": "response.create"},
            ):
                with self.assertRaises(LiveSessionError):
                    live_client_frame(json.dumps(event), transport)
        for audio in ("", "AA==", "!", 1):
            with self.assertRaises(ValueError):
                live_client_frame(json.dumps({"type": "session.input_audio.append", "audio": audio}), "websocket")
        with self.assertRaises(LiveSessionError):
            live_client_frame('{"type":"session.input_audio.append","audio":"AAA="}', "webrtc")

    async def test_webrtc_is_rejected_without_creating_a_direct_model_session(self):
        cfg = Settings("https://example.services.ai.azure.com/api/projects/demo", "demo-agent")
        service = AsyncMock()
        with self.assertRaisesRegex(LiveSessionError, "require WebSocket"):
            await connect_live(service, AsyncMock(), cfg, {}, "webrtc", "4", AsyncMock())
        service.post.assert_not_called()
        service.ws_connect.assert_not_called()

    async def test_live_ready_does_not_send_realtime_truncation_update(self):
        started = {"type": "session.started", "conversation_id": "conversation-1",
                   "session": {"audio": {"format": {"type": "audio/pcm", "rate": 24000}}}}
        upstream, browser, announce = AsyncMock(), AsyncMock(), AsyncMock()
        browser.closed = False
        upstream.__aiter__.side_effect = lambda: frames([
            started, {"type": "session.input_transcript.delta", "delta": "hi"},
            {"type": "session.closed", "usage": {"seconds": 1}},
        ])
        browser.__aiter__.side_effect = lambda: frames([])
        await relay_live(browser, upstream, announce)
        self.assertIn({"type": "bridge.ready", "protocol": "live"},
                      [call.args[0] for call in browser.send_json.call_args_list])
        announce.assert_awaited_once_with("conversation-1")
        self.assertFalse(any(call.args[0]["type"] == "session.update" for call in upstream.send_json.call_args_list))

    async def test_personalization_acknowledgments_are_required_before_microphone_readiness(self):
        values = {"language_policy": "Use English.", "display_name": "", "client_language": "en-US", "user_context": ""}
        upstream, browser = AsyncMock(), AsyncMock()
        browser.closed = False
        upstream.__aiter__.side_effect = lambda: frames([
            {"type": "session.started", "session": {"audio": {"format": {"type": "audio/pcm", "rate": 24000}}}},
            {"type": "session.instructions.appended"}, {"type": "session.thinking.appended"},
            {"type": "session.closed", "usage": {"seconds": 0}},
        ])
        browser.__aiter__.side_effect = lambda: frames([])
        await relay_live(browser, upstream, AsyncMock(), values)
        self.assertEqual([call.args[0]["type"] for call in upstream.send_json.call_args_list],
                         ["session.instructions.append", "session.thinking.append"])
        self.assertIn({"type": "bridge.ready", "protocol": "live"},
                      [call.args[0] for call in browser.send_json.call_args_list])

    async def test_diagnostic_checks_live_startup_and_native_close_without_audio(self):
        cfg = Settings("https://example.services.ai.azure.com/api/projects/demo")
        socket = AsyncMock()
        socket.__aenter__.return_value = socket
        socket.__aiter__.side_effect = lambda: frames([
            {"type": "session.started", "session": {"audio": {"format": {"type": "audio/pcm", "rate": 24000}}}},
            {"type": "session.closed", "reason": "close_requested", "usage": {"seconds": 0}},
        ])
        client = ServiceClient([])
        client.ws_connect = lambda *args, **kwargs: socket
        with patch("builtins.print"):
            self.assertEqual(await check_live(client, cfg, {}, "2"), 0)
        socket.send_json.assert_awaited_once_with({"type": "session.close"})

    def test_container_includes_live_protocol_module(self):
        dockerfile = Path(__file__).with_name("Dockerfile").read_text()
        self.assertRegex(dockerfile, r"COPY[^\n]*\blive\.py\b")


if __name__ == "__main__":
    unittest.main()
