"""Example 35 verification tool pack (route /mcp/ex35-auth-ladder, console /ex35-otp)."""

from __future__ import annotations

import logging
import os
import time
from typing import Annotated, Any, Callable, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .service import AuthLadderService, Ex35Error
from .ui import PREFIX, OtpConsoleApp

logger = logging.getLogger("shared_mcp.ex35_auth_ladder")

_SERVICE: AuthLadderService | None = None


def get_service() -> AuthLadderService:
    """One service per process, shared by the MCP tools and the OTP console."""
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = AuthLadderService.from_environment()
    return _SERVICE


CallId = Annotated[
    str,
    Field(description="The exact call_id returned by start_call. Never invent or change it."),
]
NewDigits = Annotated[
    str,
    Field(
        min_length=1,
        max_length=120,
        description=(
            "Only the digits the caller said in their LAST turn, as heard. "
            "Never repeat digits already sent: this tool remembers them."
        ),
    ),
]
Birthday = Annotated[
    str,
    Field(max_length=120, description="The date of birth exactly as heard, e.g. 'April sixteenth'. Month and day are enough."),
]


def _run(name: str, call: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        result = call()
    except Ex35Error as refusal:
        result = refusal.payload
    logger.info(
        "ex35 tool=%s ok=%s error=%s ms=%d",
        name,
        result.get("ok"),
        result.get("error"),
        (time.perf_counter() - started) * 1000,
    )
    return result


def register_tools(mcp: FastMCP, service: AuthLadderService) -> None:
    @mcp.tool()
    def start_call(
        customer_id: Annotated[
            str,
            Field(max_length=64, description="Leave empty. Empty starts the call for the default customer the bank is calling."),
        ] = "",
    ) -> dict[str, Any]:
        """Open this call's verification session. Call once, silently, at the start. Returns call_id, customer_id and calling_name (the customer this call is for) and which verifications are passed, locked and available."""
        return _run("start_call", lambda: service.start_call(customer_id))

    @mcp.tool()
    def verify_identity(
        call_id: CallId,
        method: Annotated[
            Literal["kba", "identity"],
            Field(
                description=(
                    "kba: the customer is preset by this call and cannot be changed. "
                    "identity: the customer the caller picked from find_customer."
                )
            ),
        ],
        customer_id: Annotated[
            str,
            Field(
                max_length=64,
                description=(
                    "Whose date of birth to check. kba: the call's customer_id from start_call or "
                    "get_auth_status. identity: the customer_id the caller picked."
                ),
            ),
        ],
        date_of_birth: Birthday,
    ) -> dict[str, Any]:
        """Birthday check used by both the KBA check (preset customer) and the identity check (customer found by name). Checks the month and day of birth."""
        return _run("verify_identity", lambda: service.verify_identity(call_id, method, customer_id, date_of_birth))

    @mcp.tool()
    def verify_access_code(call_id: CallId, digits: NewDigits) -> dict[str, Any]:
        """OTP verification: the 8-digit access code generated for this customer on the web page. Call as soon as the caller pauses, even with only part of the code."""
        return _run("verify_access_code", lambda: service.verify_access_code(call_id, digits))

    @mcp.tool()
    def send_sms_code(call_id: CallId) -> dict[str, Any]:
        """SMS verification, step 1: text a 6-digit code to the phone on file for calling_name."""
        return _run("send_sms_code", lambda: service.send_sms_code(call_id))

    @mcp.tool()
    def verify_sms_code(call_id: CallId, digits: NewDigits) -> dict[str, Any]:
        """SMS verification, step 2: check the 6-digit text-message code. Call as soon as the caller pauses."""
        return _run("verify_sms_code", lambda: service.verify_sms_code(call_id, digits))

    @mcp.tool()
    def get_auth_status(call_id: CallId) -> dict[str, Any]:
        """Which verifications this call has passed, which are locked and which are still available."""
        return _run("get_auth_status", lambda: service.get_auth_status(call_id))

    @mcp.tool()
    def end_call(
        call_id: CallId,
        outcome: Annotated[
            str,
            Field(max_length=120, description="Short outcome, e.g. 'completed' or 'caller_ended'."),
        ],
    ) -> dict[str, Any]:
        """Record the end of the call. No tool works on this call afterwards."""
        return _run("end_call", lambda: service.end_call(call_id, outcome))


def register(mcp: FastMCP) -> None:
    register_tools(mcp, get_service())


def build_http_routes(name_search: Callable[[str], list[str]] | None = None) -> dict[str, Any]:
    """The customer OTP console, served by the host at /ex35-otp.

    name_search, when given, adds phonetic "sounds like" suggestions to the picker.
    """
    token = os.getenv("EX35_OTP_ADMIN_TOKEN", "").strip() or None
    return {PREFIX: OtpConsoleApp(get_service(), admin_token=token, name_search=name_search)}
