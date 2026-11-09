"""Offline tool/lifecycle/SDK tests for all GPT Live samples; no Azure or audio devices."""

import asyncio
import base64
import contextlib
import io
import json
import os
import unittest
from datetime import datetime, timezone
from http import HTTPStatus
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import urlsplit

import aiohttp
from azure.ai.projects.aio import AIProjectClient
from azure.ai.projects.models import PromptAgentDefinition, VoiceAgentLiveDefinition
from azure.core.credentials import AccessToken
from azure.core.pipeline.transport import AsyncHttpResponse, AsyncHttpTransport
from azure.core.utils import case_insensitive_dict
from rich.console import Console
from websockets.asyncio.server import serve

import client_delegation as client
import prompt_agent_delegation as managed
import prompt_agent_delegation_tools as sample
import response_delegation as direct
from response_delegation import DemoError, converse
from transcript_common import TranscriptDisplay

PROJECT_ENDPOINT = "https://sample.services.ai.azure.com/api/projects/test"
LESSON = {"learner_name": direct.DEFAULT_LEARNER_NAME, "level": direct.DEFAULT_LEVEL}


def mock_transcript():
    """A recording transcript with the real stop event and typed-message queue converse() uses."""
    transcript = MagicMock()
    transcript.stop_requested = asyncio.Event()
    transcript.typed_messages = asyncio.Queue()
    return transcript


def function_call(call_id="call-1", **overrides):
    return {
        "type": "function_call",
        "call_id": call_id,
        "name": sample.DATETIME_TOOL_NAME,
        "arguments": "{}",
        **overrides,
    }


def envelope(kind, **fields):
    """A Live server event as JSON; the SDK yields models or dicts, both mappings."""
    return {"type": kind, **fields}


def backend(kind, delegation_id="delegation-1", **fields):
    return envelope(
        "response.event",
        delegation_id=delegation_id,
        event={"type": kind, **fields},
    )


def live_session(conversation_id, *events):
    """Live server events from session.started to session.closed."""
    return [
        envelope(
            "session.started",
            conversation_id=conversation_id,
            session={
                "id": f"session-{conversation_id}",
                "audio": {"format": {"type": "audio/pcm", "rate": 24000}},
            },
        ),
        *events,
        envelope("session.closed", reason="close_requested", usage={"seconds": 1}),
    ]


