# Copyright (c) Microsoft. All rights reserved.
"""Real localhost HTTP/WebSocket tests; never require Azure or a microphone."""
from __future__ import annotations

import asyncio
import copy
import json
import os
from pathlib import Path
import stat
import sys
import subprocess
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request
from websockets.exceptions import ConnectionClosedOK
from websockets.frames import Close

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import common
import demo_server as server
from session_log import SessionRecorder, read_events, read_session

ENDPOINT = "https://sample.services.ai.azure.com/api/projects/sample-project"
VOICE_PATH = "/agents/voice-agent/endpoint/protocols/voice"
DEFINITION = {
    "kind": "voice", "model": "gpt-realtime", "model_type": "managed",
    "instructions": "Be concise.", "store": True,
    "audio": {"output": {"voice": "en-US-AvaNeural", "voice_type": "azure-standard"}},
}
REGIONAL_MODEL_ERROR = (
    "Model 'gpt-realtime-regional' is not supported in managed mode in this region. "
    "Choose a supported managed model or use self-deployed mode."
)


class RegionalModelPublishTests(unittest.TestCase):
    def test_regional_fallback_preserves_the_original_and_other_models(self):
        definition = {
            **DEFINITION, "model": "gpt-realtime-regional",
            "handoff": {"nodes": [
                {"id": "regional", "config": {"model": "gpt-realtime-regional"}},
                {"id": "other", "config": {"model": "gpt-4.1-mini"}},
                {"id": "deployed", "config": {
                    "model": "gpt-realtime-regional", "model_type": "self-deployed",
                }},
            ]},
        }
        original = copy.deepcopy(definition)
        with self.assertLogs("voice_agent_portal", level="WARNING"):
            result = common.regional_model_publish_fallback(definition, 400, REGIONAL_MODEL_ERROR)
        expected = copy.deepcopy(original)
        expected["model"] = "gpt-realtime"
        expected["handoff"]["nodes"][0]["config"]["model"] = "gpt-realtime"
        self.assertEqual(expected, result)
        self.assertEqual(original, definition)

    def test_regional_fallback_requires_the_matching_managed_model_error(self):
        definition = {**DEFINITION, "model": "gpt-realtime-regional"}
        cases = [
            (definition, 200, REGIONAL_MODEL_ERROR),
            (definition, 403, REGIONAL_MODEL_ERROR),
            (definition, 429, REGIONAL_MODEL_ERROR),
            (definition, 500, REGIONAL_MODEL_ERROR),
            (definition, 400, "Invalid voice configuration."),
            (definition, 400, REGIONAL_MODEL_ERROR.replace("gpt-realtime-regional", "other-regional")),
            ({**definition, "model_type": "self-deployed"}, 400, REGIONAL_MODEL_ERROR),
            ({**definition, "kind": "prompt"}, 400, REGIONAL_MODEL_ERROR),
            (DEFINITION, 400, REGIONAL_MODEL_ERROR),
        ]
        for value, status, message in cases:
            with self.subTest(value=value, status=status, message=message):
                self.assertIsNone(common.regional_model_publish_fallback(value, status, message))


