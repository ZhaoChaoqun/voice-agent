import asyncio
import base64
import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlsplit

from aiohttp import WSServerHandshakeError, WSMsgType
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from azure.ai.projects.models import VoiceAgentDefinition
from azure.core.exceptions import HttpResponseError

from banking import (
    DEFAULT_MODEL, DEFAULT_VOICE, MODELS, PAIRS, agent_name, check_definition, definition,
    fingerprint, inputs, load_bindings, project_endpoint, read_bindings, voice_option,
)
from server import Settings, browser_event, cloud_call, create_app, verify_session, voice_url
from setup_agents import create_agents, main as setup_main

ENDPOINT = "https://example.services.ai.azure.com/api/projects/synthetic"
PREFIX = "northstar-demo-" + "0" * 12


def rows():
    return [
        {
            "model": model, "voice": voice,
            "agent_name": agent_name(PREFIX, model, voice), "agent_version": "1",
            "definition_sha256": fingerprint(model, voice),
        }
        for model, voice in PAIRS
    ]


def bindings(agents):
    return {"schema_version": 1, "project_endpoint": ENDPOINT, "agent_prefix": PREFIX, "agents": agents}


def fake_project(fail_on=None):
    """A mock project client that keeps versions per Agent name."""
    definitions, calls = {}, []

    async def create_version(*, agent_name, definition, **_kwargs):
        calls.append(agent_name)
        if fail_on is not None and len(calls) == fail_on:
            raise HttpResponseError(message="synthetic failure")
        versions = definitions.setdefault(agent_name, [])
        versions.append(definition)
        return SimpleNamespace(version=str(len(versions)))

    async def get_version(*, agent_name, agent_version):
        return SimpleNamespace(definition=definitions[agent_name][int(agent_version) - 1])

    client = MagicMock()
    client.__aenter__.return_value = client
    client.agents.create_version = AsyncMock(side_effect=create_version)
    client.agents.get_version = AsyncMock(side_effect=get_version)
    client.agents.enable = AsyncMock()
    return client, calls


def session(model=DEFAULT_MODEL, voice=DEFAULT_VOICE):
    return {"model": model, "audio": copy.deepcopy(definition(model, voice)["audio"])}