@contextlib.asynccontextmanager
async def live_server(exchange):
    """Serve exchange on a local ws:// port and route the SDK's wss:// Live handshake to it.

    Yields the recorded handshakes as (url, ws_connect keyword arguments).
    """
    handshakes = []
    connect = aiohttp.ClientSession.ws_connect

    def loopback(session, url, **kwargs):
        handshakes.append((url, kwargs))
        return connect(session, f"ws://127.0.0.1:{port}", **kwargs)

    async with serve(exchange, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        with patch.object(aiohttp.ClientSession, "ws_connect", loopback):
            yield handshakes


def play(events, received):
    """A Live server that sends events, then records client commands until closed."""

    async def exchange(socket):
        for event in events:
            await socket.send(json.dumps(event))
        async for raw in socket:
            received.append(json.loads(raw))

    return exchange


class PayloadTests(unittest.TestCase):
    def test_prompt_tools_use_projects_sdk_models(self):
        definition = sample.prompt_agent_definition("text-model")
        self.assertIsInstance(definition, PromptAgentDefinition)
        wire = definition.as_dict()
        self.assertEqual(PromptAgentDefinition(wire).as_dict(), wire)
        mcp, clock = wire["tools"]
        self.assertEqual(mcp["type"], "mcp")
        self.assertEqual(mcp["server_url"], sample.MCP_SERVER_URL)
        self.assertEqual(mcp["allowed_tools"], ["add"])
        self.assertEqual(mcp["require_approval"], "never")
        self.assertNotIn("headers", mcp)
        self.assertNotIn("authorization", mcp)
        self.assertEqual(clock["type"], "function")
        self.assertEqual(clock["name"], sample.DATETIME_TOOL_NAME)
        self.assertTrue(clock["strict"])
        self.assertEqual(
            clock["parameters"],
            {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        )
        self.assertEqual(wire["text"], {"format": {"type": "text"}})
        self.assertIn("[commentary]", wire["instructions"])

    def test_voice_retains_pinned_managed_reference(self):
        definition = sample.voice_agent_definition("live", "prompt", "7")
        self.assertIsInstance(definition, VoiceAgentLiveDefinition)
        wire = definition.as_dict()
        self.assertEqual(
            (wire["kind"], wire["sub_protocol"], wire["model_type"], wire["model"]),
            ("voice", "live", "self_deployed", "live"),
        )
        self.assertEqual(
            wire["delegation"],
            {"type": "foundry_managed_agent", "agent_name": "prompt", "agent_version": "7"},
        )
        self.assertEqual(
            wire["audio"],
            {"format": {"type": "audio/pcm", "rate": 24000}, "output": {"voice": "marin"}},
        )
        self.assertTrue(wire["store"])
        self.assertIn("current-date/time", wire["instructions"])
        self.assertNotIn("tools", managed.prompt_agent_definition("text").as_dict())

    def test_datetime_is_one_instant_with_explicit_offsets(self):
        before = datetime.now(timezone.utc).replace(microsecond=0)
        result = sample.get_current_datetime()
        after = datetime.now(timezone.utc)
        local = datetime.fromisoformat(result["local_datetime"])
        utc = datetime.fromisoformat(result["utc_datetime"])
        self.assertIsNotNone(local.utcoffset())
        self.assertEqual(utc.utcoffset().total_seconds(), 0)
        self.assertEqual(local, utc)
        self.assertLessEqual(before, utc)
        self.assertLessEqual(utc, after)
        self.assertTrue(result["timezone"])

    def test_allowed_function_executes_once(self):
        with patch.object(sample, "get_current_datetime", return_value={"clock": "test"}) as clock:
            self.assertEqual(json.loads(sample.execute_function(function_call())), {"clock": "test"})
        clock.assert_called_once_with()

    def test_invalid_arguments_do_not_read_clock(self):
        for arguments in ("", "{", "null", "[]", "0", "false", '"{}"', '{"timezone":"UTC"}', None):
            with self.subTest(arguments=arguments):
                with patch.object(sample, "get_current_datetime") as clock:
                    output = json.loads(sample.execute_function(function_call(arguments=arguments)))
                self.assertEqual(output["error"], "invalid_arguments")
                clock.assert_not_called()

    def test_unknown_function_is_not_executed(self):
        with patch.object(sample, "get_current_datetime") as clock:
            output = json.loads(sample.execute_function(function_call(name="os.system")))
        self.assertEqual(output["error"], "unknown_function")
        clock.assert_not_called()


class ToolHandlerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.handler = sample.ManagedToolHandler()
        self.sent = []

        async def send_item(**kwargs):
            self.sent.append(("item", kwargs["item"]))

        async def resume(**kwargs):
            self.sent.append(("resume", kwargs))

        self.connection = SimpleNamespace(
            response=SimpleNamespace(
                item=SimpleNamespace(create=AsyncMock(side_effect=send_item)),
                create=AsyncMock(side_effect=resume),
            )
        )
        self.transcript = MagicMock()
        await self.created()

    async def observe(self, event):
        await self.handler(self.connection, event, self.transcript)

    async def created(self, response_id="response-1", delegation_id="delegation-1"):
        await self.observe(backend(
            "response.created", delegation_id, response={"id": response_id, "status": "in_progress"}
        ))

    async def done(self, call=None, delegation_id="delegation-1", **fields):
        await self.observe(backend(
            "response.output_item.done", delegation_id,
            item=function_call() if call is None else call, **fields,
        ))

    async def completed(self, response_id="response-1", delegation_id="delegation-1"):
        # The service strips lifecycle output. Calls must come from item.done.
        await self.observe(backend(
            "response.completed", delegation_id,
            response={"id": response_id, "status": "completed", "output": []},
        ))

    async def test_waits_for_terminal_response_then_returns_function_output(self):
        await self.done()
        self.assertEqual(self.sent, [])
        await self.completed()
        self.assertEqual([kind for kind, _ in self.sent], ["item", "resume"])
        item = self.sent[0][1]
        self.assertEqual(item["type"], "function_call_output")
        self.assertEqual(item["call_id"], "call-1")
        self.assertIn("utc_datetime", json.loads(item["output"]))

    async def test_parallel_outputs_precede_one_continuation(self):
        await self.done(function_call("call-1"))
        await self.done(function_call("call-2"))
        await self.completed()
        self.assertEqual([kind for kind, _ in self.sent], ["item", "item", "resume"])
        self.assertEqual([item["call_id"] for kind, item in self.sent if kind == "item"], ["call-1", "call-2"])

    async def test_duplicate_events_do_not_reexecute_or_resume(self):
        with patch.object(sample, "get_current_datetime", return_value={"clock": "once"}) as clock:
            await self.done()
            await self.done()
            await self.completed()
            await self.done()
            await self.completed()
        clock.assert_called_once_with()
        self.connection.response.create.assert_awaited_once_with()

    async def test_multiple_backend_rounds_keep_the_same_delegation(self):
        await self.done()
        await self.completed()
        await self.created("response-2")
        await self.done(function_call("call-2"))
        await self.completed("response-2")
        self.assertEqual([kind for kind, _ in self.sent], ["item", "resume", "item", "resume"])

    async def test_server_mcp_tools_and_partial_function_arguments_are_not_executed(self):
        with patch.object(sample, "get_current_datetime") as clock:
            for tool_type in ("mcp_call", "mcp_list_tools", "message"):
                await self.done({"type": tool_type, "output": "Not a local function."})
            await self.observe(backend("response.function_call_arguments.delta", delta="{}"))
            await self.completed()
        clock.assert_not_called()
        self.assertEqual(self.sent, [])

    async def test_invalid_and_unknown_calls_return_errors_without_executing(self):
        with patch.object(sample, "get_current_datetime") as clock:
            await self.done(function_call(arguments="not json"))
            await self.done(function_call("call-2", name="not_allowed"))
            await self.completed()
        clock.assert_not_called()
        errors = [json.loads(item["output"])["error"] for kind, item in self.sent if kind == "item"]
        self.assertEqual(errors, ["invalid_arguments", "unknown_function"])
        self.connection.response.create.assert_awaited_once_with()

    async def test_failed_backend_responses_never_execute_pending_calls(self):
        for index, phase in enumerate(("failed", "incomplete", "cancelled")):
            response_id = f"response-{phase}"
            await self.created(response_id)
            await self.done(function_call(f"call-{index}"))
            await self.observe(backend(f"response.{phase}", response={"id": response_id}))
            await self.completed(response_id)
        self.assertEqual(self.sent, [])

    async def test_session_events_do_not_submit_pending_calls(self):
        await self.done()
        await self.observe(envelope(
            "session.delegation.created",
            delegation={"id": "delegation-1", "type": "delegation", "target": "foundry_managed_agent"},
        ))
        await self.observe(envelope("session.commentary.appended", client_event_id="evt_managed_1"))
        self.assertEqual(self.sent, [])
        await self.completed()
        self.assertEqual([kind for kind, _ in self.sent], ["item", "resume"])

    async def test_delegations_do_not_share_pending_calls(self):
        await self.done()
        await self.created("other-response", "other-delegation")
        await self.completed("other-response", "other-delegation")
        self.assertEqual(self.sent, [])
        await self.completed()
        self.assertEqual(len(self.sent), 2)

    async def test_uncorrelated_events_are_ignored(self):
        await self.done(delegation_id=None)
        await self.completed()
        self.assertEqual(self.sent, [])

    async def test_missing_response_id_is_rejected(self):
        with self.assertRaisesRegex(DemoError, "correlated response"):
            await self.done(delegation_id="no-response")

    async def test_changed_call_is_rejected(self):
        await self.done()
        with self.assertRaisesRegex(DemoError, "changed"):
            await self.done(function_call(arguments='{"unexpected":true}'))
        self.assertEqual(self.sent, [])

    async def test_reused_call_id_is_rejected(self):
        await self.done()
        await self.completed()
        await self.created("response-2")
        with self.assertRaisesRegex(DemoError, "reused"):
            await self.done()


class ClientExecutorTests(unittest.TestCase):
    NOW = datetime(2026, 11, 9, 4, 5, 6, tzinfo=timezone.utc)

    def test_finds_the_last_addition_in_digits_or_words(self):
        for said, expected in (
            ("What is seventeen plus twenty-five?", (17, 25)),
            ("what's 17 + 25", (17, 25)),
            ("Can you add one hundred and five to 20?", (105, 20)),
            ("The sum of 3 and 4, please.", (3, 4)),
            ("One plus one. No wait, what is 2,000 plus 30?", (2000, 30)),
            ("I goed to school.", None),
            ("", None),
        ):
            with self.subTest(said=said):
                self.assertEqual(client.find_addition(said), expected)

    def test_answers_time_and_addition_from_one_clock_reading(self):
        answer, facts = client.answer_locally("What is 2 plus 3, and what time is it?", self.NOW)
        clock = client.current_datetime(self.NOW)
        self.assertEqual(answer, f"2 plus 3 is 5. On this computer it's {clock['spoken']}.")
        self.assertIn("UTC 2026-11-09T04:05:06+00:00", facts)
        self.assertEqual(datetime.fromisoformat(clock["local_datetime"]), self.NOW)

    def test_falls_back_without_facts(self):
        self.assertEqual(client.answer_locally("Let's talk about my weekend.", self.NOW), (client.FALLBACK, None))


class OfflineCredential:
    async def get_token(self, *scopes, **kwargs):
        return AccessToken("offline-test-token", 4102444800)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class OfflineResponse(AsyncHttpResponse):
    def __init__(self, request, status_code, payload):
        super().__init__(request, None)
        self.status_code = status_code
        self.reason = HTTPStatus(status_code).phrase
        self.content_type = "application/json"
        self.headers = case_insensitive_dict({"Content-Type": self.content_type})
        self._body = json.dumps(payload).encode()

    def body(self):
        return self._body

    def json(self):
        return json.loads(self._body)

    async def read(self):
        return self._body


class OfflineProject(AsyncHttpTransport):
    """An in-memory Foundry project behind the real Projects SDK client."""

    def __init__(self, agents=None, *, fail_voice=False):
        self.agents = dict(agents or {})  # name -> (version, definition wire dict)
        self.fail_voice = fail_voice
        self.requests = []
        self.created = []
        self.deleted = []

    async def open(self):
        pass

    async def close(self):
        pass

    async def __aexit__(self, *args):
        pass

    async def send(self, request, **kwargs):
        self.requests.append(request)
        return OfflineResponse(request, *self.handle(request))

    def version(self, name):
        version, definition = self.agents[name]
        return {
            "object": "agent.version", "id": f"{name}:{version}", "name": name,
            "version": version, "created_at": 1, "definition": definition,
        }

    def handle(self, request):
        path = urlsplit(request.url).path.removeprefix(urlsplit(PROJECT_ENDPOINT).path)
        collection, name, *rest = path.strip("/").split("/")
        if request.method == "GET" and collection == "deployments":
            return 200, {"name": name, "type": "ModelDeployment"}
        if collection != "agents":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        if request.method == "POST":  # agents/{name}/versions
            definition = json.loads(request.content)["definition"]
            if definition["kind"] == "voice" and self.fail_voice:
                return 400, {"error": {"code": "test_failure", "message": "Test failure."}}
            self.created.append({"name": name, "definition": definition})
            self.agents[name] = ("7" if definition["kind"] == "prompt" else "3", definition)
            return 200, self.version(name)
        if request.method == "DELETE":
            self.deleted.append(name)
            return 200, {"object": "agent.deleted", "name": name, "deleted": True}
        if name not in self.agents:
            return 404, {"error": {"code": "not_found", "message": "Agent not found."}}
        if rest:  # agents/{name}/versions/{version}
            return 200, self.version(name)
        return 200, {
            "object": "agent", "id": name, "name": name,
            "versions": {"latest": self.version(name)},
        }

    def deployment_checks(self):
        return [
            urlsplit(request.url).path.rsplit("/", 1)[-1]
            for request in self.requests
            if "/deployments/" in request.url
        ]


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def run_main(
        self, module, main_function, *, project=None, session_events=None,
        exchange=None, environment=None, **kwargs,
    ):
        """Run a sample's main through the real Projects SDK against an offline project.

        With session_events (or a custom exchange), the SDK's Live client talks to a local
        WebSocket server that plays them; otherwise any Live handshake fails the test.
        """
        self.project = project or OfflineProject()
        self.received = []
        self.handshakes = []
        audio_factory = MagicMock(side_effect=AssertionError("Opened physical audio"))
        self.transcript = mock_transcript()
        self.transcript.__aenter__.return_value = self.transcript

        def project_client(**client_kwargs):
            return AIProjectClient(**client_kwargs, transport=self.project)

        output = io.StringIO()
        async with contextlib.AsyncExitStack() as stack:
            if session_events is None and exchange is None:
                stack.enter_context(patch.object(
                    aiohttp.ClientSession, "ws_connect",
                    side_effect=AssertionError("Opened a real Live session"),
                ))
            else:
                self.audio = OfflineAudio()
                audio_factory = MagicMock(return_value=contextlib.nullcontext(self.audio))
                self.handshakes = await stack.enter_async_context(
                    live_server(exchange or play(session_events, self.received))
                )
            stack.enter_context(patch.dict(os.environ, {
                "FOUNDRY_PROJECT_ENDPOINT": PROJECT_ENDPOINT,
                "GPT_LIVE_DEPLOYMENT": "live-model",
                "RESPONSE_DELEGATION_DEPLOYMENT": "text-model",
                "AGENT_NAME": "",
                **(environment or {}),
            }))
            stack.enter_context(patch.object(module, "project_credential", return_value=OfflineCredential()))
            stack.enter_context(patch.object(module, "AIProjectClient", side_effect=project_client))
            stack.enter_context(patch.object(module, "Audio", audio_factory))
            stack.enter_context(patch.object(module, "TranscriptDisplay", return_value=self.transcript))
            stack.enter_context(contextlib.redirect_stdout(output))
            try:
                await main_function(**kwargs)
            finally:
                self.output = output.getvalue()

    def assert_live_handshake(self, agent_name, version, structured_inputs=LESSON):
        (url, kwargs), = self.handshakes
        self.assertEqual(
            url, f"wss://sample.services.ai.azure.com/api/projects/test/agents/{agent_name}"
            "/endpoint/protocols/voice/live/sessions",
        )
        self.assertEqual(kwargs["params"]["agent_version_override"], version)
        # The SDK sends the session's structured inputs as JSON in the handshake query.
        if structured_inputs is None:
            self.assertNotIn("structured_inputs", kwargs["params"])
        else:
            self.assertEqual(json.loads(kwargs["params"]["structured_inputs"]), structured_inputs)
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer offline-test-token")
        self.assertEqual(kwargs["headers"]["Foundry-Features"], "VoiceAgents=V1Preview")

    def sent_commands(self):
        return [command["type"] for command in self.received]

    def assert_lesson_personalization(self, definition):
        """Every sample's voice agent declares the lesson inputs and a template greeting."""
        self.assertEqual(definition["model_type"], "self_deployed")
        self.assertEqual(definition["greeting"], {"type": "template", "text": direct.GREETING})
        self.assertIn("{{learner_name}}", definition["greeting"]["text"])
        self.assertIn("{{learner_name}}", definition["instructions"])
        self.assertIn("{{level}}", definition["instructions"])
        self.assertEqual(
            definition["structured_inputs"],
            {
                "learner_name": {
                    "description": "What the teacher calls the learner.",
                    "default_value": "friend",
                },
                "level": {
                    "description": "The learner's English level.",
                    "default_value": "intermediate",
                    "schema": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]},
                },
            },
        )

    async def run_managed(
        self, main_function=sample.main, *, project=None, session_events=None,
        auto_delete=True,
    ):
        await self.run_main(
            managed, main_function, project=project, session_events=session_events,
            create_only=session_events is None, auto_delete=auto_delete,
        )

    async def test_create_only_keeps_tool_agents_and_pins_returned_version(self):
        await self.run_managed(auto_delete=False)
        self.assertEqual(self.project.deleted, [])
        prompt, voice = self.project.created
        self.assertEqual(len(prompt["definition"]["tools"]), 2)
        self.assertEqual(
            voice["definition"]["delegation"],
            {"type": "foundry_managed_agent", "agent_name": prompt["name"], "agent_version": "7"},
        )
        self.assert_lesson_personalization(voice["definition"])
        self.assertEqual([request.method for request in self.project.requests[:2]], ["GET", "GET"])
        self.assertEqual(self.project.deployment_checks(), ["live-model", "text-model"])
        create = next(request for request in self.project.requests if request.method == "POST")
        self.assertIn("VoiceAgents=V1Preview", create.headers["Foundry-Features"])

    async def test_cleanup_deletes_voice_before_prompt(self):
        await self.run_managed()
        self.assertEqual(
            self.project.deleted,
            [payload["name"] for payload in reversed(self.project.created)],
        )

    async def test_failed_voice_creation_cleans_only_created_prompt(self):
        with self.assertRaisesRegex(DemoError, "HTTP 400"):
            await self.run_managed(project=OfflineProject(fail_voice=True))
        self.assertEqual(len(self.project.created), 1)
        self.assertEqual(self.project.deleted, [self.project.created[0]["name"]])

    async def test_original_managed_sample_retains_plain_prompt_and_cleanup(self):
        await self.run_managed(managed.main)
        prompt, voice = self.project.created
        self.assertNotIn("tools", prompt["definition"])
        self.assertEqual(prompt["definition"]["instructions"], managed.PROMPT_INSTRUCTIONS)
        self.assertEqual(voice["definition"]["delegation"]["agent_version"], "7")
        self.assertEqual(self.project.deleted, [voice["name"], prompt["name"]])

    async def test_original_main_handles_managed_notice_and_finishes_normal_session(self):
        await self.run_managed(managed.main, session_events=live_session(
            "conversation-original",
            envelope(
                "session.delegation.created",
                offset_ms=1000,
                delegation={
                    "id": "delegation-original",
                    "type": "delegation",
                    "target": "foundry_managed_agent",
                },
            ),
            # The managed flow as the service sends it: the prompt agent's Responses
            # stream, then Foundry's acknowledgment that it forwarded the guidance.
            backend("response.created", "delegation-original", response={"id": "response-1"}),
            backend(
                "response.output_text.delta", "delegation-original",
                delta='[commentary] Say "I went to school yesterday."',
            ),
            envelope("session.commentary.appended", client_event_id="evt_managed_1"),
            backend("response.completed", "delegation-original", response={"id": "response-1"}),
            envelope("session.output_transcript.delta", delta="I went to school yesterday."),
        ))
        activity = str(self.transcript.mock_calls)
        self.assertIn("Prompt agent delegation requested", activity)
        self.assertIn("[commentary] Say", activity)
        self.assertIn("Accepted commentary forwarded to GPT Live", activity)
        # The acknowledgment arrived before response.completed, so the final status keeps it.
        self.assertEqual(
            self.transcript.update_agent_activity.call_args.kwargs["status"],
            "Backend response completed; accepted guidance forwarded to GPT Live",
        )
        self.transcript.append_agent.assert_called_once_with("I went to school yesterday.")
        self.assertFalse({"response.create", "response.item.create", "session.commentary.append"}
                         & set(self.sent_commands()))
        self.assertTrue(self.audio.started)
        self.assertTrue(self.audio.stopped)
        prompt, voice = self.project.created
        self.assertNotIn("tools", prompt["definition"])
        self.assert_live_handshake(voice["name"], "3")
        self.assertEqual(self.project.deleted, [voice["name"], prompt["name"]])
        self.assertIn("Conversation id: conversation-original", self.output)

    async def test_managed_backend_failure_stays_visible_without_ending_the_session(self):
        await self.run_managed(managed.main, session_events=live_session(
            "conversation-failed",
            envelope(
                "session.delegation.created",
                delegation={"id": "delegation-failed", "type": "delegation", "target": "foundry_managed_agent"},
            ),
            backend("response.failed", "delegation-failed", response={"id": "response-1"}),
            envelope("session.output_transcript.delta", delta="Let's try that again."),
        ))
        self.assertIn("Backend response failed", str(self.transcript.mock_calls))
        self.transcript.append_agent.assert_called_once_with("Let's try that again.")
        self.assertIn("Conversation id: conversation-failed", self.output)

    async def test_responses_sample_creates_live_agent_and_deletes_it(self):
        await self.run_main(
            direct, direct.main, session_events=live_session("conversation-direct"),
            auto_delete=True,
        )
        (agent,) = self.project.created
        definition = agent["definition"]
        self.assertEqual(
            (definition["kind"], definition["sub_protocol"], definition["model_type"], definition["model"]),
            ("voice", "live", "self_deployed", "live-model"),
        )
        self.assertEqual(
            definition["delegation"],
            {
                "type": "responses",
                "responses": {"model": "text-model", "instructions": direct.BACKEND_INSTRUCTIONS},
            },
        )
        self.assertTrue(definition["store"])
        self.assert_lesson_personalization(definition)
        self.assertEqual(self.project.deployment_checks(), ["live-model", "text-model"])
        self.assert_live_handshake(agent["name"], "3")
        self.assertIn("Structured inputs: learner_name=Alex, level=intermediate", self.output)
        # The sample passes raw PCM; the SDK sends it base64-encoded.
        self.assertIn(
            {"type": "session.input_audio.append", "audio": base64.b64encode(bytes(48)).decode()},
            self.received,
        )
        self.assertIn("Conversation id: conversation-direct", self.output)
        self.assertEqual(self.project.deleted, [agent["name"]])

    async def test_responses_sample_reuses_existing_agent_without_changes(self):
        saved = {
            "kind": "voice", "sub_protocol": "live", "model_type": "self_deployed",
            "model": "saved-live",
            "delegation": {"type": "responses", "responses": {"model": "saved-text"}},
        }
        await self.run_main(
            direct, direct.main, project=OfflineProject({"teacher": ("5", saved)}),
            session_events=live_session("conversation-existing"),
            environment={"AGENT_NAME": "teacher"}, auto_delete=True,
        )
        self.assertEqual(self.project.created, [])
        self.assertEqual(self.project.deleted, [])
        self.assertEqual(self.project.deployment_checks(), ["saved-live", "saved-text"])
        # The saved agent declares no structured inputs, so the session sends none.
        self.assert_live_handshake("teacher", "5", structured_inputs=None)
        self.assertIn("Structured inputs: none", self.output)

    async def test_responses_sample_rejects_missing_or_realtime_agents(self):
        realtime = {"kind": "voice", "model": "realtime-model"}
        for agents, message in (({}, "was not found"), ({"teacher": ("1", realtime)}, "sub_protocol=live")):
            with self.subTest(message=message):
                with self.assertRaisesRegex(DemoError, message):
                    await self.run_main(
                        direct, direct.main, project=OfflineProject(agents),
                        session_events=[], environment={"AGENT_NAME": "teacher"},
                    )
                self.assertEqual(self.handshakes, [])
                self.assertEqual(self.project.deleted, [])

    async def run_client(self, learner_said, **lesson):
        received = []
        await self.run_main(
            direct, client.main, exchange=client_session(received, learner_said),
            environment={"AGENT_NAME": "teacher"}, auto_delete=True, **lesson,
        )
        return [command for command in received if command["type"] != "session.input_audio.append"]

    async def test_client_sample_answers_its_delegation_on_the_same_session(self):
        commands = await self.run_client(
            "What is seventeen plus twenty five?", learner_name="Mei", level="beginner",
        )
        # AGENT_NAME is ignored: the sample always creates a client-delegation agent.
        (agent,) = self.project.created
        definition = agent["definition"]
        self.assertEqual(definition["delegation"], {"type": "client"})
        self.assertIn("always delegate before answering", definition["instructions"])
        self.assert_lesson_personalization(definition)
        self.assertEqual(self.project.deployment_checks(), ["live-model"])
        self.assert_live_handshake(agent["name"], "3", {"learner_name": "Mei", "level": "beginner"})
        # Unspoken facts first, then the spoken answer, both tied to the delegation.
        self.assertEqual(
            commands,
            [
                {
                    "type": "session.thinking.append",
                    "content": "The client app computed 17 + 25 = 42.",
                    "delegation_id": "delegation-client",
                },
                {
                    "type": "session.commentary.append",
                    "content": "17 plus 25 is 42.",
                    "delegation_id": "delegation-client",
                },
            ],
        )
        activity = self.transcript.update_agent_activity.call_args
        self.assertEqual(activity.kwargs["title"], "Client delegation → this app")
        self.assertEqual(activity.kwargs["delta"], "17 plus 25 is 42.")
        self.assertIn("Conversation id: conversation-client", self.output)
        self.assertEqual(self.project.deleted, [agent["name"]])

    async def test_client_sample_falls_back_when_it_cannot_answer(self):
        commands = await self.run_client("Please correct my English: I goed to school.")
        self.assertEqual(
            commands,
            [{"type": "session.commentary.append", "content": client.FALLBACK, "delegation_id": "delegation-client"}],
        )
        self.assert_live_handshake(self.project.created[0]["name"], "3")


