"""Offline tests for the Conference Concierge Twilio phone binding script."""

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("bind_phone", Path(__file__).resolve().parents[1] / "bind_phone.py")
sample = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sample)


def response(body=None, status=200, headers=None):
    return SimpleNamespace(status_code=status, headers=headers or {}, json=lambda: body)


class BindPhoneTests(unittest.TestCase):
    def args(self, *values):
        with patch.dict(sample.os.environ, {}, clear=True):
            return sample.build_parser().parse_args(values)

    def test_bind_dry_run_builds_a_twilio_binding(self):
        result = sample.execute(self.args(
            "bind", "--agent-name", "ignite-concierge", "--connection", "telephony-twilio",
            "--phone-number", "+1 316-974-3073", "--dry-run",
        ), None)
        self.assertEqual(result, {
            "method": "POST",
            "path": "/agents/ignite-concierge/telephony/bindings",
            "body": {
                "provider": "twilio", "connection": "telephony-twilio",
                "phone_number": "+13169743073", "label": "conference-concierge-phone",
            },
        })

    def test_bind_rejects_invalid_input_before_any_request(self):
        for values, message in (
            (("--connection", "c", "--phone-number", "3169743073"), "E.164"),
            (("--connection", "c", "--phone-number", "+0123456789"), "E.164"),
            (("--phone-number", "+13169743073"), "--connection"),
        ):
            with self.subTest(values=values), self.assertRaisesRegex(ValueError, message):
                sample.execute(self.args("bind", "--agent-name", "a", *values), Mock())
        with self.assertRaisesRegex(ValueError, "Agent name"):
            sample.execute(self.args("show", "--agent-name", "../other"), Mock())

    def test_bind_posts_and_returns_the_number_to_call(self):
        send = Mock(return_value=response({"id": "twilio:13169743073", "phone_number": "+13169743073"}))
        result = sample.execute(self.args(
            "bind", "--agent-name", "a", "--connection", "c", "--phone-number", "+13169743073", "--label", "",
        ), send)
        send.assert_called_once_with("POST", "/agents/a/telephony/bindings", json={
            "provider": "twilio", "connection": "c", "phone_number": "+13169743073",
        })
        self.assertEqual(result["call"], "+13169743073")

    def test_show_and_calls_filter_to_twilio(self):
        send = Mock(return_value=response({"data": []}))
        sample.execute(self.args("show", "--agent-name", "a"), send)
        sample.execute(self.args("calls", "--agent-name", "a", "--limit", "3"), send)
        self.assertEqual(send.call_args_list[0].args, ("GET", "/agents/a/telephony/bindings"))
        self.assertEqual(send.call_args_list[0].kwargs, {"params": {"provider": "twilio"}})
        self.assertEqual(send.call_args_list[1].args, ("GET", "/agents/a/telephony/calls"))
        self.assertEqual(send.call_args_list[1].kwargs, {"params": {"provider": "twilio", "limit": 3}})

    def test_unbind_requires_yes_and_uses_the_binding_etag(self):
        with self.assertRaisesRegex(ValueError, "--yes"):
            sample.execute(self.args("unbind", "--agent-name", "a", "--binding-id", "twilio:1"), Mock())
        send = Mock(side_effect=[response({"provider": "twilio"}, headers={"ETag": '"e1"'}), response({})])
        result = sample.execute(self.args("unbind", "--agent-name", "a", "--binding-id", "twilio:1", "--yes"), send)
        self.assertEqual(send.call_args_list[1].args, ("DELETE", "/agents/a/telephony/bindings/twilio%3A1"))
        self.assertEqual(send.call_args_list[1].kwargs, {"headers": {"If-Match": '"e1"'}})
        self.assertEqual(result, {"deleted_binding": "twilio:1", "agent_retained": "a"})

    def test_unbind_refuses_other_providers_and_missing_etag(self):
        send = Mock(return_value=response({"provider": "sip"}, headers={"ETag": '"e1"'}))
        with self.assertRaisesRegex(ValueError, "non-Twilio"):
            sample.execute(self.args("unbind", "--agent-name", "a", "--binding-id", "sip:1", "--yes"), send)
        send = Mock(return_value=response({"provider": "twilio"}))
        with self.assertRaisesRegex(RuntimeError, "ETag"):
            sample.execute(self.args("unbind", "--agent-name", "a", "--binding-id", "twilio:1", "--yes"), send)
        self.assertEqual(send.call_count, 1)

    def test_project_endpoint_must_be_a_foundry_project(self):
        self.assertEqual(
            sample.project_endpoint("https://r.services.ai.azure.com/api/projects/p/"),
            "https://r.services.ai.azure.com/api/projects/p",
        )
        for bad in ("http://r.services.ai.azure.com/api/projects/p", "https://evil.example/api/projects/p",
                    "https://r.services.ai.azure.com/api/projects/p?x=1", "https://r.services.ai.azure.com/api/projects"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                sample.project_endpoint(bad)

    def test_request_errors_keep_status_code_and_request_id_only(self):
        session = Mock()
        session.request.return_value = SimpleNamespace(
            status_code=409, headers={"x-ms-request-id": "rid"},
            json=lambda: {"error": {"code": "binding_already_exists", "message": "already bound"}},
        )
        credential = Mock()
        credential.get_token.return_value = SimpleNamespace(token="secret-token")
        with self.assertRaises(RuntimeError) as raised:
            sample.request(session, credential, "https://r.services.ai.azure.com/api/projects/p", "POST", "/agents/a/telephony/bindings")
        self.assertIn("HTTP 409; binding_already_exists: already bound; request-id=rid", str(raised.exception))
        self.assertNotIn("secret-token", str(raised.exception))
        self.assertEqual(session.request.call_args.kwargs["params"], {"api-version": "v1"})


if __name__ == "__main__":
    unittest.main()
