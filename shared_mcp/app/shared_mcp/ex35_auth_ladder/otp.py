"""Customer access codes for Example 35.

Copied from the /otp console's candidate OTP logic
(docs/voice_agent/project3_umw/v1/app/uwm_mcp/auth.py, OtpService.issue_candidate and
verify_candidate): 8 digits, single use, 48 hours, SHA-256 digests only, atomic Redis
Lua issue and consume, and a new code replaces only that customer's active code.

Two deliberate differences:
- keys live under this pack's own prefix, so issuing here never replaces a code the
  UWM or Interview routes issued;
- a code identifies its owner: verify() returns who the code was issued to, so a
  caller with no prior check is identified by the code itself; when the call is
  already bound to a customer, someone else's code is rejected and not burned.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

OTP_DIGITS = 8
OTP_TTL_SECONDS = 48 * 60 * 60

# KEYS[1] active:<candidate> -> code key, KEYS[2] code:<digest> -> candidate.
_ISSUE = """
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local previous = redis.call('GET', KEYS[1])
if previous then redis.call('DEL', previous) end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[1], KEYS[2], 'EX', ARGV[2])
return 1
"""

# KEYS[1] code:<digest>, KEYS[2] consumed:<digest>, KEYS[3] active:<expected candidate>.
# Returns 1 verified, 2 already consumed, 3 issued to another customer, 0 unknown.
_CONSUME = """
local owner = redis.call('GET', KEYS[1])
if not owner then
    local consumed = redis.call('GET', KEYS[2])
    if not consumed then return 0 end
    if consumed == ARGV[1] then return 2 end
    return 3
end
if owner ~= ARGV[1] then return 3 end
local ttl = redis.call('TTL', KEYS[1])
redis.call('DEL', KEYS[1])
if redis.call('GET', KEYS[3]) == KEYS[1] then redis.call('DEL', KEYS[3]) end
if ttl > 0 then redis.call('SET', KEYS[2], owner, 'EX', ttl) end
return 1
"""


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")


class OtpStore:
    def __init__(
        self,
        reserved_codes: dict[str, str],
        *,
        redis_client: Any | None = None,
        key_prefix: str = "ex35-auth-ladder",
        ttl_seconds: int = OTP_TTL_SECONDS,
        clock: Callable[[], float] = time.time,
        code_factory: Callable[[], str] | None = None,
    ) -> None:
        # Permanent test codes: reusable, never stored, bound to one customer each.
        self._reserved = dict(reserved_codes)
        self._redis = redis_client
        # The {otp} hash tag keeps every Lua key in one Redis Cluster slot.
        self._prefix = f"{key_prefix.rstrip(':')}:{{otp}}"
        self._ttl = ttl_seconds
        self._clock = clock
        self._code_factory = code_factory or self._random_code
        self._lock = threading.Lock()
        self._codes: dict[str, dict[str, Any]] = {}
        self._active: dict[str, str] = {}

    @property
    def ttl_seconds(self) -> int:
        return self._ttl

    def _random_code(self) -> str:
        while True:
            code = f"{secrets.randbelow(10 ** OTP_DIGITS):0{OTP_DIGITS}d}"
            if code not in self._reserved:
                return code

    @staticmethod
    def _digest(code: str) -> str:
        return hashlib.sha256(code.encode("ascii")).hexdigest()

    def _key(self, kind: str, value: str) -> str:
        return f"{self._prefix}:{kind}:{value}"

    def _issued(self, code: str, created_at: float, candidate_id: str) -> dict[str, Any]:
        return {
            "otp": code,
            "candidate_id": candidate_id,
            "created_at": _iso(created_at),
            "expires_at": _iso(created_at + self._ttl),
            "expires_in_seconds": self._ttl,
        }

    def issue(self, candidate_id: str) -> dict[str, Any]:
        """Issue one code for a customer, replacing that customer's active code."""
        for _ in range(10):
            now = self._clock()
            code = self._code_factory()
            if len(code) != OTP_DIGITS or not code.isascii() or not code.isdigit():
                raise ValueError(f"OTP generator must return exactly {OTP_DIGITS} ASCII digits")
            if code in self._reserved:
                raise ValueError("OTP generator returned a reserved test access code")
            digest = self._digest(code)
            if self._redis is not None:
                created = self._redis.eval(
                    _ISSUE,
                    2,
                    self._key("active", candidate_id),
                    self._key("code", digest),
                    candidate_id,
                    self._ttl,
                )
                if int(created) == 1:
                    return self._issued(code, now, candidate_id)
                continue
            with self._lock:
                if digest in self._codes:
                    continue
                previous = self._active.get(candidate_id)
                if previous:
                    self._codes.pop(previous, None)
                self._codes[digest] = {
                    "candidate_id": candidate_id,
                    "expires_at": now + self._ttl,
                    "consumed": False,
                }
                self._active[candidate_id] = digest
                return self._issued(code, now, candidate_id)
        raise RuntimeError("could not allocate a unique OTP")

    @staticmethod
    def _text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode("utf-8")
        return str(value)

    def verify(self, code: str, required_owner: str = "") -> tuple[str, str]:
        """Consume a code and say whose it was.

        With required_owner empty the code identifies the customer: any live code
        verifies and returns its owner. With required_owner set, a code issued to
        someone else returns wrong_customer and is NOT consumed.

        Returns (status, owner); status is test_verified, verified, consumed, expired,
        wrong_customer or invalid. owner is "" when the code is unknown.
        """
        for reserved, owner in self._reserved.items():
            if secrets.compare_digest(code, reserved):
                if required_owner and owner != required_owner:
                    return "wrong_customer", owner
                return "test_verified", owner
        if len(code) != OTP_DIGITS or not code.isascii() or not code.isdigit():
            return "invalid", ""
        digest = self._digest(code)
        if self._redis is not None:
            code_key = self._key("code", digest)
            consumed_key = self._key("consumed", digest)
            owner = self._text(self._redis.get(code_key))
            if not owner:
                consumed_by = self._text(self._redis.get(consumed_key))
                if not consumed_by:
                    return "invalid", ""
                if required_owner and consumed_by != required_owner:
                    return "wrong_customer", consumed_by
                return "consumed", consumed_by
            if required_owner and owner != required_owner:
                return "wrong_customer", owner
            # The Lua script re-checks the owner atomically, so a concurrent
            # consume or re-issue between the GET above and here is still safe.
            result = int(
                self._redis.eval(
                    _CONSUME,
                    3,
                    code_key,
                    consumed_key,
                    self._key("active", owner),
                    owner,
                )
            )
            if result == 0:
                return "invalid", ""
            return {1: "verified", 2: "consumed", 3: "wrong_customer"}[result], owner
        with self._lock:
            record = self._codes.get(digest)
            if record is None:
                return "invalid", ""
            owner = record["candidate_id"]
            if required_owner and owner != required_owner:
                return "wrong_customer", owner
            if record["consumed"]:
                return "consumed", owner
            if self._clock() > record["expires_at"]:
                self._codes.pop(digest, None)
                if self._active.get(owner) == digest:
                    self._active.pop(owner, None)
                return "expired", owner
            record["consumed"] = True
            if self._active.get(owner) == digest:
                self._active.pop(owner, None)
            return "verified", owner

    def verify_for(self, code: str, candidate_id: str) -> str:
        """Consume a code only if it belongs to candidate_id (status only)."""
        return self.verify(code, candidate_id)[0]
