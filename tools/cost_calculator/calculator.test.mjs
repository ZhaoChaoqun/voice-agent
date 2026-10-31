import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULTS, MODELS, PROMPTS, GPT_LIVE_METER, supportsScenario, getRates, calculate, meterRate } from "./calculator.mjs";

const snapshot = JSON.parse((await readFile(new URL("./prices.json", import.meta.url), "utf8")).replace(/^\uFEFF/, ""));
const model = id => MODELS.find(m => m.id === id);
const book = (id, hosting = "managed", pipeline = model(id).managedPipeline || (model(id).realtime ? "native" : "cascade")) =>
  getRates(snapshot, model(id), hosting, pipeline).rates;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test("normalizes Azure 1K and 1M meters, retains exact rates", () => {
  close(book("gpt-realtime-2.1").textInput, 4);
  close(book("gpt-realtime-2.1").textCached, 0.4);
  close(book("gpt-realtime-2.1").textOutput, 24);
  close(book("gpt-realtime").textOutput, 16);
  close(book("gpt-realtime-2.1-mini").audioCached, 0.33);
  close(book("gpt-5.4", "byom").textInput, 2.5);
  close(book("gpt-5.4-mini", "byom").textOutput, 4.5);
  close(book("gpt-5.4-nano", "byom").textCached, 0.02);
  assert.throws(() => meterRate(snapshot, "not a meter"), /exactly one/);
  assert.throws(() => meterRate({ meters: [{ meterName: "bad", unitOfMeasure: "Hour", retailPrice: 1 }] }, "bad"), /Unsupported/);
});

test("every supported model/hosting/pipeline combination resolves without a missing meter error", () => {
  for (const m of MODELS) for (const hosting of ["managed", "byom"]) {
    for (const pipeline of ["native", "hybrid", "cascade", "live"]) {
      if (supportsScenario(m, hosting, pipeline)) getRates(snapshot, m, hosting, pipeline);
    }
  }
});

test("Azure Realtime uses Pro and Fast uses Lite native speech-to-speech billing", () => {
  for (const [id, tier, expected] of [
    ["azure-realtime", "Pro", [4, 0.4, 16, 32, 0.4, 64]],
    ["azure-realtime-fast", "Lite", [0.11, 0.04, 0.44, 4, 0.04, 12]],
  ]) {
    const m = model(id);
    assert.equal(m.tier, tier);
    assert.equal(Boolean(m.tierAssumption), id === "azure-realtime-fast");
    const pipeline = m.managedPipeline;
    assert.equal(pipeline, "native");
    const { rates, sources, usesGlobalReference } = getRates(snapshot, m, "managed", pipeline);
    assert.equal(usesGlobalReference, false);
    const keys = ["textInput", "textCached", "textOutput", "audioInput", "audioCached", "audioOutput"];
    keys.forEach((key, index) => {
      close(rates[key], expected[index]);
      assert.equal(sources[key].armRegionName, "centralindia");
      assert.ok(sources[key].meterName.startsWith(`Voice Live API ${tier} - LLM `));
    });
    const result = calculate({ ...DEFAULTS, nativeText: 150 }, pipeline, rates);
    const [textInput, textCached, textOutput, audioInput, audioCached, audioOutput] = expected;
    close(result.list, (5000 * textInput + 15225 * textCached + 150 * textOutput +
      427.5 * audioInput + 1923.75 * audioCached + 855 * audioOutput) / 1e6);
    assert.ok(result.rows.some(r => r.key === "audioOutput"));
    assert.ok(result.rows.every(r => !["speechInput", "speechOutput", "liveMinute"].includes(r.key)));
    const noCache = calculate({ ...DEFAULTS, cachePercent: 0 }, pipeline, rates);
    close(noCache.list, (20000 * textInput + 2351.25 * audioInput + 855 * audioOutput) / 1e6);
    const silent = calculate({ ...DEFAULTS, nativeText: 150, silencePercent: 100 }, pipeline, rates);
    close(silent.list, (5000 * textInput + 15225 * textCached + 150 * textOutput) / 1e6);
    close(result.listPerMinute, result.list / 1.5);
    assert.deepEqual(result.missing, []);
  }
});

