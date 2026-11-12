/** Opt-in real Foundry, multi-turn tool/audio verification; never part of offline tests. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { WebSocket } from "ws";
import { createDemoServer } from "../server/app";
import { runtimeConfig } from "../server/config";
import { HomeStore } from "../server/home";
import { KnowledgeStore } from "../server/knowledge";

loadDotenv({ path: new URL("../.env", import.meta.url), quiet: true });

const TURN_TIMEOUT_MS = 120_000; // Bound each billable real-service verification turn.
const READY_TIMEOUT_MS = 50_000; // Includes Entra token acquisition and managed session configuration.
const POLL_MS = 50; // Keep assertions responsive without busy-waiting on streamed events.
const AUDIO_FRAME_BYTES = 960; // 20 ms of signed 16-bit mono PCM at 24 kHz.
const AUDIO_FRAME_MS = 20; // Pace synthetic audio like microphone input, not a bulk transfer.
const TRAILING_SILENCE_BYTES = 57_600; // 1.2 seconds lets server VAD detect the utterance end.
const model = process.env.LIVE_MODEL ?? "microsoft-realtime-flash-1";
const openingLanguage = process.env.LIVE_LANGUAGE ?? "zh";
assert(
  openingLanguage === "zh" || openingLanguage === "en",
  "LIVE_LANGUAGE must be zh or en.",
);
type Event = Record<string, unknown> & { type: string };

if (process.env.RUN_LIVE_TESTS !== "1") {
  console.info(
    "Live tests are opt-in. Set RUN_LIVE_TESTS=1 and configure a real Foundry project.",
  );
  process.exit(0);
}

const config = runtimeConfig({ ...process.env, HAIER_VERIFIED_MODELS: model });
assert(
  config.projectEndpoint,
  "Configure FOUNDRY_PROJECT_ENDPOINT before live verification.",
);
assert(
  config.models.some((entry) => entry.id === model && entry.available),
  "This model is not an implemented selector.",
);
const home = new HomeStore();
const demo = createDemoServer({
  config,
  home,
  knowledge: new KnowledgeStore(),
});
await new Promise<void>((ready) => demo.server.listen(0, "127.0.0.1", ready));
const address = demo.server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const socket = new WebSocket(
  `${origin.replace("http:", "ws:")}/api/voice?model=${encodeURIComponent(model)}&language=${openingLanguage}`,
  { origin },
);
const events: Event[] = [];
let transportError = "";
socket.on("error", () => {
  transportError = "Live WebSocket transport failed.";
});
socket.on("message", (raw) => events.push(JSON.parse(raw.toString()) as Event));

async function waitFor(
  predicate: () => boolean,
  start: number,
  timeout = TURN_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const error = events
      .slice(start)
      .find((event) => event.type === "demo.error");
    assert(!error, String(error?.message ?? ""));
    assert(!transportError, transportError);
    if (predicate()) return;
    await new Promise((ready) => setTimeout(ready, POLL_MS));
  }
  throw new Error(
    `Timed out waiting for live model ${model}. Received: ${events
      .slice(start)
      .map((event) => event.type)
      .join(", ")}`,
  );
}

function transcriptOf(turn: Event[]): string {
  return turn
    .filter((event) =>
      [
        "response.output_audio_transcript.done",
        "response.audio_transcript.done",
        "response.output_text.done",
        "response.text.done",
      ].includes(event.type),
    )
    .map((event) => String(event.transcript ?? event.text ?? ""))
    .join(" ");
}

function hasSpokenCompletion(turn: Event[]): boolean {
  return (
    turn.some((event) => {
      const response = event.response as
        { status?: string; output?: { type: string }[] } | undefined;
      return (
        event.type === "response.done" &&
        response?.status === "completed" &&
        response.output?.some((item) => item.type === "message") &&
        !response.output.some((item) => item.type === "function_call")
      );
    }) && transcriptOf(turn).length > 0
  );
}

async function turn(text: string, label: string): Promise<Event[]> {
  const start = events.length;
  socket.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        id: `user_${start}`,
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }),
  );
  socket.send(JSON.stringify({ type: "response.create" }));
  return completeTurn(start, label, "synthetic text, not microphone audio");
}

async function completeTurn(
  start: number,
  label: string,
  input: string,
): Promise<Event[]> {
  await waitFor(() => hasSpokenCompletion(events.slice(start)), start);
  const result = events.slice(start);
  const audio = result
    .filter((event) =>
      ["response.audio.delta", "response.output_audio.delta"].includes(
        event.type,
      ),
    )
    .map((event) => Buffer.from(String(event.delta), "base64"));
  assert(audio.length > 0, `${label} returned no real speech audio.`);
  const transcript = transcriptOf(result);
  console.info(
    JSON.stringify({
      model,
      turn: label,
      transcript,
      audioBytes: audio.reduce((sum, chunk) => sum + chunk.length, 0),
      tools: result
        .filter((event) => event.type === "demo.tool")
        .map((event) => event.activity),
    }),
  );
  if (process.env.LIVE_SAVE_AUDIO === "1") {
    writeFileSync(resolve(`${model}-${label}.pcm`), Buffer.concat(audio), {
      mode: 0o600,
    });
    writeFileSync(
      resolve(`${model}-${label}.json`),
      JSON.stringify(
        {
          model,
          label,
          transcript,
          sampleRate: 24000,
          format: "signed 16-bit little-endian mono PCM",
          input,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  return result;
}

async function audioTurn(path: string, label: string): Promise<Event[]> {
  const start = events.length;
  const audio = Buffer.concat([
    readFileSync(path),
    Buffer.alloc(TRAILING_SILENCE_BYTES),
  ]);
  assert(audio.length % 2 === 0, "Audio must be raw 24 kHz 16-bit mono PCM.");
  for (let offset = 0; offset < audio.length; offset += AUDIO_FRAME_BYTES) {
    socket.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audio
          .subarray(offset, offset + AUDIO_FRAME_BYTES)
          .toString("base64"),
      }),
    );
    await new Promise((ready) => setTimeout(ready, AUDIO_FRAME_MS));
  }
  const result = await completeTurn(
    start,
    label,
    "synthetic Azure Speech audio, not physical microphone listening",
  );
  assert(
    result.some(
      (event) =>
        event.type === "conversation.item.input_audio_transcription.completed",
    ),
    "No real STT transcript was returned.",
  );
  return result;
}

try {
  await waitFor(
    () => events.some((event) => event.type === "demo.ready"),
    0,
    READY_TIMEOUT_MS,
  );
  console.info(
    JSON.stringify({
      model,
      turn: "proactive-welcome",
      language: openingLanguage,
      transcript: transcriptOf(events),
    }),
  );
  assert.match(
    transcriptOf(events),
    openingLanguage === "zh" ? /小海/ : /Hai|home assistant/i,
    "The native welcome must introduce the home assistant in the selected UI language.",
  );
  assert(
    events.some((event) =>
      ["response.audio.delta", "response.output_audio.delta"].includes(
        event.type,
      ),
    ),
    "The proactive welcome must contain real speech.",
  );
  const chinese = await turn(
    "请把客厅空调打开，设成制冷22度。用中文简单确认。",
    "zh-control",
  );
  assert(
    chinese.some(
      (event) =>
        event.type === "demo.tool" &&
        (event.activity as { name?: string; status?: string }).name ===
          "control_device",
    ),
  );
  assert.match(transcriptOf(chinese), /[\u4e00-\u9fff]/);
  assert.equal(
    home.snapshot().devices.find((entry) => entry.id === "ac")?.settings
      .temperature,
    22,
  );
  const english = await turn(
    "Now please switch to English. What are the dimensions of the BCD-480WGHTDEDXMU1 refrigerator? Use its product reference.",
    "en-manual",
  );
  assert(
    english.some(
      (event) =>
        event.type === "demo.sources" &&
        Array.isArray(event.sources) &&
        event.sources.some(
          (source: { kind: string }) => source.kind === "manufacturer",
        ),
    ),
  );
  assert.match(transcriptOf(english), /830|83|eight hundred|eighty/i);
  assert.match(
    transcriptOf(english),
    /width|wide|millimet|dimension|centimet/i,
  );
  const away = await turn(
    "Activate the away scene, please. Keep my refrigerator running.",
    "away",
  );
  assert(
    away.some(
      (event) =>
        event.type === "demo.tool" &&
        (event.activity as { name?: string }).name === "activate_scene",
    ),
  );
  assert.equal(home.snapshot().activeScene, "away");
  assert.equal(
    home.snapshot().devices.find((entry) => entry.id === "fridge")?.power,
    true,
  );
  assert.equal(home.snapshot().environment.temperature, 26.4);
  const recommendations = await turn(
    "打开电视，给我推荐两部最近值得看的剧。",
    "tv-recommendations",
  );
  assert.match(
    transcriptOf(recommendations),
    /小城良方|折月亮|尚公主|良陈美锦/,
  );
  assert.doesNotMatch(
    transcriptOf(recommendations),
    /还没拿到具体片名|正在获取推荐清单|等.{0,8}清单/,
  );
  assert.equal(
    home.snapshot().devices.find((device) => device.id === "tv")?.power,
    true,
  );
  const viewing = await turn(
    "就看《星际穿越》，帮我把观影环境也安排好。",
    "chosen-movie",
  );
  assert.equal(home.snapshot().activeScene, "movie");
  assert.match(
    String(
      home.snapshot().devices.find((device) => device.id === "tv")?.settings
        .mediaTitle,
    ),
    /星际穿越|Interstellar/i,
  );
  assert.equal(
    home.snapshot().devices.find((device) => device.id === "lights")?.settings
      .brightness,
    20,
  );
  assert.equal(
    home.snapshot().devices.find((device) => device.id === "curtains")?.settings
      .position,
    "closed",
  );
  assert.doesNotMatch(transcriptOf(viewing), /已经开始播放|正在播放电影/);
  assert.doesNotMatch(transcriptOf(viewing), /实际视频流|需要你自己.*播放/);
  await turn(
    "冰箱里的牛奶还剩多少？水果有没有需要优先安排的？",
    "food-records",
  );
  assert.deepEqual(home.snapshot().lifestyle?.shoppingList, []);
  await turn("帮我把两盒牛奶加到补货清单。", "confirmed-replenishment");
  assert.deepEqual(home.snapshot().lifestyle?.shoppingList, [
    { itemId: "milk", quantity: 2 },
  ]);
  const additional = await turn("再加两盒牛奶。", "additional-replenishment");
  assert.deepEqual(home.snapshot().lifestyle?.shoppingList, [
    { itemId: "milk", quantity: 4 },
  ]);
  assert.doesNotMatch(transcriptOf(additional), /下单成功|已付款|配送中/);
  assert.doesNotMatch(
    transcriptOf(additional),
    /这个清单只是|实际购买|自己去商店/,
  );
  const benefits = await turn(
    "这台空调有什么省心的地方？像朋友一样介绍，不用念参数。",
    "appliance-benefits",
  );
  assert.match(transcriptOf(benefits), /防直吹|送风|自清洁/);
  assert.doesNotMatch(transcriptOf(benefits), /DEMO-|夏季.{0,8}新款/);
  if (process.env.LIVE_AUDIO_ZH && process.env.LIVE_AUDIO_EN) {
    const zhAudio = await audioTurn(process.env.LIVE_AUDIO_ZH, "zh-audio");
    assert.match(transcriptOf(zhAudio), /[\u4e00-\u9fff]/);
    assert.equal(
      home.snapshot().devices.find((entry) => entry.id === "humidifier")
        ?.settings.targetHumidity,
      55,
    );
    const enAudio = await audioTurn(process.env.LIVE_AUDIO_EN, "en-audio");
    assert.match(transcriptOf(enAudio), /curtain|open/i);
    assert.equal(
      home.snapshot().devices.find((entry) => entry.id === "curtains")?.settings
        .position,
      "open",
    );
  }
  console.info(
    JSON.stringify({
      result: "PASS",
      model,
      transport: "real Foundry managed Voice Agent",
      turns: process.env.LIVE_AUDIO_ZH ? 11 : 9,
      microphoneQualityVerified: false,
    }),
  );
} finally {
  socket.close();
  demo.close();
}
