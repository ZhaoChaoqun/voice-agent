// Copyright (c) Microsoft. All rights reserved.

import { test, expect } from "@playwright/test";
import { mockWebRtcPeer, mountStudio } from "./studio-fixtures.mjs";

async function observeItemPlayback(page) {
  await page.addInitScript(() => {
    const playback = { segments: [], stopped: [] };
    window.__itemPlayback = playback;
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function (...args) {
      const source = createSource.apply(this, args);
      const start = source.start.bind(source);
      const stop = source.stop.bind(source);
      source.start = (when = 0, ...rest) => {
        playback.segments.push({
          sample: Math.round(source.buffer.getChannelData(0)[0] * 32768),
          start: when,
          duration: source.buffer.duration,
        });
        return start(when, ...rest);
      };
      source.stop = (...rest) => {
        playback.stopped.push(Math.round(source.buffer.getChannelData(0)[0] * 32768));
        return stop(...rest);
      };
      return source;
    };
  });
}

function itemAudioFrame(type, itemId, outputIndex, sample, responseId = "interleaved") {
  const bytes = Buffer.alloc(24000 * 2);
  for (let offset = 0; offset < bytes.length; offset += 2) bytes.writeInt16LE(sample, offset);
  return {
    type, response_id: responseId, item_id: itemId,
    output_index: outputIndex, content_index: 0, delta: bytes.toString("base64"),
  };
}

for (const prefix of ["response.audio", "response.output_audio"]) {
  test(`${prefix} reorders interleaved item audio without delaying the first item`, async ({ page }) => {
    await observeItemPlayback(page);
    const api = await mountStudio(page);
    await api.start();
    api.send({ type: "response.created", response: { id: "interleaved" } });
    for (const [id, output_index] of [["z-first", 0], ["a-second", 1]]) {
      api.send({
        type: "response.output_item.added", response_id: "interleaved",
        output_index, item: { id, type: "message", role: "assistant", content: [] },
      });
    }
    api.send(itemAudioFrame(`${prefix}.delta`, "z-first", 0, 1000));
    await expect.poll(() => page.evaluate(() => window.__itemPlayback.segments.map((s) => s.sample))).toEqual([1000]);
    api.send(itemAudioFrame(`${prefix}.delta`, "a-second", 1, 2000));
    api.send(itemAudioFrame(`${prefix}.delta`, "z-first", 0, 1001));
    api.send(itemAudioFrame(`${prefix}.delta`, "a-second", 1, 2001));
    api.send({
      type: "response.output_item.done", response_id: "interleaved",
      output_index: 1, item: { id: "a-second", type: "message", status: "completed", content: [] },
    });
    await expect.poll(() => page.evaluate(() => window.__itemPlayback.segments.map((s) => s.sample)))
      .toEqual([1000, 1001]);
    api.send({
      type: "response.output_item.done", response_id: "interleaved",
      output_index: 0, item: { id: "z-first", type: "message", status: "completed", content: [] },
    });
    await expect.poll(() => page.evaluate(() => window.__itemPlayback.segments.map((s) => s.sample)))
      .toEqual([1000, 1001, 2000, 2001]);
    api.send({ type: "response.done", response: { id: "interleaved", status: "completed", output: [] } });
    const segments = await page.evaluate(() => window.__itemPlayback.segments);
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index].start).toBeGreaterThanOrEqual(
        segments[index - 1].start + segments[index - 1].duration - 0.00001,
      );
    }
    expect(api.errors).toEqual([]);
  });
}

test("item playback and transcript order follow output indexes when later-item data arrives first", async ({ page }) => {
  await observeItemPlayback(page);
  const api = await mountStudio(page);
  await api.start();
  api.send({ type: "response.created", response: { id: "interleaved" } });
  api.send(itemAudioFrame("response.output_audio.delta", "a-later", 1, 2000));
  api.send({
    type: "response.output_audio_transcript.delta", response_id: "interleaved",
    item_id: "a-later", output_index: 1, content_index: 0, delta: "Could you tell me your date of birth?",
  });
  await expect(page.locator(".msg.assistant .text")).toHaveText("Could you tell me your date of birth?");
  expect(await page.evaluate(() => window.__itemPlayback.segments)).toEqual([]);
  api.send(itemAudioFrame("response.output_audio.delta", "z-first", 0, 1000));
  api.send({
    type: "response.output_audio_transcript.delta", response_id: "interleaved",
    item_id: "z-first", output_index: 0, content_index: 0, delta: "Thanks for confirming.",
  });
  await expect(page.locator(".msg.assistant .text"))
    .toHaveText("Thanks for confirming. Could you tell me your date of birth?");
  await expect.poll(() => page.evaluate(() => window.__itemPlayback.segments.map((s) => s.sample))).toEqual([1000]);
  api.send({
    type: "response.output_item.done", response_id: "interleaved", output_index: 0,
    item: { id: "z-first", type: "message", content: [], status: "completed" },
  });
  await expect.poll(() => page.evaluate(() => window.__itemPlayback.segments.map((s) => s.sample)))
    .toEqual([1000, 2000]);
  expect(api.errors).toEqual([]);
});