class ConfigurationTests(unittest.TestCase):
    def test_voice_overrides_preserve_voice_types_without_model_rules(self):
        for voice, voice_type in (
            ("alloy", "openai"),
            ("emma", "azure-realtime-native"),
            ("ava", "azure-realtime-native"),
            ("en-US-Emma:DragonHDOmniLatestNeural", "azure-standard"),
        ):
            with self.subTest(voice=voice):
                output = json.loads(server._voice_override_header(voice))["audio"]["output"]
                self.assertEqual({"voice": voice, "voice_type": voice_type}, output)

    def test_endpoint_validation(self):
        self.assertEqual(common.validate_project_endpoint(ENDPOINT + "/"), ENDPOINT)
        for value in (
            "", "http://sample.services.ai.azure.com/api/projects/sample",
            "https://example.com/api/projects/sample",
            "https://sample.services.ai.azure.com.evil.example/api/projects/sample",
            "https://user:password@sample.services.ai.azure.com/api/projects/sample",
            ENDPOINT + "?token=secret", ENDPOINT + "#fragment", ENDPOINT + "/../other",
            "https://sample.services.ai.azure.com:1234/api/projects/sample",
            "https://sample.services.ai.azure.com/api/projects/%2e%2e",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                common.validate_project_endpoint(value)

    def test_foundry_endpoint_is_required_with_no_fallback(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SystemExit):
                server.parse_args([])
            with self.assertRaises(ValueError):
                common.AgentsConfig.from_endpoint()
            with self.assertRaises(ValueError):
                common.AgentsConfig(host="")
            app = server.build_app(server.parse_args([
                "--project-endpoint", ENDPOINT, "--no-record-sessions",
            ]))
            cfg = app[server.DEFAULT_CONFIG_KEY]
            self.assertEqual(cfg.host, ENDPOINT)
            self.assertEqual(cfg.project, "sample-project")
            self.assertIsNone(cfg._credential)

    def test_mode_flag_is_removed(self):
        for value in ("demo", "live"):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                server.parse_args(["--project-endpoint", ENDPOINT, "--mode", value])

    def test_endpoint_environment_and_optional_port(self):
        with patch.dict(os.environ, {"AZURE_VOICE_AGENTS_ENDPOINT": ENDPOINT}, clear=True):
            args = server.parse_args([])
            self.assertEqual(args.project_endpoint, ENDPOINT)
            self.assertEqual(args.port, 9527)
            self.assertTrue(args.record_sessions)
            self.assertEqual(args.credential_mode, "default")
            self.assertEqual(args.template_config.name, "templates.config.json")
            self.assertFalse(hasattr(args, "mode"))
            with patch.dict(os.environ, {"DEMO_PORT": "9531"}):
                self.assertEqual(server.parse_args([]).port, 9531)
                self.assertEqual(server.parse_args(["--port", "9532"]).port, 9532)

    def test_cli_credential_mode_and_rotating_debug_log(self):
        credential = Mock()
        with patch.object(common, "AzureCliCredential", return_value=credential):
            cfg = common.AgentsConfig.from_endpoint(
                ENDPOINT,
                credential_mode="cli",
            )
            self.assertIs(cfg.credential(), credential)
            cfg.close()
        credential.close.assert_called_once()

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            try:
                server.configure_file_logging(root)
                server.LOGGER.info("debug-log-test")
                for handler in server.LOGGER.handlers:
                    handler.flush()
                log = root / "server.log"
                self.assertTrue(log.is_file())
                self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
                self.assertEqual(stat.S_IMODE(log.stat().st_mode), 0o600)
                self.assertIn("debug-log-test", log.read_text(encoding="utf-8"))
            finally:
                for handler in server.LOGGER.handlers:
                    handler.close()
                server.LOGGER.handlers.clear()

    def test_cli_without_endpoint_exits_with_setup_guidance(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "demo_server.py")], cwd=ROOT,
            env={**os.environ, "PYTHON_DOTENV_DISABLED": "1", "AZURE_VOICE_AGENTS_ENDPOINT": "", "DEMO_PORT": "9527"},
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("An Azure Foundry project is required", result.stderr)
        self.assertIn("AZURE_VOICE_AGENTS_ENDPOINT", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertNotIn("Open     :", result.stdout)

    def test_only_loopback_can_be_bound(self):
        with self.assertRaises(SystemExit):
            server.parse_args(["--bind", "0.0.0.0"])
        with self.assertRaises(SystemExit):
            server.parse_args(["--port", "65536"])

    def test_token_cache_refresh_and_header_contract(self):
        credential = Mock()
        credential.get_token.return_value = SimpleNamespace(token="test-token", expires_on=time.time() + 3600)
        cfg = common.AgentsConfig.from_endpoint(ENDPOINT)
        cfg._credential = credential
        self.assertEqual(cfg.auth_headers(), {"Authorization": "Bearer test-token"})
        self.assertEqual(cfg.ws_headers()["Foundry-Features"], common.FOUNDRY_FEATURES)
        self.assertNotIn("x-ms-oai-authorization-header-value", cfg.rest_headers())
        credential.get_token.assert_called_once_with(common.TOKEN_SCOPE)
        cfg._token_expires_on = 0
        cfg.get_token()
        self.assertEqual(credential.get_token.call_count, 2)
        cfg.close()
        credential.close.assert_called_once()

    def test_structured_input_validation_and_redaction(self):
        self.assertEqual(json.loads(server._structured_input_header('{"name":"你好"}')), {"name": "你好"})
        for raw in ("[]", "null", "{", '{"n":NaN}', '{"large":"' + "x" * 33000 + '"}'):
            with self.subTest(raw=raw[:30]), self.assertRaises(ValueError):
                server._structured_input_header(raw)
        text = server._redact_sensitive_query_values("/voice?structured_input=private&api_key=secret&version=2")
        self.assertNotIn("private", text)
        self.assertNotIn("secret", text)
        self.assertIn("version=2", text)

    def test_ws_url_uses_same_project_and_omits_browser_only_parameters(self):
        cfg = common.AgentsConfig.from_endpoint(ENDPOINT)
        cfg._credential = Mock()
        cfg._credential.get_token.return_value = SimpleNamespace(token="test-token", expires_on=time.time() + 3600)
        query = {"structured_input": '{"name":"你好"}', "voiceOverride": "alloy", "store": "false", "transport": "webrtc"}
        url, session_id = server.build_upstream_ws_url(cfg, VOICE_PATH, query)
        self.assertTrue(url.startswith(ENDPOINT.replace("https:", "wss:") + VOICE_PATH))
        parsed = parse_qs(urlsplit(url).query)
        self.assertNotIn("structured_input", parsed)
        self.assertNotIn("voiceOverride", parsed)
        self.assertEqual(parsed["transport"], ["webrtc"])
        self.assertEqual(parsed["agent_session_id"], [session_id])
        headers = server.build_upstream_ws_headers(cfg, query)
        self.assertEqual(json.loads(headers[server.STRUCTURED_INPUT_HEADER]), {"name": "你好"})
        self.assertEqual(json.loads(headers[server.VOICE_OVERRIDE_HEADER])["audio"]["output"], {"voice": "alloy", "voice_type": "openai"})

    def test_ws_url_can_target_local_shim_without_changing_rest_base(self):
        cfg = common.AgentsConfig.from_endpoint(ENDPOINT)
        url, _ = server.build_upstream_ws_url(
            cfg,
            VOICE_PATH,
            {},
            voice_ws_base="http://127.0.0.1:8099/api/projects/local",
        )

        self.assertEqual(cfg.agents_base, ENDPOINT)
        self.assertTrue(
            url.startswith(
                "ws://127.0.0.1:8099/api/projects/local" + VOICE_PATH
            )
        )

    def test_ws_override_accepts_only_local_project_base(self):
        self.assertEqual(
            server._local_voice_ws_base(
                "http://localhost:8099/api/projects/local/"
            ),
            "http://localhost:8099/api/projects/local",
        )
        for value in (
            "https://example.com/api/projects/local",
            "http://user:password@localhost:8099/api/projects/local",
            "http://localhost:8099/api/projects/local/agents",
            "http://localhost:bad/api/projects/local",
            "http://localhost:8099/api/projects/local?token=secret",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                server._local_voice_ws_base(value)


class LiveProxyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.http_responses = []
        self.socket_requests = []
        self.redirect_targets = []

        async def http_fixture(request):
            self.calls.append({
                "method": request.method, "path": request.path, "query": dict(request.query),
                "headers": dict(request.headers), "body": await request.read(),
            })
            if request.query.get("redirect"):
                raise web.HTTPFound(location="https://elsewhere.example/")
            if request.path.endswith("/audio/content"):
                return web.Response(body=b"RIFF-local-test-WAVE", content_type="audio/wav")
            if self.http_responses:
                status, payload = self.http_responses.pop(0)
                return web.json_response(payload, status=status, headers={
                    "x-ms-request-id": f"publish-attempt-{len(self.calls)}",
                })
            return web.json_response({"data": [], "has_more": False}, headers={
                "Set-Cookie": "do-not-forward=secret",
                "Access-Control-Allow-Origin": "*",
                "x-ms-request-id": "test-request-id",
            })

        async def ws_fixture(request):
            self.socket_requests.append({"headers": dict(request.headers), "query": dict(request.query)})
            if request.query.get("redirect"):
                raise web.HTTPFound(location=str(request.url.with_path("/redirect-target").with_query("")))
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            await ws.send_json({"type": "session.created", "session": {"id": "live-fixture"}})
            if request.query.get("agent_end"):
                await ws.close(code=1001, message=b"Conversation ended by agent")
                return ws
            async for message in ws:
                if message.type == WSMsgType.TEXT:
                    await ws.send_str(message.data)
                elif message.type == WSMsgType.BINARY:
                    await ws.send_bytes(message.data)
            return ws

        async def redirect_target(request):
            self.redirect_targets.append(request.path)
            return web.Response()

        upstream = web.Application()
        upstream.router.add_get("/redirect-target", redirect_target)
        upstream.router.add_get("/api/projects/sample-project" + VOICE_PATH, ws_fixture)
        upstream.router.add_route("*", "/{tail:.*}", http_fixture)
        self.upstream = TestServer(upstream, host="127.0.0.1")
        await self.upstream.start_server()
        self.addAsyncCleanup(self.upstream.close)
        self.app = server.build_app(server.parse_args([
            "--project-endpoint", ENDPOINT, "--no-record-sessions",
        ]))
        self.cfg = self.app[server.DEFAULT_CONFIG_KEY]
        # Test-only injection: production endpoint validation does NOT allow HTTP/loopback.
        self.cfg.host = str(self.upstream.make_url("/api/projects/sample-project"))
        self.cfg._credential = Mock()
        self.cfg._credential.get_token.return_value = SimpleNamespace(token="fixture-token", expires_on=time.time() + 3600)
        self.client = TestClient(TestServer(self.app, host="127.0.0.1"))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def test_live_voice_catalog_is_cached_per_selected_project(self):
        catalog = {"source": "live", "voices": [{"id": "hi-IN-SwaraNeural", "locale": "hi-IN"}]}
        with patch.object(server, "load_voice_catalog", return_value=catalog) as load:
            for _ in range(2):
                response = await self.client.get("/api/voices")
                self.assertEqual(200, response.status)
                self.assertEqual(catalog, await response.json())
        load.assert_called_once_with(self.cfg)

    async def test_live_voice_catalog_errors_return_full_explicit_defaults(self):
        for error in (
            server.requests.HTTPError("HTTP 401"),
            server.requests.HTTPError("HTTP 403"),
            server.requests.Timeout(),
            server.AzureError("Azure credential is unavailable"),
            ValueError("Malformed capabilities"),
        ):
            with self.subTest(error=type(error).__name__):
                self.app[server.VOICE_CATALOG_KEY].clear()
                with patch.object(server, "load_voice_catalog", side_effect=error):
                    with self.assertLogs("voice_agent_portal", level="WARNING"):
                        response = await self.client.get("/api/voices")
                self.assertEqual(200, response.status)
                body = await response.json()
                self.assertEqual("bundled", body["source"])
                self.assertEqual("voice_discovery_unavailable", body["discoveryError"]["code"])
                self.assertIn("Live voice discovery unavailable", body["notice"])
                self.assertGreaterEqual(len(body["voices"]), 1000)
                self.assertIn("diya", {voice["id"] for voice in body["voices"]})

    async def test_live_voice_catalog_failure_cache_supports_explicit_retry(self):
        catalog = {"source": "live", "voices": [{"id": "emma", "locale": "en-US"}]}
        with patch.object(server, "load_voice_catalog", side_effect=[
            server.requests.HTTPError("HTTP 403"), catalog,
        ]) as load:
            with self.assertLogs("voice_agent_portal", level="WARNING"):
                first = await self.client.get("/api/voices")
            cached = await self.client.get("/api/voices")
            self.assertEqual("bundled", (await first.json())["source"])
            self.assertEqual("bundled", (await cached.json())["source"])
            self.assertEqual(1, load.call_count)
            retried = await self.client.get("/api/voices?refresh=1")
        self.assertEqual(catalog, await retried.json())
        self.assertEqual(2, load.call_count)

    async def test_live_voice_catalog_requests_are_coalesced_and_expire(self):
        catalog = {"source": "live", "voices": [{"id": "emma", "locale": "en-US"}]}
        def delayed_catalog(cfg):
            time.sleep(.03)
            return catalog
        with patch.object(server, "load_voice_catalog", side_effect=delayed_catalog) as load:
            responses = await asyncio.gather(*(self.client.get("/api/voices") for _ in range(4)))
            self.assertTrue(all(response.status == 200 for response in responses))
            self.assertEqual(1, load.call_count)
            self.app[server.VOICE_CATALOG_KEY][self.cfg.host].expires_at = 0
            await self.client.get("/api/voices")
        self.assertEqual(2, load.call_count)

    async def test_live_voice_discovery_timeout_does_not_block_configuration(self):
        def delayed_catalog(cfg):
            time.sleep(.05)
            return {"source": "live", "voices": []}
        with patch.object(server, "load_voice_catalog", side_effect=delayed_catalog):
            with patch.object(server, "VOICE_DISCOVERY_TIMEOUT", .005):
                with self.assertLogs("voice_agent_portal", level="WARNING"):
                    response, config = await asyncio.gather(
                        self.client.get("/api/voices"), self.client.get("/config"),
                    )
        self.assertEqual(200, config.status)
        body = await response.json()
        self.assertEqual("bundled", body["source"])
        self.assertEqual("TimeoutError", body["discoveryError"]["reason"])

    async def test_configuration_has_full_defaults_even_when_live_voice_discovery_is_denied(self):
        with patch.object(server, "load_voice_catalog", side_effect=server.requests.HTTPError("HTTP 403")) as live:
            response = await self.client.get("/config")
        self.assertEqual(200, response.status)
        cfg = await response.json()
        self.assertEqual("bundled", cfg["voiceCatalogSource"])
        self.assertGreaterEqual(len(cfg["voiceCatalog"]), 900)
        self.assertIn("hi-IN-SwaraNeural", {item["id"] for item in cfg["voiceCatalog"]})
        live.assert_not_called()
        self.cfg._credential.get_token.assert_not_called()

    async def test_pages_and_configuration_require_the_configured_project(self):
        for path in (
            "/",
            "/runtime/",
            "/demo/",
            "/runtime/webrtc",
            "/webrtc",
            "/editor/",
            "/static/demo/sessions.html",
            "/static/demo/persisted.html",
        ):
            response = await self.client.get(path)
            self.assertEqual(response.status, 200, path)
            self.assertEqual(response.headers["X-Frame-Options"], "DENY")
        for name in server._ASSET_FILENAMES:
            response = await self.client.get("/static/demo/" + name)
            self.assertEqual(response.status, 200, name)
            self.assertGreater(len(await response.read()), 0)
        response = await self.client.get("/healthz")
        self.assertEqual(await response.json(), {"status": "ok", "project": "sample-project"})
        response = await self.client.get("/config")
        cfg = await response.json()
        self.assertEqual(cfg["backends"], ["sample-project"])
        self.assertNotIn("mode", cfg)
        self.assertIn("Azure Foundry project", cfg["notice"])
        self.assertNotIn("offline", json.dumps(cfg).lower())
        self.assertFalse(cfg["defaultStore"])
        self.assertIn("whisper-1", cfg["realtimeTranscriptionModels"])
        self.assertNotIn("whisper-1", cfg["cascadedTranscriptionModels"])
        self.assertEqual(
            cfg["cascadedTranscriptionModels"],
            ["azure-speech", "mai-transcribe", "mai-transcribe-2", "mai-transcribe-2-streaming"],
        )
        self.cfg._credential.get_token.assert_not_called()
        self.assertEqual(self.calls, [])

    async def test_stale_backend_cookie_cannot_select_a_mock_or_another_project(self):
        response = await self.client.get("/config", headers={"Cookie": "voice_demo_backend=demo"})
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["backend"], "sample-project")
        for path in ("/config?backend=demo", "/agents?backend=another-project"):
            response = await self.client.get(path)
            self.assertEqual(response.status, 400)
        self.cfg._credential.get_token.assert_not_called()

    async def test_local_boundary_and_configuration_files_are_protected(self):
        for headers in (
            {"Origin": "https://evil.example"}, {"Origin": "null"},
            {"Host": "evil.example"}, {"Sec-Fetch-Site": "cross-site"},
        ):
            response = await self.client.get("/config", headers=headers)
            self.assertEqual(response.status, 403)
        response = await self.client.post("/agents/test/versions", data="name=bad")
        self.assertEqual(response.status, 415)
        for path in ("/.env", "/common.py", "/static/demo/.env", "/static/demo/../common.py"):
            response = await self.client.get(path)
            self.assertIn(response.status, (400, 403, 404))
        self.assertEqual(self.calls, [])

    async def test_mcp_probe_rejects_browser_supplied_urls_and_recording_default(self):
        response = await self.client.post("/api/mcp/probe", json={"server_url": "http://169.254.169.254"})
        self.assertEqual(response.status, 400)
        self.assertIn("Agent name", (await response.json())["error"])
        response = await self.client.get("/api/demo/sessions")
        self.assertEqual((await response.json())["available"], False)
        self.assertIsNone(self.app[server.SESSION_LOG_ROOT])
        self.assertEqual(self.calls, [])

    async def test_project_discovery_and_selection_are_browser_scoped(self):
        selected = "https://other.services.ai.azure.com/api/projects/other-project"
        projects = [{
            "name": "other-project",
            "account": "other",
            "label": "other-project · other",
            "endpoint": selected,
            "subscription_id": "sub",
            "resource_group": "rg",
        }]
        with patch.object(server, "discover_projects", return_value=projects):
            response = await self.client.get("/api/projects")
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["projects"], projects)

        response = await self.client.post("/api/project", json={"endpoint": selected})
        self.assertEqual(response.status, 200)
        switched = await self.client.get("/config")
        payload = await switched.json()
        self.assertEqual(payload["backend"], "other-project")
        self.assertEqual(payload["host"], selected)
        self.assertFalse(payload["traceEnabled"])
        template_config = await self.client.get("/api/config")
        self.assertEqual((await template_config.json())["project"], "other-project")
        self.assertEqual((await self.client.get("/healthz")).status, 200)

    async def test_shutdown_never_deletes_created_azure_agents(self):
        response = await self.client.post("/agents/test/versions", json={"definition": DEFINITION})
        self.assertEqual(response.status, 200)
        await self.client.close()
        self.assertEqual([item["method"] for item in self.calls], ["POST"])
        self.cfg._credential.close.assert_called_once()

    async def test_rest_proxy_preserves_contract_and_protects_headers(self):
        body = {"definition": DEFINITION}
        response = await self.client.post("/agents/test/versions?api-version=v1&backend=sample-project", json=body, headers={
            "Authorization": "Bearer browser-must-not-win", "Cookie": "browser-cookie=private",
            "x-ms-overridden-host": "evil.example",
        })
        self.assertEqual(response.status, 200)
        call = self.calls[-1]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/projects/sample-project/agents/test/versions")
        self.assertEqual(call["query"], {"api-version": "v1"})
        self.assertEqual(json.loads(call["body"]), body)
        headers = {k.lower(): v for k, v in call["headers"].items()}
        self.assertEqual(headers["authorization"], "Bearer fixture-token")
        self.assertEqual(headers["foundry-features"], common.FOUNDRY_FEATURES)
        for name in ("cookie", "x-ms-overridden-host"):
            self.assertNotIn(name, headers)
        for name in ("Set-Cookie", "Access-Control-Allow-Origin", "Authorization"):
            self.assertNotIn(name, response.headers)
        self.assertEqual(response.headers["x-ms-request-id"], "test-request-id")

    async def test_regional_publish_success_keeps_the_original_model(self):
        body = {"definition": {**DEFINITION, "model": "gpt-realtime-regional"}}
        response = await self.client.post("/agents/test/versions", json=body)
        self.assertEqual(200, response.status)
        self.assertEqual([body], [json.loads(call["body"]) for call in self.calls])

    async def test_regional_publish_retries_once_after_the_matching_model_error(self):
        body = {
            "definition": {**DEFINITION, "model": "gpt-realtime-regional"},
            "description": "Keep the complete publication.",
            "metadata": {"source_template_id": "finance-example-realtime"}, "draft": False,
        }
        expected = copy.deepcopy(body)
        expected["definition"]["model"] = "gpt-realtime"
        published = {"name": "test", "version": "1", **expected}
        self.http_responses = [
            (400, {"error": {"code": "bad_request", "message": REGIONAL_MODEL_ERROR}}),
            (201, published),
        ]
        with self.assertLogs("voice_agent_portal", level="WARNING"):
            response = await self.client.post("/agents/test/versions?api-version=v1", json=body)
        self.assertEqual(201, response.status)
        self.assertEqual(published, await response.json())
        self.assertEqual([body, expected], [json.loads(call["body"]) for call in self.calls])
        self.assertEqual(self.calls[0]["path"], self.calls[1]["path"])
        self.assertEqual(self.calls[0]["query"], self.calls[1]["query"])
        self.assertEqual("publish-attempt-2", response.headers["x-ms-request-id"])

    async def test_regional_publish_surfaces_the_second_failure_without_retrying_again(self):
        error = {"error": {"code": "bad_request", "message": REGIONAL_MODEL_ERROR}}
        self.http_responses = [(400, error), (400, error)]
        with self.assertLogs("voice_agent_portal", level="WARNING"):
            response = await self.client.post("/agents/test/versions", json={
                "definition": {**DEFINITION, "model": "gpt-realtime-regional"},
            })
        self.assertEqual(400, response.status)
        self.assertEqual(error, await response.json())
        self.assertEqual(2, len(self.calls))
        self.assertEqual(
            ["gpt-realtime-regional", "gpt-realtime"],
            [json.loads(call["body"])["definition"]["model"] for call in self.calls],
        )

    async def test_regional_publish_does_not_retry_other_errors_or_routes(self):
        for method, path, status, message in (
            ("POST", "/agents/test/versions", 400, "Invalid voice configuration."),
            ("POST", "/agents/test/versions", 403, REGIONAL_MODEL_ERROR),
            ("POST", "/agents/test/versions", 429, REGIONAL_MODEL_ERROR),
            ("POST", "/agents/test/versions", 500, REGIONAL_MODEL_ERROR),
            ("POST", "/agents:generate", 400, REGIONAL_MODEL_ERROR),
            ("GET", "/agents/test", 400, REGIONAL_MODEL_ERROR),
        ):
            with self.subTest(method=method, path=path, status=status):
                self.calls.clear()
                error = {"error": {"code": "bad_request", "message": message}}
                self.http_responses = [(status, error)]
                response = await self.client.request(method, path, json={
                    "definition": {**DEFINITION, "model": "gpt-realtime-regional"},
                })
                self.assertEqual(status, response.status)
                self.assertEqual(error, await response.json())
                self.assertEqual(1, len(self.calls))

    async def test_audio_proxy_and_rest_redirect_rejection(self):
        response = await self.client.get(VOICE_PATH + "/conversations/conv/audio/content")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.content_type, "audio/wav")
        self.assertEqual(await response.read(), b"RIFF-local-test-WAVE")
        response = await self.client.get("/agents?redirect=1")
        self.assertEqual(response.status, 502)
        self.assertNotIn("Location", response.headers)

    async def test_auth_failure_is_actionable_without_leaking_exception(self):
        self.cfg._credential.get_token.side_effect = RuntimeError("SENSITIVE_AUTH_FAILURE")
        response = await self.client.get("/agents")
        self.assertEqual(response.status, 502)
        text = await response.text()
        self.assertIn("az login", text)
        self.assertNotIn("SENSITIVE", text)
        self.assertEqual(self.calls, [])

    async def test_bundled_notices_are_served_without_using_azure_credentials(self):
        response = await self.client.get("/static/demo/THIRD_PARTY_NOTICES.txt")
        self.assertEqual(response.status, 200)
        text = await response.text()
        self.assertIn("Vitaly Puzrin", text)
        self.assertIn("Facebook, Inc.", text)
        self.cfg._credential.get_token.assert_not_called()
        self.assertEqual(self.calls, [])

    async def test_real_upstream_websocket_text_binary_and_headers(self):
        path = VOICE_PATH + "?api-version=v1&structured_input=%7B%22name%22%3A%22Ada%22%7D&voiceOverride=alloy"
        async with self.client.ws_connect(path) as ws:
            self.assertEqual((await ws.receive_json(timeout=3))["session"]["id"], "live-fixture")
            await ws.send_json({"type": "response.create"})
            self.assertEqual((await ws.receive_json(timeout=3))["type"], "response.create")
            await ws.send_bytes(b"\x01\x02\x03\x04")
            self.assertEqual((await ws.receive(timeout=3)).data, b"\x01\x02\x03\x04")
        info = self.socket_requests[-1]
        self.assertNotIn("structured_input", info["query"])
        self.assertNotIn("voiceOverride", info["query"])
        headers = {k.lower(): v for k, v in info["headers"].items()}
        self.assertEqual(headers["authorization"], "Bearer fixture-token")
        self.assertEqual(json.loads(headers[server.STRUCTURED_INPUT_HEADER]), {"name": "Ada"})
        self.assertEqual(json.loads(headers[server.VOICE_OVERRIDE_HEADER])["audio"]["output"], {"voice": "alloy", "voice_type": "openai"})

    async def test_websocket_redirect_does_not_leak_credentials(self):
        async with self.client.ws_connect(VOICE_PATH + "?redirect=1") as ws:
            event = await ws.receive_json(timeout=3)
            self.assertEqual(event["type"], "error")
            self.assertNotIn("fixture-token", json.dumps(event))
        self.assertEqual(self.redirect_targets, [])
        self.assertEqual(len(self.socket_requests), 1)

    async def test_backend_websocket_failure_reaches_browser_with_request_id(self):
        with patch.object(
            self.cfg,
            "ws_headers",
            side_effect=RuntimeError(
                "synthetic credential failure authorization=private-token"
            ),
        ):
            async with self.client.ws_connect(VOICE_PATH) as ws:
                event = await ws.receive_json(timeout=3)

        self.assertEqual(event["type"], "error")
        self.assertEqual(event["error"]["code"], "portal_bridge_error")
        self.assertEqual(event["error"]["type"], "RuntimeError")
        self.assertIn("synthetic credential failure", event["error"]["message"])
        self.assertNotIn("private-token", json.dumps(event))
        self.assertRegex(event["error"]["request_id"], r"^[0-9a-f]{12}$")

    async def test_agent_close_preserves_completion_and_audio_drain_reason(self):
        async with self.client.ws_connect(VOICE_PATH + "?agent_end=1") as ws:
            self.assertEqual((await ws.receive_json(timeout=3))["type"], "session.created")
            message = await ws.receive(timeout=3)
            self.assertEqual(message.type, WSMsgType.CLOSE)
            self.assertEqual(message.data, 1001)
            self.assertEqual(message.extra, "Conversation ended by agent")

    async def test_normal_upstream_close_during_browser_send_is_not_an_error(self):
        close = Close(1001, "Conversation ended by agent")
        final_audio = [
            json.dumps({"type": "response.output_audio.delta", "delta": "final-1"}),
            json.dumps({"type": "response.output_audio.delta", "delta": "final-2"}),
        ]
        sent = asyncio.Event()

        class ClosingUpstream:
            close_code = close.code
            close_reason = close.reason

            def __aiter__(self):
                return self

            async def __anext__(self):
                # Like websockets, deliver frames received before the close, then stop.
                await sent.wait()
                if final_audio:
                    await asyncio.sleep(0.05)
                    return final_audio.pop(0)
                raise StopAsyncIteration

            async def send(self, _data):
                sent.set()
                raise ConnectionClosedOK(close, close, True)

        class ClosingConnect:
            async def __aenter__(self):
                return ClosingUpstream()

            async def __aexit__(self, _exc_type, _exc, _traceback):
                return False

        with patch.object(server, "ProjectWebSocketConnect", return_value=ClosingConnect()):
            async with self.client.ws_connect(VOICE_PATH) as ws:
                await ws.send_json({"type": "input_audio_buffer.append", "audio": "fixture"})
                # The microphone send fails first; the final audio must still arrive.
                for expected in ("final-1", "final-2"):
                    self.assertEqual(expected, (await ws.receive_json(timeout=3))["delta"])
                message = await ws.receive(timeout=3)
                self.assertEqual(message.type, WSMsgType.CLOSE)
                self.assertEqual(message.data, 1001)
                self.assertEqual(message.extra, "Conversation ended by agent")

    async def test_bad_structured_input_fails_before_authentication(self):
        response = await self.client.get(VOICE_PATH + "?structured_input=[]")
        self.assertEqual(response.status, 400)
        self.cfg._credential.get_token.assert_not_called()
        self.assertEqual(self.socket_requests, [])

    async def test_unhandled_http_failure_returns_visible_json_error(self):
        async def fail(_request):
            raise RuntimeError(
                "synthetic backend failure authorization=private-token"
            )

        request = make_mocked_request(
            "GET",
            "/synthetic-failure",
            headers={"Host": "127.0.0.1"},
        )
        response = await server.local_boundary(request, fail)
        payload = json.loads(response.text)

        self.assertEqual(response.status, 500)
        self.assertEqual(payload["code"], "portal_internal_error")
        self.assertIn("synthetic backend failure", payload["error"])
        self.assertNotIn("private-token", response.text)
        self.assertRegex(payload["request_id"], r"^[0-9a-f]{12}$")
        await server.security_headers(request, response)
        self.assertEqual(
            response.headers[server.PORTAL_REQUEST_ID_HEADER],
            payload["request_id"],
        )


