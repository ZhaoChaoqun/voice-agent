from __future__ import annotations

import asyncio
import io
import json
import re
import threading
import unittest
import urllib.error
import urllib.parse
from contextlib import contextmanager

from mcp.server.fastmcp import FastMCP

from shared_mcp.ex35_auth_ladder.otp import OtpStore
from shared_mcp.ex35_auth_ladder.pack import build_http_routes, register_tools
from shared_mcp.ex35_auth_ladder.service import (
    AuthLadderService,
    RedisSessionStore,
    normalize_spoken_digits,
    parse_spoken_date,
)
from shared_mcp.ex35_auth_ladder.sms import TwilioSms
from shared_mcp.ex35_auth_ladder.ui import OtpConsoleApp

try:  # The Lua scripts run only where fakeredis has Lua support.
    import fakeredis

    fakeredis.FakeRedis().eval("return 1", 0)
    HAS_LUA_REDIS = True
except Exception:  # noqa: BLE001
    HAS_LUA_REDIS = False


class _Clock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


class _FakeRedis:
    """Just enough of redis.Redis for RedisSessionStore."""

    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def set(self, key: str, value: str, ex: int | None = None, nx: bool = False) -> bool:
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    @contextmanager
    def lock(self, name: str, timeout: int, blocking_timeout: int):
        with self._lock:
            yield


def _started(service: AuthLadderService, customer_id: str = "") -> str:
    return service.start_call(customer_id)["call_id"]


def _refused(call, *args) -> dict:
    try:
        call(*args)
    except Exception as error:  # noqa: BLE001
        return error.payload
    raise AssertionError("expected a refusal")


def _kba(service: AuthLadderService, call_id: str, spoken: str) -> dict:
    customer_id = service.get_auth_status(call_id)["customer_id"]
    return service.verify_identity(call_id, "kba", customer_id, spoken)


class NormalizerTests(unittest.TestCase):
    def test_spoken_dates(self) -> None:
        cases = {
            "April 16th 1988": (1988, 4, 16),
            "the sixteenth of April nineteen eighty-eight": (1988, 4, 16),
            "april sixteen nineteen eighty eight": (1988, 4, 16),
            "1988-04-16": (1988, 4, 16),
            "4/16/1988": (1988, 4, 16),
            "4/16": (None, 4, 16),
            "1988年4月16日": (1988, 4, 16),
            "4月16号": (None, 4, 16),
            "September eighteenth, 1987": (1987, 9, 18),
            "twenty first of March two thousand one": (2001, 3, 21),
            "April 16": (None, 4, 16),
            "sometime in spring": (None, None, None),
        }
        for spoken, expected in cases.items():
            with self.subTest(spoken=spoken):
                self.assertEqual(parse_spoken_date(spoken), expected)

    def test_spoken_digits(self) -> None:
        self.assertEqual(normalize_spoken_digits("1 2 3 4"), "1234")
        self.assertEqual(normalize_spoken_digits("one two three four"), "1234")
        self.assertEqual(normalize_spoken_digits("five six, double seven"), "5677")
        self.assertEqual(normalize_spoken_digits("1234-5678"), "12345678")
        self.assertEqual(normalize_spoken_digits("um, let me check"), "")


class DirectoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.service = AuthLadderService()

    def test_directory_is_the_otp_console_list(self) -> None:
        directory = self.service.otp_directory()
        # 21 curated customers plus the 20K-name directory, minus the 8 names they share.
        self.assertEqual(directory["total_customers"], 21 + 19992)
        self.assertEqual(directory["default_candidate_id"], "cand-you-meng")
        you = self.service.customer_profile("cand-you-meng")
        self.assertEqual((you["full_name"], you["date_of_birth"]), ("You Meng", "1988-04-16"))
        self.assertEqual(
            {(t["code"], t["full_name"]) for t in directory["test_codes"]},
            {("12345678", "You Meng"), ("87654321", "Jeremy Downer")},
        )

    def test_search_pages_and_ranks_by_spelling(self) -> None:
        everyone = self.service.search_directory("", 0, 25)
        self.assertEqual(everyone["total"], 20013)
        self.assertEqual(everyone["customers"][0]["candidate_id"], "cand-you-meng")
        self.assertTrue(all(c["candidate_id"].startswith("cand-") for c in everyone["customers"][:21]))
        last = self.service.search_directory("", 20000, 100)
        self.assertEqual((last["offset"], len(last["customers"])), (20000, 13))
        self.assertEqual(len(self.service.search_directory("", 0, 10_000)["customers"]), 100)
        mich = self.service.search_directory("mich", 0, 3)
        self.assertEqual(mich["customers"][0]["full_name"], "Michael Brennan")
        either_order = {c["full_name"] for c in self.service.search_directory("bren mich")["customers"]}
        self.assertLessEqual({"Michael Brennan", "Michael Brendan", "Michelle Brennan"}, either_order)
        self.assertEqual(self.service.search_directory("zzzz")["total"], 0)
        self.assertEqual(set(mich["customers"][0]), {"candidate_id", "full_name", "state"})

    def test_generated_customers_verify_like_curated_ones(self) -> None:
        michelle = self.service.customer_profile("cust-00002")
        self.assertEqual((michelle["full_name"], michelle["date_of_birth"]), ("Michelle Brennan", "1986-10-02"))
        call_id = self.service.start_call()["call_id"]
        result = self.service.verify_identity(call_id, "identity", "cust-00002", "October second")
        self.assertEqual((result["passed"], result["calling_name"]), (["identity"], "Michelle Brennan"))
        code = self.service.issue_access_code("cust-00003")["otp"]
        result = self.service.verify_access_code(self.service.start_call()["call_id"], code)
        self.assertEqual(result["calling_name"], "Michael Brendan")
        with self.assertRaises(LookupError):
            self.service.customer_profile("cust-99999")


class VerificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = _Clock()
        self.service = AuthLadderService(clock=self.clock)
        self.call_id = _started(self.service)

    def test_start_names_only_the_called_customer(self) -> None:
        started = self.service.start_call()
        self.assertEqual(started["calling_name"], "You Meng")
        self.assertEqual(started["passed"], [])
        self.assertEqual(started["available"], ["identity", "kba", "otp", "sms"])
        self.assertNotIn("1988", json.dumps(started))
        self.assertEqual(_refused(self.service.start_call, "cand-nobody")["error"], "unknown_customer")

    def test_verifications_are_independent_and_in_any_order(self) -> None:
        partial = self.service.verify_access_code(self.call_id, "one two three four")
        self.assertEqual((partial["status"], partial["digits_missing"], partial["attempts_remaining"]), ("incomplete", 4, 3))
        self.assertNotIn("1234", json.dumps(partial))
        result = self.service.verify_access_code(self.call_id, "5 6 7 8")
        self.assertEqual((result["method"], result["passed"]), ("otp", ["otp"]))

        sent = self.service.send_sms_code(self.call_id)
        self.assertEqual(sent["sent_to"], "+1 (425) ***-4821")
        self.assertEqual(set(sent), {"ok", "status", "method", "delivery", "sent_to", "code_digits", "expires_in_seconds"})
        self.assertEqual(self.service.verify_sms_code(self.call_id, "two four six")["status"], "incomplete")
        self.assertEqual(self.service.verify_sms_code(self.call_id, "8 1 0")["passed"], ["otp", "sms"])

        self.assertEqual(_kba(self.service, self.call_id, "April sixteenth")["passed"], ["kba", "otp", "sms"])
        result = self.service.verify_identity(self.call_id, "identity", "cand-you-meng", "4/16")
        self.assertEqual((result["passed"], result["available"]), (["identity", "kba", "otp", "sms"], []))
        self.assertEqual(_kba(self.service, self.call_id, "nonsense")["status"], "already_verified")

    def test_kba_checks_month_and_day_only(self) -> None:
        for spoken in ("April 16th 1988", "4/16", "the sixteenth of April, nineteen ninety-nine", "4月16号"):
            with self.subTest(spoken=spoken):
                self.assertEqual(_kba(self.service, _started(self.service), spoken)["passed"], ["kba"])

    def test_kba_distinguishes_unclear_from_wrong_and_locks_only_itself(self) -> None:
        unclear = _refused(_kba, self.service, self.call_id, "in the spring")
        self.assertEqual((unclear["error"], unclear["attempts_remaining"]), ("date_not_understood", 3))
        for remaining in (2, 1, 0):
            refused = _refused(_kba, self.service, self.call_id, "January 1st")
            self.assertEqual((refused["error"], refused["attempts_remaining"]), ("identity_not_verified", remaining))
        self.assertTrue(refused["locked"])
        self.assertEqual(_refused(_kba, self.service, self.call_id, "April 16")["error"], "kba_locked")
        status = self.service.get_auth_status(self.call_id)
        self.assertEqual((status["locked_methods"], status["available"]), (["kba"], ["identity", "otp", "sms"]))
        self.assertEqual(self.service.verify_access_code(self.call_id, "12345678")["passed"], ["otp"])

    def test_identity_binds_the_picked_customer(self) -> None:
        refused = _refused(self.service.verify_identity, self.call_id, "identity", "cand-jeremy-downer", "April 16")
        self.assertEqual(refused["error"], "identity_not_verified")
        self.assertEqual(refused["calling_name"], "You Meng")
        result = self.service.verify_identity(self.call_id, "identity", "cand-jeremy-downer", "September eighteenth")
        self.assertEqual((result["calling_name"], result["passed"]), ("Jeremy Downer", ["identity"]))
        # Every later verification is for Jeremy Downer.
        self.assertEqual(_refused(_kba, self.service, self.call_id, "April 16")["error"], "identity_not_verified")
        self.assertEqual(_kba(self.service, self.call_id, "September 18")["passed"], ["identity", "kba"])
        # You Meng's test code no longer fits: the call is bound to Jeremy.
        refused = _refused(self.service.verify_access_code, self.call_id, "12345678")
        self.assertEqual((refused["error"], refused["code_status"]), ("different_customer", "other_customer"))
        self.assertEqual(self.service.verify_access_code(self.call_id, "87654321")["passed"], ["identity", "kba", "otp"])
        self.assertEqual(self.service.send_sms_code(self.call_id)["sent_to"], "+1 (248) ***-9012")

    def test_identity_cannot_switch_customer_after_a_pass(self) -> None:
        _kba(self.service, self.call_id, "April 16")
        refused = _refused(self.service.verify_identity, self.call_id, "identity", "cand-jeremy-downer", "September 18")
        self.assertEqual((refused["error"], refused["calling_name"]), ("different_customer", "You Meng"))
        self.assertEqual(self.service.verify_identity(self.call_id, "identity", "cand-you-meng", "April 16")["passed"], ["identity", "kba"])
        self.assertEqual(_refused(self.service.verify_identity, _started(self.service), "identity", "cand-x", "April 16")["error"], "unknown_customer")

    def test_access_code_identifies_its_owner_on_a_fresh_call(self) -> None:
        # The call opens for You Meng, but nothing has passed: Jeremy's code identifies Jeremy.
        other = self.service.issue_access_code("cand-jeremy-downer")["otp"]
        result = self.service.verify_access_code(self.call_id, other)
        self.assertEqual(
            (result["customer_id"], result["calling_name"], result["passed"]),
            ("cand-jeremy-downer", "Jeremy Downer", ["otp"]),
        )
        # Later checks are for Jeremy now.
        self.assertEqual(_kba(self.service, self.call_id, "September 18")["passed"], ["kba", "otp"])
        # A reserved test code also identifies its owner on a fresh call.
        tester = self.service.verify_access_code(_started(self.service, "cand-jeremy-downer"), "12345678")
        self.assertEqual((tester["calling_name"], tester["passed"]), ("You Meng", ["otp"]))

    def test_console_codes_are_single_use_and_bound_once_a_check_passed(self) -> None:
        code = self.service.issue_access_code("cand-you-meng")["otp"]
        other = self.service.issue_access_code("cand-jeremy-downer")["otp"]
        _kba(self.service, self.call_id, "April 16")
        refused = _refused(self.service.verify_access_code, self.call_id, other)
        self.assertEqual((refused["error"], refused["code_status"]), ("different_customer", "other_customer"))
        self.assertEqual(refused["calling_name"], "You Meng")
        self.assertEqual(self.service.verify_access_code(self.call_id, code)["passed"], ["kba", "otp"])
        self.assertEqual(_refused(self.service.verify_access_code, _started(self.service), code)["code_status"], "consumed")
        # Speaking Jeremy's code on You Meng's verified call did not burn it.
        self.assertEqual(self.service.verify_access_code(_started(self.service), other)["calling_name"], "Jeremy Downer")

    def test_new_console_code_replaces_the_old_one_and_codes_expire(self) -> None:
        old = self.service.issue_access_code("cand-you-meng")["otp"]
        new = self.service.issue_access_code("cand-you-meng")["otp"]
        _refused(self.service.verify_access_code, self.call_id, old)
        self.assertEqual(self.service.verify_access_code(self.call_id, new)["passed"], ["otp"])
        late = self.service.issue_access_code("cand-you-meng")["otp"]
        self.clock.now += 48 * 3600 + 1
        self.assertEqual(_refused(self.service.verify_access_code, _started(self.service), late)["code_status"], "expired")
        with self.assertRaises(LookupError):
            self.service.issue_access_code("cand-nobody")

    def test_otp_locks_after_three_wrong_codes(self) -> None:
        for _ in range(3):
            _refused(self.service.verify_access_code, self.call_id, "11112222")
        self.assertEqual(_refused(self.service.verify_access_code, self.call_id, "12345678")["error"], "otp_locked")
        self.assertEqual(_kba(self.service, self.call_id, "April 16")["passed"], ["kba"])

    def test_too_many_digits_resets_without_cost(self) -> None:
        self.service.verify_access_code(self.call_id, "1234")
        refused = _refused(self.service.verify_access_code, self.call_id, "12345678")
        self.assertEqual((refused["error"], refused["attempts_remaining"]), ("too_many_digits", 3))
        self.assertEqual(self.service.verify_access_code(self.call_id, "12345678")["passed"], ["otp"])

    def test_reserved_access_code_is_reusable_across_calls(self) -> None:
        for _ in range(3):
            self.assertEqual(self.service.verify_access_code(_started(self.service), "12345678")["status"], "verified")

    def test_sms_requires_send_and_expires(self) -> None:
        self.assertEqual(_refused(self.service.verify_sms_code, self.call_id, "246810")["error"], "sms_not_sent")
        self.service.send_sms_code(self.call_id)
        self.clock.now += 301
        self.assertEqual(_refused(self.service.verify_sms_code, self.call_id, "246810")["error"], "sms_code_expired")
        self.service.send_sms_code(self.call_id)
        self.assertEqual(self.service.verify_sms_code(self.call_id, "246810")["passed"], ["sms"])

    def test_ended_and_unknown_calls_are_refused(self) -> None:
        self.service.end_call(self.call_id, "completed")
        self.assertEqual(_refused(self.service.get_auth_status, self.call_id)["error"], "call_ended")
        for call_id in ("ex35-000000000000", "made-up"):
            self.assertEqual(_refused(self.service.get_auth_status, call_id)["error"], "unknown_call")

    def test_kba_customer_is_preset_and_fixed(self) -> None:
        refused = _refused(self.service.verify_identity, self.call_id, "kba", "cand-jeremy-downer", "September 18")
        self.assertEqual((refused["error"], refused["customer_id"]), ("customer_fixed", "cand-you-meng"))
        self.assertEqual(self.service.get_auth_status(self.call_id)["locked_methods"], [])
        self.assertEqual(self.service.verify_identity(self.call_id, "kba", "cand-you-meng", "April 16")["passed"], ["kba"])
        self.assertEqual(_refused(self.service.verify_identity, self.call_id, "other", "cand-you-meng", "April 16")["error"], "invalid_method")


