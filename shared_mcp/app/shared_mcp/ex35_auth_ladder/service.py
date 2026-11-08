"""Example 35 verification service: four independent caller verifications.

A hub node lets the caller choose a verification; each one returns to the hub
and, when it succeeds, adds its flag to the session:

- identity: the caller says their name (searched elsewhere), picks themselves
  from the candidates and gives the month and day of birth;
- kba: the bank already knows whom it is calling and checks only the birthday;
- otp: the caller reads an 8-digit access code issued on the /ex35-otp page;
- sms: the caller reads a 6-digit code texted to the phone on file.

The backend owns every decision. The Agent only relays what the caller said;
this service normalizes it, counts attempts and locks a verification after too
many failures.
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Any, Callable, Iterator

from .otp import OtpStore
from .sms import SmsSendError, TwilioSms

logger = logging.getLogger("shared_mcp.ex35_auth_ladder")

# The /otp console's fictional customer directory: names, dates of birth, default customer.
DIRECTORY_FILE = Path(__file__).with_name("otp_candidates.json")
# Fictional bank accounts for the same customers, plus the permanent test codes.
ACCOUNTS_FILE = Path(__file__).with_name("customers.json")
# The 20K-name directory as extra fictional customers (build_bulk_customers.py).
BULK_FILE = Path(__file__).with_name("bulk_customers.json")
#: Customers returned per page by the console's directory search.
DIRECTORY_PAGE_LIMIT = 100

METHODS = ("identity", "kba", "otp", "sms")
ACCESS_CODE_DIGITS = 8
SMS_CODE_DIGITS = 6
MAX_ATTEMPTS = 3
MAX_SMS_SENDS = 3
SMS_TTL_SECONDS = 300
SESSION_TTL_SECONDS = 4 * 60 * 60
CALL_ID_PATTERN = re.compile(r"^ex35-[0-9a-f]{12}$")


class Ex35Error(Exception):
    """A caller-safe refusal returned to the Agent as a tool result."""

    def __init__(self, error: str, **details: Any) -> None:
        super().__init__(error)
        self.payload = {"ok": False, "error": error, **details}


# ---------------------------------------------------------------- normalizers

_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7,
    "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9,
    "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}
_UNITS = {
    "zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19,
}
_ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
    "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
    "eleventh": 11, "twelfth": 12, "thirteenth": 13, "fourteenth": 14,
    "fifteenth": 15, "sixteenth": 16, "seventeenth": 17,
    "eighteenth": 18, "nineteenth": 19, "twentieth": 20, "thirtieth": 30,
}
_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
}
_DIGIT_WORDS = {
    "zero": "0", "oh": "0", "o": "0", "one": "1", "two": "2",
    "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
    "eight": "8", "nine": "9",
}


def _spoken_numbers(text: str) -> tuple[int | None, list[int]]:
    """Return the first month name and the numbers spoken around it."""
    month: int | None = None
    values: list[tuple[int, str]] = []  # (value, kind) kind: digit|unit|tens|ord
    for token in re.findall(r"[a-z]+|\d+", text):
        if token in _MONTHS and month is None:
            month = _MONTHS[token]
        elif token.isdigit():
            values.append((int(token), "digit"))
        elif token in _ORDINALS:
            values.append((_ORDINALS[token], "ord"))
        elif token in _UNITS:
            values.append((_UNITS[token], "unit"))
        elif token in _TENS:
            values.append((_TENS[token], "tens"))
        elif token == "thousand":
            values.append((1000, "thousand"))

    combined: list[tuple[int, str]] = []
    index = 0
    while index < len(values):
        value, kind = values[index]
        following = values[index + 1] if index + 1 < len(values) else None
        if kind == "tens" and following and following[1] in {"unit", "ord"} and following[0] < 10:
            combined.append((value + following[0], "word"))
            index += 2
            continue
        if following and following[1] == "thousand":
            rest = values[index + 2] if index + 2 < len(values) else None
            year = value * 1000
            if rest and rest[1] != "thousand" and rest[0] < 100:
                year += rest[0]
                index += 3
            else:
                index += 2
            combined.append((year, "year"))
            continue
        combined.append((value, "word" if kind != "digit" else "digit"))
        index += 1

    numbers: list[int] = []
    index = 0
    while index < len(combined):
        value, kind = combined[index]
        following = combined[index + 1] if index + 1 < len(combined) else None
        # "nineteen eighty-eight" -> 1988
        if (
            kind == "word"
            and value in {19, 20}
            and following is not None
            and following[1] == "word"
            and 0 <= following[0] < 100
        ):
            numbers.append(value * 100 + following[0])
            index += 2
            continue
        numbers.append(value)
        index += 1
    return month, numbers


def parse_spoken_date(raw: str) -> tuple[int | None, int | None, int | None]:
    """Parse a spoken or typed birthday into (year, month, day); parts may be None."""
    text = (raw or "").strip().lower()
    if not text:
        return None, None, None
    text = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", text)

    for pattern, order in (
        (r"\b(\d{4})[-/.年 ](\d{1,2})[-/.月 ](\d{1,2})", "ymd"),
        (r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", "mdy"),
    ):
        match = re.search(pattern, text)
        if match:
            first, second, third = (int(group) for group in match.groups())
            year, month, day = (first, second, third) if order == "ymd" else (third, first, second)
            return _checked(year, month, day)
    chinese = re.search(r"(\d{1,2})月(\d{1,2})", text)
    if chinese:
        year_match = re.search(r"(\d{4})年", text)
        return _checked(
            int(year_match.group(1)) if year_match else None,
            int(chinese.group(1)),
            int(chinese.group(2)),
        )
    month_day = re.fullmatch(r"\s*(\d{1,2})/(\d{1,2})\s*", text)
    if month_day:
        return _checked(None, int(month_day.group(1)), int(month_day.group(2)))

    month, numbers = _spoken_numbers(text)
    year = next((n for n in numbers if 1900 <= n <= 2099), None)
    remaining = [n for n in numbers if n != year]
    day = next((n for n in remaining if 1 <= n <= 31), None)
    return _checked(year, month, day)


def _checked(year: int | None, month: int | None, day: int | None) -> tuple[int | None, int | None, int | None]:
    if month is not None and not 1 <= month <= 12:
        month = None
    if day is not None and not 1 <= day <= 31:
        day = None
    if year is not None and not 1900 <= year <= 2099:
        year = None
    return year, month, day


def normalize_spoken_digits(raw: str) -> str:
    """Turn '1 2 3 4', 'one two three four', 'double five' or '1234-5678' into digits."""
    tokens = re.findall(r"[a-z]+|\d", (raw or "").lower())
    digits: list[str] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token in {"double", "triple"} and index + 1 < len(tokens):
            following = tokens[index + 1]
            digit = following if following.isdigit() else _DIGIT_WORDS.get(following, "")
            if digit:
                digits.append(digit * (2 if token == "double" else 3))
                index += 2
                continue
        if token.isdigit():
            digits.append(token)
        elif token in _DIGIT_WORDS:
            digits.append(_DIGIT_WORDS[token])
        index += 1
    return "".join(digits)


def _name_words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _generated_account(candidate_id: str) -> dict[str, Any]:
    """Fictional banking details for a generated customer, fixed by its id."""
    seed = int(hashlib.sha256(candidate_id.encode("utf-8")).hexdigest(), 16)
    return {
        "credit_tier": ("excellent", "good", "fair")[seed % 3],
        "customer_since": f"{2005 + (seed >> 4) % 21:04d}-{1 + (seed >> 12) % 12:02d}-{1 + (seed >> 16) % 28:02d}",
        "account_type": ("Everyday Checking", "Premier Checking", "Student Checking")[(seed >> 24) % 3],
        "account_masked": f"****-****-{(seed >> 28) % 10000:04d}",
        "balances_usd": {
            "checking": round((seed >> 44) % 3_000_000 / 100, 2),
            "savings": round((seed >> 72) % 12_000_000 / 100, 2),
        },
    }


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------- stores

class MemorySessionStore:
    """Single-process store for local runs and tests."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._documents: dict[str, dict[str, Any]] = {}

    def create(self, session: dict[str, Any]) -> None:
        with self._lock:
            self._documents[session["call_id"]] = copy.deepcopy(session)

    @contextmanager
    def edit(self, call_id: str) -> Iterator[dict[str, Any] | None]:
        with self._lock:
            session = copy.deepcopy(self._documents.get(call_id))
            yield session
            if session is not None:
                self._documents[call_id] = session


