"""Offline checks for permitted origins and public assets."""

import os
import runpy
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import AsyncMock, patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request

from server import (Settings, allowed_origin, bridge, change_agent_model, create_app,
                    download_conversation, origin_allowed, prepare_agent, recreate_agent)


class OriginTests(unittest.TestCase):
    def test_local_origin_is_allowed(self):
        for host, remote in (("localhost:8080", "127.0.0.1"),
                             ("127.0.0.1:8080", "127.0.0.1"),
                             ("[::1]:8080", "::1"),
                             ("127.0.0.1:8080", "::ffff:127.0.0.1")):
            with self.subTest(host=host, remote=remote):
                self.assertTrue(origin_allowed(host, "http", f"http://{host}", remote=remote))

    def test_forged_loopback_origin_requires_a_loopback_peer(self):
        for remote in (None, "", "invalid", "198.51.100.42", "10.0.0.2",
                       "2001:db8::1", "::ffff:198.51.100.42"):
            for public_origin in ("", "https://voice.example.com"):
                with self.subTest(remote=remote, public_origin=public_origin):
                    self.assertFalse(origin_allowed("127.0.0.1:8080", "http",
                        "http://127.0.0.1:8080", public_origin, remote=remote))

    def test_local_peer_still_requires_matching_origin(self):
        for origin in (None, "https://attacker.example", "http://localhost:9000"):
            self.assertFalse(origin_allowed("127.0.0.1:8080", "http", origin, remote="127.0.0.1"))

    def test_unconfigured_public_origin_is_rejected(self):
        self.assertFalse(origin_allowed("voice.example.com", "https",
                                        "https://voice.example.com"))

    def test_configured_public_origin_is_allowed(self):
        self.assertTrue(origin_allowed("voice.example.com", "http",
                                       "https://voice.example.com",
                                       "https://voice.example.com", remote="10.0.0.2"))

    def test_mismatched_public_host_is_rejected(self):
        self.assertFalse(origin_allowed("attacker.example", "http",
                                        "https://voice.example.com",
                                        "https://voice.example.com"))


class LocalBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_network_peer_cannot_authorize_with_forged_or_forwarded_loopback_headers(self):
        tokens = AsyncMock()
        app = create_app(Settings("https://example.services.ai.azure.com/api/projects/demo",
                                  "demo-agent", allow_agent_recreate=True), tokens)
        headers = {"Host": "127.0.0.1:8080", "Origin": "http://127.0.0.1:8080",
                   "X-Forwarded-For": "127.0.0.1", "X-Real-IP": "127.0.0.1",
                   "Forwarded": "for=127.0.0.1;host=127.0.0.1:8080;proto=http"}
        for path, handler in (("/api/agent/model", change_agent_model),
                              ("/api/agent/prepare", prepare_agent),
                              ("/api/agent/recreate", recreate_agent),
                              ("/api/conversation/download", download_conversation)):
            with self.subTest(path=path):
                request = make_mocked_request("POST", path, headers=headers, app=app).clone(
                    remote="198.51.100.42")
                self.assertFalse(allowed_origin(request))
                response = await handler(request)
                self.assertEqual(response.status, 403)
        request = make_mocked_request("GET", "/api/voice", headers=headers, app=app).clone(
            remote="198.51.100.42")
        with self.assertRaises(web.HTTPForbidden):
            await bridge(request)
        tokens.get_token.assert_not_awaited()


class BindingTests(unittest.TestCase):
    def test_entrypoint_defaults_to_loopback_even_with_blank_binding(self):
        for value in (None, "", "   "):
            environment = {} if value is None else {"BIND_HOST": value}
            with self.subTest(value=value), patch.dict(os.environ, environment, clear=True), patch(
                    "dotenv.load_dotenv"), patch("logging.basicConfig"), patch("aiohttp.web.run_app") as run_app:
                runpy.run_path(str(Path(__file__).with_name("server.py")), run_name="__main__")
                run_app.assert_called_once()
                self.assertEqual(run_app.call_args.kwargs["host"], "127.0.0.1")
                self.assertEqual(run_app.call_args.kwargs["port"], 8080)

    def test_entrypoint_honors_explicit_container_binding(self):
        with patch.dict(os.environ, {"BIND_HOST": "0.0.0.0", "PORT": "9000"}, clear=True), patch(
                "dotenv.load_dotenv"), patch("logging.basicConfig"), patch("aiohttp.web.run_app") as run_app:
            runpy.run_path(str(Path(__file__).with_name("server.py")), run_name="__main__")
            self.assertEqual(run_app.call_args.kwargs["host"], "0.0.0.0")
            self.assertEqual(run_app.call_args.kwargs["port"], 9000)


class AssetTests(unittest.IsolatedAsyncioTestCase):
    async def test_returned_cost_module_is_served_without_local_pricing(self):
        async with TestClient(TestServer(create_app(Settings("", "")))) as client:
            config = await (await client.get("/api/config")).json()
            self.assertNotIn("callPricing", config)
            module = await client.get("/call-cost.mjs")
            self.assertEqual(module.status, 200)
            self.assertIn("export function returnedCallCost", await module.text())
            self.assertEqual((await client.get("/call-prices.json")).status, 404)

    async def test_page_links_to_a_served_svg_favicon(self):
        async with TestClient(TestServer(create_app(Settings("", "")))) as client:
            page = await client.get("/")
            self.assertIn('<link rel="icon" type="image/svg+xml" href="/favicon.svg">', await page.text())
            icon = await client.get("/favicon.svg")
            self.assertEqual(icon.status, 200)
            self.assertEqual(icon.content_type, "image/svg+xml")
            svg = ET.fromstring(await icon.text())
            self.assertEqual(svg.tag, "{http://www.w3.org/2000/svg}svg")
            self.assertEqual(svg.attrib["viewBox"], "0 0 64 64")
            private_file = await client.get("/server.py")
            self.assertEqual(private_file.status, 404)


if __name__ == "__main__":
    unittest.main()