class RedisStoreTests(unittest.TestCase):
    def test_two_replicas_share_attempts_and_flags(self) -> None:
        client = _FakeRedis()
        replica_a = AuthLadderService(store=RedisSessionStore(client, "test:ex35"))
        replica_b = AuthLadderService(store=RedisSessionStore(client, "test:ex35"))
        call_id = _started(replica_a)
        _refused(_kba, replica_b, call_id, "January 1st")
        self.assertEqual(_refused(_kba, replica_a, call_id, "January 2nd")["attempts_remaining"], 1)
        _kba(replica_b, call_id, "April 16")
        replica_a.verify_access_code(call_id, "1234")
        self.assertEqual(replica_b.verify_access_code(call_id, "5678")["passed"], ["kba", "otp"])
        self.assertTrue(all(key.startswith("test:ex35:") for key in client.values))

    @unittest.skipUnless(HAS_LUA_REDIS, "fakeredis with Lua support is not installed")
    def test_redis_otp_scripts_across_replicas(self) -> None:
        client = fakeredis.FakeRedis(decode_responses=True)
        reserved = {"12345678": "cand-you-meng"}
        replica_a = OtpStore(reserved, redis_client=client, key_prefix="test:ex35")
        replica_b = OtpStore(reserved, redis_client=client, key_prefix="test:ex35")
        old = replica_a.issue("cand-you-meng")["otp"]
        code = replica_b.issue("cand-you-meng")["otp"]
        other = replica_a.issue("cand-jeremy-downer")["otp"]
        self.assertEqual(replica_b.verify_for(old, "cand-you-meng"), "invalid")
        self.assertEqual(replica_b.verify_for(other, "cand-you-meng"), "wrong_customer")
        self.assertEqual(replica_b.verify_for(code, "cand-you-meng"), "verified")
        self.assertEqual(replica_a.verify_for(code, "cand-you-meng"), "consumed")
        self.assertEqual(replica_a.verify_for(code, "cand-jeremy-downer"), "wrong_customer")
        self.assertEqual(replica_a.verify_for(other, "cand-jeremy-downer"), "verified")
        self.assertEqual(replica_a.verify_for("12345678", "cand-you-meng"), "test_verified")
        # Unbound verify reports the owner; bound verify leaves a foreign code unburned.
        fresh = replica_a.issue("cand-jeremy-downer")["otp"]
        self.assertEqual(replica_b.verify(fresh, "cand-you-meng"), ("wrong_customer", "cand-jeremy-downer"))
        self.assertEqual(replica_b.verify(fresh), ("verified", "cand-jeremy-downer"))
        self.assertEqual(replica_a.verify(fresh), ("consumed", "cand-jeremy-downer"))
        self.assertEqual(replica_a.verify("00000000"), ("invalid", ""))
        self.assertTrue(all(key.startswith("test:ex35:{otp}:") for key in client.keys("*")))


