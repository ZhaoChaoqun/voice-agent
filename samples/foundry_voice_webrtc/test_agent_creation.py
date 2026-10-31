"""Agent preparation creates missing Agents and repairs missing Toolbox versions."""

import asyncio
import json
import os
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp.test_utils import TestClient, TestServer

from server import (ACTIVE, DEFAULT_AGENT_NAME, AgentPreparationError, Settings, create_app,
                    inspect_configured_agent, load_settings, prepare_configured_agent, prepare_weather_toolbox,
                    recreate_configured_agent)


_UNSET = object()


class Response:
    def __init__(self, status, body=_UNSET):
        if body is _UNSET:
            body = {"version": "1"} if status == 201 else None
        self.status, self.body = status, body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def json(self):
        return self.body


class Client:
    def __init__(self, gets, posts=(), deletes=()):
        self.gets, self.posts, self.deletes = list(gets), list(posts), list(deletes)
        self.writes = []
        self.removals = []

    def get(self, *args, **kwargs):
        return self.gets.pop(0)

    def post(self, url, **kwargs):
        self.writes.append((url, kwargs))
        return self.posts.pop(0)

    def delete(self, url, **kwargs):
        self.removals.append((url, kwargs))
        return self.deletes.pop(0)


class CreationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.weather = AsyncMock(return_value={
            "type": "toolbox", "toolbox_name": "weather", "toolbox_version": "1"})
        weather_patch = patch("server.prepare_weather_toolbox", self.weather)
        weather_patch.start()
        self.addCleanup(weather_patch.stop)

    def config(self, **kwargs):
        return Settings("https://example.services.ai.azure.com/api/projects/demo", "demo-agent", **kwargs)

    def agent(self):
        definition = json.loads(Path(__file__).with_name("personalized-agent.json").read_text())
        return {"versions": {"latest": {"version": "1", "definition": definition}}}

    async def test_agent_name_is_optional_and_stable_across_settings_loads(self):
        endpoint = self.config().endpoint
        for environment in ({}, {"AZURE_VOICE_AGENT_NAME": ""}, {"AZURE_VOICE_AGENT_NAME": "  "}):
            with patch("server.load_dotenv"), patch.dict(os.environ, {
                    "AZURE_AI_PROJECT_ENDPOINT": endpoint, **environment}, clear=True):
                first, later = load_settings(), load_settings()
                self.assertTrue(first.configured)
                self.assertEqual(first.agent, DEFAULT_AGENT_NAME)
                self.assertEqual(later.agent_url(), first.agent_url())
        self.assertTrue(Settings(endpoint, "").configured)
        self.assertEqual(Settings(endpoint, " ").agent, DEFAULT_AGENT_NAME)
        self.assertEqual(Settings(endpoint, "custom-demo").agent, "custom-demo")
        self.assertFalse(Settings("").configured)

    async def test_inspection_reports_absence_without_publishing_or_enabling(self):
        for exists, responses in ((False, [Response(404), Response(200)]),
                                  (True, [Response(200, self.agent())])):
            client = Client(responses)
            result = await inspect_configured_agent(client, self.config(), {})
            self.assertEqual(result["exists"], exists)
            self.assertEqual(result["model"], "gpt-realtime-2.1")
            self.assertEqual(result["version"], "1" if exists else None)
            self.assertEqual(result["transcriptionModel"], "mai-transcribe-2")
            self.assertEqual(client.writes, [])
            self.assertEqual(client.removals, [])
        self.weather.assert_not_awaited()

    async def test_saved_model_is_reported_instead_of_the_template_default(self):
        agent = self.agent()
        agent["versions"]["latest"]["definition"]["model"] = "saved-custom-model"
        client = Client([Response(200, agent), Response(200, agent), Response(200)], [Response(204)])
        self.assertEqual((await inspect_configured_agent(client, self.config(), {}))["model"], "saved-custom-model")
        self.assertEqual((await prepare_configured_agent(client, self.config(), {}))["model"], "saved-custom-model")

    async def test_inspection_never_reports_missing_for_permission_or_project_errors(self):
        for statuses in ((403,), (500,), (404, 404), (404, 403)):
            client = Client([Response(s) for s in statuses])
            with self.assertRaises(AgentPreparationError):
                await inspect_configured_agent(client, self.config(), {})

    async def test_default_agent_is_created_once_then_found_by_a_new_app_session(self):
        first = Settings(self.config().endpoint)
        client = Client([Response(404), Response(200)], [Response(201), Response(204)])
        result = await prepare_configured_agent(client, first, {})
        self.assertEqual(result["agent"], DEFAULT_AGENT_NAME)
        self.assertTrue(result["created"])
        self.assertIn(f"/agents/{DEFAULT_AGENT_NAME}/versions?", client.writes[0][0])
        later = Settings(self.config().endpoint, "")
        client.gets.append(Response(200, self.agent()))
        result = await inspect_configured_agent(client, later, {})
        self.assertTrue(result["exists"])
        self.assertEqual(result["agent"], first.agent)
        self.assertEqual(sum("/versions?" in url for url, _ in client.writes), 1)

    async def test_status_api_works_before_creation_and_during_calls_without_mutation(self):
        for active in (False, True):
            tokens = AsyncMock()
            result = {"agent": DEFAULT_AGENT_NAME, "exists": False, "personalizationRequired": False}
            app = create_app(Settings(self.config().endpoint), tokens)
            app[ACTIVE].active = active
            with patch("server.inspect_configured_agent", AsyncMock(return_value=result)) as inspect, patch(
                    "server.prepare_configured_agent", AsyncMock()) as prepare:
                async with TestClient(TestServer(app)) as client:
                    response = await client.get("/api/config")
                    config = await response.json()
                    self.assertTrue(config["configured"])
                    self.assertEqual(config["agent"], DEFAULT_AGENT_NAME)
                    response = await client.get("/api/agent")
                    self.assertEqual(response.status, 200)
                    self.assertEqual(await response.json(), result)
                    inspect.assert_awaited_once()
                    prepare.assert_not_awaited()

    async def test_existing_agent_only_enables_without_publishing(self):
        agent = self.agent()
        definition = agent["versions"]["latest"]["definition"]
        definition["instructions"] = "Keep this saved custom prompt without a search policy."
        before = json.loads(json.dumps(agent))
        client = Client([Response(200, agent), Response(200)], [Response(204)])
        result = await prepare_configured_agent(client, self.config(), {})
        self.assertFalse(result["created"])
        self.assertFalse(result["toolboxReferenceUpdated"])
        self.weather.assert_not_awaited()
        self.assertTrue(result["personalizationRequired"])
        self.assertEqual(len(client.writes), 1)
        self.assertIn(":enable?", client.writes[0][0])
        self.assertEqual(agent, before)

    async def test_missing_weather_version_is_repaired_without_replacing_agent_settings(self):
        agent = self.agent()
        latest = agent["versions"]["latest"]
        latest["metadata"] = {"sample": "foundry_voice_webrtc", "custom": "keep"}
        tool = latest["definition"]["tools"][0]
        tool.update(toolbox_version="2", response_scheduling="when_idle")
        latest["definition"]["tools"].append({"type": "function", "name": "other"})
        expected = json.loads(json.dumps(latest["definition"]))
        expected["tools"][0]["toolbox_version"] = "1"
        client = Client([Response(200, agent), Response(404), Response(200, agent)],
                        [Response(201, {"version": "6"}), Response(204)])
        result = await prepare_configured_agent(client, self.config(), {})
        self.assertFalse(result["created"])
        self.assertTrue(result["toolboxReferenceUpdated"])
        self.assertEqual(result["version"], "6")
        self.assertEqual(client.writes[0][1]["json"],
                         {"definition": expected, "metadata": latest["metadata"]})
        self.assertEqual(tool["toolbox_version"], "2")
        self.assertEqual(client.removals, [])
        self.assertIn(":enable?", client.writes[1][0])

    async def test_weather_version_lookup_errors_never_publish_or_enable(self):
        for status in (401, 403, 429, 500):
            client = Client([Response(200, self.agent()), Response(status)])
            with self.subTest(status=status), self.assertRaisesRegex(
                    AgentPreparationError, "Weather Toolbox version lookup failed"):
                await prepare_configured_agent(client, self.config(), {})
            self.weather.assert_not_awaited()
            self.assertEqual(client.writes, [])

    async def test_invalid_weather_version_is_rejected_without_writes(self):
            for number in (None, "", "../2", 2):
                agent = self.agent()
                agent["versions"]["latest"]["definition"]["tools"][0]["toolbox_version"] = number
                client = Client([Response(200, agent)])
                with self.subTest(version=number), self.assertRaisesRegex(
                        AgentPreparationError, "invalid version"):
                    await prepare_configured_agent(client, self.config(), {})
                self.assertEqual(client.writes, [])
            self.weather.assert_not_awaited()

    async def test_weather_repair_does_not_overwrite_concurrent_agent_changes(self):
        agent = self.agent()
        agent["versions"]["latest"]["definition"]["tools"][0]["toolbox_version"] = "2"
        changed = json.loads(json.dumps(agent))
        changed["versions"]["latest"]["version"] = "2"
        client = Client([Response(200, agent), Response(404), Response(200, changed)])
        with self.assertRaisesRegex(AgentPreparationError, "Agent changed"):
            await prepare_configured_agent(client, self.config(), {})
        self.assertEqual(client.writes, [])

    async def test_weather_repair_failure_never_publishes_or_enables(self):
        self.weather.side_effect = AgentPreparationError("Weather Toolbox unavailable")
        client = Client([Response(200, self.agent()), Response(404)])
        with self.assertRaisesRegex(AgentPreparationError, "Weather Toolbox unavailable"):
            await prepare_configured_agent(client, self.config(), {})
        self.assertEqual(client.writes, [])

    async def test_agent_without_weather_is_not_given_new_tools(self):
        agent = self.agent()
        agent["versions"]["latest"]["definition"].pop("tools")
        client = Client([Response(200, agent)], [Response(204)])
        result = await prepare_configured_agent(client, self.config(), {})
        self.assertFalse(result["weatherEnabled"])
        self.assertEqual(len(client.writes), 1)
        self.weather.assert_not_awaited()

    async def test_missing_agent_is_created_with_demo_definition_then_enabled(self):
        self.weather.return_value["toolbox_version"] = "project-version-17"
        client = Client([Response(404), Response(200)], [Response(201), Response(204)])
        result = await prepare_configured_agent(client, self.config(), {})
        self.assertTrue(result["created"])
        self.assertTrue(result["personalizationRequired"])
        self.assertTrue(result["weatherEnabled"])
        self.assertEqual(result["model"], "gpt-realtime-2.1")
        self.assertEqual(result["version"], "1")
        self.weather.assert_awaited_once()
        self.assertIn("/versions?", client.writes[0][0])
        definition = client.writes[0][1]["json"]["definition"]
        self.assertEqual(client.writes[0][1]["json"]["metadata"], {"sample": "foundry_voice_webrtc"})
        self.assertEqual(definition["audio"]["output"]["voice"], "en-US-Tyler:DragonHDLatestNeural")
        self.assertEqual(definition["audio"]["input"]["noise_reduction"]["type"],
                         "azure_deep_noise_suppression_headset")
        self.assertEqual(definition["tools"], [self.weather.return_value])
        self.assertEqual(definition["tool_choice"], "auto")
        instructions = definition["instructions"]
        self.assertEqual(instructions.count("\n\nWEB SEARCH\n"), 1)
        for policy in (
                "The attached weather toolbox provides general web search, not only weather.",
                "Search when the caller requests a lookup or facts need verification.",
                "For current or changing facts--including the current time in a city--use the toolbox before answering.",
                "Give concise answers grounded in the results.",
                "Do not claim you lack real-time access without attempting the lookup.",
                "If the lookup fails, explain that honestly.",
                "Never invent results or claim a lookup succeeded without a successful tool result.",
                "Use search when needed, not for greetings, casual conversation, or simple arithmetic."):
            self.assertIn(policy, instructions)
        self.assertNotIn("WEATHER LOOKUP", definition["instructions"])
        self.assertNotIn("TOOL ACKNOWLEDGEMENT", definition["instructions"])
        self.assertIn("You are Riley, a general-purpose voice assistant.", definition["instructions"])
        self.assertIn("{{language_policy}}", definition["instructions"])
        self.assertIn("The configured greeting opens the conversation. Do not repeat it.", definition["instructions"])
        template = self.agent()["versions"]["latest"]["definition"]
        self.assertEqual(definition, {**template, "tools": [self.weather.return_value]})
        self.assertIn(":enable?", client.writes[1][0])

    async def test_failed_weather_setup_never_publishes_an_agent(self):
        self.weather.side_effect = AgentPreparationError("Weather Toolbox unavailable")
        client = Client([Response(404), Response(200)])
        with self.assertRaisesRegex(AgentPreparationError, "Weather Toolbox unavailable"):
            await prepare_configured_agent(client, self.config(), {})
        self.assertEqual(client.writes, [])

    async def test_reset_preflights_weather_before_deleting_existing_agent(self):
        self.weather.side_effect = AgentPreparationError("Weather Toolbox denied")
        client = Client([Response(200, self.agent())])
        with self.assertRaisesRegex(AgentPreparationError, "Weather Toolbox denied"):
            await recreate_configured_agent(client, self.config(), {})
        self.assertEqual(client.removals, [])
        self.assertEqual(client.writes, [])

    async def test_older_demo_without_weather_can_still_be_explicitly_reset(self):
        agent = self.agent()
        definition = agent["versions"]["latest"]["definition"]
        definition["instructions"] = definition["instructions"].partition("\n\nWEATHER LOOKUP")[0]
        definition["greeting"] = {"type": "template", "text": "{{greeting_text}}"}
        definition.pop("tools")
        client = Client([Response(200, agent), Response(404), Response(404), Response(200)],
                        [Response(201), Response(204)], [Response(200)])
        self.assertTrue((await recreate_configured_agent(client, self.config(), {}))["recreated"])

    async def test_previous_weather_prompt_without_ownership_metadata_can_be_reset(self):
        agent = self.agent()
        definition = agent["versions"]["latest"]["definition"]
        definition["model"] = "gpt-4.1-mini"
        definition["instructions"] = definition["instructions"].partition("\n\nTURN FOCUS AND CAPABILITIES")[0]
        definition["greeting"] = {"type": "template", "text": "{{greeting_text}}"}
        client = Client([Response(200, agent), Response(404), Response(404), Response(200)],
                        [Response(201), Response(204)], [Response(200)])
        self.assertTrue((await recreate_configured_agent(client, self.config(), {}))["recreated"])

    async def test_previous_prompt_without_identity_or_ownership_metadata_can_be_reset(self):
        agent = self.agent()
        agent["versions"]["latest"]["definition"]["instructions"] = (
            agent["versions"]["latest"]["definition"]["instructions"].partition("\n\nAGENT IDENTITY")[0])
        agent["versions"]["latest"]["definition"]["greeting"] = {"type": "template", "text": "{{greeting_text}}"}
        client = Client([Response(200, agent), Response(404), Response(404), Response(200)],
                        [Response(201), Response(204)], [Response(200)])
        self.assertTrue((await recreate_configured_agent(client, self.config(), {}))["recreated"])

    async def test_custom_greeting_without_ownership_metadata_cannot_be_reset(self):
        agent = self.agent()
        agent["versions"]["latest"]["definition"]["greeting"]["prompt"] = "A custom greeting."
        client = Client([Response(200, agent)])
        with self.assertRaisesRegex(AgentPreparationError, "not recognized"):
            await recreate_configured_agent(client, self.config(), {})
        self.assertEqual(client.removals, [])
        self.assertEqual(client.writes, [])

    async def test_denied_or_unavailable_project_never_creates(self):
        for statuses in ((403,), (401,), (500,), (404, 404), (404, 403)):
            client = Client([Response(status) for status in statuses])
            with self.subTest(statuses=statuses), self.assertRaises(AgentPreparationError):
                await prepare_configured_agent(client, self.config(), {})
            self.assertEqual(client.writes, [])

    async def test_existing_incompatible_agent_is_not_changed(self):
        for definition in ({"kind": "prompt"}, {"kind": "voice"}):
            client = Client([Response(200, {"versions": {"latest": {"definition": definition}}})])
            with self.assertRaises(AgentPreparationError):
                await prepare_configured_agent(client, self.config(personalization_required=True), {})
            self.assertEqual(client.writes, [])

    async def test_publication_and_enable_failures_are_explicit(self):
        for posts in ([Response(403)], [Response(201), Response(403)]):
            client = Client([Response(404), Response(200)], posts)
            with self.assertRaises(AgentPreparationError):
                await prepare_configured_agent(client, self.config(), {})

    async def test_api_checks_origin_and_returns_preparation_result(self):
        tokens = AsyncMock()
        tokens.get_token.return_value = "test"
        result = {"agent": "demo-agent", "created": True, "personalizationRequired": True}
        with patch("server.prepare_configured_agent", AsyncMock(return_value=result)) as prepare:
            async with TestClient(TestServer(create_app(self.config(), tokens))) as client:
                bad = await client.post("/api/agent/prepare", headers={"Origin": "https://untrusted.example"})
                self.assertEqual(bad.status, 403)
                prepare.assert_not_awaited()
                response = await client.post("/api/agent/prepare", headers={"Origin": str(client.make_url("")).rstrip("/")})
                self.assertEqual(response.status, 200)
                self.assertEqual(await response.json(), result)

    async def test_reset_removes_then_publishes_same_name_and_reuses_next_time(self):
        for status in (200, 204, 404):
            client = Client(
                [Response(200, self.agent()), Response(404), Response(404), Response(200)],
                [Response(201), Response(204)], [Response(status)])
            result = await recreate_configured_agent(client, self.config(), {})
            self.assertEqual(result["agent"], "demo-agent")
            self.assertTrue(result["recreated"])
            self.assertEqual(client.removals[0][0], self.config().agent_url())
            self.assertIn("/agents/demo-agent/versions?", client.writes[0][0])
            client.gets.append(Response(200, self.agent()))
            client.gets.append(Response(200))
            client.posts.append(Response(204))
            reused = await prepare_configured_agent(client, self.config(), {})
            self.assertFalse(reused["created"])
            self.assertEqual(len(client.removals), 1)
            self.assertEqual(sum("/versions?" in url for url, _ in client.writes), 1)

    async def test_reset_missing_agent_creates_without_delete(self):
        client = Client([Response(404), Response(404), Response(200)], [Response(201), Response(204)])
        self.assertTrue((await recreate_configured_agent(client, self.config(), {}))["recreated"])
        self.assertEqual(client.removals, [])

    async def test_reset_rejects_unrelated_agents_and_denied_lookups(self):
        unrelated = {"versions": {"latest": {"definition": {"kind": "voice"}}}}
        for response in (Response(200, unrelated), Response(401), Response(403), Response(500)):
            client = Client([response])
            with self.assertRaises(AgentPreparationError):
                await recreate_configured_agent(client, self.config(), {})
            self.assertEqual(client.removals, [])
            self.assertEqual(client.writes, [])

    async def test_reset_recognizes_ownership_marker_for_updated_demo(self):
        agent = self.agent()
        agent["versions"]["latest"]["definition"]["instructions"] = "Updated demo instructions"
        agent["versions"]["latest"]["metadata"] = {"sample": "foundry_voice_webrtc"}
        client = Client([Response(200, agent), Response(404), Response(404), Response(200)],
                        [Response(201), Response(204)], [Response(200)])
        self.assertTrue((await recreate_configured_agent(client, self.config(), {}))["recreated"])

    async def test_delete_failure_never_publishes(self):
        client = Client([Response(200, self.agent())], deletes=[Response(403)])
        with self.assertRaisesRegex(AgentPreparationError, "removal failed"):
            await recreate_configured_agent(client, self.config(), {})
        self.assertEqual(client.writes, [])

    async def test_reset_waits_for_confirmed_removal_before_publishing(self):
        client = Client(
            [Response(200, self.agent()), Response(200, self.agent()), Response(404), Response(404), Response(200)],
            [Response(201), Response(204)], [Response(200)])
        with patch("server.asyncio.sleep", AsyncMock()) as sleep:
            self.assertTrue((await recreate_configured_agent(client, self.config(), {}))["recreated"])
            sleep.assert_awaited_once()

    async def test_unverified_removal_never_publishes(self):
        for statuses in ([403], [200] * 10):
            client = Client([Response(200, self.agent()), *[Response(s) for s in statuses]],
                            deletes=[Response(200)])
            with patch("server.asyncio.sleep", AsyncMock()), self.assertRaisesRegex(AgentPreparationError, "Removal was requested"):
                await recreate_configured_agent(client, self.config(), {})
            self.assertEqual(client.writes, [])

    async def test_partial_failure_tells_user_to_retry_without_deleting_again(self):
        for posts in ([Response(403)], [Response(201), Response(403)]):
            client = Client(
                [Response(200, self.agent()), Response(404), Response(404), Response(200)],
                posts, [Response(200)])
            with self.assertRaisesRegex(AgentPreparationError, "previous Agent was removed.*Retry setup & start"):
                await recreate_configured_agent(client, self.config(), {})

    async def test_reset_api_requires_opt_in_origin_and_exact_confirmation(self):
        tokens = AsyncMock()
        result = {"agent": "demo-agent", "created": True, "recreated": True}
        for enabled in (False, True):
            with patch("server.recreate_configured_agent", AsyncMock(return_value=result)) as reset:
                async with TestClient(TestServer(create_app(self.config(allow_agent_recreate=enabled), tokens))) as client:
                    origin = {"Origin": str(client.make_url("")).rstrip("/")}
                    response = await client.get("/api/config")
                    self.assertEqual((await response.json())["agentRecreateAllowed"], enabled)
                    for body in ({}, None, [], {"confirm_agent": "wrong"},
                                 {"confirm_agent": "demo-agent", "agent": "other"}):
                        response = await client.post("/api/agent/recreate", headers=origin, json=body)
                        self.assertEqual(response.status, 400 if enabled else 403)
                        reset.assert_not_awaited()
                    response = await client.post("/api/agent/recreate", headers={"Origin": "https://untrusted.example"},
                                                 json={"confirm_agent": "demo-agent"})
                    self.assertEqual(response.status, 403)
                    reset.assert_not_awaited()
                    response = await client.post("/api/agent/recreate", headers=origin,
                                                 json={"confirm_agent": "demo-agent"})
                    self.assertEqual(response.status, 200 if enabled else 403)
                    if enabled:
                        self.assertEqual(await response.json(), result)
                        reset.assert_awaited_once()
                    else:
                        reset.assert_not_awaited()

    async def test_active_call_blocks_reset(self):
        with patch("server.recreate_configured_agent", AsyncMock()) as reset:
            app = create_app(self.config(allow_agent_recreate=True), AsyncMock())
            app[ACTIVE].active = True
            async with TestClient(TestServer(app)) as client:
                response = await client.post("/api/agent/recreate",
                    headers={"Origin": str(client.make_url("")).rstrip("/")}, json={"confirm_agent": "demo-agent"})
                self.assertEqual(response.status, 409)
                self.assertIn("End the active conversation", (await response.json())["error"])
                reset.assert_not_awaited()

    async def test_reset_serializes_preparation_and_blocks_new_calls(self):
        entered, release = asyncio.Event(), asyncio.Event()

        async def resetting(*args):
            entered.set()
            await release.wait()
            return {"agent": "demo-agent", "created": True, "recreated": True}

        with patch("server.recreate_configured_agent", resetting), patch(
                "server.prepare_configured_agent", AsyncMock(return_value={"agent": "demo-agent"})) as prepare:
            async with TestClient(TestServer(create_app(self.config(allow_agent_recreate=True), AsyncMock()))) as client:
                headers = {"Origin": str(client.make_url("")).rstrip("/")}
                resetting_request = asyncio.ensure_future(client.post(
                    "/api/agent/recreate", headers=headers, json={"confirm_agent": "demo-agent"}))
                try:
                    await asyncio.wait_for(entered.wait(), 2)
                    response = await client.get("/api/voice", headers=headers)
                    self.assertEqual(response.status, 409)
                    preparation = asyncio.ensure_future(client.post("/api/agent/prepare", headers=headers))
                    await asyncio.sleep(0.01)
                    prepare.assert_not_awaited()
                finally:
                    release.set()
                self.assertEqual((await resetting_request).status, 200)
                self.assertEqual((await preparation).status, 200)
                prepare.assert_awaited_once()


