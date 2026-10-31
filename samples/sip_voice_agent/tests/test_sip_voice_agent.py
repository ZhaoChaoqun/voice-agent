"""Offline tests for Agent definitions, SIP bindings, and REST operations."""

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location(
    "sip_voice_agent", Path(__file__).resolve().parents[1] / "sip_voice_agent.py"
)
sample = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sample)


def response(body=None, status=200, headers=None):
    return SimpleNamespace(status_code=status, headers=headers or {}, json=lambda: body)


class SampleTests(unittest.TestCase):
    def args(self, *values):
        with patch.dict(sample.os.environ, {}, clear=True):
            return sample.build_parser().parse_args(values)

    def test_responses_definition_matches_native_live_shape(self):
        definition = sample.voice_definition("live-deployment", "marin", "responses-deployment")
        self.assertEqual(definition["kind"], "voice")
        self.assertEqual(definition["sub_protocol"], "live")
        self.assertEqual(definition["model_type"], "self_deployed")
        self.assertEqual(definition["model"], "live-deployment")
        self.assertEqual(definition["audio"], {
            "format": {"type": "audio/pcm", "rate": 24000}, "output": {"voice": "marin"},
        })
        self.assertFalse(definition["store"])
        self.assertEqual(definition["tools"], [{"type": "system", "name": "end_conversation"}])
        self.assertEqual(definition["delegation"], {
            "type": "responses",
            "responses": {"model": "responses-deployment", "instructions": sample.BACKEND_INSTRUCTIONS},
        })
        for key in ("live_config", "greeting", "system_tools", "conversation_engine", "turn_detection"):
            self.assertNotIn(key, definition)
        self.assertIn("Delegate to the backend", definition["instructions"])

    def test_create_voice_transfer_uses_same_system_contract_as_realtime(self):
        path = Path(__file__).resolve().parents[1] / "transfer_targets.example.json"
        result = sample.execute(self.args(
            "create", "--agent-name", "demo", "--live-model", "live", "--responses-model", "responses",
            "--transfer-targets-file", str(path), "--dry-run",
        ), None)
        definition = result["body"]["definition"]
        tool = definition["tools"][1]
        self.assertEqual((tool["type"], tool["name"]), ("system", "transfer"))
        self.assertEqual(tool["targets"][0]["name"], "human_support")
        self.assertEqual(tool["targets"][0]["routing"], {"strategy": "sequential", "ring_timeout_seconds": 20})
        self.assertNotIn("tools", definition["delegation"]["responses"])
        self.assertNotIn("system_tools", definition)
        self.assertNotIn("+14255550100", definition["instructions"])

    def test_targets_replacement_uses_etag_and_replaces_exact_file(self):
        body = {"transfer_targets": [{
            "name": "support", "description": "Human support",
            "destination": {"type": "phone_number", "value": "+14255550100"},
        }]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "targets.json"
            path.write_text(json.dumps(body), encoding="utf-8")
            send = Mock(side_effect=[response({}, headers={"ETag": '"old"'}), response(body, headers={"ETag": '"new"'})])
            result = sample.execute(self.args("targets", "--agent-name", "demo", "--file", str(path), "--yes"), send)
            self.assertEqual(result, {"configuration": body, "etag": '"new"'})
            self.assertEqual(send.call_args.kwargs, {"json": body, "headers": {"If-Match": '"old"'}})

    def test_targets_preview_is_offline_and_live_replace_requires_yes_and_etag(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "targets.json"
            path.write_text('{"transfer_targets": []}', encoding="utf-8")
            args = self.args("targets", "--agent-name", "demo", "--file", str(path), "--dry-run")
            send = Mock(side_effect=AssertionError("offline"))
            self.assertEqual(sample.execute(args, send)["then"]["body"], {"transfer_targets": []})
            send.assert_not_called()
            args.dry_run = False
            with self.assertRaises(ValueError):
                sample.execute(args, send)
            send.assert_not_called()
            args.yes = True
            for etag in (None, " ", "*"):
                with self.subTest(etag=etag):
                    send = Mock(return_value=response({}, headers={"ETag": etag}))
                    with self.assertRaises(RuntimeError):
                        sample.execute(args, send)
                    self.assertEqual(send.call_count, 1)

    def test_invalid_targets_never_send_http(self):
        for body in (
            {}, {"transfer_targets": None}, {"transfer_targets": [{}]},
            {"transfer_targets": [{"name": "support", "description": "Human", "destination": {"type": "sip", "value": "sip:user@example.test"}}]},
        ):
            with self.subTest(body=body), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "targets.json"
                path.write_text(json.dumps(body), encoding="utf-8")
                send = Mock()
                with self.assertRaises(ValueError):
                    sample.execute(self.args("targets", "--agent-name", "demo", "--file", str(path), "--yes"), send)
                send.assert_not_called()

    def test_localized_digits_are_rejected_before_agent_or_target_requests(self):
        for number in ("+1４２５５５５０１００", "+1٤٢٥٥٥٥٠١٠٠"):
            with self.subTest(number=number), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "targets.json"
                path.write_text(json.dumps({"transfer_targets": [{
                    "name": "support", "description": "Human support",
                    "destination": {"type": "phone_number", "value": number},
                }]}), encoding="utf-8")
                for values in (
                    ("targets", "--agent-name", "demo", "--file", str(path), "--yes"),
                    ("create", "--agent-name", "demo", "--live-model", "live", "--responses-model", "backend",
                     "--transfer-targets-file", str(path)),
                ):
                    for preview in ([], ["--dry-run"]):
                        send = Mock()
                        with self.assertRaises(ValueError):
                            sample.execute(self.args(*values, *preview), send)
                        send.assert_not_called()

    def test_call_controls_use_service_call_id_and_only_target_name(self):
        for command, extra, kwargs in (("transfer", ["--target", "support"], {"json": {"target": "support"}}), ("end", [], {})):
            with self.subTest(command=command):
                args = self.args(command, "--agent-name", "a/b", "--call-id", "c?x=1", *extra)
                send = Mock(return_value=response({"status": "managing"}))
                sample.execute(args, send)
                send.assert_called_once_with("POST", f"/agents/a%2Fb/telephony/calls/c%3Fx%3D1:{command}", **kwargs)
                args.dry_run = True
                send.reset_mock()
                self.assertEqual(sample.execute(args, send)["method"], "POST")
                send.assert_not_called()

    def test_mutating_control_timeout_is_not_retried(self):
        send = Mock(side_effect=TimeoutError("Outcome unknown"))
        with self.assertRaises(TimeoutError):
            sample.execute(self.args("transfer", "--agent-name", "demo", "--call-id", "call", "--target", "support"), send)
        send.assert_called_once()

    def test_responses_deployment_uses_environment_or_explicit_cli_override(self):
        environment = {"GPT_LIVE_MODEL_DEPLOYMENT": "live", "RESPONSES_MODEL_DEPLOYMENT": "env-responses"}
        for options, expected in (([], "env-responses"), (["--responses-model", "cli-responses"], "cli-responses")):
            with self.subTest(options=options), patch.dict(sample.os.environ, environment, clear=True):
                args = sample.build_parser().parse_args(["create", "--agent-name", "demo", "--dry-run", *options])
                definition = sample.execute(args, None)["body"]["definition"]
                self.assertEqual(definition["delegation"]["responses"]["model"], expected)
                self.assertEqual(definition["delegation"]["type"], "responses")

    def test_missing_deployments_or_voice_fail_before_http(self):
        for values in (
            ("", "marin", "responses"), ("live", "", "responses"),
            ("live", "marin", None), ("live", "marin", ""), ("live", "marin", " "),
        ):
            with self.subTest(values=values):
                args = self.args("create", "--agent-name", "demo")
                args.live_model, args.voice, args.responses_model = values
                send = Mock(side_effect=AssertionError("No HTTP before configuration is valid"))
                with self.assertRaises(ValueError):
                    sample.execute(args, send)
                send.assert_not_called()

    def test_create_rejects_managed_backend_options(self):
        for option in ("--backend-agent", "--backend-version"):
            with self.subTest(option=option), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                self.args("create", "--agent-name", "demo", option, "unused")
            self.assertEqual(error.exception.code, 2)

    def test_create_dry_run_never_calls_http(self):
        send = Mock(side_effect=AssertionError("HTTP must not be called"))
        result = sample.execute(self.args(
            "create", "--agent-name", "demo", "--live-model", "live",
            "--responses-model", "responses", "--dry-run",
        ), send)
        self.assertEqual(result["path"], "/agents")
        self.assertEqual(result["body"]["name"], "demo")
        send.assert_not_called()

    def test_main_dry_run_does_not_resolve_project_or_import_azure(self):
        argv = [
            "sip_voice_agent.py", "create", "--agent-name", "demo",
            "--live-model", "live", "--responses-model", "responses", "--dry-run",
        ]
        with patch.object(sample.sys, "argv", argv), patch.object(
            sample, "project_endpoint", side_effect=AssertionError("No remote setup"),
        ), contextlib.redirect_stdout(io.StringIO()) as output:
            sample.main()
        self.assertEqual(json.loads(output.getvalue())["method"], "POST")

    def test_create_posts_only_voice_agent_with_direct_model_delegation(self):
        send = Mock(return_value=response({"name": "demo"}))
        sample.execute(self.args(
            "create", "--agent-name", "demo", "--live-model", "live",
            "--responses-model", "responses-deployment",
        ), send)
        self.assertEqual(send.call_count, 1)
        self.assertEqual(send.call_args.args, ("POST", "/agents"))
        self.assertEqual(send.call_args.kwargs["json"]["name"], "demo")
        self.assertEqual(send.call_args.kwargs["json"]["definition"]["delegation"], {
            "type": "responses",
            "responses": {"model": "responses-deployment", "instructions": sample.BACKEND_INSTRUCTIONS},
        })

    def test_binding_body_has_only_public_inbound_fields(self):
        self.assertEqual(sample.binding_body(" inbound ", []), {
            "provider": "sip", "connection_name": "inbound",
        })
        self.assertEqual(sample.binding_body("inbound", ["+14255550100"]), {
            "provider": "sip", "connection_name": "inbound",
            "allowed_calling_numbers": ["+14255550100"],
        })
        with self.assertRaises(ValueError):
            sample.binding_body(" ", [])

    def test_bind_dry_run_and_server_owned_id_uri(self):
        uri = "sip:agent_opaque_westus2@gateway.example:5061;transport=tls"
        body = {"id": "sip:opaque", "provider": "sip", "incoming_call_url": uri}
        send = Mock(return_value=response(body, status=201, headers={"ETag": '"v1"'}))
        args = self.args("bind", "--agent-name", "demo", "--connection", "inbound", "--dry-run")
        self.assertEqual(sample.execute(args, send)["body"]["provider"], "sip")
        send.assert_not_called()
        args.dry_run = False
        self.assertEqual(sample.execute(args, send), {"binding": body, "etag": '"v1"'})
        send.assert_called_once_with(
            "POST", "/agents/demo/telephony/bindings",
            json={"provider": "sip", "connection_name": "inbound"},
        )

    def test_failed_binding_is_not_retried_or_rolled_back(self):
        send = Mock(side_effect=TimeoutError("Outcome unknown"))
        with self.assertRaises(TimeoutError):
            sample.execute(self.args("bind", "--agent-name", "demo", "--connection", "inbound"), send)
        self.assertEqual(send.call_count, 1)

    def test_unbind_gets_etag_and_deletes_only_one_binding(self):
        send = Mock(side_effect=[response({"provider": "sip"}, headers={"ETag": '"current"'}), response(status=204)])
        result = sample.execute(self.args(
            "unbind", "--agent-name", "demo", "--binding-id", "sip:abc", "--yes",
        ), send)
        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args_list[0].args, ("GET", "/agents/demo/telephony/bindings/sip%3Aabc"))
        self.assertEqual(send.call_args_list[1].args, ("DELETE", "/agents/demo/telephony/bindings/sip%3Aabc"))
        self.assertEqual(send.call_args_list[1].kwargs, {"headers": {"If-Match": '"current"'}})
        self.assertEqual(result["agent_retained"], "demo")

    def test_unbind_requires_confirmation_valid_etag_and_sip_provider(self):
        args = self.args("unbind", "--agent-name", "demo", "--binding-id", "sip:abc")
        send = Mock()
        with self.assertRaises(ValueError):
            sample.execute(args, send)
        send.assert_not_called()
        args.yes = True
        for provider, etag in (("sip", None), ("sip", " "), ("sip", "*"), ("twilio", '"v1"')):
            with self.subTest(provider=provider, etag=etag):
                send = Mock(return_value=response({"provider": provider}, headers={"ETag": etag}))
                with self.assertRaises((ValueError, RuntimeError)):
                    sample.execute(args, send)
                self.assertEqual(send.call_count, 1)

    def test_unbind_concurrent_update_is_not_retried(self):
        send = Mock(side_effect=[
            response({"provider": "sip"}, headers={"ETag": '"v1"'}), RuntimeError("HTTP 412"),
        ])
        with self.assertRaisesRegex(RuntimeError, "412"):
            sample.execute(self.args("unbind", "--agent-name", "demo", "--binding-id", "id", "--yes"), send)
        self.assertEqual(send.call_count, 2)

    def test_show_and_calls_use_scoped_routes_and_preserve_pages(self):
        page = {"data": [{"id": "id"}], "has_more": True, "last_id": "id"}
        send = Mock(return_value=response(page))
        self.assertEqual(sample.execute(self.args("show", "--agent-name", "demo"), send), page)
        send.assert_called_once_with("GET", "/agents/demo/telephony/bindings", params={"provider": "sip"})
        send.reset_mock()
        self.assertEqual(sample.execute(self.args("calls", "--agent-name", "demo"), send), page)
        send.assert_called_once_with("GET", "/agents/demo/telephony/calls", params={"provider": "sip", "limit": 20})
        send.reset_mock()
        sample.execute(self.args("calls", "--agent-name", "a/b", "--call-id", "c?x=1"), send)
        send.assert_called_once_with("GET", "/agents/a%2Fb/telephony/calls/c%3Fx%3D1")

    def test_http_refreshes_token_keeps_feature_header_and_does_not_redirect(self):
        session = Mock()
        session.request.return_value = response(status=204)
        credential = Mock()
        credential.get_token.side_effect = [SimpleNamespace(token="one"), SimpleNamespace(token="two")]
        endpoint = "https://resource.services.ai.azure.com/api/projects/demo"
        for _ in range(2):
            sample.request(session, credential, endpoint, "DELETE", "/agents/demo/telephony/bindings/id",
                           headers={"If-Match": '"v1"'})
        first, second = session.request.call_args_list
        self.assertEqual(first.kwargs["headers"]["Authorization"], "Bearer one")
        self.assertEqual(second.kwargs["headers"]["Authorization"], "Bearer two")
        self.assertEqual(second.kwargs["headers"]["If-Match"], '"v1"')
        self.assertEqual(second.kwargs["headers"]["Foundry-Features"], "VoiceAgents=V1Preview")
        self.assertFalse(second.kwargs["allow_redirects"])
        self.assertEqual(second.kwargs["params"], {"api-version": "v1"})
        credential.get_token.assert_called_with("https://ai.azure.com/.default")

    def test_http_failures_are_not_retried_or_printed_verbatim(self):
        for status in (302, 400, 401, 403, 409, 412, 500):
            with self.subTest(status=status):
                session = Mock()
                session.request.return_value = response(status=status, headers={"x-ms-request-id": "req-1"})
                session.request.return_value.text = "secret-response"
                credential = Mock()
                credential.get_token.return_value = SimpleNamespace(token="secret-token")
                with self.assertRaisesRegex(RuntimeError, f"HTTP {status}") as error:
                    sample.request(session, credential,
                                   "https://resource.services.ai.azure.com/api/projects/demo",
                                   "POST", "/agents", json={})
                self.assertNotIn("secret", str(error.exception))
                self.assertIn("req-1", str(error.exception))
                session.request.assert_called_once()

    def test_endpoint_rejects_nonproject_credential_or_query_urls(self):
        valid = "https://resource.services.ai.azure.com/api/projects/demo"
        self.assertEqual(sample.project_endpoint(valid + "/"), valid)
        for invalid in (
            "http://example.com/api/projects/demo", "https://user:pass@example.com/api/projects/demo",
            valid + "?token=abc", valid + "#part", valid + "/agents", "https://example.com", "",
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                sample.project_endpoint(invalid)

    def test_endpoint_accepts_documented_foundry_hosts(self):
        for authority in (
            "resource.services.ai.azure.com", "resource-1.services.ai.azure.com:443",
            "RESOURCE.SERVICES.AI.AZURE.COM",
        ):
            endpoint = f"https://{authority}/api/projects/demo"
            with self.subTest(endpoint=endpoint):
                self.assertEqual(sample.project_endpoint(endpoint + "/"), endpoint)

    def test_empty_query_or_fragment_delimiters_fail_before_token_or_http(self):
        valid = "https://resource.services.ai.azure.com/api/projects/demo"
        for suffix in ("?", "#", "?#", "/?", "/#", "?/", "#/"):
            with self.subTest(suffix=suffix):
                session = Mock()
                credential = Mock()
                with self.assertRaises(ValueError):
                    sample.project_endpoint(valid + suffix)
                with self.assertRaises(ValueError):
                    sample.request(session, credential, valid + suffix, "GET", "/agents/demo")
                credential.get_token.assert_not_called()
                session.request.assert_not_called()

    def test_untrusted_endpoint_is_rejected_before_token_or_request(self):
        for authority in (
            "example.com", "localhost", "127.0.0.1", "[::1]",
            "services.ai.azure.com", "evilservices.ai.azure.com",
            "resource.services.ai.azure.com.example.com",
            "resource.services.ai.azure.com@evil.example",
            r"evil.example\.services.ai.azure.com",
            "evil.example%2f.services.ai.azure.com",
            "resource.services.ai.azure.com:8443",
            "resource.services.ai.azure.com:not-a-port",
        ):
            with self.subTest(authority=authority):
                credential = Mock()
                session = Mock()
                endpoint = f"https://{authority}/api/projects/demo"
                with self.assertRaises(ValueError):
                    sample.project_endpoint(endpoint)
                with self.assertRaises(ValueError):
                    sample.request(session, credential, endpoint, "GET", "/agents/demo")
                credential.get_token.assert_not_called()
                session.request.assert_not_called()

    def test_main_rejects_untrusted_cli_or_environment_before_authentication(self):
        endpoint = "https://example.com/api/projects/demo"
        for source in ("cli", "environment"):
            with self.subTest(source=source):
                credential_factory = Mock(side_effect=AssertionError("Must not authenticate"))
                session_factory = Mock(side_effect=AssertionError("Must not open a session"))
                modules = {
                    "dotenv": SimpleNamespace(load_dotenv=Mock()),
                    "requests": SimpleNamespace(Session=session_factory),
                    "azure.identity": SimpleNamespace(DefaultAzureCredential=credential_factory),
                }
                argv = ["sip_voice_agent.py"]
                environment = {}
                if source == "cli":
                    argv += ["--project-endpoint", endpoint]
                else:
                    environment["PROJECT_ENDPOINT"] = endpoint
                argv += ["show", "--agent-name", "demo"]
                with patch.dict(sample.os.environ, environment, clear=True), patch.dict(
                    sample.sys.modules, modules,
                ), patch.object(sample.sys, "argv", argv), self.assertRaises(ValueError):
                    sample.main()
                credential_factory.assert_not_called()
                session_factory.assert_not_called()


class ConnectionTests(unittest.TestCase):
    resource_id = (
        "/subscriptions/00000000-1111-2222-3333-444444444444/resourceGroups/sample-rg"
        "/providers/Microsoft.CognitiveServices/accounts/sample-resource/projects/demo"
    )
    path = resource_id + "/connections/inbound"

    def setUp(self):
        environment = patch.dict(sample.os.environ, {}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        self.session = Mock()
        self.credential = Mock()
        self.credential.get_token.return_value = SimpleNamespace(token="secret-arm-token")

    def args(self, *values):
        return sample.build_parser().parse_args([
            "connection", "--project-resource-id", self.resource_id, "--connection", "inbound", *values,
        ])

    def existing(self, auth_type="digest", **properties):
        return response({"properties": {
            "category": "SipInbound", "authType": "CustomKeys",
            "metadata": {"sip_auth_type": auth_type},
            "credentials": {"keys": {"password": "secret-server-value"}}, **properties,
        }})

    def run_command(self, args):
        return sample.execute(args, lambda method, path, **kw: sample.arm_request(
            self.session, self.credential, method, path, **kw,
        ))

    def test_existing_connection_is_reused_without_credentials_or_put(self):
        for mode in ("digest", "ip_acl"):
            with self.subTest(mode=mode):
                send = Mock(return_value=self.existing(mode))
                result = sample.execute(self.args(), send)
                self.assertEqual(result, {"connection_name": "inbound", "resource_id": self.path,
                                          "status": "existing", "auth_type": mode})
                send.assert_called_once_with("GET", self.path, allow_not_found=True)
                self.assertNotIn("secret", json.dumps(result))

    def test_wrong_category_auth_type_or_mode_is_not_overwritten(self):
        for properties in (
            {"category": "SipOutbound"}, {"category": "Twilio"}, {"authType": "ApiKey"},
            {"metadata": {"sip_auth_type": "unsupported"}},
            {"metadata": {"sip_auth_type": "ip_acl"}},
        ):
            with self.subTest(properties=properties):
                send = Mock(return_value=self.existing(**properties))
                with self.assertRaises(ValueError):
                    sample.execute(self.args("--auth-type", "digest"), send)
                send.assert_called_once_with("GET", self.path, allow_not_found=True)

    def test_missing_digest_connection_is_created_then_read_back(self):
        self.session.request.side_effect = [response(status=404), response(status=200), self.existing()]
        with patch.dict(sample.os.environ, {"SIP_USERNAME": "caller", "SIP_PASSWORD": " secret-password "}):
            result = self.run_command(self.args())
        self.assertEqual(result["status"], "created")
        calls = self.session.request.call_args_list
        self.assertEqual([call.args[0] for call in calls], ["GET", "PUT", "GET"])
        self.assertEqual(calls[1].kwargs["json"], {"properties": {
            "category": "SipInbound", "target": "sip", "authType": "CustomKeys",
            "metadata": {"sip_auth_type": "digest"},
            "credentials": {"keys": {"username": "caller", "password": " secret-password "}},
        }})
        for call in calls:
            self.assertEqual(call.args[1], "https://management.azure.com" + self.path)
            self.assertEqual(call.kwargs["params"], {"api-version": "2025-06-01"})
            self.assertFalse(call.kwargs["allow_redirects"])
            self.assertEqual(call.kwargs["headers"]["Authorization"], "Bearer secret-arm-token")
            self.assertNotIn("Foundry-Features", call.kwargs["headers"])
        self.assertEqual(self.credential.get_token.call_count, 3)
        self.credential.get_token.assert_called_with("https://management.azure.com/.default")
        self.assertNotIn("secret", json.dumps(result))

    def test_missing_ip_acl_connection_uses_explicit_source_addresses(self):
        send = Mock(side_effect=[response(status=404), response(status=201), self.existing("ip_acl")])
        with patch.dict(sample.os.environ, {"SIP_SOURCE_CIDRS": "203.0.113.10/32,2001:db8::1/128"}):
            result = sample.execute(self.args("--auth-type", "ip_acl"), send)
        self.assertEqual(result["status"], "created")
        properties = send.call_args_list[1].kwargs["json"]["properties"]
        self.assertEqual(properties["metadata"], {"sip_auth_type": "ip_acl"})
        self.assertEqual(properties["credentials"]["keys"], {"source_cidrs": "203.0.113.10/32,2001:db8::1/128"})

    def test_missing_or_invalid_credentials_never_issue_put(self):
        cases = [
            ("digest", {}), ("digest", {"SIP_USERNAME": "caller"}),
            ("digest", {"SIP_USERNAME": "caller", "SIP_PASSWORD": " "}),
            ("ip_acl", {}), ("ip_acl", {"SIP_SOURCE_CIDRS": ""}),
            ("ip_acl", {"SIP_SOURCE_CIDRS": "203.0.113.10/32,"}),
            ("ip_acl", {"SIP_SOURCE_CIDRS": "invalid-private-value"}),
        ]
        for mode, environment in cases:
            with self.subTest(mode=mode, keys=list(environment)), patch.dict(sample.os.environ, environment, clear=True):
                send = Mock(return_value=response(status=404))
                with self.assertRaises(ValueError) as error:
                    sample.execute(self.args("--auth-type", mode), send)
                send.assert_called_once_with("GET", self.path, allow_not_found=True)
                self.assertNotIn("invalid-private-value", str(error.exception))

    def test_http_errors_are_not_missing_connections_and_do_not_leak_response(self):
        for status in (301, 302, 400, 401, 403, 409, 429, 500):
            with self.subTest(status=status):
                self.session.request.reset_mock()
                error = response(status=status, headers={"x-ms-request-id": "req-1"})
                error.text = "secret-response"
                self.session.request.return_value = error
                with self.assertRaisesRegex(RuntimeError, f"HTTP {status}") as raised:
                    self.run_command(self.args())
                self.session.request.assert_called_once()
                self.assertNotIn("secret", str(raised.exception))

    def test_put_conflict_is_not_retried_or_rolled_back(self):
        for status in (400, 403, 409, 412, 500):
            with self.subTest(status=status), patch.dict(sample.os.environ, {"SIP_USERNAME": "caller", "SIP_PASSWORD": "secret"}):
                self.session.request.reset_mock()
                self.session.request.side_effect = [response(status=404), response(status=status)]
                with self.assertRaisesRegex(RuntimeError, f"HTTP {status}"):
                    self.run_command(self.args())
                self.assertEqual([c.args[0] for c in self.session.request.call_args_list], ["GET", "PUT"])

    def test_put_timeout_is_not_retried_or_rolled_back(self):
        send = Mock(side_effect=[response(status=404), TimeoutError("Outcome unknown")])
        with patch.dict(sample.os.environ, {"SIP_USERNAME": "caller", "SIP_PASSWORD": "secret"}), self.assertRaises(TimeoutError):
            sample.execute(self.args(), send)
        self.assertEqual([c.args[0] for c in send.call_args_list], ["GET", "PUT"])

    def test_accepted_creation_is_not_reported_complete(self):
        send = Mock(side_effect=[response(status=404), response(status=202)])
        with patch.dict(sample.os.environ, {"SIP_USERNAME": "caller", "SIP_PASSWORD": "secret"}), self.assertRaisesRegex(RuntimeError, "not confirmed"):
            sample.execute(self.args(), send)
        self.assertEqual(send.call_count, 2)

    def test_readback_failure_does_not_report_success_or_delete(self):
        self.session.request.side_effect = [response(status=404), response(status=200), response(status=404)]
        with patch.dict(sample.os.environ, {"SIP_USERNAME": "caller", "SIP_PASSWORD": "secret"}), self.assertRaisesRegex(RuntimeError, "HTTP 404"):
            self.run_command(self.args())
        self.assertEqual([c.args[0] for c in self.session.request.call_args_list], ["GET", "PUT", "GET"])

    def test_dry_run_never_reads_or_prints_credentials_or_calls_http(self):
        for mode in ("digest", "ip_acl"):
            with self.subTest(mode=mode), patch.dict(sample.os.environ, {
                "SIP_USERNAME": "secret-user", "SIP_PASSWORD": "secret-password", "SIP_SOURCE_CIDRS": "secret-value",
            }):
                send = Mock(side_effect=AssertionError("No HTTP"))
                result = sample.execute(self.args("--auth-type", mode, "--dry-run"), send)
                self.assertEqual(result["method"], "GET")
                self.assertEqual(result["if_missing"]["method"], "PUT")
                self.assertNotIn("secret", json.dumps(result))
                send.assert_not_called()

    def test_resource_id_and_name_reject_url_injection_before_authentication(self):
        for path in (
            "https://evil.example" + self.path, self.path + "?secret=value", self.path + "#fragment",
            self.path + "/listsecrets", self.path.replace("/projects/demo", "/projects/.."),
            self.path.replace("/projects/demo", "/projects/%2e%2e"), self.resource_id + "/connections/../other",
            self.path.replace("00000000-1111-2222-3333-444444444444", "not-a-subscription"),
            self.path.replace("/projects/demo", ""),
        ):
            with self.subTest(path=path), self.assertRaises(ValueError):
                sample.arm_request(self.session, self.credential, "GET", path)
        self.credential.get_token.assert_not_called()
        self.session.request.assert_not_called()

    def test_invalid_connection_settings_fail_before_credentials_are_created(self):
        factory = Mock(side_effect=AssertionError("Must not authenticate"))
        modules = {"azure.identity": SimpleNamespace(DefaultAzureCredential=factory)}
        for resource_id, name in (("", "inbound"), (self.resource_id, ""), (self.resource_id, "bad/name")):
            argv = ["sip_voice_agent.py", "connection", "--project-resource-id", resource_id, "--connection", name]
            with self.subTest(resource_id=resource_id, name=name), patch.dict(
                sample.sys.modules, modules,
            ), patch.object(sample.sys, "argv", argv), self.assertRaises(ValueError):
                sample.main()
        factory.assert_not_called()

    def test_unknown_auth_type_from_environment_cannot_create_connection(self):
        send = Mock(return_value=response(status=404))
        with patch.dict(sample.os.environ, {"SIP_AUTH_TYPE": "unsupported"}), self.assertRaises(ValueError):
            sample.execute(self.args(), send)
        send.assert_called_once_with("GET", self.path, allow_not_found=True)

    def test_connection_dry_run_works_without_optional_dependencies(self):
        argv = ["sip_voice_agent.py", "connection", "--project-resource-id", self.resource_id,
                "--connection", "inbound", "--dry-run"]
        with patch.dict(sample.sys.modules, {"requests": None, "azure.identity": None, "dotenv": None}), patch.object(
            sample.sys, "argv", argv,
        ), contextlib.redirect_stdout(io.StringIO()) as output:
            sample.main()
        self.assertEqual(json.loads(output.getvalue())["if_missing"]["method"], "PUT")

    def test_main_connection_uses_arm_without_foundry_endpoint(self):
        self.session.__enter__ = Mock(return_value=self.session)
        self.session.__exit__ = Mock(return_value=False)
        self.credential.__enter__ = Mock(return_value=self.credential)
        self.credential.__exit__ = Mock(return_value=False)
        self.session.request.return_value = self.existing()
        modules = {
            "dotenv": SimpleNamespace(load_dotenv=Mock()),
            "requests": SimpleNamespace(Session=Mock(return_value=self.session)),
            "azure.identity": SimpleNamespace(DefaultAzureCredential=Mock(return_value=self.credential)),
        }
        argv = ["sip_voice_agent.py", "connection"]
        environment = {"PROJECT_RESOURCE_ID": self.resource_id, "SIP_CONNECTION_NAME": "inbound"}
        with patch.dict(sample.os.environ, environment), patch.dict(sample.sys.modules, modules), patch.object(
            sample.sys, "argv", argv,
        ), contextlib.redirect_stdout(io.StringIO()) as output:
            sample.main()
        self.assertEqual(json.loads(output.getvalue())["status"], "existing")
        self.credential.get_token.assert_called_once_with(sample.ARM_TOKEN_SCOPE)
        self.session.__exit__.assert_called_once()
        self.credential.__exit__.assert_called_once()

    def test_main_preserves_literal_dotenv_password_through_arm_creation(self):
        from dotenv import load_dotenv

        self.session.__enter__ = Mock(return_value=self.session)
        self.session.__exit__ = Mock(return_value=False)
        self.credential.__enter__ = Mock(return_value=self.credential)
        self.credential.__exit__ = Mock(return_value=False)
        password = " before-${SIP_TEST_SET}-${SIP_TEST_UNSET}-after "
        for quote in ("'", '"'):
            with self.subTest(quote=quote):
                self.session.request.reset_mock()
                self.session.request.side_effect = [response(status=404), response(status=200), self.existing()]
                config = io.StringIO(f"SIP_USERNAME=caller\nSIP_PASSWORD={quote}{password}{quote}\n")
                loader = Mock(side_effect=lambda config=config, **kwargs: load_dotenv(stream=config, **kwargs))
                modules = {
                    "dotenv": SimpleNamespace(load_dotenv=loader),
                    "requests": SimpleNamespace(Session=Mock(return_value=self.session)),
                    "azure.identity": SimpleNamespace(DefaultAzureCredential=Mock(return_value=self.credential)),
                }
                environment = {"PROJECT_RESOURCE_ID": self.resource_id, "SIP_CONNECTION_NAME": "inbound",
                               "SIP_TEST_SET": "must-not-expand"}
                with patch.dict(sample.os.environ, environment, clear=True), patch.dict(
                    sample.sys.modules, modules,
                ), patch.object(sample.sys, "argv", ["sip_voice_agent.py", "connection"]), contextlib.redirect_stdout(
                    io.StringIO(),
                ) as output:
                    sample.main()
                calls = self.session.request.call_args_list
                self.assertEqual([call.args[0] for call in calls], ["GET", "PUT", "GET"])
                self.assertEqual(calls[1].kwargs["json"]["properties"]["credentials"]["keys"]["password"], password)
                loader.assert_called_once_with(interpolate=False)
                self.assertEqual(json.loads(output.getvalue())["status"], "created")
                self.assertNotIn(password, output.getvalue())
                self.assertNotIn("must-not-expand", output.getvalue())


if __name__ == "__main__":
    unittest.main()