def _http(
    app, method: str, path: str, body: bytes = b"", headers: list | None = None, query: bytes = b""
) -> tuple[int, bytes]:
    sent: list[dict] = []

    async def receive() -> dict:
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict) -> None:
        sent.append(message)

    scope = {"type": "http", "method": method, "path": path, "headers": headers or [], "query_string": query}
    asyncio.run(app(scope, receive, send))
    return sent[0]["status"], b"".join(m.get("body", b"") for m in sent[1:])


class OtpConsoleTests(unittest.TestCase):
    def test_page_directory_and_issue(self) -> None:
        service = AuthLadderService()
        app = OtpConsoleApp(service)
        status, page = _http(app, "GET", "/ex35-otp")
        self.assertEqual(status, 200)
        self.assertIn(b"Customer OTP Console", page)
        status, body = _http(app, "GET", "/ex35-otp/api/customers")
        first = json.loads(body)
        self.assertEqual((status, first["total"], len(first["customers"])), (200, 20013, 50))
        self.assertEqual((first["default_candidate_id"], first["sounds_like"]), ("cand-you-meng", []))
        status, body = _http(app, "GET", "/ex35-otp/api/customers", query=b"q=michelle%20bren&offset=0&limit=5")
        self.assertEqual(json.loads(body)["customers"][0]["full_name"], "Michelle Brennan")
        self.assertEqual(_http(app, "GET", "/ex35-otp/api/customers", query=b"offset=x&limit=y")[0], 200)
        status, body = _http(app, "GET", "/ex35-otp/api/customers/cust-00002")
        self.assertEqual((status, json.loads(body)["full_name"]), (200, "Michelle Brennan"))
        self.assertEqual(_http(app, "GET", "/ex35-otp/api/customers/cust-99999")[0], 404)
        self.assertEqual(_http(app, "GET", "/ex35-otp/api/customers/..%2Fsecret")[0], 404)
        status, body = _http(app, "POST", "/ex35-otp/api/otp", b'{"candidate_id":"cand-you-meng"}')
        issued = json.loads(body)
        self.assertEqual((status, issued["customer"]["full_name"]), (201, "You Meng"))
        self.assertEqual(service.verify_access_code(_started(service), issued["otp"])["passed"], ["otp"])
        self.assertEqual(_http(app, "POST", "/ex35-otp/api/otp", b'{"candidate_id":"x"}')[0], 404)
        self.assertEqual(_http(app, "POST", "/ex35-otp/api/otp", b"not json")[0], 400)
        self.assertEqual(_http(app, "GET", "/ex35-otp/other")[0], 404)

    def test_sounds_like_only_when_spelling_finds_nobody(self) -> None:
        heard: list[str] = []

        def name_search(text: str) -> list[str]:
            heard.append(text)
            return ["cand-zheng-niu", "unknown-id"]

        app = OtpConsoleApp(AuthLadderService(), name_search=name_search)
        body = json.loads(_http(app, "GET", "/ex35-otp/api/customers", query=b"q=jung%20new")[1])
        self.assertEqual((body["total"], [c["full_name"] for c in body["sounds_like"]]), (0, ["Zheng Niu"]))
        body = json.loads(_http(app, "GET", "/ex35-otp/api/customers", query=b"q=you%20meng")[1])
        self.assertEqual((body["total"], body["sounds_like"]), (1, []))
        self.assertEqual(heard, ["jung new"])

    def test_optional_admin_key(self) -> None:
        app = OtpConsoleApp(AuthLadderService(), admin_token="k" * 32)
        self.assertEqual(_http(app, "GET", "/ex35-otp")[0], 200)
        self.assertEqual(_http(app, "GET", "/ex35-otp/api/customers")[0], 401)
        self.assertEqual(_http(app, "POST", "/ex35-otp/api/otp", b'{"candidate_id":"cand-you-meng"}')[0], 401)
        auth = [(b"authorization", b"Bearer " + b"k" * 32)]
        self.assertEqual(_http(app, "GET", "/ex35-otp/api/customers", headers=auth)[0], 200)
        self.assertEqual(_http(app, "GET", "/ex35-otp/api/customers/cand-you-meng")[0], 401)


