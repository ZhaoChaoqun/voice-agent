"""Loopback WebSocket protocol test using a fake service and a mock handoff."""

import asyncio
import json
import unittest
from unittest.mock import AsyncMock

from azure.ai.projects.models import VoiceAgentDefinition
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

from sample import Client, build_definition, matches_settings


class WebSocketTests(unittest.IsolatedAsyncioTestCase):
    def test_projects_sdk_preserves_builtin_transfer_configuration(self):
        expected = build_definition()
        actual = VoiceAgentDefinition(expected).as_dict()
        self.assertTrue(matches_settings(actual, expected))

    async def test_real_socket_negotiation_context_request_result_and_server_continuation(self):
        service_done = asyncio.get_running_loop().create_future()
        inbound = []

        async def service(socket):
            async def emit(event):
                await socket.send(json.dumps(event))

            async def receive():
                event = json.loads(await socket.recv())
                inbound.append(event)
                return event

            try:
                await emit({"type": "session.updated", "session": {"id": "loopback-session"}})
                await emit({"type": "session.system_tools.ready", "execution": "client", "tools": ["transfer"]})
                update = await receive()
                self.assertEqual(update["type"], "session.update")
                await emit({"type": "session.updated", "session": {"id": "loopback-session", "instructions": update["session"]["instructions"]}})
                self.assertEqual((await receive())["type"], "conversation.item.create")
                self.assertEqual((await receive())["type"], "response.create")
                await emit({"type": "response.created", "response": {"id": "response-1"}})
                await emit({"type": "response.system_tool_arguments.done", "name": "transfer", "call_id": "loopback-call", "arguments": "{}"})
                await emit({"type": "response.done", "response": {"id": "response-1", "status": "completed", "output": []}})
                await emit({"type": "system_tool.requested", "name": "transfer", "call_id": "loopback-call", "response_id": "response-1",
                            "target": "support", "reason": "User requested help", "expires_at": 160})
                result = await receive()
                self.assertEqual(result["type"], "system_tool.result")
                self.assertEqual(result["status"], "not_answered")
                await emit({"type": "system_tool.result.acknowledged", "name": "transfer", "call_id": "loopback-call", "status": "not_answered"})
                await emit({"type": "response.created", "response": {"id": "response-2"}})
                await emit({"type": "response.done", "response": {"id": "response-2", "status": "completed", "output": []}})
                await emit({"type": "session.done"})
                service_done.set_result(None)
            except BaseException as error:
                if not service_done.done():
                    service_done.set_exception(error)
                await socket.close()

        async with serve(service, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            async with connect(f"ws://127.0.0.1:{port}") as socket:
                async def send(event):
                    await socket.send(json.dumps(event))

                execute = AsyncMock(return_value="not_answered")
                client = Client(send, execute, now=lambda: 100, report=lambda _: None)

                async def receive():
                    async for raw in socket:
                        await client.on_event(json.loads(raw))

                receiver = asyncio.create_task(receive())
                try:
                    await client.session_ready.wait()
                    await client.executor_ready.wait()
                    await client.configure("Loopback synthetic context")
                    await client.ask("Please transfer me to support")
                    await service_done
                    await receiver
                    execute.assert_awaited_once()
                    self.assertTrue(client.closed.is_set())
                    self.assertEqual([event["type"] for event in inbound],
                                     ["session.update", "conversation.item.create", "response.create", "system_tool.result"])
                finally:
                    await client.close()
                    receiver.cancel()
                    await asyncio.gather(receiver, return_exceptions=True)


if __name__ == "__main__":
    unittest.main()
