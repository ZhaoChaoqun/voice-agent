"""Shared live-test helpers: record Agent audio, connect the page, and drive a fake microphone.

Taken from the Python prototype's test_audio_browser.py; test_live_browser.py imports them.
"""

import base64
import json
import math
import struct
from collections import Counter
from pathlib import Path

from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / "data" / "catalog.json").read_text())
VOICE_SESSION_ID = next(session["id"] for session in CATALOG["sessions"] if session["code"] == "BRK244")


class AudioTrace:
    def __init__(self):
        self.events = Counter()
        self.pcm = bytearray()
        self.transcripts = []
        self.input_transcripts = []
        self.errors = []

    def receive(self, frame):
        if not isinstance(frame, str):
            return
        event = json.loads(frame)
        kind = event.get("type")
        self.events[kind] += 1
        if kind in {"response.output_audio.delta", "response.audio.delta"}:
            self.pcm.extend(base64.b64decode(event["delta"], validate=True))
        if kind in {"response.output_audio_transcript.done", "response.audio_transcript.done"}:
            self.transcripts.append(event.get("transcript", ""))
        if kind == "conversation.item.input_audio_transcription.completed":
            self.input_transcripts.append(event.get("transcript", ""))
        if kind in {"error", "bridge.error"}:
            self.errors.append(event)

    def attach(self, page):
        page.on("websocket", lambda socket: socket.on("framereceived", self.receive))

    def assert_speech(self):
        assert not self.errors, self.errors
        assert len(self.pcm) >= 4800, f"No meaningful output audio: {self.events}"
        samples = struct.unpack(f"<{len(self.pcm) // 2}h", self.pcm)
        rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples))
        assert rms > 100, f"Output audio is effectively silent: RMS={rms}"
        return {"audio_chunks": self.events["response.output_audio.delta"] + self.events["response.audio.delta"],
                "pcm_bytes": len(self.pcm), "seconds": len(self.pcm) / 48000, "rms": round(rms, 1)}


def connect(page, url, microphone):
    page.goto(url)
    page.wait_for_load_state("networkidle")
    page.evaluate("(enabled) => {document.getElementById('use-mic').checked = enabled;}", microphone)
    page.locator("#guide-launcher").click()
    page.wait_for_function(
        "() => !document.getElementById('message').disabled || !document.getElementById('error').hidden",
        timeout=120000,
    )
    expect(page.locator("#error")).to_be_hidden()
    expect(page.locator("#message")).to_be_enabled()
    page.wait_for_function(
        "() => window.igniteDemo.getAudioState().renderedSeconds > .5 && "
        "!window.igniteDemo.getVoiceState().responding && !window.igniteDemo.getVoiceState().speaking",
        timeout=60000,
    )

def install_microphone_fixture(page):
    page.add_init_script("""
        navigator.mediaDevices.getUserMedia = async () => {
            const context = new AudioContext({sampleRate:24000});
            await context.resume();
            const destination = context.createMediaStreamDestination();
            window.__testMic = {context, destination};
            return destination.stream;
        };
        window.addEventListener('ignite:tool-result', event => {
            if (event.detail.name === 'highlight_session' && event.detail.source === 'agent')
                window.__audioAtHighlight = window.igniteDemo.getAudioState().receivedSeconds;
        });
    """)


def feed_microphone(page, pcm):
    page.evaluate("""async encoded => {
        const {context, destination} = window.__testMic;
        await context.resume();
        const raw = atob(encoded);
        const buffer = context.createBuffer(1, raw.length / 2, 24000);
        const samples = buffer.getChannelData(0);
        for (let index = 0; index < samples.length; index++) {
            const value = raw.charCodeAt(2*index) | raw.charCodeAt(2*index+1) << 8;
            samples[index] = (value >= 32768 ? value - 65536 : value) / 32768;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);
        source.start();
    }""", base64.b64encode(pcm).decode())