def client_session(received, learner_said):
    """A client-delegation session: greet, hear the learner, delegate, and close once answered."""

    async def exchange(socket):
        async def send(kind, **fields):
            await socket.send(json.dumps({"type": kind, **fields}))

        await send("session.started", conversation_id="conversation-client", session={
            "id": "session-client",
            "audio": {"format": {"type": "audio/pcm", "rate": 24000}},
            "delegation": {"type": "client"},
        })
        # Foundry speaks the filled-in greeting as commentary before the learner talks.
        await send("session.commentary.appended", start_ms=0, end_ms=900)
        await send("session.output_transcript.delta", delta="Hi Mei!", start_ms=0, end_ms=900)
        await send("session.input_transcript.delta", delta=learner_said, start_ms=1000, end_ms=2000)
        await send(
            "session.delegation.created",
            offset_ms=2100,
            delegation={"id": "delegation-client", "type": "delegation", "target": "client"},
        )
        async for raw in socket:
            command = json.loads(raw)
            received.append(command)
            if command["type"] == "session.commentary.append":
                await send("session.closed", reason="close_requested", usage={"seconds": 1})

    return exchange


class OfflineAudio:
    def __init__(self):
        self.started = False
        self.stopped = False
        self.played = []

    def start(self):
        self.started = True

    async def frames(self, stop):
        yield bytes(48)
        await stop.wait()

    def play(self, pcm):
        self.played.append(pcm)

    def stop_microphone(self):
        self.stopped = True

    async def drain(self):
        pass


