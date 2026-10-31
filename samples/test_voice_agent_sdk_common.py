"""Offline tests for the preview Voice Agent SDK sample helpers."""

from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from voice_agent_definition import materialize_handoff_instruction_inheritance
from voice_agent_sdk_common import (
    EventPrinter,
    _canonical_definition,
    _load_settings,
    _realtime_url,
    _validate_agent_name,
    _validate_project_endpoint,
    load_materialized_agent,
)


class VoiceAgentSdkCommonTests(unittest.TestCase):
    def test_materializes_shared_handoff_instructions_for_publish(self) -> None:
        definition = {
            "instructions": "Shared policy.",
            "handoff": {
                "nodes": [
                    {
                        "id": "billing",
                        "config": {
                            "instructions": "Handle billing.",
                            "inherit_from_base_instructions": True,
                        },
                    },
                    {
                        "id": "support",
                        "config": {
                            "instructions": "Handle support.",
                            "inherit_from_base_instructions": False,
                        },
                    },
                ],
                "edges": [],
            },
        }

        materialize_handoff_instruction_inheritance(definition)

        billing = definition["handoff"]["nodes"][0]["config"]
        support = definition["handoff"]["nodes"][1]["config"]
        self.assertEqual(
            "Shared policy.\n\nHandle billing.",
            billing["instructions"],
        )
        self.assertEqual("Handle support.", support["instructions"])
        self.assertNotIn("inherit_from_base_instructions", billing)
        self.assertNotIn("inherit_from_base_instructions", support)

    def test_validates_project_endpoint_and_agent_name(self) -> None:
        endpoint = "https://account.services.ai.azure.com/api/projects/project"
        self.assertEqual(_validate_project_endpoint(endpoint + "/"), endpoint)
        self.assertEqual(_validate_agent_name("sdk-sample-agent"), "sdk-sample-agent")

        with self.assertRaises(ValueError):
            _validate_project_endpoint("https://<account>/api/projects/<project>")
        with self.assertRaises(ValueError):
            _validate_project_endpoint("https://evil.example/api/projects/stolen")
        with self.assertRaises(ValueError):
            _validate_project_endpoint(
                "https://account.services.ai.azure.com.evil.example/api/projects/stolen"
            )
        with self.assertRaises(ValueError):
            _validate_agent_name("invalid agent name")

    def test_materializes_each_sample_without_environment_leakage(self) -> None:
        template = {
            "name": "template-name",
            "description": "test",
            "definition": {
                "kind": "voice",
                "model_type": "managed",
                "model": "default-model",
                "tools": [
                    {
                        "type": "mcp",
                        "server_label": "tools",
                        "server_url": "",
                        "project_connection_id": "",
                    }
                ],
            },
        }
        environments = [
            (
                "first-agent",
                "first-model",
                "https://first.example/mcp",
                "first-connection",
            ),
            (
                "second-agent",
                "second-model",
                "https://second.example/mcp",
                "second-connection",
            ),
        ]

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sample_dirs = []
            for index, values in enumerate(environments):
                agent_name, model, server_url, connection_id = values
                sample_dir = root / str(index)
                sample_dir.mkdir()
                (sample_dir / "agent.json").write_text(
                    json.dumps(template),
                    encoding="utf-8",
                )
                (sample_dir / ".env").write_text(
                    "\n".join(
                        [
                            "AZURE_AI_PROJECT_ENDPOINT="
                            "https://account.services.ai.azure.com/api/projects/project",
                            f"VOICE_AGENT_NAME={agent_name}",
                            f"VOICE_AGENT_MODEL={model}",
                            f"VOICE_AGENT_MCP_SERVER_URL={server_url}",
                            f"VOICE_AGENT_MCP_CONNECTION_ID={connection_id}",
                        ]
                    )
                    + "\n",
                    encoding="utf-8",
                )
                sample_dirs.append(sample_dir)

            with patch.dict(os.environ, {}, clear=True):
                first_name, _, first = load_materialized_agent(sample_dirs[0])
                second_name, _, second = load_materialized_agent(sample_dirs[1])

        self.assertEqual(first_name, "first-agent")
        self.assertEqual(second_name, "second-agent")
        self.assertEqual(first["model_type"], "managed")
        self.assertEqual(second["model_type"], "managed")
        self.assertEqual(first["model"], "first-model")
        self.assertEqual(second["model"], "second-model")
        self.assertEqual(
            first["tools"][0]["project_connection_id"],
            "first-connection",
        )
        self.assertEqual(
            second["tools"][0]["project_connection_id"],
            "second-connection",
        )

    def test_mcp_config_switch_overrides_sample_mcp_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            sample_dir = Path(directory)
            config_dir = sample_dir / "config"
            config_dir.mkdir()
            (config_dir / "shared.env").write_text(
                "\n".join(
                    [
                        "VOICE_AGENT_MCP_SERVER_URL="
                        "https://shared.example/mcp/finance",
                        "VOICE_AGENT_MCP_CONNECTION_ID=shared-connection",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (sample_dir / ".env").write_text(
                "\n".join(
                    [
                        "AZURE_AI_PROJECT_ENDPOINT="
                        "https://account.services.ai.azure.com/api/projects/project",
                        "VOICE_AGENT_MCP_CONFIG=config/shared.env",
                        "VOICE_AGENT_MCP_SERVER_URL=https://internal.example/mcp",
                        "VOICE_AGENT_MCP_CONNECTION_ID=internal-connection",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {}, clear=True):
                settings = _load_settings(sample_dir)

        self.assertEqual(
            settings["VOICE_AGENT_MCP_SERVER_URL"],
            "https://shared.example/mcp/finance",
        )
        self.assertEqual(
            settings["VOICE_AGENT_MCP_CONNECTION_ID"],
            "shared-connection",
        )

    def test_mcp_config_switch_reports_missing_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            sample_dir = Path(directory)
            (sample_dir / ".env").write_text(
                "VOICE_AGENT_MCP_CONFIG=missing.env\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "VOICE_AGENT_MCP_CONFIG does not exist",
                ):
                    _load_settings(sample_dir)

    def test_canonicalizes_service_audio_defaults(self) -> None:
        authored = {
            "audio": {
                "input": {
                    "turn_detection": {
                        "remove_filler_words": False,
                    }
                },
                "output": {
                    "voice": "en-US-AvaNeural",
                    "voice_type": "azure-standard",
                },
            }
        }
        readback = {
            "audio": {
                "input": {"turn_detection": {}},
                "output": {
                    "voice": {
                        "type": "azure-standard",
                        "name": "en-US-AvaNeural",
                    }
                },
            }
        }
        self.assertEqual(
            _canonical_definition(authored),
            _canonical_definition(readback),
        )

    def test_builds_encoded_realtime_url(self) -> None:
        url = _realtime_url(
            "https://account.services.ai.azure.com/api/projects/project",
            "sample-agent",
            "session-id",
        )
        self.assertEqual(
            url,
            "wss://account.services.ai.azure.com/api/projects/project/"
            "agents/sample-agent/endpoint/protocols/voice"
            "?api-version=v1&agent_session_id=session-id",
        )

    def test_committed_directory_scenarios_match_expected_shapes(self) -> None:
        samples = Path(__file__).resolve().parent
        common_settings = {
            "AZURE_AI_PROJECT_ENDPOINT": (
                "https://account.services.ai.azure.com/api/projects/project"
            ),
            "AZURE_CREDENTIAL_MODE": "default",
            "VOICE_AGENT_MODEL": "gpt-realtime",
            "VOICE_AGENT_MCP_SERVER_URL": "https://tools.example/mcp",
        }
        _, _, finance = load_materialized_agent(
            samples / "example1_finance_with_handoff_realtime",
            {
                **common_settings,
                "VOICE_AGENT_NAME": "finance-test",
                "VOICE_AGENT_MCP_CONNECTION_ID": "finance-connection",
            },
        )
        _, _, otp_officer_search = load_materialized_agent(
            samples / "example2_finance_with_OTP_and_Officer_Search",
            {
                **common_settings,
                "VOICE_AGENT_NAME": "finance-otp-officer-search-test",
                "VOICE_AGENT_MCP_CONNECTION_ID": "finance-otp-officer-search-connection",
            },
        )
        _, _, elevator_service = load_materialized_agent(
            samples / "example3_elevator_service_with_safety_zendesk_and_handoff",
            {
                **common_settings,
                "VOICE_AGENT_NAME": "elevator-service-test",
                "VOICE_AGENT_MCP_CONNECTION_ID": "elevator-service-connection",
            },
        )


        self.assertEqual(finance["model_type"], "managed")
        self.assertEqual(finance["model"], "gpt-realtime")
        self.assertEqual(len(finance["handoff"]["nodes"]), 8)
        self.assertEqual(len(finance["handoff"]["edges"]), 13)

        self.assertEqual(otp_officer_search["model_type"], "managed")
        self.assertEqual(otp_officer_search["model"], "gpt-realtime")
        self.assertNotIn("handoff", otp_officer_search)
        self.assertEqual(
            otp_officer_search["tools"][0]["allowed_tools"],
            [
                "verify_caller_otp",
                "calculate_loan_offer",
                "record_loan_interest",
                "auto_assign_loan_officer",
                "search_loan_officer",
                "confirm_loan_officer",
                "end_call",
            ],
        )
        self.assertEqual(elevator_service["model_type"], "managed")
        self.assertEqual(elevator_service["model"], "gpt-realtime")
        self.assertEqual(
            "en-US-Ava:DragonHDLatestNeural",
            elevator_service["audio"]["output"]["voice"]["name"],
        )
        self.assertEqual(
            "azure-standard",
            elevator_service["audio"]["output"]["voice"]["type"],
        )
        self.assertEqual(len(elevator_service["handoff"]["nodes"]), 9)
        self.assertEqual(len(elevator_service["handoff"]["edges"]), 17)
        source_definition = json.loads(
            (
                samples
                / "example3_elevator_service_with_safety_zendesk_and_handoff"
                / "agent.json"
            ).read_text(encoding="utf-8")
        )["definition"]
        shared_instructions = source_definition["instructions"]
        self.assertIn("## CONVERSATIONAL RESPONSE", shared_instructions)
        self.assertIn(
            "Match an explicitly stated emotion with restrained empathy.",
            shared_instructions,
        )
        self.assertIn(
            "that operation is the only next step",
            shared_instructions,
        )
        self.assertIn(
            "Never invent or\nintensify an emotion",
            shared_instructions,
        )
        self.assertNotIn("## CURRENT NODE", shared_instructions)
        for source_node, materialized_node in zip(
            source_definition["handoff"]["nodes"],
            elevator_service["handoff"]["nodes"],
            strict=True,
        ):
            source_config = source_node["config"]
            materialized_config = materialized_node["config"]
            self.assertIs(source_config["inherit_from_base_instructions"], True)
            self.assertTrue(
                source_config["instructions"].startswith("## CURRENT NODE\n")
            )
            self.assertNotIn("## GLOBAL POLICY", source_config["instructions"])
            self.assertNotIn(
                "inherit_from_base_instructions",
                materialized_config,
            )
            self.assertTrue(
                materialized_config["instructions"].startswith("## GLOBAL POLICY\n")
            )
            self.assertIn(
                "\n\n## CURRENT NODE\n",
                materialized_config["instructions"],
            )
        query_edge = next(
            edge
            for edge in elevator_service["handoff"]["edges"]
            if edge["id"] == "intent_router_to_query_issue"
        )
        self.assertEqual("auto", query_edge["target_response"])
        self.assertEqual(
            "I understand you want a clear update on this ticket.",
            query_edge["transfer_message"],
        )
        report_issue = next(
            node
            for node in elevator_service["handoff"]["nodes"]
            if node["id"] == "report_issue"
        )
        self.assertEqual(
            [
                "record_issue",
                "assess_safety",
                "mock_zendesk_create_ticket",
            ],
            report_issue["config"]["tools"][0]["allowed_tools"],
        )
        query_issue = next(
            node
            for node in elevator_service["handoff"]["nodes"]
            if node["id"] == "query_issue"
        )
        self.assertEqual(
            ["mock_zendesk_get_ticket_status"],
            query_issue["config"]["tools"][0]["allowed_tools"],
        )
        self.assertIsNone(query_issue["config"]["interim_response"])
        human_handoff = next(
            node
            for node in elevator_service["handoff"]["nodes"]
            if node["id"] == "human_handoff"
        )
        self.assertEqual(
            ["request_human_handoff"],
            human_handoff["config"]["tools"][0]["allowed_tools"],
        )
        self.assertNotIn(
            "transfer_call",
            {
                tool.get("name")
                for node in elevator_service["handoff"]["nodes"]
                for tool in node["config"]["tools"]
            },
        )

    def test_example1_directories_share_the_direct_identity_workflow(self) -> None:
        samples = Path(__file__).resolve().parent
        settings = {
            "AZURE_AI_PROJECT_ENDPOINT": (
                "https://account.services.ai.azure.com/api/projects/project"
            ),
            "AZURE_CREDENTIAL_MODE": "default",
            "VOICE_AGENT_NAME": "stale-env-agent",
            "VOICE_AGENT_MODEL": "stale-env-model",
            "VOICE_AGENT_MCP_SERVER_URL": "https://tools.example/mcp",
            "VOICE_AGENT_MCP_CONNECTION_ID": "finance-connection",
        }
        with patch.dict(os.environ, {}, clear=True):
            realtime_name, _, realtime = load_materialized_agent(
                samples / "example1_finance_with_handoff_realtime",
                settings,
                prefer_document_name=True,
            )
            cascade_name, _, cascade = load_materialized_agent(
                samples / "example1_finance_with_handoff_cascade",
                settings,
                prefer_document_name=True,
            )

        self.assertEqual("finance-example-realtime", realtime_name)
        self.assertEqual("finance-example-cascade-luna", cascade_name)
        # Cascade follows the realtime graph, greeting and shared prompt; it
        # adds only latency cover for its slower tool and handoff turns.
        self.assertEqual(realtime["instructions"], cascade["instructions"])
        self.assertEqual(realtime["greeting"], cascade["greeting"])
        self.assertEqual(
            [(edge["id"], edge["source"], edge["target"]) for edge in realtime["handoff"]["edges"]],
            [(edge["id"], edge["source"], edge["target"]) for edge in cascade["handoff"]["edges"]],
        )
        self.assertEqual(
            [node["id"] for node in realtime["handoff"]["nodes"]],
            [node["id"] for node in cascade["handoff"]["nodes"]],
        )
        self.assertEqual(
            {
                "type": "template",
                "text": (
                    "Hello, thank you for taking the call. "
                    "This is Virtual Finance calling."
                ),
            },
            realtime["greeting"],
        )
        nodes = {node["id"]: node for node in realtime["handoff"]["nodes"]}
        self.assertEqual(
            [
                "rpc", "offer", "offer_decision", "charges_consent",
                "wrap_up", "appointment", "offer_summary", "end",
            ],
            list(nodes),
        )
        edges = {edge["id"]: edge for edge in realtime["handoff"]["edges"]}
        self.assertEqual(13, len(edges))
        self.assertEqual("rpc", edges["entrypoint_to_rpc"]["target"])
        closing = "Thank you for your time. Goodbye."
        self.assertEqual(
            {
                "entrypoint_to_rpc": (
                    "This is Virtual Finance calling about a personal loan offer. "
                    "Before I share the details, I need to confirm who I'm speaking with."
                ),
                "rpc_to_offer": "That matches our records.",
                "offer_to_offer_decision": "Thank you. Saving your decision now.",
                "offer_decision_to_wrap_up": (
                    "Because you did not accept our offer, we can talk again next time."
                ),
                "appointment_to_offer_summary": (
                    "Sure, let's confirm your offer and appointment details."
                ),
                "offer_summary_to_end": closing,
                "wrap_up_to_end": closing,
            },
            {
                edge_id: edge["transfer_message"]
                for edge_id, edge in edges.items()
                if "transfer_message" in edge
            },
        )
        for node_id, node in nodes.items():
            with self.subTest(node=node_id):
                self.assertIsNone(node["config"]["interim_response"])
        cascade_nodes = {node["id"]: node for node in cascade["handoff"]["nodes"]}
        cascade_edges = {edge["id"]: edge for edge in cascade["handoff"]["edges"]}
        self.assertEqual(
            {"offer"},
            {
                node_id for node_id, node in cascade_nodes.items()
                if node["config"]["interim_response"]
            },
        )
        self.assertEqual(
            ["tool"], cascade_nodes["offer"]["config"]["interim_response"]["triggers"],
        )
        for edge_id, message in (
            ("offer_decision_to_charges_consent",
             "Your decision is saved. Next, let me take you through the charges."),
            ("charges_consent_to_appointment",
             "Now let's book your appointment with a loan officer."),
            ("appointment_to_offer_summary",
             "Your appointment is booked. Let me confirm your offer and appointment details."),
        ):
            with self.subTest(cascade_edge=edge_id):
                self.assertEqual(message, cascade_edges[edge_id]["transfer_message"])
        self.assertIn(
            "Let me book that for you.",
            cascade_nodes["appointment"]["config"]["instructions"],
        )
        self.assertEqual(
            ["start_call", "confirm_right_party"],
            nodes["rpc"]["config"]["tools"][0]["allowed_tools"],
        )
        rpc = " ".join(nodes["rpc"]["config"]["instructions"].split())
        self.assertIn("call start_call once", rpc)
        self.assertIn("Am I speaking with <calling_first_name>?", rpc)
        self.assertIn("could you please tell me your date of birth?", rpc)
        charges = nodes["charges_consent"]
        self.assertEqual(
            ["present_charges", "capture_bureau_consent"],
            charges["config"]["tools"][0]["allowed_tools"],
        )
        disclosure = " ".join(charges["config"]["instructions"].split())
        self.assertIn("processing fee of <processing_fee_inr> rupees", disclosure)
        self.assertIn(
            'Do you consent to a credit-bureau check for this application? '
            'Please say "I consent" or "I decline".',
            disclosure,
        )
        for phrase in (
            "I'm checking those details now.",
            "Confirming your identity, just a second.",
            "Checking your offer, one moment.",
            "Saving your appointment info",
            "Let me check that time and arrange your appointment.",
        ):
            self.assertNotIn(phrase, json.dumps(realtime))
        end = nodes["end"]
        self.assertEqual(
            {
                "type": "system",
                "name": "end_conversation",
                "description": (
                    "End the active conversation only after its business "
                    "disposition has been recorded and the closing has been "
                    "spoken. Call it with only a non-empty reason."
                ),
            },
            end["config"]["tools"][0],
        )
        self.assertEqual("gpt-realtime-regional", realtime["model"])
        for definition in (realtime, cascade):
            self.assertEqual(
                400,
                definition["audio"]["input"]["turn_detection"]["silence_duration_ms"],
            )
        self.assertEqual(
            "azure-speech",
            realtime["audio"]["input"]["transcription"]["model"],
        )
        self.assertIsNone(
            realtime["audio"]["input"]["turn_detection"][
                "end_of_utterance_detection"
            ]
        )
        self.assertEqual(
            "en-IN-Diya:DragonHDLatestNeural",
            realtime["audio"]["output"]["voice"]["name"],
        )
        self.assertEqual("gpt-4.1-mini", cascade["model"])
        self.assertEqual(
            "azure-speech",
            cascade["audio"]["input"]["transcription"]["model"],
        )
        # Smart Turn end-of-utterance detection is off for both runtimes.
        self.assertIsNone(
            cascade["audio"]["input"]["turn_detection"][
                "end_of_utterance_detection"
            ],
        )
        self.assertEqual(
            "en-IN-Diya:DragonHDLatestNeural",
            cascade["audio"]["output"]["voice"]["name"],
        )

    def test_sample_env_defaults_match_committed_model_mode(self) -> None:
        samples = Path(__file__).resolve().parent
        for directory in (
            "example1_finance_with_handoff_realtime",
            "example1_finance_with_handoff_cascade",
            "example2_finance_with_OTP_and_Officer_Search",
            "example3_elevator_service_with_safety_zendesk_and_handoff",
        ):
            sample = samples / directory
            definition = json.loads(
                (sample / "agent.json").read_text(encoding="utf-8")
            )["definition"]
            defaults = {
                key.strip(): value.strip()
                for line in (sample / ".env.example").read_text(
                    encoding="utf-8"
                ).splitlines()
                if line and not line.startswith("#") and "=" in line
                for key, value in [line.split("=", 1)]
            }
            self.assertEqual(definition["model_type"], "managed")
            self.assertNotIn("VOICE_AGENT_MODEL_TYPE", defaults)
            if directory.startswith("example1_finance_with_handoff_"):
                self.assertNotIn("VOICE_AGENT_MODEL", defaults)
            else:
                self.assertEqual(
                    defaults["VOICE_AGENT_MODEL"],
                    definition["model"],
                )

    def test_counts_handoff_and_mcp_call_evidence(self) -> None:
        printer = EventPrinter(verbose=False)
        with contextlib.redirect_stdout(io.StringIO()):
            printer.show(
                {
                    "type": "response.done",
                    "response": {
                        "output": [
                            {
                                "type": "function_call",
                                "name": "handoff",
                            }
                        ]
                    },
                }
            )
            printer.show({"type": "response.mcp_call.completed"})
            printer.show({"type": "mcp_list_tools.completed"})

        summary = printer.summary("agent", "session")
        self.assertEqual(summary["handoff_events"], 1)
        self.assertEqual(summary["mcp_events"], 2)
        self.assertEqual(summary["mcp_call_events"], 1)

if __name__ == "__main__":
    unittest.main()