class WeatherToolboxTests(unittest.IsolatedAsyncioTestCase):
    def config(self):
        return Settings("https://example.services.ai.azure.com/api/projects/demo")

    def version(self, number="1"):
        return {"version": number, "tools": [{"type": "web_search", "name": "weather"}]}

    async def test_existing_weather_toolbox_reuses_immutable_latest_version_without_publishing(self):
        client = Client([Response(200, {"versions": {"latest": self.version("3")}})])
        reference = await prepare_weather_toolbox(client, self.config(), {})
        self.assertEqual(reference, {"type": "toolbox", "toolbox_name": "weather", "toolbox_version": "3"})
        self.assertEqual(client.writes, [])

    async def test_missing_toolbox_is_published_from_bundled_definition(self):
        client = Client([Response(404), Response(200)], [Response(200, self.version())])
        reference = await prepare_weather_toolbox(client, self.config(), {})
        self.assertEqual(reference["toolbox_version"], "1")
        url, request = client.writes[0]
        self.assertIn("/toolboxes/weather/versions?", url)
        self.assertEqual(request["json"]["tools"][0]["type"], "web_search")
        self.assertEqual(request["json"]["metadata"]["sample"], "foundry_voice_webrtc")
        self.assertFalse(request["allow_redirects"])

    async def test_authorization_or_missing_api_is_not_treated_as_missing_toolbox(self):
        for statuses in ((403,), (401,), (500,), (404, 404), (404, 403)):
            client = Client([Response(status) for status in statuses])
            with self.subTest(statuses=statuses), self.assertRaises(AgentPreparationError):
                await prepare_weather_toolbox(client, self.config(), {})
            self.assertEqual(client.writes, [])

    async def test_creation_error_is_explicit(self):
        client = Client([Response(404), Response(200)], [Response(403)])
        with self.assertRaisesRegex(AgentPreparationError, "Weather Toolbox creation failed"):
            await prepare_weather_toolbox(client, self.config(), {})

    async def test_invalid_existing_toolbox_is_not_overwritten(self):
        for latest in (None, {}, {"version": "latest", "tools": [{"type": "web_search"}]},
                       {"version": "1", "tools": []}, {"version": "1", "tools": [None]},
                       {"version": "1", "tools": [{"type": "mcp"}]}):
            client = Client([Response(200, {"versions": {"latest": latest}})])
            with self.subTest(latest=latest), self.assertRaisesRegex(AgentPreparationError, "must have a published version"):
                await prepare_weather_toolbox(client, self.config(), {})
            self.assertEqual(client.writes, [])

    async def test_malformed_publication_response_is_not_a_success(self):
        client = Client([Response(404), Response(200)], [Response(201, None)])
        with self.assertRaises(AgentPreparationError):
            await prepare_weather_toolbox(client, self.config(), {})