@contextlib.asynccontextmanager
async def sdk_live_connection(exchange):
    """A real Projects SDK Live connection whose WebSocket peer is exchange."""
    async with (
        live_server(exchange),
        AIProjectClient(
            endpoint=PROJECT_ENDPOINT, credential=OfflineCredential(), transport=OfflineProject()
        ) as project,
        project.beta.voice_agents.live.connect(agent_name="loopback-voice") as connection,
    ):
        yield connection


class SDKLoopbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_live_sdk_routes_tool_output_and_only_displays_accepted_guidance(self):
        async def exchange(socket):
            async def send(kind, **fields):
                await socket.send(json.dumps({"type": kind, **fields}))

            async def send_backend(kind, **fields):
                await send("response.event", delegation_id="delegation-1", event={"type": kind, **fields})

            await send("session.started", conversation_id="conversation-offline", session={
                "id": "session-offline",
                "audio": {"format": {"type": "audio/pcm", "rate": 24000}},
            })
            await send(
                "session.delegation.created",
                event_id="event-delegation-1",
                offset_ms=1000,
                delegation={
                    "id": "delegation-1",
                    "type": "delegation",
                    "target": "foundry_managed_agent",
                },
            )
            await send_backend("response.created", response={"id": "response-1", "status": "in_progress"})
            await send_backend("response.output_item.done", item=function_call())
            await send_backend("response.completed", response={"id": "response-1", "status": "completed", "output": []})
            commands = []
            async for raw in socket:
                message = json.loads(raw)
                if message["type"].startswith("response."):
                    commands.append(message)
                if message["type"] == "response.create":
                    break
            self.assertEqual([command["type"] for command in commands], ["response.item.create", "response.create"])
            output = commands[0]["item"]
            self.assertEqual(output["call_id"], "call-1")
            self.assertIn("utc_datetime", json.loads(output["output"]))
            # The resumed prompt agent answers; Foundry forwards the accepted section.
            await send_backend("response.created", response={"id": "response-2", "status": "in_progress"})
            await send_backend("response.output_text.delta", delta="[commentary] The clock was checked.")
            await send("session.commentary.appended", event_id="event-ack", client_event_id="evt_managed_1",
                       start_ms=2000, end_ms=2200)
            await send_backend("response.completed", response={"id": "response-2", "status": "completed", "output": []})
            await send("session.output_transcript.delta", delta="The clock was checked.")
            await send("session.output_audio.delta", delta=base64.b64encode(bytes(48)).decode("ascii"))
            await send("session.closed", reason="close_requested", usage={"seconds": 1})

        audio = OfflineAudio()
        transcript = mock_transcript()
        async with sdk_live_connection(exchange) as connection:
            async with asyncio.timeout(10):
                conversation_id = await converse(
                    connection, audio, transcript, "tools-prompt:7",
                    managed_delegation=True, event_handler=sample.ManagedToolHandler(),
                )
        self.assertEqual(conversation_id, "conversation-offline")
        self.assertTrue(audio.started)
        self.assertTrue(audio.stopped)
        self.assertEqual(audio.played, [bytes(48)])
        transcript.append_agent.assert_called_once_with("The clock was checked.")
        activity = str(transcript.mock_calls)
        self.assertIn("[commentary] The clock was checked.", activity)
        self.assertIn("Prompt agent delegation requested", activity)
        self.assertIn("Accepted commentary forwarded to GPT Live", activity)

    async def check_delegation_notice(self, target):
        """Exercise the notice with the real SDK and no local tool handler."""
        received = []

        async def exchange(socket):
            await socket.send(json.dumps({
                "type": "session.started",
                "session": {
                    "id": "session-notice",
                    "audio": {"format": {"type": "audio/pcm", "rate": 24000}},
                },
            }))
            await socket.send(json.dumps({
                "type": "session.delegation.created",
                "offset_ms": 1000,
                "delegation": {"id": "delegation-notice", "target": target},
            }))
            await socket.send(json.dumps({
                "type": "session.closed",
                "reason": "close_requested",
                "usage": {"seconds": 1},
            }))
            async for raw in socket:
                received.append(json.loads(raw))

        transcript = mock_transcript()
        try:
            async with sdk_live_connection(exchange) as connection:
                async with asyncio.timeout(10):
                    await converse(
                        connection, OfflineAudio(), transcript,
                        "plain-prompt:7", managed_delegation=True,
                    )
        finally:
            # A notification must never cause client commentary or prompt execution.
            self.assertFalse(any(
                command["type"] in {
                    "session.commentary.append",
                    "session.thinking.append",
                    "response.create",
                    "response.item.create",
                }
                for command in received
            ))
        return transcript

    async def test_original_managed_sample_accepts_service_owned_notice(self):
        transcript = await self.check_delegation_notice("foundry_managed_agent")
        self.assertIn("Prompt agent delegation requested", str(transcript.mock_calls))

    async def test_native_client_and_responses_targets_still_fail_without_fallback(self):
        for target in ("client", "responses"):
            with self.subTest(target=target):
                with self.assertRaisesRegex(DemoError, f"delegation target '{target}'"):
                    await self.check_delegation_notice(target)