class McpRegistrationTests(unittest.TestCase):
    def test_tools_are_prefixed_and_refusals_are_results(self) -> None:
        mcp = FastMCP("ex35-test")
        register_tools(mcp, AuthLadderService())
        names = {tool.name for tool in asyncio.run(mcp.list_tools())}
        self.assertEqual(
            names,
            {
                "start_call",
                "verify_identity",
                "verify_access_code",
                "send_sms_code",
                "verify_sms_code",
                "get_auth_status",
                "end_call",
            },
        )

        def call(name: str, **arguments: object) -> dict:
            result = asyncio.run(mcp.call_tool(name, arguments))
            content = result[0] if isinstance(result, tuple) else result
            return json.loads(content[0].text)

        started = call("start_call")
        self.assertEqual(started["calling_name"], "You Meng")
        refused = call("verify_identity", call_id=started["call_id"], method="kba", customer_id=started["customer_id"], date_of_birth="January 1")
        self.assertEqual(refused["error"], "identity_not_verified")
        self.assertTrue(call("verify_identity", call_id=started["call_id"], method="kba", customer_id=started["customer_id"], date_of_birth="4/16")["ok"])

    def test_pack_serves_the_console_route(self) -> None:
        self.assertEqual(list(build_http_routes()), ["/ex35-otp"])


