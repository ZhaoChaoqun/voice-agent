import unittest

from aiohttp.test_utils import AioHTTPTestCase

from server import Settings, create_app


class ServerTests(AioHTTPTestCase):
    async def get_application(self):
        self.code = "test-only-presenter-code"
        return create_app(Settings("https://example.services.ai.azure.com/api/projects/demo", self.code))

    def origin(self):
        return str(self.client.make_url("/")).rstrip("/")

    async def test_health_and_public_assets_without_credentials(self):
        async with self.client.get("/health") as response:
            self.assertEqual(response.status, 200)
        async with self.client.get("/") as response:
            self.assertEqual(response.status, 200)
            self.assertIn("viewport-fit=cover", await response.text())
            self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        async with self.client.get("/prompt.md") as response:
            self.assertEqual(response.status, 404)

    async def test_authentication_and_origin(self):
        async with self.client.get("/api/config") as response:
            self.assertEqual(response.status, 401)
        async with self.client.post("/api/login", json={"code": self.code}) as response:
            self.assertEqual(response.status, 403)
        async with self.client.post("/api/login", json={"code": "wrong"},
                                    headers={"Origin": self.origin()}) as response:
            self.assertEqual(response.status, 401)
        async with self.client.post("/api/login", json={"code": self.code},
                                    headers={"Origin": self.origin()}) as response:
            self.assertEqual(response.status, 200)
            token = response.cookies["ava_demo"].value
            self.assertTrue(response.cookies["ava_demo"]["httponly"])
            self.assertEqual(response.cookies["ava_demo"]["samesite"], "Strict")
        async with self.client.get("/api/config", cookies={"ava_demo": token}) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual((await response.json())["model"], "gpt-realtime-2.1")
        async with self.client.get("/api/voice", headers={"Origin": "https://evil.example"},
                                   cookies={"ava_demo": token}) as response:
            self.assertEqual(response.status, 403)

    async def test_host_spoofing_and_login_throttling(self):
        async with self.client.get("/", headers={"Host": "evil.example"}) as response:
            self.assertEqual(response.status, 403)
        for _ in range(30):
            await self.client.post("/api/login", json={"code": "wrong"},
                                   headers={"Origin": self.origin()})
        async with self.client.post("/api/login", json={"code": self.code},
                                    headers={"Origin": self.origin()}) as response:
            self.assertEqual(response.status, 429)

    async def test_malformed_login_is_explicit_error(self):
        async with self.client.post("/api/login", data="{", headers={"Origin": self.origin()}) as response:
            self.assertEqual(response.status, 400)


if __name__ == "__main__":
    unittest.main()