if __name__ == "__main__":
    unittest.main()


class TypedInputTests(unittest.IsolatedAsyncioTestCase):
    """Typed messages go to the session's backend with response.item.create and response.create."""

    async def converse_with(self, exchange, *, delegation, typed_input=True, typed=None, **options):
        self.output = io.StringIO()
        transcript = TranscriptDisplay(console=Console(file=self.output, markup=False, highlight=False))

        async def type_when_ready():
            while not transcript.typing_enabled:
                await asyncio.sleep(0.01)
            for text in typed or []:
                self.assertTrue(transcript.submit_typed(text))

        async with sdk_live_connection(exchange) as connection:
            async with asyncio.timeout(10):
                typist = asyncio.create_task(type_when_ready()) if typed else None
                await converse(
                    connection, OfflineAudio(), transcript, "text-model",
                    managed_delegation=delegation == "foundry_managed_agent",
                    typed_input=typed_input, **options,
                )
                if typist:
                    await typist
        return transcript

    @staticmethod
    def started(delegation):
        session = {"id": "session-typed", "audio": {"format": {"type": "audio/pcm", "rate": 24000}}}
        return {"type": "session.started", "conversation_id": "conversation-typed", "session": {**session, "delegation": {"type": delegation}}}

    async def test_typed_message_is_a_user_item_then_response_create_for_each_backend(self):
        for delegation in ("responses", "foundry_managed_agent"):
            with self.subTest(delegation=delegation):
                received = []

                async def exchange(socket):
                    await socket.send(json.dumps(self.started(delegation)))
                    async for raw in socket:
                        command = json.loads(raw)
                        received.append(command)
                        if command["type"] == "response.create":
                            # The backend's delegation names the response.create that started it.
                            await socket.send(json.dumps({
                                "type": "session.delegation.created", "client_event_id": command["event_id"],
                                "offset_ms": 0, "delegation": {"id": "delegation-typed", "type": "delegation", "target": delegation},
                            }))
                            await socket.send(json.dumps({
                                "type": "response.event", "delegation_id": "delegation-typed",
                                "event": {"type": "response.completed", "response": {"id": "response-typed"}},
                            }))
                            await socket.send(json.dumps({
                                "type": "session.output_transcript.delta", "delta": 'Say "I went."', "start_ms": 0, "end_ms": 100,
                            }))
                            await socket.send(json.dumps({"type": "session.closed", "reason": "close_requested", "usage": {"seconds": 1}}))

                transcript = await self.converse_with(exchange, delegation=delegation, typed=["I goed to school."])
                item, run = [command for command in received if command["type"].startswith("response.")]
                self.assertEqual(item["type"], "response.item.create")
                self.assertEqual(
                    item["item"],
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "I goed to school."}]},
                )
                self.assertEqual(run["type"], "response.create")
                self.assertRegex(item["event_id"], r"^typed-[0-9a-f]{12}$")
                self.assertRegex(run["event_id"], r"^typed-run-[0-9a-f]{12}$")
                self.assertIn("[typed] I goed to school.", transcript.user_text)
                self.assertEqual(transcript.agent_text, 'Say "I went."')
                self.assertTrue(transcript.agent_activities["delegation-typed"].title.endswith("(typed message)"))
                self.assertFalse(transcript.typing_enabled)

    async def test_a_rejected_typed_message_is_reported_without_ending_the_session(self):
        received = []

        async def exchange(socket):
            await socket.send(json.dumps(self.started("foundry_managed_agent")))
            async for raw in socket:
                command = json.loads(raw)
                received.append(command)
                if command["type"] == "response.item.create":
                    await socket.send(json.dumps({
                        "type": "error", "event_id": "evt_managed_1",
                        "error": {
                            "type": "invalid_request_error", "code": "typed_input_too_large",
                            "message": "The typed message exceeds the size limit.", "client_event_id": command["event_id"],
                        },
                    }))
                    await socket.send(json.dumps({"type": "session.output_transcript.delta", "delta": "Still here.", "start_ms": 0, "end_ms": 1}))
                    await socket.send(json.dumps({"type": "session.closed", "reason": "close_requested", "usage": {"seconds": 1}}))

        transcript = await self.converse_with(exchange, delegation="foundry_managed_agent", typed=["x" * 50])
        self.assertIn("Typed message not accepted: typed_input_too_large", self.output.getvalue())
        self.assertEqual(transcript.agent_text, "Still here.")

    async def test_uncorrelated_errors_still_end_the_session(self):
        async def exchange(socket):
            await socket.send(json.dumps(self.started("responses")))
            await socket.send(json.dumps({
                "type": "error", "event_id": "evt_1",
                "error": {"type": "server_error", "code": "boom", "message": "Something failed."},
            }))
            async for raw in socket:
                if json.loads(raw)["type"] == "session.close":
                    await socket.send(json.dumps({"type": "session.closed", "reason": "close_requested", "usage": {"seconds": 1}}))

        with self.assertRaisesRegex(DemoError, "Something failed"):
            await self.converse_with(exchange, delegation="responses")

    async def test_client_delegation_keeps_the_text_box_disabled(self):
        received = []
        states = []

        async def exchange(socket):
            await socket.send(json.dumps(self.started("client")))
            await asyncio.sleep(0.05)
            await socket.send(json.dumps({"type": "session.closed", "reason": "close_requested", "usage": {"seconds": 1}}))
            async for raw in socket:
                received.append(json.loads(raw))

        transcript = TranscriptDisplay(console=Console(file=io.StringIO()))
        original = transcript.enable_typing
        transcript.enable_typing = lambda enabled, hint: (states.append((enabled, hint)), original(enabled, hint))
        async with sdk_live_connection(exchange) as connection:
            async with asyncio.timeout(10):
                await converse(connection, OfflineAudio(), transcript, "client", typed_input=False)
        self.assertFalse(states[0][0])
        self.assertIn("client delegation", states[0][1])
        self.assertFalse(transcript.submit_typed("hello"))
        self.assertFalse(any(command["type"].startswith("response.") for command in received))

    async def test_text_box_queues_messages_only_while_typing_is_enabled(self):
        from textual.widgets import Input

        from transcript_common import TranscriptApp

        transcript = TranscriptDisplay(console=Console(file=io.StringIO()))
        app = TranscriptApp(transcript)
        async with app.run_test(size=(120, 30)) as pilot:
            box = app.query_one("#typed", Input)
            self.assertTrue(box.disabled)
            transcript.enable_typing(True, "Type a message and press Enter.")
            await pilot.pause(0.3)
            self.assertFalse(box.disabled)
            box.focus()
            await pilot.press(*"I goed to school.", "enter", "enter")
            await pilot.pause(0.1)
            self.assertEqual(transcript.typed_messages.get_nowait(), "I goed to school.")
            self.assertTrue(transcript.typed_messages.empty())
            self.assertEqual(box.value, "")
            transcript.enable_typing(False, "The lesson has ended.")
            await pilot.pause(0.3)
            self.assertTrue(box.disabled)
