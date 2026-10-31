# Copyright (c) Microsoft. All rights reserved.
"""Template version discovery and version-aware routes without Azure calls."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from aiohttp.test_utils import TestClient, TestServer

import demo_server
import template_portal


VERSION = "backups/20261020/original"
ENDPOINT = "https://sample.services.ai.azure.com/api/projects/sample-project"
ORIGINAL_TEMPLATE_IDS = (
    "finance-example-realtime",
    "finance-example-cascade-luna",
    "finance-with-otp-and-officer-search",
    "elevator-service-example",
    "frontdesk-receptionist-example",
    "customer-support-example",
    "appointment-setter-example",
    "receptionist-messaging-example",
)


class TemplateVersionFixture:
    def create_catalog(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.folder = self.root / "samples" / "example"
        self.folder.mkdir(parents=True)
        self.config = self.root / "templates.config.json"
        self.config.write_text(json.dumps({
            "version": 1,
            "templates": [{
                "id": "example",
                "folder": "samples/example",
                "lock_runtime": True,
                "mcp": {
                    "connection_mode": "public",
                    "server_url": "https://tools.example/mcp",
                },
            }],
        }), encoding="utf-8")
        self.default = {
            "name": "default-agent",
            "description": "Default description",
            "definition": {
                "kind": "voice",
                "model": "gpt-realtime",
                "instructions": "Default instructions",
                "audio": {"output": {"voice": "en-US-AvaNeural"}},
                "tools": [],
            },
        }
        self.backup = copy.deepcopy(self.default)
        self.backup.update(name="backup-agent", description="Backup description")
        self.backup["definition"].update(
            instructions="Backup instructions",
            tools=[{
                "type": "mcp",
                "server_label": "backup",
                "server_url": "https://old.example/mcp",
                "allowed_tools": ["backup_tool"],
            }],
        )
        self.write_version(".", self.default)
        self.write_version(VERSION, self.backup)
        self.catalog = template_portal.TemplateCatalog(
            self.config, self.root / "samples", self.root / "shared_mcp",
        )

    def write_version(self, version: str, document: dict) -> Path:
        path = self.folder / version / "agent.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(document), encoding="utf-8")
        return path


class TemplateVersionCatalogTests(TemplateVersionFixture, unittest.TestCase):
    def setUp(self) -> None:
        self.create_catalog()

    def test_target_locale_is_explicit_and_shared_by_template_versions(self) -> None:
        self.assertEqual("", self.catalog.cards()[0]["target_locale"])
        config = json.loads(self.config.read_text())
        config["templates"][0]["target_locale"] = "hi-IN"
        self.config.write_text(json.dumps(config))
        self.catalog.reload()
        self.assertEqual("hi-IN", self.catalog.cards()[0]["target_locale"])
        self.assertEqual("hi-IN", self.catalog.detail("example", VERSION)["target_locale"])

    def test_invalid_target_locale_is_reported_instead_of_guessed(self) -> None:
        for locale in ("en-*", "hi-in", "English", None, ["hi-IN"]):
            with self.subTest(locale=locale):
                config = json.loads(self.config.read_text())
                config["templates"][0]["target_locale"] = locale
                self.config.write_text(json.dumps(config))
                self.catalog.reload()
                self.assertEqual([], self.catalog.cards())
                self.assertEqual(1, len(self.catalog.errors))
                self.assertIn("target_locale", self.catalog.errors[0]["error"])

    def test_versions_keep_one_card_and_independent_documents(self) -> None:
        cards = self.catalog.cards()
        self.assertEqual(1, len(cards))
        self.assertEqual(".", cards[0]["default_version"])
        self.assertEqual(
            [{"id": ".", "name": "Default (agent.json)"}, {"id": VERSION, "name": VERSION}],
            cards[0]["versions"],
        )
        self.assertEqual(self.default, self.catalog.document("example"))
        self.assertEqual(self.backup, self.catalog.document("example", VERSION))
        detail = self.catalog.detail("example", VERSION)
        self.assertEqual(VERSION, detail["version"])
        self.assertEqual("Backup instructions", detail["instructions"])
        self.assertTrue(detail["requires_mcp"])
        self.assertEqual(1, detail["tool_count"])
        self.assertFalse(cards[0]["requires_mcp"])
        document = self.catalog.document("example", VERSION)
        document["definition"]["instructions"] = "Changed working copy"
        self.assertEqual(self.backup, self.catalog.document("example", VERSION))

    def test_reload_discovers_additions_changes_and_removals(self) -> None:
        updated = copy.deepcopy(self.backup)
        updated["definition"]["instructions"] = "Updated backup"
        self.write_version(VERSION, updated)
        path = self.write_version("backups/revised", self.default)
        self.catalog.reload()
        self.assertEqual(updated, self.catalog.document("example", VERSION))
        self.assertEqual(self.default, self.catalog.document("example", "backups/revised"))
        path.unlink()
        self.catalog.reload()
        self.assertIsNone(self.catalog.source("example", "backups/revised"))

    def test_failed_config_reload_preserves_the_loaded_catalog(self) -> None:
        self.config.write_text("{", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "Could not read template config"):
            self.catalog.reload()
        self.assertEqual(2, len(self.catalog.cards()[0]["versions"]))
        self.assertEqual(self.backup, self.catalog.document("example", VERSION))

    def test_invalid_versions_are_reported_without_losing_valid_versions(self) -> None:
        for version, content in (
            ("bad-json", "{"),
            ("bad-shape", "[]"),
            ("no-definition", "{}"),
        ):
            path = self.folder / version / "agent.json"
            path.parent.mkdir()
            path.write_text(content, encoding="utf-8")
        outside = self.root / "samples" / "outside.json"
        outside.write_text(json.dumps(self.default), encoding="utf-8")
        (self.folder / "escaped").mkdir()
        (self.folder / "escaped" / "agent.json").symlink_to(outside)
        self.catalog.reload()
        self.assertEqual(
            {"bad-json", "bad-shape", "no-definition", "escaped"},
            {error["version"] for error in self.catalog.errors},
        )
        self.assertEqual(2, len(self.catalog.cards()[0]["versions"]))
        self.assertEqual(self.backup, self.catalog.document("example", VERSION))
        for version in ("unknown", "../outside", str(outside), "escaped"):
            self.assertIsNone(self.catalog.document("example", version))

    def test_configured_runtime_filename_is_not_mixed_with_other_runtimes(self) -> None:
        config = json.loads(self.config.read_text(encoding="utf-8"))
        config["templates"][0]["agent_file"] = "agent.realtime.json"
        self.config.write_text(json.dumps(config), encoding="utf-8")
        (self.folder / "agent.realtime.json").write_text(json.dumps(self.default), encoding="utf-8")
        (self.folder / VERSION / "agent.realtime.json").write_text(
            json.dumps(self.backup), encoding="utf-8",
        )
        self.write_version("other-runtime", self.default)
        self.catalog.reload()
        self.assertEqual(
            [".", VERSION],
            [version["id"] for version in self.catalog.cards()[0]["versions"]],
        )
        self.assertEqual(self.backup, self.catalog.document("example", VERSION))

    def test_real_sample_backups_are_all_selectable(self) -> None:
        catalog = template_portal.TemplateCatalog()
        for template_id, folder in (
            ("finance-example-realtime", "example1_finance_with_handoff_realtime"),
            ("finance-example-cascade-luna", "example1_finance_with_handoff_cascade"),
            ("finance-with-otp-and-officer-search", "example2_finance_with_OTP_and_Officer_Search"),
            ("elevator-service-example", "example3_elevator_service_with_safety_zendesk_and_handoff"),
            ("frontdesk-receptionist-example", "example4_frontdesk_with_fluency_and_handoff"),
            ("customer-support-example", "example5_customer_support"),
            ("appointment-setter-example", "example6_appointment_setter"),
            ("receptionist-messaging-example", "example7_receptionist_messaging"),
        ):
            root = template_portal.SAMPLES_DIR / folder
            for path in root.rglob("agent.json"):
                version = path.parent.relative_to(root).as_posix()
                with self.subTest(template_id=template_id, version=version):
                    self.assertEqual(
                        json.loads(path.read_text(encoding="utf-8")),
                        catalog.document(template_id, version),
                    )

    def test_finance_version_roots_and_models_remain_separate(self) -> None:
        catalog = template_portal.TemplateCatalog()
        realtime = catalog.source("finance-example-realtime")
        cascade = catalog.source("finance-example-cascade-luna")
        self.assertNotEqual(realtime.path.parent, cascade.path.parent)
        for template_id, model in (
            ("finance-example-realtime", "gpt-realtime-regional"),
            ("finance-example-cascade-luna", "gpt-4.1-mini"),
        ):
            card = next(card for card in catalog.cards() if card["id"] == template_id)
            self.assertEqual(".", card["default_version"])
            for version in card["versions"]:
                with self.subTest(template_id=template_id, version=version["id"]):
                    self.assertEqual(
                        model,
                        catalog.document(template_id, version["id"])["definition"]["model"],
                    )

    def test_original_selectable_templates_follow_runtime_policy(self) -> None:
        catalog = template_portal.TemplateCatalog()
        self.assertEqual([], catalog.errors)
        for template_id in ORIGINAL_TEMPLATE_IDS:
            card = next(card for card in catalog.cards() if card["id"] == template_id)
            model = {
                "finance-example-cascade-luna": "gpt-4.1-mini",
                "finance-example-realtime": "gpt-realtime-regional",
            }.get(card["id"], "gpt-realtime")
            for version in card["versions"]:
                with self.subTest(template_id=card["id"], version=version["id"]):
                    definition = catalog.document(card["id"], version["id"])["definition"]
                    self.assertEqual(model, definition["model"])
                    turn_detection = definition["audio"]["input"]["turn_detection"]
                    self.assertTrue(
                        turn_detection["type"].startswith("azure_semantic_vad"),
                    )
                    self.assertEqual(400, turn_detection["silence_duration_ms"])

    def test_runtime_updated_backup_manifests_keep_exact_prior_sources(self) -> None:
        for manifest_path in template_portal.SAMPLES_DIR.glob("*/backups/**/manifest.json"):
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            update = manifest.get("runtime_update")
            if not update:
                continue
            with self.subTest(manifest=str(manifest_path)):
                previous = manifest_path.parent / update["prior_manifest"]
                self.assertEqual(
                    update["prior_manifest_sha256"],
                    hashlib.sha256(previous.read_bytes()).hexdigest(),
                )
                for record in manifest["files"]:
                    path = manifest_path.parent / record["file"]
                    self.assertEqual(
                        record["sha256"], hashlib.sha256(path.read_bytes()).hexdigest(),
                    )
                    if "source_snapshot_before_runtime_update" in record:
                        snapshot = manifest_path.parent / record[
                            "source_snapshot_before_runtime_update"
                        ]
                        self.assertEqual(
                            record["source_file_sha256_before_runtime_update"],
                            hashlib.sha256(snapshot.read_bytes()).hexdigest(),
                        )


class TemplateVersionRouteTests(TemplateVersionFixture, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.create_catalog()
        app = demo_server.build_app(demo_server.parse_args([
            "--project-endpoint", ENDPOINT, "--no-record-sessions",
        ]))
        app[template_portal.CATALOG_KEY] = self.catalog
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()

    async def test_detail_uses_selected_definition_and_keeps_default_compatible(self) -> None:
        response = await self.client.get("/api/templates/example", params={"version": VERSION})
        self.assertEqual(200, response.status)
        detail = await response.json()
        self.assertEqual(VERSION, detail["version"])
        self.assertEqual("Backup instructions", detail["definition"]["instructions"])
        self.assertEqual("Backup description", detail["description"])
        self.assertTrue(detail["requires_mcp"])
        self.assertEqual(
            "https://tools.example/mcp", detail["definition"]["tools"][0]["server_url"],
        )
        default = await (await self.client.get("/api/templates/example")).json()
        self.assertEqual(".", default["version"])
        self.assertEqual(self.default["definition"], default["definition"])

    async def test_publish_and_mcp_configuration_use_selected_version(self) -> None:
        with (
            patch.object(
                demo_server.VoicePolicy, "resolve",
                side_effect=AssertionError("Template publication must not prevalidate voices"),
            ),
            patch.object(template_portal, "validate_mcp_probe_url"),
            patch.object(template_portal, "create_mcp_connection") as connection,
            patch.object(template_portal, "publish_agent", return_value={
                "name": "local-only-backup", "version": "1",
            }) as publish,
        ):
            response = await self.client.post(
                "/api/templates/example/mcp/configure", params={"version": VERSION}, json={},
            )
            self.assertEqual(200, response.status)
            self.assertTrue((await response.json())["configured"])
            response = await self.client.post(
                "/api/templates/example/publish", params={"version": VERSION},
                json={"name": "backup", "model": "ignored-override"},
            )
        self.assertEqual(201, response.status)
        result = await response.json()
        self.assertEqual(VERSION, result["source_template_version"])
        self.assertEqual("backup-agent", result["source_agent_name"])
        definition = publish.call_args.kwargs["definition"]
        self.assertEqual("Backup instructions", definition["instructions"])
        self.assertEqual("gpt-realtime", definition["model"])
        self.assertEqual("Backup description", publish.call_args.kwargs["description"])
        self.assertEqual("https://tools.example/mcp", definition["tools"][0]["server_url"])
        connection.assert_not_called()
        self.assertEqual(self.backup, self.catalog.document("example", VERSION))
        self.assertEqual(
            self.backup, json.loads((self.folder / VERSION / "agent.json").read_text()),
        )

    async def test_probe_checks_the_selected_versions_tools(self) -> None:
        with patch.object(template_portal, "mcp_handshake", return_value={"tools": []}):
            response = await self.client.get(
                "/api/templates/example/mcp/probe", params={"version": VERSION},
            )
        self.assertIn("backup_tool", (await response.json())["error"])

    async def test_unknown_versions_never_fall_back_to_default(self) -> None:
        for version in ("missing", "../outside", "/etc", ""):
            for action, method in (
                ("", self.client.get),
                ("/mcp/probe", self.client.get),
                ("/mcp/configure", self.client.post),
                ("/publish", self.client.post),
            ):
                with self.subTest(version=version, action=action):
                    response = await method(
                        f"/api/templates/example{action}", params={"version": version},
                        **({"json": {}} if action in {"/mcp/configure", "/publish"} else {}),
                    )
                    self.assertEqual(404, response.status)


if __name__ == "__main__":
    unittest.main()