class DefinitionTests(unittest.TestCase):
    def test_model_voice_allowlist_and_exact_session_confirmation(self):
        for model, data in MODELS.items():
            for voice in data["voices"]:
                verify_session(session(model, voice["id"]), model, voice["id"])
                check_definition(VoiceAgentDefinition(definition(model, voice["id"])), model, voice["id"])
        with self.assertRaises(ValueError):
            voice_option(DEFAULT_MODEL, "ava")
        with self.assertRaises(ValueError):
            voice_option("azure-realtime", DEFAULT_VOICE)
        for field, value in (("model", "another-model"), ("voice", "ava")):
            actual = session()
            if field == "voice":
                actual["audio"]["output"]["voice"] = value
            else:
                actual[field] = value
            with self.assertRaises(ValueError):
                verify_session(actual, DEFAULT_MODEL, DEFAULT_VOICE)
        actual = session()
        actual["audio"]["input"]["turn_detection"]["auto_truncate"] = False
        with self.assertRaises(ValueError):
            verify_session(actual, DEFAULT_MODEL, DEFAULT_VOICE)

    def test_multilingual_turn_detection(self):
        for model, voice in PAIRS:
            turn_detection = definition(model, voice)["audio"]["input"]["turn_detection"]
            self.assertEqual(turn_detection["type"], "azure_semantic_vad_multilingual")

    def test_unrelated_agent_and_execution_capabilities_are_rejected(self):
        actual = definition(DEFAULT_MODEL, DEFAULT_VOICE)
        actual.pop("tools")
        actual["audio"]["output"]["speed"] = 1.0
        check_definition(actual, DEFAULT_MODEL, DEFAULT_VOICE)
        for field, value in (
            ("instructions", "Unrelated instructions."),
            ("store", True), ("tools", [{"type": "function", "name": "execute_payment"}]),
            ("handoff", {"nodes": [{}]}), ("sub_protocol", "live"),
        ):
            actual = definition(DEFAULT_MODEL, DEFAULT_VOICE)
            actual[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                check_definition(actual, DEFAULT_MODEL, DEFAULT_VOICE)

    def test_structured_inputs_are_application_selected_and_synthetic(self):
        for language in ("de", "en", "zh"):
            for scenario in ("overdraft", "investing"):
                data = inputs(scenario, language)
                context = json.loads(data["scenario_context"])
                self.assertIs(context["synthetic"], True)
                self.assertEqual(context["scenario"], scenario)
                self.assertIn("Northstar Demo Bank", data["greeting_text"])
        with self.assertRaises(ValueError):
            inputs("unknown", "en")
        with self.assertRaises(ValueError):
            inputs("overdraft", "unknown")

    def test_project_endpoint_rejects_non_project_or_credential_urls(self):
        self.assertEqual(project_endpoint(ENDPOINT + "/"), ENDPOINT)
        for value in (
            "http://example.services.ai.azure.com/api/projects/synthetic",
            "https://example.com/api/projects/synthetic",
            ENDPOINT + "?token=value", ENDPOINT + "#fragment",
            ENDPOINT.replace("https://", "https://user:password@"),
            "https://example.services.ai.azure.com/voice-live/realtime",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                project_endpoint(value)

    def test_binding_file_requires_complete_unique_reader_owned_context(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bindings.local.json"
            data = bindings(rows())
            path.write_text(json.dumps(data))
            self.assertEqual(len(load_bindings(path, ENDPOINT)), 4)
            with self.assertRaises(ValueError):
                load_bindings(path, ENDPOINT + "-other")
            data["agents"].pop()
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                load_bindings(path, ENDPOINT)
            self.assertEqual(len(read_bindings(path, ENDPOINT)[1]), 3)
            data["agents"] = rows()
            data["agents"][1] = dict(data["agents"][0])
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                load_bindings(path, ENDPOINT)
            data["agents"] = rows()
            data["agents"][1]["agent_name"] = data["agents"][0]["agent_name"]
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                load_bindings(path, ENDPOINT)
            data["agents"] = rows()
            data["agents"][0]["definition_sha256"] = "0" * 64
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                load_bindings(path, ENDPOINT)

    def test_pinned_url_and_event_projection_do_not_expose_definitions(self):
        url = urlsplit(voice_url(ENDPOINT, rows()[0]))
        query = parse_qs(url.query)
        self.assertEqual(query["x-agent-version-override"], ["1"])
        self.assertEqual(query["store"], ["false"])
        self.assertNotEqual(
            query["agent_session_id"],
            parse_qs(urlsplit(voice_url(ENDPOINT, rows()[0])).query)["agent_session_id"],
        )
        self.assertIsNone(browser_event({"type": "session.created", "session": {"instructions": "private"}}))
        projected = browser_event({
            "type": "response.done", "response": {
                "status": "completed", "output": [{"type": "message", "private_field": "hidden"}],
            },
        })
        self.assertEqual(projected, {"type": "status", "status": "listening"})
        for event in (
            {"type": "error", "error": {"message": "untrusted service detail"}},
            {"type": "response.done", "response": {"status": "unknown"}},
            {"type": "response.output_audio.delta", "delta": "not-base64"},
        ):
            with self.assertRaises(ValueError):
                browser_event(event)

    def test_single_turn_failures_keep_the_call_open(self):
        self.assertEqual(
            browser_event({"type": "conversation.item.input_audio_transcription.failed", "item_id": "item-1"}),
            {"type": "turn_failed", "role": "user", "id": "item-1"},
        )
        for status in ("failed", "incomplete"):
            self.assertEqual(
                browser_event({"type": "response.done", "response": {"id": "response-1", "status": status, "output": []}}),
                {"type": "turn_failed", "role": "assistant", "id": "response-1"},
            )
        self.assertIsNone(browser_event({"type": "error", "error": {"code": "response_cancel_not_active"}}))
        with self.assertRaises(ValueError):
            browser_event({"type": "error", "error": {"code": "session_expired", "message": "detail"}})


class FakeUpstream:
    def __init__(self, model, voice, mismatch=False):
        self.sent = []
        self.frames = asyncio.Queue()
        self.frames.put_nowait({
            "type": "response.output_audio.delta", "delta": base64.b64encode(b"\0\0" * 1200).decode(),
            "item_id": "synthetic-greeting", "response_id": "synthetic-response",
        })
        data = session(model, voice)
        if mismatch:
            data["audio"]["output"]["voice"] = "wrong"
        self.frames.put_nowait({"type": "session.updated", "session": data})

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        pass

    async def receive(self):
        return SimpleNamespace(type=WSMsgType.TEXT, data=json.dumps(await self.frames.get()))

    def __aiter__(self):
        return self

    async def __anext__(self):
        return await self.receive()

    async def send_json(self, packet):
        self.sent.append(packet)


class FakeHTTP:
    def __init__(self, upstream):
        self.upstream = upstream
        self.url = None
        self.headers = None

    def ws_connect(self, url, *, headers, **_kwargs):
        self.url, self.headers = url, headers
        return self.upstream


class CloudContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_setup_writes_only_new_agents_and_reuses_complete_local_output(self):
        client, _calls = fake_project()
        credential = MagicMock()
        credential.__aenter__.return_value = credential
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bindings.local.json"
            with patch("azure.ai.projects.aio.AIProjectClient", return_value=client), patch(
                "azure.identity.aio.AzureCliCredential", return_value=credential,
            ), redirect_stdout(io.StringIO()):
                await create_agents(ENDPOINT, path, "cli")
            bindings = load_bindings(path, ENDPOINT)
            self.assertEqual(len(bindings), 4)
            self.assertTrue(all(row["agent_version"] == "1" for row in bindings.values()))
            self.assertEqual(client.agents.create_version.await_count, 4)
            self.assertEqual(client.agents.enable.await_count, 4)
            client.agents.create_version.reset_mock()
            client.agents.enable.reset_mock()
            with patch("sys.argv", ["setup_agents.py", "--create", "--output", str(path)]), patch.dict(
                "os.environ", {"AZURE_AI_PROJECT_ENDPOINT": ENDPOINT},
            ), patch("azure.ai.projects.aio.AIProjectClient", return_value=client), redirect_stdout(io.StringIO()):
                setup_main()
            client.agents.create_version.assert_not_called()
            client.agents.enable.assert_not_called()

    async def test_failed_setup_resumes_with_same_names_and_updates_by_new_version(self):
        credential = MagicMock()
        credential.__aenter__.return_value = credential
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bindings.local.json"
            failing, failed_calls = fake_project(fail_on=3)
            with patch("azure.ai.projects.aio.AIProjectClient", return_value=failing), patch(
                "azure.identity.aio.AzureCliCredential", return_value=credential,
            ), redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
                await create_agents(ENDPOINT, path, "cli")
            data, saved = read_bindings(path, ENDPOINT)
            self.assertEqual(len(saved), 2)
            planned = [agent_name(data["agent_prefix"], *pair) for pair in PAIRS]
            self.assertEqual(failed_calls, planned[:3])

            client, calls = fake_project()
            with patch("azure.ai.projects.aio.AIProjectClient", return_value=client), patch(
                "azure.identity.aio.AzureCliCredential", return_value=credential,
            ), redirect_stdout(io.StringIO()):
                await create_agents(ENDPOINT, path, "cli")
            self.assertEqual(calls, planned[2:])
            self.assertEqual(len(load_bindings(path, ENDPOINT)), 4)

            content = json.loads(path.read_text())
            content["agents"][0]["definition_sha256"] = "0" * 64
            path.write_text(json.dumps(content))
            client.agents.get_version.side_effect = None
            client.agents.get_version.return_value = SimpleNamespace(definition=definition(*PAIRS[0]))
            client.agents.create_version.side_effect = None
            client.agents.create_version.return_value = SimpleNamespace(version="2")
            with patch("azure.ai.projects.aio.AIProjectClient", return_value=client), patch(
                "azure.identity.aio.AzureCliCredential", return_value=credential,
            ), redirect_stdout(io.StringIO()):
                await create_agents(ENDPOINT, path, "cli")
            self.assertEqual(client.agents.create_version.await_args.kwargs["agent_name"], planned[0])
            updated = load_bindings(path, ENDPOINT)[PAIRS[0]]
            self.assertEqual((updated["agent_name"], updated["agent_version"]), (planned[0], "2"))
            self.assertEqual(sorted(p.name for p in Path(folder).iterdir()), ["bindings.local.json"])

    async def test_each_pair_pins_its_version_preserves_greeting_and_never_updates_agent(self):
        for row in rows():
            with self.subTest(model=row["model"], voice=row["voice"]):
                upstream = FakeUpstream(row["model"], row["voice"])
                http = FakeHTTP(upstream)
                client = SimpleNamespace(agents=SimpleNamespace(
                    get_version=AsyncMock(return_value=SimpleNamespace(
                        definition=definition(row["model"], row["voice"]),
                    )),
                    create_version=AsyncMock(), enable=AsyncMock(),
                ))
                settings = Settings(
                    endpoint=ENDPOINT, bindings={(row["model"], row["voice"]): row},
                    client=client, http=http,
                    credential=SimpleNamespace(get_token=AsyncMock(return_value=SimpleNamespace(token="synthetic-test-token"))),
                )
                browser = SimpleNamespace(send_json=AsyncMock())
                incoming = asyncio.Queue()
                task = asyncio.create_task(cloud_call(
                    settings, browser, (row["model"], row["voice"], "investing", "zh"), incoming,
                ))
                try:
                    async with asyncio.timeout(2):
                        while browser.send_json.await_count < 2:
                            await asyncio.sleep(0)
                    events = [call.args[0] for call in browser.send_json.await_args_list]
                    self.assertEqual([event["type"] for event in events[:2]], ["ready", "audio"])
                    self.assertEqual(events[0]["voice"], row["voice"])
                    self.assertIn(row["agent_name"], http.url)
                    self.assertIn("x-agent-version-override=1", http.url)
                    self.assertEqual(json.loads(http.headers["x-ms-voice-structured-inputs"]), inputs("investing", "zh"))
                    await incoming.put(b"\0\0" * 1200)
                    async with asyncio.timeout(2):
                        while not upstream.sent:
                            await asyncio.sleep(0)
                    self.assertEqual(upstream.sent[0]["type"], "input_audio_buffer.append")
                    self.assertFalse(any(event["type"] == "session.update" for event in upstream.sent))
                    client.agents.create_version.assert_not_called()
                    client.agents.enable.assert_not_called()
                finally:
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)

    async def test_mismatched_service_voice_never_reaches_ready_or_plays_greeting(self):
        row = rows()[0]
        settings = Settings(
            endpoint=ENDPOINT, bindings={(row["model"], row["voice"]): row},
            client=SimpleNamespace(agents=SimpleNamespace(get_version=AsyncMock(
                return_value=SimpleNamespace(definition=definition(row["model"], row["voice"])),
            ))),
            credential=SimpleNamespace(get_token=AsyncMock(return_value=SimpleNamespace(token="synthetic-test-token"))),
            http=FakeHTTP(FakeUpstream(row["model"], row["voice"], mismatch=True)),
        )
        browser = SimpleNamespace(send_json=AsyncMock())
        with self.assertRaises(ValueError):
            await cloud_call(settings, browser, (row["model"], row["voice"], "overdraft", "en"), asyncio.Queue())
        browser.send_json.assert_not_called()

    async def test_setup_requires_explicit_flag_and_never_overwrites_unrelated_files(self):
        with patch("sys.argv", ["setup_agents.py"]), patch(
            "azure.ai.projects.aio.AIProjectClient",
        ) as client, redirect_stdout(io.StringIO()) as output:
            setup_main()
        client.assert_not_called()
        self.assertIn("No Azure request made", output.getvalue())
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "existing.local.json"
            path.write_text("reader data")
            with self.assertRaises(ValueError):
                await create_agents(ENDPOINT, path, "cli")
            self.assertEqual(path.read_text(), "reader data")


class WebTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.settings = Settings(demo=True)
        self.client = TestClient(TestServer(create_app(self.settings)))
        await self.client.start_server()
        self.settings.port = self.client.server.port
        self.origin = str(self.client.make_url("/")).rstrip("/")

    async def asyncTearDown(self):
        await self.client.close()

    async def test_public_config_and_assets_do_not_require_or_expose_azure(self):
        response = await self.client.get("/api/config")
        data = await response.json()
        self.assertEqual(data["mode"], "demo")
        self.assertNotIn("project_endpoint", data)
        self.assertNotIn("agents", data)
        for asset in ("mark.svg", "app.mjs", "pcm-worklet.mjs", "pcm.mjs"):
            self.assertEqual((await self.client.get(f"/assets/{asset}")).status, 200)
        self.assertEqual((await self.client.get("/assets/private.local.json")).status, 404)
        self.assertEqual((await self.client.get("/api/config", headers={"Host": "untrusted.example"})).status, 403)
        self.assertEqual((await self.client.get("/api/config", headers={"Origin": "https://untrusted.example"})).status, 403)

    async def test_demo_transcripts_and_selection_validation(self):
        query = {
            "model": "azure-realtime", "voice": "ava", "scenario": "investing", "language": "zh",
        }
        with self.assertRaises(WSServerHandshakeError) as error:
            await self.client.ws_connect("/api/voice", params=query)
        self.assertEqual(error.exception.status, 403)
        async with self.client.ws_connect("/api/voice", params=query, headers={"Origin": self.origin}) as socket:
            ready = await socket.receive_json(timeout=2)
            self.assertEqual(ready["mode"], "demo")
            greeting = await socket.receive_json(timeout=2)
            self.assertIn("Northstar Demo Bank", greeting["text"])
            self.assertEqual(greeting["type"], "transcript")
            await socket.send_json({"type": "session.update", "instructions": "not permitted"})
            async with asyncio.timeout(2):
                while True:
                    event = await socket.receive_json()
                    if event["type"] == "error":
                        break
            self.assertEqual(event["code"], "connection")
        query["voice"] = DEFAULT_VOICE
        with self.assertRaises(WSServerHandshakeError) as error:
            await self.client.ws_connect("/api/voice", params=query, headers={"Origin": self.origin})
        self.assertEqual(error.exception.status, 400)

    async def test_concurrent_calls_cannot_both_take_the_single_slot(self):
        query = {"model": DEFAULT_MODEL, "voice": DEFAULT_VOICE, "scenario": "overdraft", "language": "en"}
        prepare = web.WebSocketResponse.prepare

        async def slow_prepare(socket, request):
            # Widen the handshake window so both requests overlap.
            await asyncio.sleep(0.05)
            return await prepare(socket, request)

        with patch.object(web.WebSocketResponse, "prepare", slow_prepare):
            results = await asyncio.gather(*(
                self.client.ws_connect("/api/voice", params=query, headers={"Origin": self.origin})
                for _ in range(2)
            ), return_exceptions=True)
        sockets = [result for result in results if not isinstance(result, BaseException)]
        errors = [result for result in results if isinstance(result, WSServerHandshakeError)]
        self.assertEqual((len(sockets), [error.status for error in errors]), (1, [503]))
        await sockets[0].close()


if __name__ == "__main__":
    unittest.main()