class RedisSessionStore:
    """Cross-replica store: one JSON document per call, edited under a Redis lock."""

    def __init__(self, client: Any, key_prefix: str, ttl_seconds: int = SESSION_TTL_SECONDS) -> None:
        self._client = client
        self._prefix = key_prefix.rstrip(":")
        self._ttl = ttl_seconds

    def _key(self, call_id: str) -> str:
        return f"{self._prefix}:session:{call_id}"

    def create(self, session: dict[str, Any]) -> None:
        self._client.set(self._key(session["call_id"]), json.dumps(session), ex=self._ttl, nx=True)

    @contextmanager
    def edit(self, call_id: str) -> Iterator[dict[str, Any] | None]:
        with self._client.lock(f"{self._prefix}:lock:{call_id}", timeout=10, blocking_timeout=5):
            raw = self._client.get(self._key(call_id))
            session = json.loads(raw) if raw else None
            yield session
            if session is not None:
                self._client.set(self._key(call_id), json.dumps(session), ex=self._ttl)


def _redis_from_environment() -> tuple[Any, str] | None:
    """The no-auth host's shared Redis and this pack's key prefix, when configured."""
    url = (os.getenv("EX35_AUTH_LADDER_REDIS_URL") or os.getenv("NOAUTH_MCP_REDIS_URL") or "").strip()
    if not url:
        return None
    import redis  # imported lazily so local runs need no Redis package

    password = (
        os.getenv("EX35_AUTH_LADDER_REDIS_PASSWORD")
        or os.getenv("NOAUTH_MCP_REDIS_PASSWORD")
        or ""
    ).strip() or None
    base = (os.getenv("NOAUTH_MCP_REDIS_KEY_PREFIX") or "voice-agent:noauth").strip().rstrip(":")
    client = redis.Redis.from_url(
        url,
        password=password,
        socket_connect_timeout=3.0,
        socket_timeout=3.0,
        decode_responses=True,
    )
    return client, f"{base}:ex35-auth-ladder"