test("item playback interruption drops buffered audio and never resumes late packets", async ({ page }) => {
  await observeItemPlayback(page);
  const api = await mountStudio(page);
  await api.start();
  api.send({ type: "response.created", response: { id: "interleaved" } });
  api.send(itemAudioFrame("response.output_audio.delta", "first", 0, 1000));
  api.send(itemAudioFrame("response.output_audio.delta", "second", 1, 2000));
  await expect.poll(() => page.evaluate(() => window.__itemPlayback.segments.map((s) => s.sample))).toEqual([1000]);
  api.send({ type: "input_audio_buffer.speech_started", item_id: "interrupt" });
  await expect.poll(() => page.evaluate(() => window.__itemPlayback.stopped)).toEqual([1000]);
  api.send({ type: "input_audio_buffer.speech_stopped", item_id: "interrupt" });
  api.send(itemAudioFrame("response.output_audio.delta", "second", 1, 2001));
  api.send({ type: "response.created", response: { id: "next" } });
  api.send(itemAudioFrame("response.output_audio.delta", "new-first", 0, 3000, "next"));
  api.send({ type: "response.done", response: { id: "interleaved", status: "cancelled", output: [] } });
  await expect.poll(() => page.evaluate(() => window.__itemPlayback.segments.map((s) => s.sample)))
    .toEqual([1000, 3000]);
  expect(await page.evaluate(() => window.__itemPlayback.stopped)).toEqual([1000]);
  expect(api.errors).toEqual([]);
});

for (const status of ["cancelled", "failed"]) {
  test(`item playback ${status} clears that response without stopping earlier response audio`, async ({ page }) => {
    await observeItemPlayback(page);
    const api = await mountStudio(page);
    await api.start();
    api.send({ type: "response.created", response: { id: "kept" } });
    api.send(itemAudioFrame("response.output_audio.delta", "kept-item", 0, 4000, "kept"));
    api.send({ type: "response.done", response: { id: "kept", status: "completed", output: [] } });
    api.send({ type: "response.created", response: { id: "interleaved" } });
    api.send(itemAudioFrame("response.output_audio.delta", "first", 0, 1000));
    api.send(itemAudioFrame("response.output_audio.delta", "second", 1, 2000));
    await expect.poll(() => page.evaluate(() => window.__itemPlayback.segments.map((s) => s.sample)))
      .toEqual([4000, 1000]);
    api.send({ type: "response.done", response: { id: "interleaved", status, output: [] } });
    await expect.poll(() => page.evaluate(() => window.__itemPlayback.stopped)).toEqual([1000]);
    api.send({ type: "response.created", response: { id: "next" } });
    api.send(itemAudioFrame("response.output_audio.delta", "next-item", 0, 3000, "next"));
    await expect.poll(() => page.evaluate(() => window.__itemPlayback.segments.map((s) => s.sample)))
      .toEqual([4000, 1000, 3000]);
    expect(api.errors).toEqual([]);
  });
}

test("native WebRTC does not duplicate item audio through the WebSocket PCM queue", async ({ page }) => {
  await observeItemPlayback(page);
  await mockWebRtcPeer(page);
  const api = await mountStudio(page, {}, "/runtime/?agent=realtime-agent&transport=webrtc");
  await api.start();
  api.send({ type: "response.created", response: { id: "interleaved" } });
  api.send(itemAudioFrame("response.output_audio.delta", "first", 0, 1000));
  api.send({
    type: "response.output_audio_transcript.done", response_id: "interleaved",
    item_id: "first", output_index: 0, content_index: 0, transcript: "Native media answer.",
  });
  api.send({ type: "response.done", response: { id: "interleaved", status: "completed", output: [] } });
  await expect(page.locator(".msg.assistant .text")).toHaveText("Native media answer.");
  expect(await page.evaluate(() => window.__itemPlayback.segments)).toEqual([]);
  expect(api.errors).toEqual([]);
});
