"""Offline contract tests for the Genesys Audio Connector sample."""

import io
import json
import threading
import unittest
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

import genesys_audio_connector as sample

ENDPOINT = "https://example.services.ai.azure.com/api/projects/support"


class SampleTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(sample.os.environ, {}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def arguments(self, *values):
        return sample.parser().parse_args(list(values))

    def response(self, status=200, body=b'{"name":"demo"}'):
        response = Mock(status=status)
        response.read.return_value = body
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        return response

    def test_agent_declares_spoken_system_ending_and_audio(self):
        operation = sample.operation_for(self.arguments("create", "--agent-name", "demo"))
        self.assertEqual((operation["method"], operation["path"]), ("POST", "/agents"))
        self.assertEqual(operation["body"]["name"], "demo")
        definition = operation["body"]["definition"]
        self.assertEqual(definition["kind"], "voice")
        self.assertEqual(definition["output_modalities"], ["audio"])
        self.assertEqual(definition["audio"]["input"]["format"], {"type": "audio/pcm", "rate": 24000})
        self.assertEqual(definition["audio"]["output"]["format"], {"type": "audio/pcm", "rate": 24000})
        self.assertEqual([(t["type"], t["name"]) for t in definition["tools"]], [("system", "end_conversation")])
        self.assertFalse(definition["store"])

    def test_custom_model_uses_the_deployment_name_and_voice(self):
        args = self.arguments("create", "--agent-name", "demo", "--model-type", "self_deployed",
                              "--model", "my-deployment", "--voice", "en-US-AndrewNeural")
        definition = sample.operation_for(args)["body"]["definition"]
        self.assertEqual(definition["model_type"], "self_deployed")
        self.assertEqual(definition["model"], "my-deployment")
        self.assertEqual(definition["audio"]["output"]["voice"], "en-US-AndrewNeural")

    def test_empty_model_or_voice_is_rejected(self):
        for model, voice in [("", "Ava"), ("model", " ")]:
            with self.subTest(model=model, voice=voice), self.assertRaises(ValueError):
                sample.voice_definition(model, "managed", voice)

    def test_connection_uri_uses_the_agent_scoped_public_route(self):
        self.assertEqual(sample.connection_uri(ENDPOINT + "/", "demo"),
                         "wss://example.services.ai.azure.com/api/projects/support/agents/demo/endpoint/protocols/voice/telephony/genesys-audiohook?api-version=v1")
        self.assertEqual(sample.project_endpoint(ENDPOINT.replace(".com", ".com:443")), ENDPOINT)

    def test_default_project_alias_is_preserved_in_endpoint_cli_output(self):
        endpoint = "https://example.services.ai.azure.com/api/projects/_project"
        self.assertEqual(sample.project_endpoint(endpoint + "/"), endpoint)
        with patch.object(sample, "access_token") as token, redirect_stdout(io.StringIO()) as output:
            sample.main(["endpoint", "--project-endpoint", endpoint, "--agent-name", "demo"])
        self.assertEqual(output.getvalue().strip(),
                         "wss://example.services.ai.azure.com/api/projects/_project/agents/demo/endpoint/protocols/voice/telephony/genesys-audiohook?api-version=v1")
        token.assert_not_called()

    def test_network_commands_preserve_the_default_project_alias(self):
        endpoint = "https://example.services.ai.azure.com/api/projects/_project"
        for command, method, suffix in [
            ("create", "POST", "/agents?api-version=v1"),
            ("calls", "GET", "/agents/demo/telephony/calls?api-version=v1&provider=genesys-audiohook&limit=20"),
            ("delete", "DELETE", "/agents/demo?api-version=v1"),
        ]:
            opener = Mock()
            opener.open.return_value = self.response()
            with self.subTest(command=command), patch.object(sample, "access_token", return_value="test-token"), patch.object(sample, "build_opener", return_value=opener), redirect_stdout(io.StringIO()):
                sample.main([command, "--project-endpoint", endpoint, "--agent-name", "demo"])
                outgoing = opener.open.call_args.args[0]
                self.assertEqual(outgoing.full_url, endpoint + suffix)
                self.assertEqual(outgoing.get_method(), method)
                self.assertEqual(outgoing.get_header("Authorization"), "Bearer test-token")
                opener.open.assert_called_once()

    def test_bad_endpoint_is_rejected_before_credentials_are_requested(self):
        endpoints = [
            "", "http://example.services.ai.azure.com/api/projects/support",
            "https://example.services.ai.azure.com.attacker.test/api/projects/support",
            "https://attacker.test/api/projects/support", ENDPOINT + "?api-key=secret",
            ENDPOINT + "#fragment", ENDPOINT + "/extra", ENDPOINT.replace("support", ".."),
            ENDPOINT.replace("support", "a%2fb"), ENDPOINT.replace(".com", ".com:444"),
            ENDPOINT.replace("support", "_other"), ENDPOINT.replace("support", "_project/extra"),
            ENDPOINT.replace("support", "_project%2Fextra"),
            ENDPOINT.replace(".com", ".com:private_value"),
            ENDPOINT.replace("https://", "https://user:password@"), ENDPOINT.replace("support", "sup\nport"),
        ]
        with patch.object(sample, "access_token") as token:
            for endpoint in endpoints:
                with self.subTest(endpoint=endpoint), self.assertRaises(ValueError) as caught:
                    sample.request(endpoint, {"method": "GET", "path": "/agents/demo"})
                self.assertNotIn("private_value", str(caught.exception))
            token.assert_not_called()

    def test_invalid_agent_name_cannot_change_the_route(self):
        for name in ["", "..", "a/b", "a?x=1", "a#b", "a%2fb", "a b", "a" * 64]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                sample.connection_uri(ENDPOINT, name)

    def test_call_list_has_provider_filter_and_bounded_page(self):
        self.assertEqual(sample.operation_for(self.arguments("calls", "--agent-name", "demo")), {
            "method": "GET", "path": "/agents/demo/telephony/calls",
            "params": {"provider": "genesys-audiohook", "limit": 20},
        })

    def test_delete_targets_only_the_named_agent(self):
        self.assertEqual(sample.operation_for(self.arguments("delete", "--agent-name", "demo")),
                         {"method": "DELETE", "path": "/agents/demo"})

    def test_previews_and_endpoint_do_not_authenticate_or_send_requests(self):
        with patch.object(sample, "request") as send, patch.object(sample, "access_token") as token:
            for operation in ("create", "calls", "delete"):
                with self.subTest(operation=operation), redirect_stdout(io.StringIO()) as output:
                    sample.main([operation, "--agent-name", "demo", "--dry-run"])
                    self.assertIn("method", json.loads(output.getvalue()))
            with redirect_stdout(io.StringIO()) as output:
                sample.main(["endpoint", "--agent-name", "demo", "--project-endpoint", ENDPOINT])
                self.assertEqual(output.getvalue().strip(), sample.connection_uri(ENDPOINT, "demo"))
            send.assert_not_called()
            token.assert_not_called()

    def test_rest_request_sends_bearer_and_preview_header_to_validated_endpoint(self):
        opener = Mock()
        opener.open.return_value = self.response(body=b'{"data":[]}')
        operation = sample.operation_for(self.arguments("calls", "--agent-name", "demo"))
        with patch.object(sample, "access_token", return_value="test-token"), patch.object(sample, "build_opener", return_value=opener) as factory:
            self.assertEqual(sample.request(ENDPOINT, operation), {"data": []})
        outgoing = opener.open.call_args.args[0]
        self.assertEqual(outgoing.full_url, ENDPOINT + "/agents/demo/telephony/calls?api-version=v1&provider=genesys-audiohook&limit=20")
        self.assertEqual(outgoing.get_header("Authorization"), "Bearer test-token")
        self.assertEqual(outgoing.get_header("Foundry-features"), "VoiceAgents=V1Preview")
        self.assertIsInstance(factory.call_args.args[0], sample.NoRedirect)
        opener.open.assert_called_once()

    def test_redirect_is_not_followed_by_the_real_http_transport(self):
        received = []

        class Redirect(BaseHTTPRequestHandler):
            def do_GET(self):
                received.append((self.path, self.headers.get("Authorization")))
                self.send_response(302)
                self.send_header("Location", f"http://localhost:{self.server.server_port}/target")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *_):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Redirect) as server:
            worker = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.05))
            worker.start()
            try:
                request = sample.Request(f"http://127.0.0.1:{server.server_port}/start",
                                         headers={"Authorization": "Bearer test-token"})
                with self.assertRaises(HTTPError) as caught:
                    sample.build_opener(sample.NoRedirect()).open(request, timeout=5)
                self.assertEqual(caught.exception.code, 302)
                caught.exception.close()
                self.assertEqual(received, [("/start", "Bearer test-token")])
            finally:
                server.shutdown()
                worker.join()

    def test_create_sends_the_definition_as_json(self):
        opener = Mock()
        opener.open.return_value = self.response(status=201)
        operation = sample.operation_for(self.arguments("create", "--agent-name", "demo"))
        with patch.object(sample, "access_token", return_value="test-token"), patch.object(sample, "build_opener", return_value=opener):
            sample.request(ENDPOINT, operation)
        outgoing = opener.open.call_args.args[0]
        self.assertEqual(outgoing.get_method(), "POST")
        self.assertEqual(json.loads(outgoing.data), operation["body"])

    def test_http_errors_do_not_echo_response_bodies_or_retry(self):
        for status in (302, 401, 403, 409, 500):
            opener = Mock()
            opener.open.side_effect = HTTPError(ENDPOINT, status, "private detail", {}, io.BytesIO(b"secret response"))
            with self.subTest(status=status), patch.object(sample, "access_token", return_value="test-token"), patch.object(sample, "build_opener", return_value=opener):
                with self.assertRaisesRegex(RuntimeError, f"HTTP {status}") as caught:
                    sample.request(ENDPOINT, {"method": "POST", "path": "/agents"})
                self.assertNotIn("secret", str(caught.exception))
                self.assertNotIn("private", str(caught.exception))
                opener.open.assert_called_once()

    def test_accepted_operation_is_not_reported_complete(self):
        opener = Mock()
        opener.open.return_value = self.response(status=202)
        with patch.object(sample, "access_token", return_value="test-token"), patch.object(sample, "build_opener", return_value=opener):
            with self.assertRaisesRegex(RuntimeError, "still pending"):
                sample.request(ENDPOINT, {"method": "POST", "path": "/agents"})
        opener.open.assert_called_once()

    def test_empty_delete_response_is_successful(self):
        opener = Mock()
        opener.open.return_value = self.response(status=204, body=b"")
        with patch.object(sample, "access_token", return_value="test-token"), patch.object(sample, "build_opener", return_value=opener):
            self.assertEqual(sample.request(ENDPOINT, {"method": "DELETE", "path": "/agents/demo"}), {})

    def test_transport_failure_is_not_retried(self):
        opener = Mock()
        opener.open.side_effect = URLError("private transport detail")
        with patch.object(sample, "access_token", return_value="test-token"), patch.object(sample, "build_opener", return_value=opener):
            with self.assertRaisesRegex(RuntimeError, "did not complete"):
                sample.request(ENDPOINT, {"method": "POST", "path": "/agents"})
        opener.open.assert_called_once()

    def test_cli_token_is_captured_without_changing_the_cli_context(self):
        with patch.object(sample.shutil, "which", return_value="az"), patch.object(sample.subprocess, "run", return_value=Mock(returncode=0, stdout="test-token\n")) as run:
            self.assertEqual(sample.access_token(), "test-token")
            self.assertEqual(run.call_args.args[0], ["az", "account", "get-access-token", "--resource", "https://ai.azure.com", "--query", "accessToken", "--output", "tsv"])
            self.assertTrue(run.call_args.kwargs["capture_output"])

    def test_failed_cli_sign_in_does_not_echo_cli_output(self):
        with patch.object(sample.shutil, "which", return_value="az"), patch.object(sample.subprocess, "run", return_value=Mock(returncode=1, stdout="private token", stderr="private diagnostic")):
            with self.assertRaisesRegex(RuntimeError, "az login") as caught:
                sample.access_token()
            self.assertNotIn("private", str(caught.exception))

    def test_create_and_delete_cli_report_the_requested_agent(self):
        with patch.object(sample, "request", return_value={"name": "demo"}) as send:
            with redirect_stdout(io.StringIO()) as output:
                sample.main(["create", "--project-endpoint", ENDPOINT, "--agent-name", "demo"])
            self.assertEqual(json.loads(output.getvalue())["connection_uri"], sample.connection_uri(ENDPOINT, "demo"))
            self.assertEqual(send.call_args.args[1]["method"], "POST")
            with redirect_stdout(io.StringIO()) as output:
                sample.main(["delete", "--project-endpoint", ENDPOINT, "--agent-name", "demo"])
            self.assertEqual(json.loads(output.getvalue()), {"deleted_agent": "demo"})
            self.assertEqual(send.call_args.args[1], {"method": "DELETE", "path": "/agents/demo"})


if __name__ == "__main__":
    unittest.main()
