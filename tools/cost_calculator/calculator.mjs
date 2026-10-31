export const DEFAULTS = Object.freeze({
  duration: 90, turns: 4, humanSeconds: 45, agentSeconds: 45,
  inputAudioRate: 10, outputAudioRate: 20,
  userText: 150, agentText: 150, nativeText: 0, reasoning: 0,
  cachePercent: 100, silencePercent: 5, prompt: 5000, calls: 10000,
});

export const PROMPTS = [0, 1000, 5000, 10000, 20000];
export const SOURCE_DOC = "https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live";
export const GPT_LIVE_METER = "Live 1 Gl Unit";

export const MODELS = [
  { id: "gpt-realtime-2.1", name: "GPT Realtime 2.1", tier: "Pro", realtime: true, output2: true },
  { id: "gpt-realtime-2.1-mini", name: "GPT Realtime 2.1 mini", tier: "Std", realtime: true },
  { id: "gpt-realtime", name: "GPT Realtime 1.0 (gpt-realtime)", tier: "Pro", realtime: true },
  { id: "gpt-realtime-1.5", name: "GPT Realtime 1.5", tier: "Pro", realtime: true },
  { id: "azure-realtime", name: "Azure Realtime", tier: "Pro", realtime: true, managedPipeline: "native" },
  { id: "azure-realtime-fast", name: "Azure Realtime Fast", tier: "Lite", realtime: true,
    managedPipeline: "native", tierAssumption: true },
  { id: "gpt-4.1", name: "GPT-4.1", tier: "Pro" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 mini", tier: "Std" },
  { id: "gpt-4.1-nano", name: "GPT-4.1 nano", tier: "Lite" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
  { id: "gpt-5.4", name: "GPT-5.4", tier: "Pro", byomPrefix: "5.4" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 mini", byomPrefix: "5.4 mini" },
  { id: "gpt-5.4-nano", name: "GPT-5.4 nano", byomPrefix: "5.4 nano" },
  { id: "gpt-5.2", name: "GPT-5.2", tier: "Pro", byomPrefix: "GPT 5.2" },
  { id: "gpt-5.1", name: "GPT-5.1", tier: "Pro", byomPrefix: "GPT 5.1" },
  { id: "gpt-oss-120b", name: "GPT OSS 120B", oss: true },
  { id: "gpt-6-sol", name: "GPT-6 Sol" },
];

export function supportsScenario(model, hosting, pipeline) {
  if (model.managedPipeline) return hosting === "managed" && pipeline === model.managedPipeline;
  return ["native", "hybrid"].includes(pipeline) ? Boolean(model.realtime) : !model.realtime;
}

export function validateAssumptions(a) {
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof a[key] !== "number" || !Number.isFinite(a[key]) || a[key] < 0) {
      throw new Error(`${key} must be a finite, non-negative number.`);
    }
  }
  if (a.duration === 0) throw new Error("Call duration must be greater than zero.");
  if (!Number.isInteger(a.turns) || a.turns < 1) throw new Error("Turns must be a positive integer.");
  if (!Number.isInteger(a.calls)) throw new Error("Call volume must be an integer.");
  if (a.humanSeconds + a.agentSeconds > a.duration) {
    throw new Error("Human + agent speaking time cannot exceed call duration in this turn-based estimate.");
  }
  if (a.cachePercent > 100) throw new Error("Cache percentage must be between 0 and 100.");
  if (a.silencePercent > 100) throw new Error("Silence percentage must be between 0 and 100.");
}

export function meterRate(snapshot, name, unit = "tokens") {
  const matches = snapshot.meters.filter(m => m.meterName === name);
  if (matches.length !== 1) throw new Error(`Expected exactly one retail meter: ${name}`);
  const meter = matches[0];
  const units = { tokens: { "1K": 1000, "1M": 1 }, minutes: { "1 Hour": 1 / 60, "1 Minute": 1 } };
  const factor = units[unit]?.[meter.unitOfMeasure];
  if (!factor || !Number.isFinite(meter.retailPrice) || meter.retailPrice < 0) {
    throw new Error(`Unsupported retail rate or unit: ${name}`);
  }
  return meter.retailPrice * factor;
}

export function getRates(snapshot, model, hosting, pipeline = model.managedPipeline || "cascade") {
  if (model.managedPipeline && !supportsScenario(model, hosting, pipeline)) {
    throw new Error(`${model.name} uses a managed ${model.managedPipeline} tier reference; no BYOM or alternative-pipeline rates are verified.`);
  }
  const rates = { textInput: null, textCached: null, textOutput: null,
    audioInput: null, audioCached: null, audioOutput: null, speechInput: null, speechOutput: null,
    liveMinute: null };
  const evidence = [];
  const sources = {};
  const usesGlobalReference = hosting === "managed" && !model.tier;
  function read(key, name, unit = "tokens") {
    rates[key] = meterRate(snapshot, name, unit);
    sources[key] = snapshot.meters.find(m => m.meterName === name);
    evidence.push(name);
  }
  if (hosting === "managed" && model.tier) {
    const prefix = `Voice Live API ${model.tier}`;
    read("textInput", `${prefix} - LLM Text Input Tokens`);
    read("textCached", `${prefix} - LLM Text Cached Tokens`);
    read("textOutput", `${prefix} - LLM Text Output${model.output2 ? " 2" : ""} Tokens`);
    read("speechInput", `${prefix} - Standard Speech Audio Input Tokens`);
    read("speechOutput", `${prefix} - Standard Speech Audio ${model.tier === "Std" ? "Outpt" : "Output"} Tokens`);
    if (model.realtime) {
      read("audioInput", `${prefix} - LLM Audio Input Tokens`);
      read("audioCached", `${prefix}${model.tier === "Std" ? "-" : " -"} LLM Audio Cached Tokens`);
      read("audioOutput", `${prefix}${model.tier === "Std" ? "-" : " -"} LLM Audio Output Tokens`);
    }
  } else if (hosting === "byom" || usesGlobalReference) {
    read("speechInput", "Voice Live BYO Standard Speech Audio Input Tokens");
    read("speechOutput", "Voice Live BYO Standard Speech Audio Output Tokens");
    if (model.realtime) {
      if (model.id.startsWith("gpt-realtime-2.1")) {
        for (const [kind, label] of [["text", "Text"], ["audio", "Audio"]]) {
          read(`${kind}Input`, `${model.id} ${label} inp Gl 1M Tokens`);
          read(`${kind}Cached`, `${model.id} ${label} cd inp Gl 1M Tokens`);
          read(`${kind}Output`, `${model.id} ${label} opt Gl 1M Tokens`);
        }
      } else if (model.id === "gpt-realtime-1.5") {
        for (const [kind, label] of [["text", "txt"], ["audio", "aud"]]) {
          read(`${kind}Input`, `gpt rt 1.5 ${label} inp Gl 1M Tokens`);
          read(`${kind}Cached`, `gpt rt 1.5 ${label} cd inp Gl 1M Tokens`);
          read(`${kind}Output`, `gpt rt 1.5 ${label} opt Gl 1M Tokens`);
        }
      } else {
        for (const [kind, label] of [["text", "txt"], ["audio", "aud"]]) {
          read(`${kind}Input`, `gpt rt ${label} 0828 Inp glbl Tokens`);
          read(`${kind}Cached`, `gpt rt ${label} 0828 cchd Inp glbl Tokens`);
          read(`${kind}Output`, `gpt rt ${label} 0828 Outp glbl Tokens`);
        }
      }
    } else if (model.id.startsWith("gpt-4.1")) {
      const p = model.id.replaceAll("-", " ");
      read("textInput", `${p} Inp glbl Tokens`);
      read("textCached", `${p} cached Inp glbl Tokens`);
      read("textOutput", `${p} Outp glbl Tokens`);
    } else if (model.oss) {
      read("textInput", "gpt-oss-120B Inp glbl Tokens");
      read("textOutput", "gpt-oss-120B Outp glbl Tokens");
      // No cache meter is published in the regional snapshot. Use full input
      // pricing for reused tokens rather than inventing a cache discount.
      rates.textCached = rates.textInput;
      sources.textCached = sources.textInput;
    } else if (model.id === "gpt-6-sol" || model.id === "gpt-5.6-luna") {
      const p = model.id === "gpt-6-sol" ? "6-sol" : "5.6 luna";
      read("textInput", `${p} ShortCo Inp Std Gl 1M Tokens`);
      read("textCached", `${p} ShortCo Cd Inp Std Gl 1M Tokens`);
      read("textOutput", `${p} ShortCo Opt Std Gl 1M Tokens`);
    } else if (model.byomPrefix) {
      const p = model.byomPrefix;
      read("textInput", `${p} ${p.startsWith("5.4 ") ? "Inp" : "inp"} Gl 1M Tokens`);
      read("textCached", `${p} ${p.startsWith("5.4 ") ? "cd Inp" : "cd inp"} Gl 1M Tokens`);
      read("textOutput", `${p} ${p.startsWith("5.4 ") ? "Opt" : "opt"} Gl 1M Tokens`);
    }
  }
  if (pipeline === "live") read("liveMinute", GPT_LIVE_METER, "minutes");
  return { rates, evidence, sources, usesGlobalReference };
}

export function calculate(a, pipeline, rates) {
  validateAssumptions(a);
  if (!["native", "hybrid", "cascade", "live"].includes(pipeline)) throw new Error("Unknown pipeline.");
  const rows = [];
  const missing = new Set();
  const reuse = (a.turns - 1) / 2;
  const hit = a.cachePercent / 100;
  const speakingFraction = 1 - a.silencePercent / 100;
  const inputAudio = a.humanSeconds * speakingFraction * a.inputAudioRate;
  const outputAudio = a.agentSeconds * speakingFraction * a.outputAudioRate;
  function add(label, quantity, key, unit = "tokens") {
    if (!Number.isFinite(quantity)) throw new Error(`Token quantity is too large: ${label}`);
    if (quantity === 0) return;
    const rate = rates[key];
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) throw new Error(`Invalid rate: ${key}`);
    if (rate == null) missing.add(key);
    const divisor = unit === "minutes" ? 1 : 1e6;
    const list = rate == null ? null : quantity * rate / divisor;
    if (list !== null && !Number.isFinite(list)) {
      throw new Error(`Cost is too large: ${label}`);
    }
    rows.push({ label, quantity, key, unit, rate, list });
  }
  function input(label, fresh, reused, normal, cached) {
    add(`${label} / fresh + cache misses`, fresh + reused * (1 - hit), normal);
    add(`${label} / cached`, reused * hit, cached);
  }
  input("System prompt", a.prompt, a.prompt * (a.turns - 1), "textInput", "textCached");
  if (pipeline === "native" || pipeline === "hybrid") {
    input("Caller audio", inputAudio, inputAudio * reuse, "audioInput", "audioCached");
    if (pipeline === "native") {
      input("Previous agent audio", 0, outputAudio * reuse, "audioInput", "audioCached");
      add("Native audio output", outputAudio, "audioOutput");
      input("Previous output text", 0, a.nativeText * reuse, "textInput", "textCached");
      add("Native output text (optional)", a.nativeText, "textOutput");
    } else {
      input("Previous agent text", 0, a.agentText * reuse, "textInput", "textCached");
      add("Agent text + reasoning output", a.agentText + a.reasoning, "textOutput");
      add("Azure HD speech", outputAudio, "speechOutput");
    }
  } else {
    input("User transcript", a.userText, a.userText * reuse, "textInput", "textCached");
    input("Previous agent text", 0, a.agentText * reuse, "textInput", "textCached");
    add("Agent text + reasoning output", a.agentText + a.reasoning, "textOutput");
    if (pipeline === "cascade") {
      add("Azure STT", inputAudio, "speechInput");
      add("Azure HD speech", outputAudio, "speechOutput");
    } else {
      add("GPT Live voice session", a.duration / 60, "liveMinute", "minutes");
    }
  }
  const listComplete = rows.every(r => r.list !== null);
  const list = listComplete ? rows.reduce((sum, r) => sum + r.list, 0) : null;
  return { rows, missing: [...missing], list, inputAudio, outputAudio,
    listPerMinute: list === null ? null : list / (a.duration / 60) };
}
