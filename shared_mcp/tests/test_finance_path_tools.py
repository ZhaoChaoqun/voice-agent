from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

import test_finance_store_paths as fixtures
from mcp.server.fastmcp.exceptions import ToolError

from shared_mcp.finance_handoff.config import ServerConfig as HandoffConfig
from shared_mcp.finance_handoff.server import build_server as handoff_server
from shared_mcp.finance_otp_officer.config import ServerConfig as OtpConfig
from shared_mcp.finance_otp_officer.server import build_server as otp_server
from shared_mcp.finance_otp_officer.server import build_service as otp_service


class FinancePathToolTests(unittest.TestCase):
    def test_registered_read_and_write_tools_reject_sibling_session(self):
        for fixture, config_type, build_server, state_env, id_field, write_tool in (
            (fixtures.HandoffStorePathTests, HandoffConfig, handoff_server,
             "FINANCE_MCP_STATE_DIR", "call_id", "auto_assign_loan_officer"),
            (fixtures.OtpStorePathTests, OtpConfig, otp_server,
             "FINANCE_OTP_MCP_STATE_DIR", "session_id", "auto_assign_loan_officer"),
        ):
            with self.subTest(pack=id_field):
                with tempfile.TemporaryDirectory(
                    dir=Path(__file__).resolve().parents[1]
                ) as directory:
                    root = Path(directory)
                    archive = root / "archive"
                    fixture.store_type(archive).create(fixture.session("fixture-id"))
                    original = (archive / "fixture-id.json").read_bytes()
                    config = config_type.from_environment({
                        state_env: str(root / "active"),
                        "FINANCE_OTP_MCP_AUTH_DIR": str(root / "auth"),
                    })
                    server = build_server(config)
                    for name in ("get_call_state", write_tool):
                        with self.assertRaisesRegex(ToolError, "invalid_identifier"):
                            asyncio.run(server.call_tool(
                                name, {id_field: "../archive/fixture-id"}
                            ))
                        self.assertEqual(
                            original, (archive / "fixture-id.json").read_bytes()
                        )

    def test_generated_ids_remain_usable_through_registered_tools(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).resolve().parents[1]
        ) as directory:
            root = Path(directory)
            config = HandoffConfig.from_environment({
                "FINANCE_MCP_STATE_DIR": str(root / "handoff")
            })
            server = handoff_server(config)
            _, started = asyncio.run(server.call_tool("start_call", {}))
            _, result = asyncio.run(server.call_tool(
                "get_call_state", {"call_id": started["call_id"]}
            ))
            self.assertTrue(result["ok"])

            config = OtpConfig.from_environment({
                "FINANCE_OTP_MCP_STATE_DIR": str(root / "otp"),
                "FINANCE_OTP_MCP_AUTH_DIR": str(root / "auth"),
            })
            server = otp_server(config)
            # Persist a server-generated ID without invoking OTP transport context.
            service = otp_service(config)
            started = service.start_call(
                config.caller_id, config.directory_id, "start",
                config.routing_persona_ref,
            )
            _, result = asyncio.run(server.call_tool(
                "get_call_state", {"session_id": started["session_id"]}
            ))
            self.assertTrue(result["ok"])