test("Azure models use their correct managed pipeline, never substituted with GPT BYOM rates", () => {
  for (const id of ["azure-realtime", "azure-realtime-fast"]) {
    for (const hosting of ["managed", "byom"]) for (const pipeline of ["native", "hybrid", "cascade", "live"]) {
      const supported = hosting === "managed" && pipeline === "native";
      assert.equal(supportsScenario(model(id), hosting, pipeline), supported);
      if (!supported) assert.throws(() => getRates(snapshot, model(id), hosting, pipeline), /no BYOM or alternative-pipeline rates/);
    }
  }
  assert.equal(supportsScenario(model("gpt-realtime"), "byom", "hybrid"), true);
  assert.equal(supportsScenario(model("gpt-4.1"), "managed", "cascade"), true);
  assert.equal(supportsScenario(model("gpt-6-sol"), "byom", "live"), true);
});

test("BYOM models are prefilled from South India Global while speech remains Central India", () => {
  assert.equal(snapshot.region, "southindia");
  assert.equal(snapshot.voiceLiveRegion, "centralindia");
  for (const m of MODELS) {
    if (!supportsScenario(m, "byom", m.realtime ? "native" : "cascade")) continue;
    const { rates, sources } = getRates(snapshot, m, "byom");
    for (const key of ["textInput", "textCached", "textOutput", ...(m.realtime ? ["audioInput", "audioCached", "audioOutput"] : [])]) {
      assert.notEqual(rates[key], null, `${m.id} ${key} should be prefilled`);
      assert.equal(sources[key].armRegionName, "southindia");
      assert.equal(sources[key].processingScope, "Global");
      assert.doesNotMatch(sources[key].meterName, /Batch|FT|Flex| PP /);
    }
    for (const key of ["speechInput", "speechOutput"]) assert.equal(sources[key].armRegionName, "centralindia");
  }
});

test("South India GPT-4.1 and realtime prices do not reuse managed tier rates", () => {
  const rates = book("gpt-4.1", "byom");
  close(rates.textInput, 2);
  close(rates.textCached, 0.5);
  close(rates.textOutput, 8);
  close(book("gpt-4.1-mini", "byom").textInput, 0.4);
  close(book("gpt-4.1-nano", "byom").textOutput, 0.4);
  close(book("gpt-realtime-2.1-mini", "byom").audioInput, 10);
  close(book("gpt-realtime-2.1-mini", "byom").textCached, 0.06);
  close(book("gpt-realtime", "byom").audioOutput, 64);
  const result = calculate({ ...DEFAULTS, prompt: 0 }, "cascade", rates);
  close(result.list, (150 * 2 + 450 * 0.5 + 150 * 8 + 427.5 * 12.5 + 855 * 23) / 1e6);
});

