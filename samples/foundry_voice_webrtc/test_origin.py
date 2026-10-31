"""Offline checks for permitted origins and public assets."""

import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from runpy import run_module
from unittest.mock import AsyncMock, patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request

from server import Settings, client_access, create_app, load_settings, origin_allowed


class OriginTests(unittest.TestCase):
    def test_local_origin_is_allowed(self):
        self.assertTrue(origin_allowed("127.0.0.1:8080", "http",
                                       "http://127.0.0.1:8080"))

    def test_unconfigured_public_origin_is_rejected(self):
        self.assertFalse(origin_allowed("voice.example.com", "https",
                                        "https://voice.example.com"))

    def test_configured_public_origin_is_allowed(self):
        self.assertTrue(origin_allowed("voice.example.com", "http",
                                       "https://voice.example.com",
                                       "https://voice.example.com"))

    def test_mismatched_public_host_is_rejected(self):
        self.assertFalse(origin_allowed("attacker.example", "http",
                                        "https://voice.example.com",
                                        "https://voice.example.com"))


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


class AccessBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def test_local_listener_does_not_follow_public_origin(self):
        for cfg in (Settings("", ""), Settings("", "", public_origin="https://voice.example.com")):
            self.assertEqual(cfg.listen_host, "127.0.0.1")

    def test_hosted_mode_requires_explicit_configuration(self):
        with self.assertRaisesRegex(ValueError, "requires PUBLIC_ORIGIN"):
            Settings("", "", trusted_azure_ingress=True)
        for origin in ("http://voice.example.com", "https://voice.example.com/path"):
            with self.assertRaisesRegex(ValueError, "HTTPS origin"):
                Settings("", "", public_origin=origin, trusted_azure_ingress=True)
        cfg = Settings("", "", public_origin="https://voice.example.com", trusted_azure_ingress=True)
        self.assertEqual(cfg.listen_host, "0.0.0.0")
        with patch("server.load_dotenv"), patch.dict("os.environ", {
                "PUBLIC_ORIGIN": "https://voice.example.com",
                "TRUSTED_AZURE_INGRESS": "true"}, clear=True):
            self.assertTrue(load_settings().trusted_azure_ingress)

    def test_standalone_entrypoint_uses_the_selected_listener(self):
        for hosted, host in (("false", "127.0.0.1"), ("true", "0.0.0.0")):
            with patch("dotenv.load_dotenv"), patch.dict("os.environ", {
                    "PUBLIC_ORIGIN": "https://voice.example.com",
                    "TRUSTED_AZURE_INGRESS": hosted, "PORT": "8080"}, clear=True):
                with patch("aiohttp.web.run_app") as run_app, patch("logging.basicConfig"):
                    run_module("server", run_name="__main__")
                self.assertEqual(run_app.call_args.kwargs["host"], host)
                self.assertEqual(run_app.call_args.kwargs["port"], 8080)

    def test_container_hosted_mode_keeps_platform_authentication_enabled(self):
        template = (Path(__file__).parent / "infra" / "modules" / "container-app.bicep").read_text()
        self.assertRegex(template, r"name: 'TRUSTED_AZURE_INGRESS'\s+value: 'true'")
        self.assertRegex(template, r"platform:\s*\{\s*enabled: true")
        self.assertIn("unauthenticatedClientAction: entraEnabled ? 'RedirectToLoginPage' : 'Return401'", template)
        self.assertRegex(template, r"excludedPaths:\s*\[\s*'/health'\s*\]")

    async def test_remote_peers_cannot_reach_any_route_with_spoofed_headers(self):
        tokens = AsyncMock()
        app = create_app(Settings("", "", allow_agent_recreate=True), tokens)
        for route in app.router.routes():
            path = route.resource.canonical.replace("{file}", "app.js")
            for peer in ("192.0.2.10", "2001:db8::10", "::ffff:192.0.2.10", "", "localhost"):
                with self.subTest(path=path, method=route.method, peer=peer):
                    request = make_mocked_request(route.method, path, app=app, headers={
                        "Host": "localhost:8080", "Origin": "http://localhost:8080",
                        "X-Forwarded-For": "127.0.0.1", "X-MS-CLIENT-PRINCIPAL-ID": "forged",
                    }).clone(remote=peer)
                    handler = AsyncMock(return_value=web.Response())
                    with self.assertRaises(web.HTTPForbidden):
                        await client_access(request, handler)
                    handler.assert_not_awaited()
        tokens.get_token.assert_not_awaited()
        self.assertIn(client_access, app.middlewares)

    async def test_loopback_peers_can_reach_handlers(self):
        app = create_app(Settings("", ""))
        for peer in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            request = make_mocked_request("GET", "/api/config", app=app).clone(remote=peer)
            handler = AsyncMock(return_value=web.Response(status=200))
            self.assertEqual((await client_access(request, handler)).status, 200)
            handler.assert_awaited_once()

    async def test_hosted_routes_require_ingress_identity_except_health(self):
        app = create_app(Settings("", "", public_origin="https://voice.example.com",
                                  trusted_azure_ingress=True), AsyncMock())
        for route in app.router.routes():
            path = route.resource.canonical.replace("{file}", "app.js")
            for identity in ("", "   ", "authenticated-user"):
                with self.subTest(path=path, method=route.method, identity=identity):
                    request = make_mocked_request(route.method, path, app=app, headers={
                        "Host": "voice.example.com", "X-MS-CLIENT-PRINCIPAL-ID": identity,
                    }).clone(remote="192.0.2.10")
                    handler = AsyncMock(return_value=web.Response(status=200))
                    if path == "/health" or identity.strip():
                        self.assertEqual((await client_access(request, handler)).status, 200)
                        handler.assert_awaited_once()
                    else:
                        with self.assertRaises(web.HTTPUnauthorized):
                            await client_access(request, handler)
                        handler.assert_not_awaited()

    async def test_hosted_http_routes_reject_anonymous_callers_before_credentials(self):
        tokens = AsyncMock()
        app = create_app(Settings("", "", public_origin="https://voice.example.com",
                                  trusted_azure_ingress=True), tokens)
        async with TestClient(TestServer(app)) as client:
            headers = {"Host": "voice.example.com", "Origin": "https://voice.example.com"}
            for route in app.router.routes():
                path = route.resource.canonical.replace("{file}", "app.js")
                if path == "/health":
                    continue
                with self.subTest(path=path, method=route.method):
                    response = await client.request(route.method, path, headers=headers)
                    self.assertEqual(response.status, 401)
            self.assertEqual((await client.get("/health")).status, 200)
            response = await client.get("/api/config", headers={
                **headers, "X-MS-CLIENT-PRINCIPAL-ID": "authenticated-user"})
            self.assertEqual(response.status, 200)
        tokens.get_token.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