# --------------------------------------------------------------------- service

class AuthLadderService:
    def __init__(
        self,
        store: MemorySessionStore | RedisSessionStore | None = None,
        *,
        otp_store: OtpStore | None = None,
        directory_file: Path = DIRECTORY_FILE,
        accounts_file: Path = ACCOUNTS_FILE,
        bulk_file: Path | None = BULK_FILE,
        clock: Callable[[], float] = time.time,
        sms_sender: TwilioSms | None = None,
    ) -> None:
        directory = json.loads(Path(directory_file).read_text(encoding="utf-8"))
        banking = json.loads(Path(accounts_file).read_text(encoding="utf-8"))
        if directory.get("fixture") != "fictional" or banking.get("fixture") != "fictional":
            raise ValueError("Example 35 data must be fictional fixtures")
        accounts = banking["accounts"]
        self._customers: dict[str, dict[str, Any]] = {}
        for item in directory["candidates"]:
            candidate_id = item["candidate_id"]
            if candidate_id not in accounts:
                raise ValueError(f"no fictional account for {candidate_id}")
            date.fromisoformat(item["date_of_birth"])
            self._customers[candidate_id] = {**item, **accounts[candidate_id]}
        # The customer an outbound call is placed to; kba checks this person.
        self._default_candidate_id = str(directory["default_candidate_id"])
        curated = list(self._customers)
        bulk = self._load_bulk(Path(bulk_file)) if bulk_file is not None else []
        # Console order: the default customer, the curated customers, then the rest by name.
        self._order = [
            self._default_candidate_id,
            *(cid for cid in curated if cid != self._default_candidate_id),
            *sorted(bulk, key=lambda cid: self._customers[cid]["full_name"].lower()),
        ]
        self._search_rows = [
            (cid, " ".join(_name_words(self._customers[cid]["full_name"])), _name_words(self._customers[cid]["full_name"]))
            for cid in self._order
        ]
        self._reserved_access_codes = dict(banking["reserved_access_codes"])
        for candidate_id in (self._default_candidate_id, *self._reserved_access_codes.values()):
            if candidate_id not in self._customers:
                raise ValueError(f"unknown customer in Example 35 data: {candidate_id}")
        self._reserved_sms_code = str(banking["reserved_sms_code"])
        self._store = store or MemorySessionStore()
        self._otp = otp_store or OtpStore(self._reserved_access_codes, clock=clock)
        self._clock = clock
        # None: simulated texts (nothing delivered; the test code passes).
        self._sms = sms_sender

    def _load_bulk(self, path: Path) -> list[str]:
        """Add the generated customers; returns their ids."""
        document = json.loads(path.read_text(encoding="utf-8"))
        if document.get("fixture") != "fictional":
            raise ValueError("Example 35 data must be fictional fixtures")
        fields = document["fields"]
        names = {customer["full_name"].lower() for customer in self._customers.values()}
        added: list[str] = []
        for row in document["rows"]:
            item = dict(zip(fields, row))
            candidate_id = item["candidate_id"]
            if candidate_id in self._customers or item["full_name"].lower() in names:
                raise ValueError(f"duplicate Example 35 customer: {candidate_id} {item['full_name']}")
            names.add(item["full_name"].lower())
            date.fromisoformat(item["date_of_birth"])
            self._customers[candidate_id] = {**item, **_generated_account(candidate_id)}
            added.append(candidate_id)
        return added

    @classmethod
    def from_environment(cls) -> "AuthLadderService":
        try:
            sms_sender = TwilioSms.from_environment()
        except ValueError as error:
            # A bad SMS setting must not take the other checks down.
            logger.warning("ex35 sms disabled: %s", error)
            sms_sender = None
        shared = _redis_from_environment()
        if shared is None:
            return cls(sms_sender=sms_sender)
        client, prefix = shared
        service = cls(store=RedisSessionStore(client, prefix), sms_sender=sms_sender)
        service._otp = OtpStore(service._reserved_access_codes, redis_client=client, key_prefix=prefix)
        return service

    # ------------------------------------------------------------ helpers

    def _new_session(self, candidate_id: str) -> dict[str, Any]:
        now = round(self._clock(), 3)
        return {
            "call_id": f"ex35-{secrets.token_hex(6)}",
            "candidate_id": candidate_id,
            "passed": [],
            "identity": {"attempts": 0, "locked": False},
            "kba": {"attempts": 0, "locked": False},
            "otp": {"attempts": 0, "locked": False, "buffer": ""},
            "sms": {
                "attempts": 0,
                "locked": False,
                "buffer": "",
                "sends": 0,
                "digest": None,
                "expires_at": None,
            },
            "ended": False,
            "outcome": None,
            "events": [],
            "created_at": now,
            "updated_at": now,
        }

    def _event(self, session: dict[str, Any], name: str, **details: Any) -> None:
        session["events"] = [
            *session["events"][-29:],
            {"at": round(self._clock(), 3), "event": name, **details},
        ]
        session["updated_at"] = round(self._clock(), 3)

    @contextmanager
    def _session(self, call_id: str) -> Iterator[dict[str, Any]]:
        call_id = (call_id or "").strip()
        if not CALL_ID_PATTERN.fullmatch(call_id):
            raise Ex35Error("unknown_call", next_step="Use the exact call_id returned by start_call.")
        refusal: Ex35Error | None = None
        with self._store.edit(call_id) as session:
            if session is None or "passed" not in session:
                raise Ex35Error("unknown_call", next_step="Use the exact call_id returned by start_call.")
            if session["ended"]:
                raise Ex35Error("call_ended", outcome=session["outcome"])
            try:
                yield session
            except Ex35Error as error:
                # A refusal still persists counted attempts and lockouts.
                refusal = error
        if refusal is not None:
            raise refusal

    def _status(self, session: dict[str, Any]) -> dict[str, Any]:
        passed = [method for method in METHODS if method in session["passed"]]
        locked = [method for method in METHODS if session[method]["locked"] and method not in passed]
        return {
            "call_id": session["call_id"],
            "customer_id": session["candidate_id"],
            "calling_name": self._customer(session)["full_name"],
            "passed": passed,
            "locked_methods": locked,
            "available": [method for method in METHODS if method not in passed and method not in locked],
        }

    def _customer(self, session: dict[str, Any]) -> dict[str, Any]:
        return self._customers[session["candidate_id"]]

    def _open(self, session: dict[str, Any], method: str) -> dict[str, Any] | None:
        """Already-passed result, a lock refusal, or None when the method can run."""
        if method in session["passed"]:
            return {"ok": True, "status": "already_verified", "method": method, **self._status(session)}
        if session[method]["locked"]:
            raise Ex35Error(f"{method}_locked", method=method, **self._status(session))
        return None

    def _remaining(self, session: dict[str, Any], method: str) -> int:
        return MAX_ATTEMPTS - session[method]["attempts"]

    def _fail(self, session: dict[str, Any], method: str, error: str, **details: Any) -> None:
        state = session[method]
        state["attempts"] += 1
        state["locked"] = state["attempts"] >= MAX_ATTEMPTS
        self._event(
            session, f"{method}_failed", attempts=state["attempts"],
            **{k: v for k, v in details.items() if k != "next_step"},
        )
        raise Ex35Error(
            error,
            method=method,
            attempts_remaining=self._remaining(session, method),
            locked=state["locked"],
            **{k: v for k, v in details.items() if k in {"code_status", "next_step"}},
            **self._status(session),
        )

    def _pass(self, session: dict[str, Any], method: str, **details: Any) -> dict[str, Any]:
        session["passed"] = [m for m in METHODS if m in session["passed"] or m == method]
        self._event(session, f"{method}_verified", **details)
        return {"ok": True, "status": "verified", "method": method, **self._status(session)}

    def _month_day(self, session: dict[str, Any], method: str, spoken: str) -> tuple[int, int]:
        _, month, day = parse_spoken_date(spoken)
        if month is None or day is None:
            raise Ex35Error(
                "date_not_understood",
                method=method,
                attempts_remaining=self._remaining(session, method),
                next_step="This did not cost an attempt. Ask for the month and day of birth again.",
            )
        return month, day

    def _birthday_matches(self, candidate_id: str, month: int, day: int) -> bool:
        # Only the month and day are checked; a spoken year is ignored.
        on_file = date.fromisoformat(self._customers[candidate_id]["date_of_birth"])
        return (month, day) == (on_file.month, on_file.day)

    def _collect(self, session: dict[str, Any], method: str, spoken: str, length: int) -> str | dict[str, Any]:
        """Accumulate spoken digits across turns; return the full code or an incomplete result."""
        state = session[method]
        heard = normalize_spoken_digits(spoken)
        if not heard:
            raise Ex35Error("no_digits_heard", method=method, attempts_remaining=self._remaining(session, method))
        collected = state["buffer"] + heard
        if len(collected) > length:
            state["buffer"] = ""
            raise Ex35Error(
                "too_many_digits",
                method=method,
                attempts_remaining=self._remaining(session, method),
                next_step=f"This did not cost an attempt. Ask for all {length} digits again from the start.",
            )
        if len(collected) < length:
            state["buffer"] = collected
            return {
                "ok": False,
                "status": "incomplete",
                "method": method,
                "digits_collected": len(collected),
                "digits_missing": length - len(collected),
                "attempts_remaining": self._remaining(session, method),
                "next_step": "This did not cost an attempt. Ask for the remaining digits. Next time pass only the new digits.",
            }
        state["buffer"] = ""
        return collected

    @staticmethod
    def _profile(customer: dict[str, Any]) -> dict[str, Any]:
        keys = (
            "candidate_id", "full_name", "date_of_birth", "credit_tier", "customer_since", "state",
            "phone_masked", "account_type", "account_masked", "balances_usd",
        )
        return {key: customer[key] for key in keys} | {"fixture": "fictional"}

    # ------------------------------------------------------- OTP console

    def otp_directory(self) -> dict[str, Any]:
        """Console facts that do not depend on a search."""
        return {
            "fixture": "fictional",
            "default_candidate_id": self._default_candidate_id,
            "total_customers": len(self._order),
            "test_codes": [
                {"code": code, "candidate_id": owner, "full_name": self._customers[owner]["full_name"]}
                for code, owner in self._reserved_access_codes.items()
            ],
            "test_sms_code": self._reserved_sms_code,
            "access_code_ttl_seconds": self._otp.ttl_seconds,
        }

    def _summary(self, candidate_id: str) -> dict[str, Any]:
        customer = self._customers[candidate_id]
        return {"candidate_id": candidate_id, "full_name": customer["full_name"], "state": customer["state"]}

    def search_directory(self, query: str = "", offset: int = 0, limit: int = 50) -> dict[str, Any]:
        """One page of customers whose name matches what was typed, by spelling.

        Empty text lists everyone in console order. Otherwise a name that starts with
        the text ranks first, then names where every typed word starts a name word,
        then names that contain the text.
        """
        words = _name_words(query or "")[:6]
        offset = max(0, int(offset))
        limit = max(1, min(int(limit), DIRECTORY_PAGE_LIMIT))
        if not words:
            ids = self._order
        else:
            text = " ".join(words)
            ranked: list[tuple[int, int, str]] = []
            for position, (candidate_id, name, name_words) in enumerate(self._search_rows):
                if name.startswith(text):
                    rank = 0
                elif all(any(part.startswith(word) for part in name_words) for word in words):
                    rank = 1
                elif text in name:
                    rank = 2
                else:
                    continue
                ranked.append((rank, position, candidate_id))
            ranked.sort()
            ids = [candidate_id for *_, candidate_id in ranked]
        return {
            "query": query or "",
            "total": len(ids),
            "offset": offset,
            "customers": [self._summary(candidate_id) for candidate_id in ids[offset : offset + limit]],
        }

    def customer_summaries(self, candidate_ids: list[str]) -> list[dict[str, Any]]:
        return [self._summary(cid) for cid in candidate_ids if cid in self._customers]

    def customer_profile(self, candidate_id: str) -> dict[str, Any]:
        customer = self._customers.get(candidate_id)
        if customer is None:
            raise LookupError(candidate_id)
        return self._profile(customer)

    def issue_access_code(self, candidate_id: str) -> dict[str, Any]:
        customer = self._customers.get(candidate_id)
        if customer is None:
            raise LookupError(candidate_id)
        return {**self._otp.issue(candidate_id), "customer": self._profile(customer)}

    # -------------------------------------------------------------- tools

    def start_call(self, customer_id: str = "") -> dict[str, Any]:
        candidate_id = (customer_id or "").strip() or self._default_candidate_id
        if candidate_id not in self._customers:
            raise Ex35Error("unknown_customer", next_step="Omit customer_id to use the default customer.")
        session = self._new_session(candidate_id)
        self._event(session, "call_started", candidate_id=candidate_id)
        self._store.create(session)
        # Only the name: the date of birth and codes are what the caller must supply.
        return {"ok": True, **self._status(session)}

    def verify_identity(self, call_id: str, method: str, customer_id: str, date_of_birth: str) -> dict[str, Any]:
        """Check one customer's month and day of birth, for both birthday checks.

        kba: the customer is preset by the call (customer_id from start_call) and
        cannot be changed. identity: the customer the caller picked from
        find_customer; it binds the call to them while nothing has passed yet.
        """
        method = (method or "").strip().lower()
        if method not in {"kba", "identity"}:
            raise Ex35Error("invalid_method", next_step="Use method 'kba' or 'identity'.")
        with self._session(call_id) as session:
            done = self._open(session, method)
            if done:
                return done
            candidate_id = (customer_id or "").strip()
            if candidate_id not in self._customers:
                raise Ex35Error(
                    "unknown_customer",
                    method=method,
                    next_step="Use customer_id from start_call for kba, or from find_customer for identity.",
                )
            if method == "kba" and candidate_id != session["candidate_id"]:
                # The preset customer cannot change; this costs no attempt.
                raise Ex35Error(
                    "customer_fixed",
                    method="kba",
                    **self._status(session),
                    next_step="KBA checks only the customer this call is for: use customer_id from get_auth_status.",
                )
            if method == "identity" and session["passed"] and candidate_id != session["candidate_id"]:
                raise Ex35Error(
                    "different_customer",
                    method="identity",
                    **self._status(session),
                    next_step="This call is already verified for calling_name; identity can only confirm that customer.",
                )
            month, day = self._month_day(session, method, date_of_birth)
            if not self._birthday_matches(candidate_id, month, day):
                # Never say whether the name or the birthday was wrong.
                self._fail(session, method, "identity_not_verified")
            session["candidate_id"] = candidate_id
            return self._pass(session, method, candidate_id=candidate_id)

    def verify_access_code(self, call_id: str, digits: str) -> dict[str, Any]:
        with self._session(call_id) as session:
            done = self._open(session, "otp")
            if done:
                return done
            collected = self._collect(session, "otp", digits, ACCESS_CODE_DIGITS)
            if isinstance(collected, dict):
                return collected
            # The code identifies the customer. While nothing has passed, any live
            # code verifies and binds the call to its owner; once a check has passed,
            # only that customer's code counts and someone else's is not burned.
            bound = session["candidate_id"] if session["passed"] else ""
            status, owner = self._otp.verify(collected, bound)
            if status == "wrong_customer":
                self._fail(
                    session,
                    "otp",
                    "different_customer",
                    code_status="other_customer",
                    next_step="This code belongs to a different customer than the one already verified on this call.",
                )
            if status not in {"verified", "test_verified"}:
                self._fail(
                    session,
                    "otp",
                    "access_code_invalid",
                    code_status=status if status in {"consumed", "expired"} else "invalid",
                )
            session["candidate_id"] = owner
            return self._pass(session, "otp", code_status=status, candidate_id=owner)

    def send_sms_code(self, call_id: str) -> dict[str, Any]:
        with self._session(call_id) as session:
            done = self._open(session, "sms")
            if done:
                return done
            sms = session["sms"]
            if sms["sends"] >= MAX_SMS_SENDS:
                raise Ex35Error("sms_send_limit_reached", method="sms", **self._status(session))
            code = f"{secrets.randbelow(10 ** SMS_CODE_DIGITS):0{SMS_CODE_DIGITS}d}"
            message_sid = ""
            if self._sms is not None:
                body = (
                    f"Contoso Bank demo: your verification code is {code}. "
                    f"It expires in {SMS_TTL_SECONDS // 60} minutes."
                )
                try:
                    message_sid = self._sms.send(body)
                except SmsSendError as error:
                    # Not counted as a send; the code never existed.
                    logger.warning("ex35 sms send failed: %s", error)
                    self._event(session, "sms_send_failed", reason=str(error))
                    raise Ex35Error(
                        "sms_send_failed",
                        method="sms",
                        **self._status(session),
                        next_step="Say the text message could not be sent right now and offer another check.",
                    ) from None
            sms.update(
                sends=sms["sends"] + 1,
                digest=_digest(code),
                expires_at=round(self._clock() + SMS_TTL_SECONDS, 3),
                buffer="",
            )
            # The code is never returned to the Agent.
            self._event(session, "sms_sent", sends=sms["sends"], message_sid=message_sid or None)
            return {
                "ok": True,
                "status": "sent",
                "method": "sms",
                "delivery": "twilio" if message_sid else "simulated",
                "sent_to": self._sms.to_masked if message_sid else self._customer(session)["phone_masked"],
                "code_digits": SMS_CODE_DIGITS,
                "expires_in_seconds": SMS_TTL_SECONDS,
            }

    def verify_sms_code(self, call_id: str, digits: str) -> dict[str, Any]:
        with self._session(call_id) as session:
            done = self._open(session, "sms")
            if done:
                return done
            sms = session["sms"]
            if not sms["digest"]:
                raise Ex35Error("sms_not_sent", method="sms", next_step="Call send_sms_code first.")
            if self._clock() > sms["expires_at"]:
                sms.update(digest=None, buffer="")
                raise Ex35Error("sms_code_expired", method="sms", next_step="Offer to send a new code.")
            collected = self._collect(session, "sms", digits, SMS_CODE_DIGITS)
            if isinstance(collected, dict):
                return collected
            valid = secrets.compare_digest(_digest(collected), sms["digest"]) or secrets.compare_digest(
                collected, self._reserved_sms_code
            )
            if not valid:
                self._fail(session, "sms", "sms_code_invalid")
            sms.update(digest=None, expires_at=None)
            return self._pass(session, "sms")

    def get_auth_status(self, call_id: str) -> dict[str, Any]:
        with self._session(call_id) as session:
            return {"ok": True, **self._status(session)}

    def end_call(self, call_id: str, outcome: str) -> dict[str, Any]:
        with self._session(call_id) as session:
            session["ended"] = True
            session["outcome"] = (outcome or "completed").strip()[:120]
            self._event(session, "call_ended", outcome=session["outcome"])
            return {"ok": True, "status": "ended", **self._status(session)}
