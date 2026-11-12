"""Opt-in live Azure check. Uses paid inference and fictional text, never a microphone."""

import argparse
import asyncio
import json
import os
from pathlib import Path

import aiohttp
from dotenv import load_dotenv

from server import ROOT

DIALOGUE = [
    "Hi, Lehmann here. Could you raise the overdraft on my current account?",
    "A total limit of five thousand euros, please. It's for a clutch repair and a utility back-payment.",
    "I changed jobs in September. My salary is higher but has only come in twice. I'm on my lunch break.",
    "Yes, I explicitly agree. Please save the demo application for a total limit of five thousand euros. I'll upload the payslip in the real app, not here.",
    "I dip into it towards the end of the month, and after holidays. I travel three or four times a year. In Thailand my other bank's credit card charged cash withdrawal fees and an annual fee.",
    "Yes, I'd like to hear about an optional comparison, but only if it's worth it.",
    "Would the credit card be included? And exactly how much lower is the PremiumKonto overdraft rate?",
    "Please put the account comparison checklist in my demo inbox. I don't want to decide about switching now.",
    "If I say it's not worth it, everything stays the same and my overdraft application continues, right?",
    "Thanks. Could you briefly recap what we did? Then goodbye.",
]


async def run(url, output=None, greeting_only=False):
    load_dotenv(ROOT / ".env")
    transcript, states, audio_bytes = [], [], 0
    ready = False
    async with aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True)) as client:
        async with client.get(f"{url}/health") as response:
            assert response.status == 200
        async with client.get(f"{url}/api/config") as response:
            assert response.status == 401, "API must be private."
        async with client.post(f"{url}/api/login", json={"code": os.environ["DEMO_ACCESS_CODE"]},
                               headers={"Origin": url}) as response:
            assert response.status == 200, f"Login failed: {response.status}"
        async with client.ws_connect(f"{url}/api/voice?transport=text", headers={"Origin": url},
                                     max_msg_size=4 * 1024 * 1024) as ws:
            async def turn():
                nonlocal ready, audio_bytes
                async with asyncio.timeout(120):
                    async for msg in ws:
                        if msg.type != aiohttp.WSMsgType.TEXT:
                            raise RuntimeError("Voice connection ended unexpectedly.")
                        event = json.loads(msg.data)
                        kind = event["type"]
                        if kind in {"demo.error", "demo.notice"}:
                            raise RuntimeError(event["message"])
                        if kind == "demo.ready":
                            ready = True
                        if kind in {"response.audio.delta", "response.output_audio.delta"}:
                            audio_bytes += len(event["delta"]) * 3 // 4
                        if kind.endswith("transcript.done") or kind in {"response.output_text.done", "response.text.done"}:
                            text = event.get("transcript") or event.get("text")
                            transcript.append({"role": "assistant", "text": text})
                            print("AVA:", text, flush=True)
                        if kind == "demo.state":
                            states.append(event["state"])
                        if kind == "demo.idle":
                            return
                raise RuntimeError("No complete response received.")
            await turn()
            assert ready, "Configured model and voice were not acknowledged."
            if not greeting_only:
                for text in DIALOGUE:
                    transcript.append({"role": "user", "text": text})
                    print("Customer:", text, flush=True)
                    await ws.send_json({"type": "demo.text", "text": text})
                    await turn()
                assert states, "No banking tools executed."
                final = states[-1]
                assert final["application"]["requested_limit_eur"] == 5000
                assert final["application"]["approved"] is False
                assert final["current_limit_eur"] == 2000
                assert {item["id"] for item in final["inbox"]} == {"overdraft", "comparison"}
            assert audio_bytes > 24000, "Expected real synthesized audio, not only text."
            await ws.send_json({"type": "session.close"})
    result = {"ready": ready, "audio_bytes": audio_bytes, "transcript": transcript, "states": states}
    if output:
        Path(output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"PASS: configured model/voice, real audio ({audio_bytes} bytes), authenticated endpoint"
          + (", overdraft and comparison." if not greeting_only else "."), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8080")
    parser.add_argument("--output")
    parser.add_argument("--greeting-only", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args.url.rstrip("/"), args.output, args.greeting_only))