test("unverified managed tiers use explicit Global model references, not invented tier rates", () => {
  for (const id of ["gpt-5.6-luna", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-oss-120b", "gpt-6-sol"]) {
    const reference = getRates(snapshot, model(id), "managed");
    assert.equal(reference.usesGlobalReference, true);
    assert.deepEqual(reference.rates, book(id, "byom"));
    assert.equal(reference.sources.textInput.processingScope, "Global");
    assert.equal(reference.sources.speechOutput.armRegionName, "centralindia");
    assert.notEqual(calculate(DEFAULTS, "cascade", reference.rates).list, null);
  }
  const tier = getRates(snapshot, model("gpt-4.1"), "managed");
  assert.equal(tier.usesGlobalReference, false);
  close(tier.rates.textInput, 4);
});

test("GPT-5.6 Luna BYOM uses exact Standard Global inference meters and BYO speech", () => {
  const { rates, sources } = getRates(snapshot, model("gpt-5.6-luna"), "byom");
  close(rates.textInput, 0.2);
  close(rates.textCached, 0.02);
  close(rates.textOutput, 1.2);
  close(rates.speechInput, 12.5);
  close(rates.speechOutput, 23);
  for (const key of ["textInput", "textCached", "textOutput"]) {
    assert.match(sources[key].meterName, /^5\.6 luna ShortCo .* Std Gl 1M Tokens$/);
    assert.equal(sources[key].retrievedAt, "2026-10-26");
    assert.equal(sources[key].armRegionName, "southindia");
    assert.equal(sources[key].processingScope, "Global");
  }
  const textCost = (5000 * 0.2 + 15000 * 0.02 + 150 * 0.2 + 450 * 0.02 + 150 * 1.2) / 1e6;
  const cascade = calculate(DEFAULTS, "cascade", rates);
  close(cascade.list, textCost + (427.5 * 12.5 + 855 * 23) / 1e6);
  close(cascade.listPerMinute, cascade.list / 1.5);
  const live = calculate(DEFAULTS, "live", book("gpt-5.6-luna", "byom", "live"));
  close(live.list, textCost + 1.5 * 0.05);
});

test("all selectable models have priced scenarios across both hosting modes", () => {
  for (const hosting of ["managed", "byom"]) for (const m of MODELS) {
    const pipeline = m.managedPipeline || (m.realtime ? "native" : "cascade");
    if (!supportsScenario(m, hosting, pipeline)) continue;
    const result = calculate(DEFAULTS, pipeline, book(m.id, hosting));
    assert.notEqual(result.list, null, `${hosting} / ${m.id}`);
    assert.deepEqual(result.missing, []);
  }
});

test("default native call counts fresh audio and cached history without speech duplication", () => {
  const result = calculate({ ...DEFAULTS, prompt: 0 }, "native", book("gpt-realtime-2.1"));
  assert.equal(DEFAULTS.inputAudioRate, 10);
  assert.equal(DEFAULTS.outputAudioRate, 20);
  assert.equal(DEFAULTS.silencePercent, 5);
  assert.equal(result.inputAudio, 427.5);
  assert.equal(result.outputAudio, 855);
  close(result.list, (427.5 * 32 + 855 * 64 + 1923.75 * 0.4) / 1e6);
  assert.ok(result.rows.every(r => !r.label.includes("Azure")));
});

test("input audio rate overrides do not change output audio usage", () => {
  const rates = book("gpt-realtime-2.1");
  const original = calculate({ ...DEFAULTS, prompt: 0, inputAudioRate: 20 }, "native", rates);
  const updated = calculate({ ...DEFAULTS, prompt: 0 }, "native", rates);
  assert.equal(original.inputAudio, 855);
  assert.equal(updated.inputAudio, 427.5);
  assert.equal(original.outputAudio, 855);
  assert.equal(updated.outputAudio, 855);
  close(original.list, (855 * 32 + 855 * 64 + 2565 * 0.4) / 1e6);
  close(original.list - updated.list, (427.5 * 32 + 641.25 * 0.4) / 1e6);
});

test("system prompt is full price once, reused across the remaining turns", () => {
  const rates = book("gpt-realtime-2.1");
  const base = calculate({ ...DEFAULTS, prompt: 0 }, "native", rates);
  const full = calculate(DEFAULTS, "native", rates);
  close(full.list - base.list, 5000 * (4 + 3 * 0.4) / 1e6);
  const noCache = calculate({ ...DEFAULTS, cachePercent: 0 }, "native", rates);
  close(noCache.list, (20000 * 4 + 2351.25 * 32 + 855 * 64) / 1e6);
  const halfCache = calculate({ ...DEFAULTS, cachePercent: 50 }, "native", rates);
  close(halfCache.list, (noCache.list + full.list) / 2);
});

test("single turn does not charge replayed context", () => {
  const result = calculate({ ...DEFAULTS, turns: 1 }, "hybrid", book("gpt-realtime-2.1"));
  assert.ok(result.rows.every(r => !r.label.includes("/ cached")));
  close(result.list, (5000 * 4 + 427.5 * 32 + 150 * 24 + 855 * 31) / 1e6);
});

test("hybrid uses 150 text output tokens and HD list price, no native output audio charge", () => {
  const result = calculate({ ...DEFAULTS, prompt: 0 }, "hybrid", book("gpt-realtime-2.1"));
  const llm = (427.5 * 32 + 641.25 * 0.4 + 225 * 0.4 + 150 * 24) / 1e6;
  close(result.list, llm + 855 * 31 / 1e6);
  assert.ok(result.rows.every(r => r.key !== "audioOutput"));
});

test("BYOM uses BYO speech meters, not managed tier prices", () => {
  const rates = book("gpt-5.4", "byom");
  close(rates.speechInput, 12.5);
  close(rates.speechOutput, 23);
  close(rates.textOutput, 15);
  const result = calculate({ ...DEFAULTS, prompt: 0 }, "cascade", rates);
  const llm = (150 * 2.5 + 450 * 0.25 + 150 * 15) / 1e6;
  close(result.list, llm + (427.5 * 12.5 + 855 * 23) / 1e6);
  close(result.listPerMinute, result.list / 1.5);
});

test("OSS without published cached pricing charges full input instead of free caching", () => {
  const rates = book("gpt-oss-120b", "byom");
  close(rates.textInput, 0.15);
  close(rates.textCached, 0.15);
  close(rates.textOutput, 0.6);
});

test("unknown prices block totals, not silently treated as zero", () => {
  const rates = { ...book("gpt-4.1", "byom"), textInput: null };
  const result = calculate(DEFAULTS, "cascade", rates);
  assert.equal(result.list, null);
  assert.equal(result.listPerMinute, null);
  assert.ok(result.missing.includes("textInput"));
  const unknownSpeech = calculate(DEFAULTS, "cascade", { ...book("gpt-5.4", "byom"), speechOutput: null });
  assert.equal(unknownSpeech.list, null);
  assert.equal(unknownSpeech.listPerMinute, null);
  assert.ok(unknownSpeech.missing.includes("speechOutput"));
});

test("GPT Live hourly AOAI meter converts to a per-minute reference, not a token rate", () => {
  const meter = snapshot.meters.find(m => m.meterName === GPT_LIVE_METER);
  assert.equal(meter.armRegionName, "southindia");
  assert.equal(meter.processingScope, "Global");
  close(meterRate(snapshot, GPT_LIVE_METER, "minutes"), 0.05);
  assert.throws(() => meterRate(snapshot, GPT_LIVE_METER), /Unsupported/);
  assert.throws(() => meterRate(snapshot, "Voice Live API Pro - LLM Text Input Tokens", "minutes"), /Unsupported/);
  assert.equal(book("gpt-5.4", "byom").liveMinute, null);
});

test("GPT Live uses South India GPT-6 Sol backend and AOAI voice prices", () => {
  const rates = book("gpt-6-sol", "byom", "live");
  close(rates.liveMinute, 0.05);
  close(rates.textInput, 2);
  close(rates.textCached, 0.2);
  close(rates.textOutput, 10);
  const result = calculate({ ...DEFAULTS, prompt: 0 }, "live", rates);
  close(result.list, (150 * 2 + 450 * 0.2 + 150 * 10) / 1e6 + 1.5 * 0.05);
  assert.ok(result.rows.every(r => !r.label.includes("Azure")));
});

test("priced GPT Live backend adds session minutes without whole-minute rounding or speech duplication", () => {
  const result = calculate({ ...DEFAULTS, prompt: 0 }, "live", book("gpt-5.4", "byom", "live"));
  close(result.list, (150 * 2.5 + 450 * 0.25 + 150 * 15) / 1e6 + 1.5 * 0.05);
  const session = result.rows.find(r => r.key === "liveMinute");
  close(session.list, 0.075);
  assert.equal(session.unit, "minutes");
  assert.ok(result.rows.every(r => !["speechInput", "speechOutput", "audioInput", "audioOutput"].includes(r.key)));
  const missingSession = calculate(DEFAULTS, "live", { ...book("gpt-5.4", "byom", "live"), liveMinute: null });
  assert.deepEqual(missingSession.missing, ["liveMinute"]);
  assert.equal(missingSession.list, null);
});

test("reasoning output is billed but not added to visible cached history", () => {
  const base = calculate(DEFAULTS, "cascade", book("gpt-4.1"));
  const extra = calculate({ ...DEFAULTS, reasoning: 1000 }, "cascade", book("gpt-4.1"));
  close(extra.list - base.list, 1000 * 16 / 1e6);
});

test("results and components expose only list-price fields", () => {
  const result = calculate(DEFAULTS, "cascade", book("gpt-4.1"));
  assert.deepEqual(Object.keys(result).sort(), ["inputAudio", "list", "listPerMinute", "missing", "outputAudio", "rows"]);
  for (const row of result.rows) {
    assert.deepEqual(Object.keys(row).sort(), ["key", "label", "list", "quantity", "rate", "unit"]);
  }
  close(result.list, result.rows.reduce((sum, row) => sum + row.list, 0));
  close(result.listPerMinute, result.list / 1.5);
});

test("invalid assumptions and negative rates are rejected", () => {
  for (const changes of [{ duration: 0 }, { turns: 0 }, { turns: 1.5 }, { humanSeconds: 91 },
    { agentSeconds: -1 }, { prompt: NaN }, { cachePercent: 101 }, { calls: 1.5 }, { inputAudioRate: Infinity },
    { silencePercent: -1 }, { silencePercent: 101 }, { silencePercent: NaN }, { silencePercent: Infinity }]) {
    assert.throws(() => calculate({ ...DEFAULTS, ...changes }, "native", book("gpt-realtime")));
  }
  assert.throws(() => calculate(DEFAULTS, "native", { ...book("gpt-realtime"), audioInput: -1 }), /Invalid rate/);
  assert.throws(() => calculate({ ...DEFAULTS, prompt: Number.MAX_VALUE }, "native", book("gpt-realtime")), /too large/);
});

test("zero-priced input is explicit and unused missing rates do not block a total", () => {
  const rates = { ...book("gpt-realtime"), textInput: null, textCached: null, audioOutput: 0 };
  const result = calculate({ ...DEFAULTS, prompt: 0 }, "native", rates);
  assert.deepEqual(result.missing, []);
  close(result.list, (427.5 * 32 + 1923.75 * 0.4) / 1e6);
});

test("silence scales only audio rows, with zero preserving baseline and full silence removing audio", () => {
  const audioKeys = new Set(["audioInput", "audioCached", "audioOutput", "speechInput", "speechOutput"]);
  for (const hosting of ["managed", "byom"]) {
    for (const [id, pipeline] of [["gpt-realtime-2.1", "native"], ["gpt-realtime-2.1", "hybrid"],
      ["gpt-4.1", "cascade"], ["gpt-6-sol", "live"]]) {
      const rates = book(id, hosting, pipeline);
      const a = { ...DEFAULTS, nativeText: 100, reasoning: 80 };
      const baseline = calculate({ ...a, silencePercent: 0 }, pipeline, rates);
      assert.equal(baseline.inputAudio, 450);
      assert.equal(baseline.outputAudio, 900);
      for (const silencePercent of [5, 10, 20, 30, 100]) {
        const result = calculate({ ...a, silencePercent }, pipeline, rates);
        const fraction = 1 - silencePercent / 100;
        close(result.inputAudio, 450 * fraction);
        close(result.outputAudio, 900 * fraction);
        for (const row of baseline.rows) {
          const actual = result.rows.find(r => r.label === row.label);
          const factor = audioKeys.has(row.key) ? fraction : 1;
          close(actual?.quantity ?? 0, row.quantity * factor);
          close(actual?.list ?? 0, row.list * factor);
          if (actual) assert.equal(actual.rate, row.rate);
        }
        const audioCost = baseline.rows.filter(r => audioKeys.has(r.key)).reduce((sum, row) => sum + row.list, 0);
        close(result.list, baseline.list - audioCost * silencePercent / 100);
        close(result.listPerMinute, result.list / 1.5);
        if (pipeline === "live") close(result.list, baseline.list);
      }
    }
  }
  close(calculate({ ...DEFAULTS, prompt: 0, silencePercent: 0 }, "native", book("gpt-realtime-2.1")).list,
    (450 * 32 + 900 * 64 + 2025 * 0.4) / 1e6);
});

test("all five prompt sizes grow monotonically for every priced model", () => {
  assert.deepEqual(PROMPTS, [0, 1000, 5000, 10000, 20000]);
  for (const m of MODELS) for (const hosting of ["managed", "byom"]) {
    const pipeline = m.managedPipeline || (m.realtime ? "native" : "cascade");
    if (!supportsScenario(m, hosting, pipeline)) continue;
    const costs = PROMPTS.map(prompt => calculate({ ...DEFAULTS, prompt }, pipeline, book(m.id, hosting)).list);
    if (costs.every(c => c !== null)) {
      for (let i = 1; i < costs.length; i++) assert.ok(costs[i] >= costs[i - 1]);
    }
  }
});
