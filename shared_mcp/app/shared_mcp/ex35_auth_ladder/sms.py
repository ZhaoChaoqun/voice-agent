"""Real text messages for Example 35's SMS check, through Twilio's REST API.

No SDK: one HTTPS form POST to the Messages resource. Configuration comes only from
the environment, so nothing secret lives in the image or the repo:

- TWILIO_ACCOUNT_SID                       account that sends (AC...)
- TWILIO_AUTH_TOKEN, or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET
- TWILIO_SMS_FROM (an SMS-capable number in E.164) or TWILIO_MESSAGING_SERVICE_SID
- EX35_SMS_TO                              the one demo phone that receives every
                                           code; the customers are fictional, so
                                           their numbers on file are not real

When any of these is missing the service keeps the simulated sender: the code is
not delivered and the test text-message code is the way to pass.
"""

from __future__ import annotations

import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

TWILIO_API = "https://api.twilio.com/2010-04-01"
_E164 = re.compile(r"^\+[1-9]\d{7,14}$")
_SID = re.compile(r"^(AC|SK|MG)[0-9a-fA-F]{32}$")


class SmsSendError(RuntimeError):
    """Twilio refused or could not be reached; carries no secret."""


def mask_phone(number: str) -> str:
    digits = re.sub(r"\D", "", number)
    if number.startswith("+1") and len(digits) == 11:
        return f"+1 ({digits[1:4]}) ***-{digits[-4:]}"
    return f"+{digits[:-4][:3]}***{digits[-4:]}"


class TwilioSms:
    def __init__(
        self,
        account_sid: str,
        username: str,
        password: str,
        to_number: str,
        *,
        from_number: str = "",
        messaging_service_sid: str = "",
        timeout_seconds: float = 4.0,
        opener: Callable[..., Any] | None = None,
    ) -> None:
        if not _SID.fullmatch(account_sid) or not account_sid.startswith("AC"):
            raise ValueError("TWILIO_ACCOUNT_SID must look like AC followed by 32 hex digits")
        if not _E164.fullmatch(to_number):
            raise ValueError("EX35_SMS_TO must be an E.164 number such as +14255550100")
        if from_number and not _E164.fullmatch(from_number):
            raise ValueError("TWILIO_SMS_FROM must be an E.164 number")
        if messaging_service_sid and not (
            _SID.fullmatch(messaging_service_sid) and messaging_service_sid.startswith("MG")
        ):
            raise ValueError("TWILIO_MESSAGING_SERVICE_SID must look like MG followed by 32 hex digits")
        if not (from_number or messaging_service_sid):
            raise ValueError("set TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID")
        self._account_sid = account_sid
        self._auth = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
        self._to = to_number
        self._from = from_number
        self._service = messaging_service_sid
        self._timeout = timeout_seconds
        self._open = opener or urllib.request.urlopen

    @property
    def to_masked(self) -> str:
        return mask_phone(self._to)

    @classmethod
    def from_environment(cls, env: dict[str, str] | None = None) -> "TwilioSms | None":
        env = os.environ if env is None else env
        get = lambda name: (env.get(name) or "").strip()  # noqa: E731
        account = get("TWILIO_ACCOUNT_SID")
        to_number = get("EX35_SMS_TO")
        if get("TWILIO_API_KEY_SID") and get("TWILIO_API_KEY_SECRET"):
            username, password = get("TWILIO_API_KEY_SID"), get("TWILIO_API_KEY_SECRET")
        else:
            username, password = account, get("TWILIO_AUTH_TOKEN")
        sender = get("TWILIO_SMS_FROM") or get("TWILIO_MESSAGING_SERVICE_SID")
        if not (account and to_number and password and sender):
            return None
        return cls(
            account,
            username,
            password,
            to_number,
            from_number=get("TWILIO_SMS_FROM"),
            messaging_service_sid=get("TWILIO_MESSAGING_SERVICE_SID"),
        )

    def send(self, body: str) -> str:
        """Send one message; return Twilio's message SID."""
        form = {"To": self._to, "Body": body}
        if self._service:
            form["MessagingServiceSid"] = self._service
        else:
            form["From"] = self._from
        request = urllib.request.Request(
            f"{TWILIO_API}/Accounts/{self._account_sid}/Messages.json",
            data=urllib.parse.urlencode(form).encode("ascii"),
            headers={
                "Authorization": f"Basic {self._auth}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with self._open(request, timeout=self._timeout) as response:
                payload = json.loads(response.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8") or "{}")
            except ValueError:
                detail = {}
            raise SmsSendError(
                f"twilio_http_{error.code}" + (f"_code_{detail['code']}" if detail.get("code") else "")
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise SmsSendError(f"twilio_unreachable_{type(error).__name__}") from None
        sid = str(payload.get("sid") or "")
        if not sid.startswith("SM") and not sid.startswith("MM"):
            raise SmsSendError("twilio_no_message_sid")
        return sid
