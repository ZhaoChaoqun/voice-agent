# Copyright (c) Microsoft. All rights reserved.
"""Editor portal routes and customer-facing static contracts."""

from __future__ import annotations

import unittest
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from aiohttp.test_utils import TestClient, TestServer

import demo_server
from template_portal import iter_mcp_tools


ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = "https://sample.services.ai.azure.com/api/projects/sample-project"


class HandoffPortalRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        args = demo_server.parse_args([
            "--project-endpoint",
            ENDPOINT,
            "--no-record-sessions",
        ])
        self.client = TestClient(TestServer(demo_server.build_app(args)))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()

    async def test_editor_page_and_allowlisted_assets_are_served(self) -> None:
        response = await self.client.get("/editor/")
        self.assertEqual(200, response.status)
        self.assertEqual("DENY", response.headers["X-Frame-Options"])
        markup = await response.text()
        self.assertIn("Editor · Voice Agents", markup)
        self.assertIn('aria-label="Portal pages"', markup)
        self.assertIn(">Runtime<", markup)
        self.assertNotIn('href="/templates/"', markup)
        self.assertNotIn(">Dashboard<", markup)

        for asset in (
            "handoff-app.js", "handoff-core.mjs", "js-yaml.mjs", "voice-picker.mjs",
            "transcription-languages.mjs", "anchored-popover.mjs", "handoff.css",
        ):
            with self.subTest(asset=asset):
                response = await self.client.get(f"/static/handoff/{asset}")
                self.assertEqual(200, response.status)
                self.assertGreater(len(await response.read()), 0)
        self.assertEqual(
            404,
            (await self.client.get("/static/handoff/handoff.html")).status,
        )

    async def test_home_opens_editor_and_preserves_runtime_deep_links(self) -> None:
        for source, target in (
            ("/", "/editor/"),
            ("/?backend=sample", "/editor/?backend=sample"),
            ("/?agent=existing&view=handoff", "/runtime/?agent=existing&view=handoff"),
        ):
            with self.subTest(source=source):
                response = await self.client.get(source, allow_redirects=False)
                self.assertEqual(302, response.status)
                self.assertEqual(target, response.headers["Location"])
        response = await self.client.get("/runtime/")
        self.assertEqual(200, response.status)
        self.assertIn("/static/demo/bundle.js", await response.text())

    async def test_runtime_aliases_preserve_deep_link_parameters(self) -> None:
        query = "?agent=existing&view=handoff&transport=webrtc&debug=1&value=a%26b%2Fc&tag=one&tag=two"
        for path in ("/runtime", "/demo", "/demo/"):
            for suffix in ("", query):
                with self.subTest(path=path, suffix=suffix):
                    response = await self.client.get(path + suffix, allow_redirects=False)
                    self.assertEqual(308, response.status)
                    location = urlsplit(response.headers["Location"])
                    self.assertEqual("/runtime/", location.path)
                    self.assertEqual(
                        parse_qsl(suffix.removeprefix("?"), keep_blank_values=True),
                        parse_qsl(location.query, keep_blank_values=True),
                    )
                    response = await self.client.get(path + suffix)
                    self.assertEqual(200, response.status)
                    self.assertEqual("/runtime/", response.url.path)
                    self.assertIn("<title>Voice agent runtime</title>", await response.text())

    async def test_legacy_handoff_url_redirects_to_editor(self) -> None:
        for source, target in (
            ("/handoff", "/editor/"),
            ("/handoff/", "/editor/"),
            ("/handoff/?backend=sample", "/editor/?backend=sample"),
        ):
            with self.subTest(source=source):
                response = await self.client.get(source, allow_redirects=False)
                self.assertEqual(308, response.status)
                self.assertEqual(target, response.headers["Location"])

    async def test_template_detail_supports_handoff_working_copies(self) -> None:
        response = await self.client.get(
            "/api/templates/elevator-service-example"
        )
        self.assertEqual(200, response.status)
        detail = await response.json()
        self.assertEqual("voice", detail["definition"]["kind"])
        self.assertGreater(
            len(detail["definition"]["handoff"]["nodes"]),
            1,
        )
        for node in detail["definition"]["handoff"]["nodes"]:
            config = node["config"]
            self.assertNotIn("inherit_from_base_instructions", config)
            self.assertTrue(config["instructions"].startswith("## GLOBAL POLICY\n"))
            self.assertIn("\n\n## CURRENT NODE\n", config["instructions"])
        self.assertRegex(
            detail["suggested_agent_name"],
            r"^local-only-elevator-service-example-[0-9a-f]{8}$",
        )
        for tool in iter_mcp_tools(detail["definition"]):
            self.assertNotIn("authorization", tool)
            self.assertNotIn("headers", tool)


class HandoffPortalStaticContractTests(unittest.TestCase):
    def test_editor_runtime_and_navigation_contracts_remain_connected(self) -> None:
        html = (
            ROOT / "static/handoff/handoff.html"
        ).read_text(encoding="utf-8")
        app = (
            ROOT / "static/handoff/handoff-app.js"
        ).read_text(encoding="utf-8")
        studio = (
            ROOT / "web/src/App.jsx"
        ).read_text(encoding="utf-8")
        studio_header = (
            ROOT / "web/src/components/StudioHeader.jsx"
        ).read_text(encoding="utf-8")
        templates = (
            ROOT / "static/templates.html"
        ).read_text(encoding="utf-8")

        self.assertIn("Load from templates", html)
        self.assertIn("Try it now", html)
        self.assertNotIn('id="validate-action"', html)
        self.assertIn('id="create-blank-action"', html)
        self.assertIn("Format view", html)
        self.assertEqual(1, html.count('id="publish-run-action"'))
        self.assertNotIn('id="publish-action"', html)
        self.assertIn('id="publish-progress"', html)
        for step in ("validate", "mcp", "publish", "verify", "open"):
            self.assertIn(f'data-publish-step="{step}"', html)
        self.assertNotIn('id="save-draft-action"', html)
        self.assertIn('fetch(`/api/templates/${encodeURIComponent(templateId)}?version=${encodeURIComponent(version)}`)', app)
        self.assertIn("/mcp/configure", app)
        self.assertIn("openPublishProgress()", app)
        self.assertIn('setPublishStep("verify", "running"', app)
        self.assertIn("detail.definition", app)
        self.assertNotIn("publishDefinition(true)", app)
        self.assertIn("view=handoff", app)
        self.assertNotIn("Agent Creation", studio)
        self.assertNotIn("onCreateAgent", studio)
        self.assertIn('<span aria-current="page">Runtime</span>', studio_header)
        self.assertNotIn('href="/templates"', studio_header)
        self.assertIn('href="/editor/"', studio_header)
        self.assertIn(">Editor</a>", studio_header)
        self.assertIn(">Runtime</a>", templates)
        self.assertNotIn('href="/templates/"', templates)
        self.assertIn('href="/editor/"', templates)
        self.assertIn('href="/runtime/"', templates)
        self.assertIn('href="/runtime/"', html)
        self.assertIn('href="/runtime/"', studio_header)
        self.assertIn('window.location.assign(`/runtime/?agent=', app)


if __name__ == "__main__":
    unittest.main()
