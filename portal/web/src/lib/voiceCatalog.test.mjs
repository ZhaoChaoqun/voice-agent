// Copyright (c) Microsoft. All rights reserved.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  loadLiveVoiceCatalog, voiceCatalogStatusText, withDefaultVoiceCatalog,
} from "../../../static/handoff/voice-catalog.mjs";
import { loadConfig } from "../config.js";

const voices = [{ id: "hi-IN-SwaraNeural", type: "azure-standard", locale: "hi-IN" }];

test("configuration loads defaults without issuing or awaiting live discovery", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    assert.equal(url, "/config");
    return Response.json({
      voiceCatalog: voices, voiceCatalogNotice: "Bundled reference",
      defaultVoice: "emma", openaiVoices: ["alloy"], azureVoices: [],
    });
  });
  const cfg = await loadConfig();
  assert.deepEqual(calls, ["/config"]);
  assert.equal(cfg.voiceCatalogSource, "bundled");
  assert.equal(cfg.defaultVoice, "emma");
  assert.ok(cfg.voiceCatalog.some((voice) => voice.id === "emma"));
  assert.ok(cfg.voiceCatalog.some((voice) => voice.id === "alloy"));
  assert.ok(cfg.voiceCatalog.some((voice) => voice.id === "hi-IN-SwaraNeural"));
});

test("mandatory configuration failures are not hidden by voice defaults", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Project access denied" }, { status: 401 }));
  await assert.rejects(loadConfig(), /Project access denied/);
});

test("live discovery enriches metadata and an explicit retry bypasses its failure cache", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "/api/voices?refresh=1");
    return Response.json({ source: "live", voices, notice: "Live metadata" });
  });
  const result = await loadLiveVoiceCatalog({ refresh: true });
  assert.equal(result.voiceCatalogSource, "live");
  assert.deepEqual(result.voiceCatalog, voices);
  assert.equal(result.voiceCatalogNotice, "Live metadata");
});

for (const status of [401, 403, 429, 500, 502]) {
  test(`HTTP ${status} is visible while default and configured voices remain usable`, async (t) => {
    const cfg = withDefaultVoiceCatalog({
      voiceCatalog: voices, defaultVoice: "custom-selected-voice", azureVoices: [], openaiVoices: [],
    });
    t.mock.method(globalThis, "fetch", async () => Response.json({
      error: "Discovery failed", request_id: "voice-request-id",
    }, { status }));
    await assert.rejects(loadLiveVoiceCatalog(), /Discovery failed.*voice-request-id/);
    assert.equal(cfg.defaultVoice, "custom-selected-voice");
    assert.ok(cfg.voiceCatalog.some((voice) => voice.id === "custom-selected-voice"));
    assert.match(voiceCatalogStatusText(cfg, false, "HTTP error"), /built-in.*unavailable.*unchanged/);
  });
}

test("the API explicitly returning bundled defaults is not mislabeled as live", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    source: "bundled", voices, discoveryError: { reason: "HTTP 403" },
  }));
  await assert.rejects(loadLiveVoiceCatalog(), /HTTP 403/);
});

for (const payload of [null, {}, { voices: [] }, { voices: [{ id: "voice", type: "unknown" }] }]) {
  test(`malformed live metadata stays an optional discovery error: ${JSON.stringify(payload)}`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    await assert.rejects(loadLiveVoiceCatalog(), /invalid voice catalog/);
  });
}

test("a hung request times out without changing the existing catalog", async (t) => {
  t.mock.method(globalThis, "fetch", (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  await Promise.all([
    assert.rejects(loadLiveVoiceCatalog({ timeoutMs: 10 }), /timed out after 0.01 seconds/),
    delay(20),
  ]);
});

test("cancelling old-project discovery does not turn it into a timeout", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const discovery = loadLiveVoiceCatalog({ signal: controller.signal });
  controller.abort();
  await assert.rejects(discovery, { name: "AbortError" });
});