class RecordingTests(unittest.TestCase):
    def test_recorder_promotes_failed_response_done_to_session_error(self):
        with tempfile.TemporaryDirectory() as directory:
            recorder = SessionRecorder(
                Path(directory),
                web_id="failed-response",
                agent="sample",
                backend="live",
                upstream="wss://example.invalid",
            )
            recorder.record("down", json.dumps({
                "type": "response.done",
                "response": {
                    "status": "failed",
                    "status_details": {
                        "type": "failed",
                        "error": {
                            "message": "No tool call found for function call output.",
                            "type": "invalid_request_error",
                        },
                    },
                },
            }))
            recorder.record("down", json.dumps({
                "type": "response.done",
                "response": {"status": "completed"},
            }))
            recorder.close()

            session = read_session(Path(directory), recorder.run_id)
            self.assertEqual(len(session["errors"]), 1)
            self.assertEqual(session["errors"][0]["type"], "response.done")
            self.assertEqual(
                session["errors"][0]["message"],
                "No tool call found for function call output.",
            )
            self.assertIn(
                "response.done failed No tool call found for function call output.",
                session["timeline"],
            )

    def test_opt_in_recorder_redacts_known_secrets_and_elides_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            recorder = SessionRecorder(root, web_id="../../bad", agent="sample", backend="live", upstream="wss://example.invalid")
            recorder.record("down", json.dumps({
                "type": "session.updated", "session": {"id": "s", "tools": [
                    {"authorization": "secret-bearer", "api_key": "secret-key", "credential": "secret-turn"},
                ]},
            }))
            recorder.record("up", '{"type":"input_audio_buffer.append","audio":"DO_NOT_RECORD_PCM"}')
            recorder.close()
            text = (recorder.dir / "events.jsonl").read_text(encoding="utf-8")
            self.assertNotIn("secret-bearer", text)
            self.assertNotIn("secret-key", text)
            self.assertNotIn("secret-turn", text)
            self.assertNotIn("DO_NOT_RECORD_PCM", text)
            self.assertIn("<redacted>", text)
            self.assertIsNone(read_session(root, "../escape"))
            self.assertIsNone(read_events(root, "../escape"))
            self.assertEqual(recorder.dir.parent, root)


if __name__ == "__main__":
    unittest.main()