class _FakeResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        return None


class SmsSenderTests(unittest.TestCase):
    ACCOUNT = "AC" + "0" * 32

    def _sender(self, opener) -> TwilioSms:
        return TwilioSms(self.ACCOUNT, self.ACCOUNT, "token", "+14255550100", from_number="+13855550199", opener=opener)

    def test_real_send_texts_the_code_and_the_agent_never_sees_it(self) -> None:
        sent: list = []

        def opener(request, timeout):
            sent.append((request, timeout))
            return _FakeResponse(b'{"sid": "SM' + b"1" * 32 + b'"}')

        service = AuthLadderService(sms_sender=self._sender(opener))
        call_id = _started(service)
        result = service.send_sms_code(call_id)
        self.assertEqual((result["delivery"], result["sent_to"]), ("twilio", "+1 (425) ***-0100"))
        request, timeout = sent[0]
        self.assertEqual(request.full_url, f"https://api.twilio.com/2010-04-01/Accounts/{self.ACCOUNT}/Messages.json")
        self.assertLessEqual(timeout, 5)
        form = urllib.parse.parse_qs(request.data.decode())
        self.assertEqual((form["To"], form["From"]), (["+14255550100"], ["+13855550199"]))
        code = re.search(r"code is (\d{6})", form["Body"][0]).group(1)
        self.assertNotIn(code, json.dumps(result))
        self.assertEqual(service.verify_sms_code(call_id, " ".join(code))["passed"], ["sms"])

    def test_failed_send_is_reported_and_not_counted(self) -> None:
        def opener(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 400, "bad", {}, io.BytesIO(b'{"code": 21608}'))

        service = AuthLadderService(sms_sender=self._sender(opener))
        call_id = _started(service)
        refused = _refused(service.send_sms_code, call_id)
        self.assertEqual(refused["error"], "sms_send_failed")
        self.assertNotIn("token", json.dumps(refused))
        self.assertEqual(_refused(service.verify_sms_code, call_id, "246810")["error"], "sms_not_sent")

    def test_unconfigured_sender_is_simulated(self) -> None:
        self.assertIsNone(TwilioSms.from_environment({}))
        self.assertIsNone(TwilioSms.from_environment({"TWILIO_ACCOUNT_SID": self.ACCOUNT, "TWILIO_AUTH_TOKEN": "t"}))
        configured = TwilioSms.from_environment({
            "TWILIO_ACCOUNT_SID": self.ACCOUNT,
            "TWILIO_AUTH_TOKEN": "t",
            "TWILIO_SMS_FROM": "+13855550199",
            "EX35_SMS_TO": "+8613800000000",
        })
        self.assertEqual(configured.to_masked, "+861***0000")
        with self.assertRaises(ValueError):
            TwilioSms.from_environment({
                "TWILIO_ACCOUNT_SID": self.ACCOUNT, "TWILIO_AUTH_TOKEN": "t",
                "TWILIO_SMS_FROM": "3855550199", "EX35_SMS_TO": "+14255550100",
            })
        simulated = AuthLadderService()
        self.assertEqual(simulated.send_sms_code(_started(simulated))["delivery"], "simulated")


if __name__ == "__main__":
    unittest.main()
