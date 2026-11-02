"""Offline tests: no authentication, model, microphone, or telephone operations."""

import asyncio
import json
import unittest
from unittest.mock import AsyncMock

from sample import Client, RULES, TransferRequest, build_definition, matches_settings, project_endpoint, websocket_url


def request(call_id="call-1", **changes):
    return {"type": "system_tool.requested", "name": "transfer", "call_id": call_id,
            "target": "support", "reason": "User requested help", "response_id": "response-1",
            "expires_at": 160, **changes}


class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.send = AsyncMock()
        self.execute = AsyncMock(return_value="not_answered")
        self.client = Client(self.send, self.execute, now=lambda: 100, report=lambda _: None)
        await self.ready()

    async def asyncTearDown(self):
        await self.client.close()

    async def ready(self):
        await self.client.on_event({"type": "session.updated", "session": {"id": "session-1"}})
        await self.client.on_event({"type": "session.system_tools.ready", "execution": "client", "tools": ["transfer"]})

    async def test_intent_and_response_completion_never_execute_or_complete_system_tools(self):
        for event in [
            {"type": "response.system_tool_arguments.delta", "delta": "{bad json"},
            {"type": "response.system_tool_arguments.done", "name": "transfer", "arguments": "{}"},
            {"type": "response.output_item.done", "item": {"type": "system_tool", "name": "transfer", "status": "completed"}},
            {"type": "response.done", "response": {"status": "completed", "output": [{"type": "system_tool", "name": "transfer", "status": "completed"}]}},
            {"type": "response.done", "response": {"status": "cancelled", "output": []}},
            {"type": "input_collection.status", "call_id": "call-1", "status": "provider_accepted"},
        ]:
            await self.client.on_event(event)
        self.execute.assert_not_awaited()
        self.send.assert_not_awaited()

    async def test_request_executes_once_and_duplicate_retries_only_identical_result(self):
        await self.client.on_event(request())
        await self.client.on_event(request())
        await self.client.tasks["call-1"]
        await self.client.on_event(request())
        self.assertEqual(self.execute.await_count, 1)
        sent = [call.args[0] for call in self.send.await_args_list]
        self.assertEqual(len(sent), 2)
        self.assertTrue(all(event["type"] == "system_tool.result" for event in sent))
        self.assertTrue(all(event["call_id"] == "call-1" and event["status"] == "not_answered" for event in sent))
        await self.client.on_event({"type": "system_tool.result.acknowledged", "call_id": "call-1", "status": "not_answered"})
        await self.client.on_event(request())
        self.assertEqual(self.send.await_count, 2)
        self.assertFalse(self.client.idle())
        await self.client.on_event({"type": "response.done", "response": {"status": "completed", "output": []}})
        self.assertTrue(self.client.idle())

    async def test_waits_for_playback_without_blocking_event_receiver(self):
        playback_entered = asyncio.Event()
        release_playback = asyncio.Event()

        async def playback(_):
            playback_entered.set()
            await release_playback.wait()

        self.client.playback_drained = playback
        await self.client.on_event(request())
        await playback_entered.wait()
        self.execute.assert_not_awaited()
        await self.client.on_event({"type": "input_collection.status", "status": "listening"})
        release_playback.set()
        await self.client.tasks["call-1"]
        self.execute.assert_awaited_once()

    async def test_completed_intent_waits_for_execution_request_before_admitting_another_turn(self):
        await self.client.on_event({"type": "response.done", "response": {"status": "completed", "output": [
            {"type": "system_tool", "name": "transfer", "call_id": "call-1", "status": "completed"},
        ]}})
        with self.assertRaisesRegex(RuntimeError, "settle"):
            await self.client.ask("Another request")
        self.execute.assert_not_awaited()
        await self.client.on_event(request())
        await self.client.tasks["call-1"]
        self.execute.assert_awaited_once()

    async def test_expired_before_execution_has_no_side_effect(self):
        await self.client.on_event(request(expires_at=99))
        await self.client.tasks["call-1"]
        self.execute.assert_not_awaited()
        self.assertEqual(self.send.await_args.args[0]["status"], "not_executed")

    async def test_deadline_is_not_restarted_after_playback(self):
        async def playback(_):
            self.client.now = lambda: 170

        self.client.playback_drained = playback
        await self.client.on_event(request())
        await self.client.tasks["call-1"]
        self.execute.assert_not_awaited()
        self.assertEqual(self.send.await_args.args[0]["status"], "not_executed")

    async def test_cancellation_before_playback_completion_does_not_execute(self):
        entered = asyncio.Event()

        async def playback(_):
            entered.set()
            await asyncio.Event().wait()

        self.client.playback_drained = playback
        await self.client.on_event(request())
        await entered.wait()
        await self.client.on_event({"type": "system_tool.cancelled", "call_id": "call-1", "reason": "client_cancelled"})
        await self.client.tasks["call-1"]
        self.execute.assert_not_awaited()
        self.assertTrue(self.client.blocked)
        self.assertEqual(self.send.await_args.args[0]["status"], "failed_or_uncertain")

    async def test_executor_failure_is_uncertain_and_never_automatically_retried(self):
        self.execute.side_effect = OSError("Response lost after external dispatch")
        await self.client.on_event(request())
        await self.client.tasks["call-1"]
        await self.client.on_event(request())
        await self.client.on_event(request("call-2"))
        await self.client.tasks["call-2"]
        self.execute.assert_awaited_once()
        self.assertTrue(self.client.blocked)
        self.assertEqual(self.client.results["call-1"], "failed_or_uncertain")
        self.assertEqual(self.client.results["call-2"], "not_executed")

    async def test_success_acknowledgement_ends_agent_role_without_provider_hangup(self):
        self.execute.return_value = "transferred"
        await self.client.on_event(request())
        await self.client.tasks["call-1"]
        self.assertFalse(self.client.closed.is_set())
        await self.client.on_event({"type": "system_tool.result.acknowledged", "call_id": "call-1", "status": "transferred"})
        self.assertTrue(self.client.closed.is_set())
        self.assertEqual([call.args[0]["type"] for call in self.send.await_args_list], ["system_tool.result"])

    async def test_no_execution_before_service_explicitly_negotiates(self):
        self.client.executor_ready.clear()
        with self.assertRaisesRegex(RuntimeError, "negotiation"):
            await self.client.on_event(request())
        self.execute.assert_not_awaited()

    async def test_changed_duplicate_and_unmatched_ack_are_errors(self):
        await self.client.on_event(request())
        await self.client.tasks["call-1"]
        with self.assertRaisesRegex(RuntimeError, "changed"):
            await self.client.on_event(request(reason="Different intent"))
        with self.assertRaisesRegex(RuntimeError, "Unmatched"):
            await self.client.on_event({"type": "system_tool.result.acknowledged", "call_id": "unknown", "status": "transferred"})

    async def test_session_configuration_is_acknowledged_before_input(self):
        update_sent = asyncio.Event()

        async def send(event):
            if event["type"] == "session.update":
                update_sent.set()

        self.client.send = AsyncMock(side_effect=send)
        pending = asyncio.create_task(self.client.configure("Demo context"))
        await update_sent.wait()
        with self.assertRaisesRegex(RuntimeError, "settle"):
            await self.client.ask("Hello")
        instructions = self.client.send.await_args.args[0]["session"]["instructions"]
        self.assertTrue(instructions.startswith(RULES))
        await self.client.on_event({"type": "session.updated", "session": {"id": "session-1", "instructions": "Old settings"}})
        self.assertFalse(pending.done())
        await self.client.on_event({"type": "session.updated", "session": {"id": "session-1", "instructions": instructions}})
        await pending
        await self.client.ask("Hello")
        self.assertEqual([call.args[0]["type"] for call in self.client.send.await_args_list],
                         ["session.update", "conversation.item.create", "response.create"])

    async def test_no_mid_turn_prompt_or_pending_transfer_reconfiguration(self):
        await self.client.on_event({"type": "response.created"})
        with self.assertRaisesRegex(RuntimeError, "idle"):
            await self.client.configure("new context")
        self.client.active_response = False
        await self.client.on_event(request())
        with self.assertRaisesRegex(RuntimeError, "idle"):
            await self.client.configure("new context")

    async def test_disconnect_cancels_execution_without_replaying_or_inventing_outcome(self):
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def execute(_):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        self.client.execute = execute
        await self.client.on_event(request())
        await started.wait()
        await self.client.close()
        self.assertTrue(cancelled.is_set())
        self.send.assert_not_awaited()

    async def test_result_write_failure_is_observed(self):
        self.send.side_effect = OSError("Socket closed")
        await self.client.on_event(request())
        error = await self.client.failure
        self.assertIsInstance(error, OSError)
        self.execute.assert_awaited_once()


