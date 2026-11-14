import assert from "node:assert/strict";
import test from "node:test";
import { PcmEncoder, PACKET_FRAMES, RATE } from "./static/pcm.mjs";
import { VoiceAudio } from "./static/audio.mjs";

test("capture resamples native browser rates to bounded 24 kHz little-endian PCM16", () => {
  for (const inputRate of [24000, 44100, 48000, 96000]) {
    const encoder = new PcmEncoder(inputRate);
    const packets = [];
    for (let offset = 0; offset < inputRate; offset += 128) {
      const length = Math.min(128, inputRate - offset);
      packets.push(...encoder.push(new Float32Array(length).fill(0.5)));
    }
    assert.ok(Math.abs(packets.length * PACKET_FRAMES + encoder.offset - RATE) <= 2);
    assert.ok(encoder.samples.length < 6);
    for (const packet of packets) {
      assert.equal(packet.byteLength, PACKET_FRAMES * 2);
      assert.equal(new DataView(packet).getInt16(0, true), 16384);
    }
  }
  const encoder = new PcmEncoder(RATE);
  const [packet] = encoder.push(Float32Array.from({ length: 2400 }, (_, index) => index % 2 ? 2 : -2));
  assert.equal(new DataView(packet).getInt16(0, true), -32768);
  assert.equal(new DataView(packet).getInt16(2, true), 32767);
});

class Context {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.destination = {};
    this.scheduled = [];
  }
  createBuffer(_channels, frames, rate) {
    return { duration: frames / rate, getChannelData: () => new Float32Array(frames) };
  }
  createBufferSource() {
    const node = {
      connect() {}, disconnect() {},
      start: time => this.scheduled.push({ node, time }),
      stop() { this.stopped = true; },
    };
    return node;
  }
  async close() { this.state = "closed"; }
}

test("playback buffers faster-than-realtime speech, schedules briefly ahead and stops all audio", async t => {
  t.mock.method(globalThis, "setInterval", () => 0);
  t.mock.method(globalThis, "clearInterval", () => {});
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  const player = new VoiceAudio(error => { throw error; }, () => {});
  try {
    player.play(Buffer.alloc(RATE * 2 * 20).toString("base64"));
    assert.ok(player.queue.length > 0);
    assert.ok(player.context.scheduled.every(item => item.time < 0.25));
    const scheduled = [...player.context.scheduled];
    player.interrupt();
    assert.equal(player.frames, 0);
    assert.equal(player.nodes.size, 0);
    assert.ok(scheduled.every(item => item.node.stopped));
    assert.throws(() => player.play("AA=="), /PCM16/);
    assert.throws(() => player.play(Buffer.alloc(RATE * 2 * 121).toString("base64")), /120 seconds/);
    player.context.state = "suspended";
    assert.throws(() => player.play(Buffer.alloc(2400).toString("base64")), /paused/);
  } finally {
    await player.close();
    globalThis.AudioContext = previous;
  }
});