class ConfigurationTests(unittest.TestCase):
    def test_explicit_builtin_contract_and_safe_session_defaults(self):
        definition = build_definition()
        self.assertEqual(definition["output_modalities"], ["text"])
        self.assertFalse(definition["store"])
        self.assertEqual([(t["type"], t["name"]) for t in definition["tools"]],
                         [("system", "transfer"), ("system", "end_conversation")])
        self.assertNotIn("function", json.dumps(definition["tools"]))
        self.assertNotIn("greeting", definition)

    def test_target_and_request_validation(self):
        for change in ({"target": "https://example.com"}, {"target": "unknown"}, {"call_id": ""},
                       {"response_id": None}, {"reason": " "}, {"expires_at": True}, {"expires_at": "160"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                TransferRequest.parse(request(**change))

    def test_public_url_and_exact_opt_in(self):
        url = websocket_url("https://example.services.ai.azure.com/api/projects/demo", "agent-1", "3")
        self.assertIn("/agents/agent-1/endpoint/protocols/voice?", url)
        self.assertIn("client_system_tools=transfer", url)
        self.assertIn("x-agent-version-override=3", url)
        for endpoint in ("http://example.services.ai.azure.com/api/projects/demo", "https://localhost/api/projects/demo",
                         "https://example.services.ai.azure.com/api/projects/demo?token=x", "https://user:secret@example.services.ai.azure.com/api/projects/demo"):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                project_endpoint(endpoint)

    def test_readback_allows_defaults_but_rejects_changed_tool_or_target(self):
        requested = build_definition()
        actual = build_definition()
        actual["tools"][1]["timeout_seconds"] = 60
        self.assertTrue(matches_settings(actual, requested))
        actual["tools"][0]["targets"][0]["name"] = "unexpected"
        self.assertFalse(matches_settings(actual, requested))


if __name__ == "__main__":
    unittest.main()
