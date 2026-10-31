import { transcriptionLanguageError } from "./transcription-languages.mjs?v=20261028-settings-import";
import { JSON_SCHEMA, load } from "./js-yaml.mjs?v=20261028-yaml-import";

export const ENTRYPOINT_ID = "$entrypoint";

export const MODEL_ESTIMATE_CATALOG = Object.freeze({
  "gpt-realtime": { latency: "Low", cost: "High" },
  "gpt-realtime-mini": { latency: "Low", cost: "Low" },
  "gpt-realtime-1.5": { latency: "Low", cost: "High" },
  "gpt-realtime-2": { latency: "Medium", cost: "High" },
  "gpt-realtime-2.1": { latency: "Medium", cost: "High" },
  "gpt-realtime-2.1-mini": { latency: "Medium", cost: "Low" },
  "azure-realtime": { latency: "Low", cost: "High" },
  "gpt-5.4": { latency: "Medium", cost: "High" },
  "gpt-5.6-terra": { latency: "Medium", cost: "High" },
  "gpt-5.6-luna": { latency: "Medium", cost: "Low" },
  "gpt-6-sol": { latency: "Medium", cost: "High" },
  "gpt-6.1-sol": { latency: "High", cost: "High" },
  "gpt-6-luna": { latency: "Medium", cost: "Low" },
  "gpt-oss-120b": { latency: "Low", cost: "Low" },
});

const SILENT_HANDOFF_BASELINE_MS = 3126.2;
const SILENT_HANDOFF_BASELINE_MODEL_LATENCY_MS = 800;
const MODEL_REQUESTS_PER_MINUTE = 10;
const TEXT_INPUT_TOKENS_PER_REQUEST = 64_000;
const TEXT_OUTPUT_TOKENS_PER_REQUEST = 2_000;
const NATIVE_AUDIO_INPUT_TOKENS_PER_REQUEST = 6_000;
export const PIPELINE_LLM_ESTIMATE_DIVISOR = 150;
// Charge the complete context on every request, not just the new speech in that turn.
export const PIPELINE_COST_USAGE = Object.freeze({
  userAudioSeconds: 60,
  agentAudioSeconds: 60,
  inputAudioTokensPerSecond: 10,
  outputAudioTokensPerSecond: 20,
  modelRequestsPerMinute: MODEL_REQUESTS_PER_MINUTE,
  textInputTokensPerRequest: TEXT_INPUT_TOKENS_PER_REQUEST,
  textOutputTokensPerRequest: TEXT_OUTPUT_TOKENS_PER_REQUEST,
  nativeAudioInputTokensPerRequest: NATIVE_AUDIO_INPUT_TOKENS_PER_REQUEST,
  nativeAudioInputTokens: MODEL_REQUESTS_PER_MINUTE * NATIVE_AUDIO_INPUT_TOKENS_PER_REQUEST,
  textInputTokens: MODEL_REQUESTS_PER_MINUTE * TEXT_INPUT_TOKENS_PER_REQUEST,
  textOutputTokens: MODEL_REQUESTS_PER_MINUTE * TEXT_OUTPUT_TOKENS_PER_REQUEST,
});
// Round the highest verified standalone duration reference (1.7 cents) up; this is not a Voice Live tariff.
const AUXILIARY_TRANSCRIPTION_ALLOWANCE_PER_MINUTE = .02;
export const PIPELINE_RETAIL_RATES_PER_MILLION = Object.freeze({
  pro: Object.freeze({
    nativeAudioInput: 32,
    nativeAudioOutput: 64,
    speechInput: 17,
    customSpeechInput: 40,
    speechOutput: 31,
    customSpeechOutput: 55,
    textInput: 4,
    textOutput: 16,
  }),
  standard: Object.freeze({
    nativeAudioInput: 11,
    nativeAudioOutput: 22,
    speechInput: 15,
    customSpeechInput: 39,
    speechOutput: 26,
    customSpeechOutput: 50,
    textInput: .66,
    textOutput: 2.64,
  }),
  lite: Object.freeze({
    nativeAudioInput: 4,
    nativeAudioOutput: 12,
    speechInput: 15,
    customSpeechInput: 38,
    speechOutput: 25,
    customSpeechOutput: 50,
    textInput: .11,
    textOutput: .44,
  }),
});
const UNVERIFIED_MODEL_ALLOWANCE = Object.freeze({
  nativeAudioInput: 40,
  nativeAudioOutput: 80,
  speechInput: 17,
  customSpeechInput: 40,
  speechOutput: 31,
  customSpeechOutput: 55,
  textInput: 6,
  textOutput: 30,
});

export const PIPELINE_MODELS = Object.freeze([
  {
    id: "gpt-realtime-2.1",
    label: "GPT Realtime 2.1",
    architecture: "realtime",
    tier: "pro",
    typicalLatencyMs: 1300,
    textOutputRate: 24,
  },
  {
    id: "azure-realtime",
    label: "Azure Realtime",
    architecture: "realtime",
    tier: "pro",
    typicalLatencyMs: 600,
    textOutputRate: 24,
    costIsAllowance: true,
  },
  {
    id: "gpt-realtime-1.5",
    label: "GPT Realtime 1.5",
    architecture: "realtime",
    tier: "pro",
    typicalLatencyMs: 600,
    textOutputRate: 24,
    costIsAllowance: true,
  },
  {
    id: "gpt-realtime-2.1-mini",
    label: "GPT Realtime 2.1 Mini",
    architecture: "realtime",
    tier: "standard",
    typicalLatencyMs: 1000,
  },
  {
    id: "gpt-realtime",
    label: "GPT Realtime",
    architecture: "realtime",
    tier: "pro",
    typicalLatencyMs: 800,
  },
  {
    id: "gpt-realtime-mini",
    label: "GPT Realtime Mini",
    architecture: "realtime",
    tier: "standard",
    typicalLatencyMs: 400,
    latencyFallback: true,
  },
  {
    id: "gpt-realtime-2",
    label: "GPT Realtime 2",
    architecture: "realtime",
    tier: "pro",
    typicalLatencyMs: 1000,
    textOutputRate: 24,
    preview: true,
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    architecture: "cascaded",
    tier: "pro",
    typicalLatencyMs: 1000,
    textOutputRate: 24,
    costIsAllowance: true,
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    architecture: "cascaded",
    tier: "pro",
    typicalLatencyMs: 1300,
    textOutputRate: 24,
    costIsAllowance: true,
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    architecture: "cascaded",
    tier: "standard",
    typicalLatencyMs: 1300,
  },
  {
    id: "gpt-6-sol",
    label: "GPT-6 Sol",
    architecture: "cascaded",
    tier: "pro",
    typicalLatencyMs: 1400,
    budgetRates: UNVERIFIED_MODEL_ALLOWANCE,
  },
  {
    id: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    architecture: "cascaded",
    tier: "pro",
    typicalLatencyMs: 1600,
    budgetRates: UNVERIFIED_MODEL_ALLOWANCE,
  },
  {
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    architecture: "cascaded",
    tier: "lite",
    typicalLatencyMs: 1400,
    budgetRates: UNVERIFIED_MODEL_ALLOWANCE,
  },
  {
    id: "gpt-oss-120b",
    label: "GPT OSS 120B",
    architecture: "cascaded",
    tier: "standard",
    typicalLatencyMs: 700,
    budgetRates: UNVERIFIED_MODEL_ALLOWANCE,
  },
]);

const TRANSCRIBERS = Object.freeze([
  {
    id: "native-realtime-audio",
    label: "No auxiliary transcript · native audio only",
    latencyMs: 0,
    latencySource: "No separate STT stage",
    costSource: "No auxiliary transcription",
    noAdditionalCost: true,
  },
  {
    id: "azure-speech",
    label: "Azure Speech",
    latencyMs: 1016,
    latencySource: "Pipecat public TTFS median",
    costSource: "Voice Live Standard Speech audio-input rate",
  },
  {
    id: "mai-transcribe",
    label: "MAI Transcribe",
    latencyMs: 525,
    latencySource: "Voice Live observed family estimate",
    costSource: "Azure Voice Live public rate via service estimator mapping",
  },
  {
    id: "mai-transcribe-2",
    label: "MAI Transcribe 2",
    latencyMs: 525,
    latencySource: "Voice Live observed family estimate",
    costSource: "Azure Voice Live public rate via service estimator mapping",
  },
  {
    id: "mai-transcribe-2-streaming",
    label: "MAI Transcribe 2 Streaming",
    latencyMs: 130,
    latencySource: "Microsoft public end-of-speech latency",
    costSource: "Azure Voice Live public rate via service estimator mapping",
    preview: true,
  },
  {
    id: "gpt-live-transcribe",
    label: "GPT Live Transcribe",
    latencyMs: 740,
    latencySource: "Realtime transcription family proxy",
    preview: true,
  },
  {
    id: "gpt-realtime-whisper",
    label: "GPT Realtime Whisper",
    latencyMs: 740,
    latencySource: "Pipecat public TTFS median",
    preview: true,
  },
  {
    id: "gpt-transcribe",
    label: "GPT Transcribe",
    latencyMs: 637,
    latencySource: "GPT-4o transcription family proxy",
    preview: true,
  },
  {
    id: "gpt-4o-transcribe",
    label: "GPT-4o Transcribe",
    latencyMs: 637,
    latencySource: "Pipecat public TTFS median",
  },
  {
    id: "gpt-4o-mini-transcribe",
    label: "GPT-4o Mini Transcribe",
    latencyMs: 637,
    latencySource: "GPT-4o transcription family proxy",
  },
  {
    id: "gpt-4o-transcribe-diarize",
    label: "GPT-4o Transcribe Diarize",
    latencyMs: 637,
    latencySource: "GPT-4o transcription family proxy",
  },
  {
    id: "whisper-1",
    label: "Whisper 1",
    latencyMs: 1507,
    latencySource: "Public hosted-API median",
  },
]);
const METERED_TRANSCRIBER_IDS = Object.freeze(TRANSCRIBERS.slice(1, 5).map((item) => item.id));
const OPENAI_VOICES = Object.freeze(
  ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]
    .map((id) => ({
      id,
      label: `${id[0].toUpperCase()}${id.slice(1)} · OpenAI native`,
      type: "openai",
      latencyMs: null,
      latencyIncludedInModel: true,
      latencySource: "Native model audio output",
    })),
);
const AZURE_REALTIME_VOICES = Object.freeze(
  ["andrew", "emma", "ava", "ryan", "sonia", "william", "natasha", "clara", "liam", "aarti", "diya", "meera",
    "yunxi", "xiaoxiao", "nanami", "keita", "denise", "remy", "thierry", "sylvie", "ximena", "alvaro", "dalia",
    "jorge", "seraphina", "florian", "elsa", "diego", "francisca", "antonio", "sunhi", "hyunsu", "premwadee", "niwat"]
    .map((id) => ({
      id,
      label: `${id[0].toUpperCase()}${id.slice(1)} · Azure Realtime native`,
      type: "azure-realtime-native",
      latencyMs: null,
      latencyIncludedInModel: true,
      latencySource: "Native model audio output",
    })),
);
const AZURE_STANDARD_VOICES = Object.freeze([
  ...["Emma", "Brian"].map((name) => ({
    id: `en-US-${name}:DragonHDOmniLatestNeural`,
    label: `${name} · Azure Dragon HD Omni`,
    type: "azure-standard",
    latencyMs: null,
    latencySource: "No latency reference for this voice",
  })),
  {
    id: "en-US-Ava:DragonHDLatestNeural",
    label: "Ava · Azure Dragon HD",
    type: "azure-standard",
    latencyMs: 307,
    latencySource: "Voice Live first-text-to-first-audio observation; public Dragon HD proxy is ~356 ms",
  },
  ...[
    "en-US-AvaNeural", "en-US-AndrewNeural", "en-US-EmmaNeural", "en-US-BrianNeural",
    "en-US-JennyNeural", "en-US-GuyNeural", "en-US-AvaMultilingualNeural", "zh-CN-XiaoxiaoNeural",
  ].map((id) => ({
    id,
    label: `${id} · Azure Speech`,
    type: "azure-standard",
    latencyMs: null,
    latencySource: "No latency reference for this voice",
  })),
  {
    id: "en-IN-Diya:DragonHDLatestNeural",
    label: "Diya · Azure Dragon HD",
    type: "azure-standard",
    latencyMs: 307,
    latencySource: "Voice Live first-text-to-first-audio observation; public Dragon HD proxy is ~356 ms",
  },
]);
const VOICES = Object.freeze([...OPENAI_VOICES, ...AZURE_REALTIME_VOICES, ...AZURE_STANDARD_VOICES]);

function normalizePipelineModelId(model) {
  if (model === "gpt-realtime-2025-08-28") return "gpt-realtime";
  if (model === "gpt-realtime-mini-2025-12-15") return "gpt-realtime-mini";
  if (model === "gpt-realtime-1.5-2026-02-23") return "gpt-realtime-1.5";
  if (model === "gpt-5.4-2026-03-05") return "gpt-5.4";
  return model;
}

function modelDefinition(model) {
  const modelId = normalizePipelineModelId(model);
  return PIPELINE_MODELS.find((item) => item.id === modelId) || null;
}

function supportedVoiceTypes() {
  return ["openai", "azure-realtime-native", "azure-standard", "azure-custom", "azure-personal"];
}

function defaultStt(model) {
  if (model.id === "azure-realtime") return "azure-speech";
  return model.architecture === "realtime" ? "whisper-1" : "azure-speech";
}

function defaultVoice(model) {
  if (model.id === "azure-realtime") return "ava";
  return model.architecture === "realtime"
    ? "alloy"
    : "en-US-Ava:DragonHDLatestNeural";
}

function configuredPipelineVoice(id, voiceType) {
  const known = VOICES.find((voice) => voice.id === id);
  if (known && (!voiceType || known.type === voiceType)) return known;
  const type = voiceType || (/^[a-z]{2,3}-[A-Z]{2}-.+Neural$/.test(id) ? "azure-standard" : "");
  if (!id || !supportedVoiceTypes().includes(type)) return null;
  return {
    id,
    label: id,
    type,
    latencyMs: null,
    latencySource: "No latency reference for this configured voice",
  };
}

function componentRates(model) {
  return model.budgetRates || PIPELINE_RETAIL_RATES_PER_MILLION[model.tier];
}

function componentCost(model, kind, { voiceType = "", customSpeech = false } = {}) {
  const rates = componentRates(model);
  if (kind === "stt") {
    const inputRate = customSpeech ? rates.customSpeechInput : rates.speechInput;
    return inputRate * PIPELINE_COST_USAGE.userAudioSeconds
      * PIPELINE_COST_USAGE.inputAudioTokensPerSecond / 1_000_000;
  }
  if (kind === "model") {
    const outputRate = model.textOutputRate ?? rates.textOutput;
    const textCost = (
      rates.textInput * PIPELINE_COST_USAGE.textInputTokens
      + outputRate * PIPELINE_COST_USAGE.textOutputTokens
    ) / 1_000_000;
    const nativeAudioInputCost = model.architecture === "realtime"
      ? rates.nativeAudioInput * PIPELINE_COST_USAGE.nativeAudioInputTokens / 1_000_000
      : 0;
    return (textCost + nativeAudioInputCost) / PIPELINE_LLM_ESTIMATE_DIVISOR;
  }
  const nativeOutput = model.architecture === "realtime"
    && (voiceType === "openai" || voiceType === "azure-realtime-native");
  let rate = rates.speechOutput;
  if (nativeOutput) rate = rates.nativeAudioOutput;
  else if (voiceType === "azure-custom" || voiceType === "azure-personal") rate = rates.customSpeechOutput;
  return rate * PIPELINE_COST_USAGE.agentAudioSeconds
    * PIPELINE_COST_USAGE.outputAudioTokensPerSecond / 1_000_000;
}

function transcriptionUsesAllowance(transcription) {
  return transcription.id !== "native-realtime-audio"
    && !METERED_TRANSCRIBER_IDS.includes(transcription.id);
}

function transcriptionCost(transcription, model, customSpeech) {
  if (transcription.id === "native-realtime-audio") return 0;
  const speechCost = componentCost(model, "stt", { customSpeech });
  if (transcriptionUsesAllowance(transcription)) {
    return Math.max(
      speechCost,
      AUXILIARY_TRANSCRIPTION_ALLOWANCE_PER_MINUTE * PIPELINE_COST_USAGE.userAudioSeconds / 60,
    );
  }
  return speechCost;
}

function transcriptionPublicRateLabel(transcription, model, customSpeech) {
  if (transcriptionUsesAllowance(transcription) || model.budgetRates) return "";
  if (transcription.id === "native-realtime-audio") return "$0 additional transcription";
  const rates = componentRates(model);
  const rate = customSpeech ? rates.customSpeechInput : rates.speechInput;
  return `$${rate} / 1M Voice Live ${customSpeech ? "custom " : ""}speech-input tokens`;
}

function modelPublicRateLabel(model) {
  if (model.budgetRates || model.costIsAllowance) return "";
  const rates = componentRates(model);
  const outputRate = model.textOutputRate ?? rates.textOutput;
  if (model.architecture === "realtime") {
    return `$${rates.nativeAudioInput} audio input + $${rates.textInput} text input + $${outputRate} text output / 1M tokens`;
  }
  return `$${rates.textInput} text input + $${outputRate} text output / 1M tokens`;
}

function voicePublicRateLabel(model, voiceType) {
  if (model.budgetRates || voiceType === "azure-personal") return "";
  const rates = componentRates(model);
  const nativeOutput = model.architecture === "realtime"
    && (voiceType === "openai" || voiceType === "azure-realtime-native");
  let rate = rates.speechOutput;
  if (nativeOutput) rate = rates.nativeAudioOutput;
  else if (voiceType === "azure-custom") rate = rates.customSpeechOutput;
  return `$${rate} / 1M ${nativeOutput ? "native audio-output" : "Voice Live speech-output"} tokens`;
}

function estimatedHandoffLatency(model) {
  return Math.round(
    SILENT_HANDOFF_BASELINE_MS
      + model.typicalLatencyMs
      - SILENT_HANDOFF_BASELINE_MODEL_LATENCY_MS,
  );
}

function buildPipeline({ model, stt, voice, voiceType = "", customSpeech = false }) {
  const transcription = TRANSCRIBERS.find((item) => item.id === stt);
  const selectedVoice = configuredPipelineVoice(voice, voiceType);
  if (
    !transcription
    || !selectedVoice
  ) return null;
  const handoffLatencyMs = estimatedHandoffLatency(model);
  const latencyMidpointMs = Math.round((model.typicalLatencyMs + handoffLatencyMs) / 2);
  const transcriptionAllowance = transcriptionUsesAllowance(transcription);
  const modelAllowance = Boolean(model.budgetRates || model.costIsAllowance);
  const customInput = customSpeech && transcription.id === "azure-speech";
  let transcriptionSource = transcription.costSource;
  if (customInput) transcriptionSource = "Voice Live Custom Speech audio-input retail rate";
  if (transcriptionAllowance || model.budgetRates) {
    transcriptionSource = "Conservative transcription allowance; exact public Voice Live rate is unverified";
  }
  return {
    architecture: model.architecture,
    tier: model.tier,
    estimatedHandoffLatencyMs: handoffLatencyMs,
    stt: {
      ...transcription,
      costPerMinute: transcriptionCost(transcription, model, customInput),
      publicRateLabel: transcriptionPublicRateLabel(transcription, model, customInput),
      costIsAllowance: transcriptionAllowance || Boolean(model.budgetRates),
      costSource: transcriptionSource,
    },
    model: {
      ...model,
      latencyMinMs: model.typicalLatencyMs,
      latencyMaxMs: handoffLatencyMs,
      latencyMs: latencyMidpointMs,
      costPerMinute: componentCost(model, "model"),
      publicRateLabel: modelPublicRateLabel(model),
      costIsAllowance: modelAllowance,
      costSource: `${modelAllowance
        ? "Conservative model allowance; exact public Voice Live rate is unverified"
        : "Azure Voice Live public retail rate"}. Temporary model budget /${PIPELINE_LLM_ESTIMATE_DIVISOR}; workload revision pending approval`,
    },
    voice: {
      ...selectedVoice,
      costPerMinute: componentCost(model, "voice", { voiceType: selectedVoice.type }),
      publicRateLabel: voicePublicRateLabel(model, selectedVoice.type),
      costIsAllowance: Boolean(model.budgetRates) || selectedVoice.type === "azure-personal",
      costSource: model.budgetRates || selectedVoice.type === "azure-personal"
        ? "Conservative speech allowance; exact public Voice Live rate is unverified"
        : "Azure Voice Live public retail rate",
    },
  };
}

const PRESET_DEFINITIONS = [
  {
    id: "balanced",
    label: "Balanced",
    icon: "scales",
    summary: "GPT Realtime 2.1 with native audio understanding and OpenAI voice.",
    model: "gpt-realtime-2.1",
    stt: "whisper-1",
    voice: "alloy",
  },
  {
    id: "azure-native",
    label: "Azure Native",
    icon: "audio",
    summary: "Azure Realtime with its required native voice family.",
    model: "azure-realtime",
    stt: "azure-speech",
    voice: "ava",
  },
  {
    id: "fast",
    label: "Realtime Standard",
    icon: "bolt",
    summary: "Lower-cost GPT Realtime 2.1 Mini with native audio.",
    model: "gpt-realtime-2.1-mini",
    stt: "whisper-1",
    voice: "alloy",
  },
  {
    id: "cascade-pro",
    label: "Cascade Pro",
    icon: "brain",
    summary: "GPT-5.4 with managed transcription and Azure Speech output.",
    model: "gpt-5.4",
    stt: "mai-transcribe-2",
    voice: "en-US-Ava:DragonHDLatestNeural",
  },
  {
    id: "cascade-standard",
    label: "Cascade Standard",
    icon: "leaf",
    summary: "GPT-5.6 Luna with Azure Speech input and output.",
    model: "gpt-5.6-luna",
    stt: "azure-speech",
    voice: "en-US-Ava:DragonHDLatestNeural",
  },
];

export const PIPELINE_PRESETS = Object.freeze(PRESET_DEFINITIONS.map((preset) => {
  const model = modelDefinition(preset.model);
  const pipeline = buildPipeline({ model, stt: preset.stt, voice: preset.voice });
  return Object.freeze({ ...preset, ...pipeline });
}));

export const PIPELINE_COMPONENTS = Object.freeze({
  stt: TRANSCRIBERS,
  model: PIPELINE_MODELS,
  voice: VOICES,
});

export function voiceLocale(voice) {
  if (typeof voice === "object" && voice.locale) return voice.locale;
  const id = typeof voice === "string" ? voice : voice.id || voice.value || "";
  return id.match(/^([a-z]{2,3}-(?:[A-Z][a-z]{3}-)?(?:[A-Z]{2}|\d{3}))-/)?.[1] || "";
}

export function groupVoicesByLocale(voices) {
  const groups = new Map();
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  for (const voice of voices) {
    const locale = voiceLocale(voice);
    if (!groups.has(locale)) {
      groups.set(locale, {
        locale,
        label: locale ? `${locale} · ${voice.localeName || names.of(locale)}` : "No fixed locale",
        items: [],
      });
    }
    groups.get(locale).items.push(voice);
  }
  return [...groups.values()].sort((left, right) => (
    left.locale && right.locale ? left.locale.localeCompare(right.locale) : left.locale ? -1 : right.locale ? 1 : 0
  ));
}

export function estimatePipelineComponent(kind, id) {
  const known = PIPELINE_COMPONENTS[kind].find((component) => component.id === id);
  if (known) return { ...known, latencyMs: null, costPerMinute: null };
  return {
    id,
    label: String(id || `inherited-${kind}`).replaceAll("-", " "),
    latencyMs: null,
    costPerMinute: null,
    estimateUnavailable: true,
  };
}

export function estimatePipeline({
  model = "", voice = "", voiceType = "", stt = "", customSpeech = false,
} = {}) {
  const modelId = normalizePipelineModelId(model);
  const modelEntry = modelDefinition(modelId);
  if (!modelEntry) {
    return {
      preset: null,
      pipeline: {
        available: false,
        architecture: "unknown",
        stt: estimatePipelineComponent("stt", stt || "inherited-stt"),
        model: estimatePipelineComponent("model", modelId || "inherited-model"),
        voice: estimatePipelineComponent("voice", voice || "inherited-voice"),
      },
    };
  }
  const sttId = stt || defaultStt(modelEntry);
  const voiceId = voice || defaultVoice(modelEntry);
  const pipeline = buildPipeline({ model: modelEntry, stt: sttId, voice: voiceId, voiceType, customSpeech });
  if (!pipeline) {
    return {
      preset: null,
      pipeline: {
        available: false,
        architecture: modelEntry.architecture,
        stt: estimatePipelineComponent("stt", sttId),
        model: estimatePipelineComponent("model", modelId),
        voice: estimatePipelineComponent("voice", voiceId),
      },
    };
  }
  const preset = PIPELINE_PRESETS.find(
    (item) => item.model.id === modelId
      && item.voice.id === voiceId
      && item.stt.id === sttId,
  ) || null;
  return { preset, pipeline };
}

export function pipelineComponentOptions(kind, selection = {}) {
  const currentModel = modelDefinition(normalizePipelineModelId(selection.model));
  const voices = selection.voices || PIPELINE_COMPONENTS.voice;
  if (kind === "stt") {
    return TRANSCRIBERS.filter((transcriber) => transcriber.id !== "native-realtime-audio")
      .map((transcriber) => {
        const pipeline = currentModel ? buildPipeline({
          model: currentModel,
          stt: transcriber.id,
          customSpeech: selection.customSpeech,
          voice: PIPELINE_COMPONENTS.voice.some((item) => item.id === selection.voice)
            ? selection.voice
            : defaultVoice(currentModel),
        }) : null;
        return {
          ...(pipeline?.stt || estimatePipelineComponent("stt", transcriber.id)),
          ...transcriber,
          costSource: pipeline?.stt.costSource || transcriber.costSource,
          compatible: true,
          incompatibility: "",
        };
      });
  }
  if (kind === "model") {
    return PIPELINE_MODELS.map((model) => {
      const pipeline = buildPipeline({
        model,
        stt: defaultStt(model),
        voice: defaultVoice(model),
      });
      return pipeline.model;
    });
  }
  if (!currentModel) return kind === "voice"
    ? voices.map((voice) => ({
      ...estimatePipelineComponent("voice", voice.id), ...voice, compatible: true, incompatibility: "",
    }))
    : [];
  return voices.map((candidateVoice) => {
    const pipeline = buildPipeline({
        model: currentModel,
        stt: selection.stt || defaultStt(currentModel),
        voice: candidateVoice.id,
        voiceType: candidateVoice.type,
      });
    return {
      ...(pipeline?.voice || estimatePipelineComponent("voice", candidateVoice.id)),
      ...candidateVoice,
      compatible: true,
      incompatibility: "",
    };
  });
}

export function pipelineComponentProvider(kind, component = {}) {
  if (kind === "model") {
    return component.id === "azure-realtime" ? "Azure Realtime" : "Voice Live managed";
  }
  if (kind === "stt") {
    const id = String(component.id || "");
    if (id === "native-realtime-audio") return "Model native";
    if (id === "azure-speech") return "Azure Speech";
    if (id.startsWith("mai-")) return "Microsoft AI";
    if (id.startsWith("gpt-") || id === "whisper-1") return "OpenAI";
    return "Voice Live";
  }
  const providers = {
    openai: "GPT native",
    "azure-realtime-native": "Azure Realtime",
    "azure-standard": "Azure Speech",
    "azure-custom": "Azure Custom Voice",
    "azure-personal": "Azure Personal Voice",
  };
  return providers[component.type] || "Voice Live";
}

export function pipelineMetricMinimum(component = {}, metric) {
  if (metric === "latency") {
    const value = component.latencyMinMs ?? component.latencyMs;
    return Number.isFinite(value) ? value : null;
  }
  if (metric === "cost") {
    const value = component.costMinPerMinute ?? component.costPerMinute;
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function sortPipelineComponents(kind, components, sort = {}) {
  const key = ["name", "provider", "latency", "cost"].includes(sort.key)
    ? sort.key
    : "name";
  const direction = sort.direction === "desc" ? -1 : 1;
  const text = (component) => (
    key === "provider"
      ? pipelineComponentProvider(kind, component)
      : component.label || component.id || ""
  ).toLocaleLowerCase();
  return components.map((component, index) => ({ component, index })).sort((left, right) => {
    const leftLocked = left.component.compatible === false;
    const rightLocked = right.component.compatible === false;
    if (leftLocked !== rightLocked) return leftLocked ? 1 : -1;
    if (key === "latency" || key === "cost") {
      const leftValue = pipelineMetricMinimum(left.component, key);
      const rightValue = pipelineMetricMinimum(right.component, key);
      if (leftValue === null || rightValue === null) {
        if (leftValue !== rightValue) return leftValue === null ? 1 : -1;
      } else if (leftValue !== rightValue) {
        return (leftValue - rightValue) * direction;
      }
    } else {
      const compared = text(left.component).localeCompare(text(right.component));
      if (compared) return compared * direction;
    }
    return left.index - right.index;
  }).map(({ component }) => component);
}

export const PIPELINE_METRICS_DISCLAIMER = `STT/TTS budget: ${PIPELINE_COST_USAGE.userAudioSeconds}s input + ${PIPELINE_COST_USAGE.agentAudioSeconds}s output audio. Temporary LLM estimate: previous model budget /${PIPELINE_LLM_ESTIMATE_DIVISOR}; workload revision pending approval. Actual charges may be higher; latency varies.`;

export function formatPipelineCost(value) {
  if (!Number.isFinite(value) || value < 0) return "Not available";
  const scaled = value * 10_000;
  if (!Number.isFinite(scaled)) return "Not available";
  const hundredths = Math.max(
    value > 0 ? 1 : 0,
    Math.ceil(scaled - Math.abs(scaled) * Number.EPSILON),
  );
  const amount = (hundredths / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${amount}¢/min`;
}

export function formatPipelineLatency(component) {
  const minimum = component?.latencyMinMs ?? component?.latencyMs;
  const maximum = component?.latencyMaxMs ?? component?.latencyMs;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return "Not available";
  const boundary = (value) => value >= 1000
    ? `${(value / 1000).toFixed(1)} s`
    : `${value.toLocaleString("en-US")} ms`;
  if (minimum === maximum) return boundary(minimum);
  return `${boundary(minimum)} – ${boundary(Math.ceil(maximum / 100) * 100)}`;
}

export function pipelineTotals(pipeline) {
  if (!pipeline?.available && pipeline?.available !== undefined) return null;
  const components = [pipeline.stt, pipeline.model, pipeline.voice];
  if (components.some((component) => !Number.isFinite(component.costPerMinute) || component.costPerMinute < 0)) return null;
  return {
    costPerMinute: components.reduce((total, component) => total + component.costPerMinute, 0),
    latencyMinMs: pipeline.model.latencyMinMs,
    latencyMaxMs: pipeline.model.latencyMaxMs,
    latencyMs: pipeline.model.latencyMs,
  };
}

export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function layoutHandoffGraph(
  nodeIds,
  edges,
  {
    entryId = ENTRYPOINT_ID,
    nodeWidth = 280,
    nodeHeight = 226,
    columnGap = 92,
    rowGap = 124,
    originX = 70,
    originY = 95,
  } = {},
) {
  const ids = [...new Set((nodeIds || []).map(String))];
  if (!ids.length) return new Map();

  const idSet = new Set(ids);
  const originalOrder = new Map(ids.map((id, index) => [id, index]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  const incoming = new Map(ids.map((id) => [id, []]));
  const graphEdges = (edges || [])
    .map((edge, index) => ({
      index,
      source: String(edge?.source || ""),
      target: String(edge?.target || ""),
    }))
    .filter((edge) => (
      idSet.has(edge.source)
      && idSet.has(edge.target)
      && edge.source !== edge.target
      && edge.target !== entryId
    ));

  for (const edge of graphEdges) {
    outgoing.get(edge.source).push(edge);
    incoming.get(edge.target).push(edge);
  }

  const reachable = new Set();
  const pending = idSet.has(entryId) ? [entryId] : [ids[0]];
  while (pending.length) {
    const id = pending.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of outgoing.get(id) || []) pending.push(edge.target);
  }

  // Feedback edges are drawn, but excluded from ranking so cycles cannot collapse the layout.
  const backEdges = new Set();
  const colors = new Map();
  const visit = (start) => {
    const stack = [[start, 0]];
    colors.set(start, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const children = outgoing.get(frame[0]) || [];
      if (frame[1] >= children.length) {
        colors.set(frame[0], 2);
        stack.pop();
        continue;
      }
      const edge = children[frame[1]];
      frame[1] += 1;
      if (colors.get(edge.target) === 1) {
        backEdges.add(edge.index);
      } else if (!colors.get(edge.target)) {
        colors.set(edge.target, 1);
        stack.push([edge.target, 0]);
      }
    }
  };
  if (idSet.has(entryId)) visit(entryId);
  for (const id of ids) if (!colors.get(id)) visit(id);

  const rankedEdges = graphEdges.filter((edge) => (
    !backEdges.has(edge.index)
    && reachable.has(edge.source) === reachable.has(edge.target)
  ));
  const rankOutgoing = new Map(ids.map((id) => [id, []]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const edge of rankedEdges) {
    rankOutgoing.get(edge.source).push(edge.target);
    indegree.set(edge.target, indegree.get(edge.target) + 1);
  }

  const localDepth = new Map(ids.map((id) => [id, 0]));
  const ready = ids.filter((id) => indegree.get(id) === 0);
  while (ready.length) {
    ready.sort((left, right) => originalOrder.get(left) - originalOrder.get(right));
    const source = ready.shift();
    for (const target of rankOutgoing.get(source)) {
      localDepth.set(target, Math.max(localDepth.get(target), localDepth.get(source) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) ready.push(target);
    }
  }

  const reachableDepths = ids.filter((id) => reachable.has(id)).map((id) => localDepth.get(id));
  const disconnectedStart = Math.max(0, ...reachableDepths) + 1;
  const depth = new Map(ids.map((id) => [
    id,
    reachable.has(id) ? localDepth.get(id) : disconnectedStart + localDepth.get(id),
  ]));
  const layers = new Map();
  for (const id of ids) {
    const layer = depth.get(id);
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push(id);
  }

  const slot = new Map();
  const refreshSlots = () => {
    for (const layerIds of layers.values()) {
      layerIds.forEach((id, index) => slot.set(id, index));
    }
  };
  const connectedAverage = (id, direction) => {
    const candidates = (direction === "incoming" ? incoming.get(id) : outgoing.get(id))
      .map((edge) => (direction === "incoming" ? edge.source : edge.target))
      .filter((other) => (
        direction === "incoming" ? depth.get(other) < depth.get(id) : depth.get(other) > depth.get(id)
      ));
    if (!candidates.length) return null;
    return candidates.reduce((sum, other) => sum + (slot.get(other) || 0), 0) / candidates.length;
  };
  const sortLayer = (layer, direction) => {
    const layerIds = layers.get(layer);
    layerIds.sort((left, right) => {
      const leftAverage = connectedAverage(left, direction);
      const rightAverage = connectedAverage(right, direction);
      if (leftAverage === null && rightAverage === null) {
        return originalOrder.get(left) - originalOrder.get(right);
      }
      if (leftAverage === null) return 1;
      if (rightAverage === null) return -1;
      return leftAverage - rightAverage || originalOrder.get(left) - originalOrder.get(right);
    });
    refreshSlots();
  };

  refreshSlots();
  const layerNumbers = [...layers.keys()].sort((left, right) => left - right);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const layer of layerNumbers.slice(1)) sortLayer(layer, "incoming");
    for (const layer of layerNumbers.slice(0, -1).reverse()) sortLayer(layer, "outgoing");
  }

  const widestLayer = Math.max(...[...layers.values()].map((layerIds) => layerIds.length));
  const layoutWidth = widestLayer * nodeWidth + Math.max(0, widestLayer - 1) * columnGap;
  const positions = new Map();
  for (const [layer, layerIds] of layers) {
    const layerWidth = layerIds.length * nodeWidth + Math.max(0, layerIds.length - 1) * columnGap;
    const offsetX = originX + (layoutWidth - layerWidth) / 2;
    layerIds.forEach((id, index) => {
      positions.set(id, {
        x: offsetX + index * (nodeWidth + columnGap),
        y: originY + layer * (nodeHeight + rowGap),
      });
    });
  }
  return positions;
}

export function smoothVerticalEdgePath(x1, y1, x2, y2) {
  const dy = Math.max(18, (y2 - y1) / 2);
  return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
}

export function smoothOuterEdgePath(x1, y1, x2, y2, laneX) {
  return `M${x1},${y1} C${laneX},${y1} ${laneX},${y2} ${x2},${y2}`;
}

export function sideEdgeAnchors(from, to, laneX) {
  const centerX = (
    from.x + from.width / 2
    + to.x + to.width / 2
  ) / 2;
  const side = laneX < centerX ? "left" : "right";
  return {
    side,
    sourceX: side === "left" ? from.x : from.x + from.width,
    sourceY: from.y + from.height / 2,
    targetX: side === "left" ? to.x : to.x + to.width,
    targetY: to.y + to.height / 2,
  };
}

export function pipelineBrand(kind, value) {
  const id = String(value || "").toLowerCase();
  if (id.includes("mai-transcribe")) return "mai";
  if (id.includes("whisper")) return "whisper";
  if (id.includes("azure-speech") || id.includes("speech-to-text")) return "azure";
  if (id.includes("gpt") || id === "native-realtime-audio") return "gpt";
  if (kind === "voice" && (id.startsWith("en-") || id.includes("neural"))) return "azure";
  if (kind === "voice") return "voice";
  return kind === "stt" ? "speech" : "generic";
}

export function matchesAgentSearch(name, query) {
  const haystack = String(name || "").toLocaleLowerCase();
  return String(query || "")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function stableJson(value, spacing = 2) {
  return JSON.stringify(canonical(value), null, spacing);
}

export function publicationFeatures(baseFeatures, draft = false) {
  const features = String(baseFeatures || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (draft) features.push("DraftAgents=V1Preview");
  return [...new Set(features)].join(",");
}

function yamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function yamlKey(value) {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)
    ? value
    : JSON.stringify(value);
}

function yamlLines(value, depth) {
  const indent = "  ".repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return [`${indent}[]`];
    return value.flatMap((item) => {
      if (!isObject(item) && !Array.isArray(item)) {
        return [`${indent}- ${yamlScalar(item)}`];
      }
      const nested = yamlLines(item, depth + 1);
      return [`${indent}-`, ...nested];
    });
  }
  if (isObject(value)) {
    const entries = Object.keys(value).sort();
    if (!entries.length) return [`${indent}{}`];
    return entries.flatMap((key) => {
      const item = value[key];
      if (!isObject(item) && !Array.isArray(item)) {
        return [`${indent}${yamlKey(key)}: ${yamlScalar(item)}`];
      }
      if ((Array.isArray(item) && !item.length) || (isObject(item) && !Object.keys(item).length)) {
        return [`${indent}${yamlKey(key)}: ${Array.isArray(item) ? "[]" : "{}"}`];
      }
      return [`${indent}${yamlKey(key)}:`, ...yamlLines(item, depth + 1)];
    });
  }
  return [`${indent}${yamlScalar(value)}`];
}

export function deterministicYaml(value) {
  return `${yamlLines(canonical(value), 0).join("\n")}\n`;
}

export function createBlankDefinition() {
  return {
    kind: "voice",
    model_type: "managed",
    model: "gpt-realtime",
    instructions: "You are a friendly, helpful voice assistant. The greeting is already delivered; do not repeat it. Help the caller with their questions. Keep replies concise and conversational. When the caller says goodbye or asks to end the conversation, hand off to the end node.",
    greeting: {
      type: "template",
      text: "Hello! How can I help you today?",
    },
    output_modalities: ["audio"],
    store: false,
    tool_choice: "auto",
    tools: [],
    audio: {
      input: {
        format: {
          type: "audio/pcm",
          rate: 24000,
        },
        turn_detection: {
          type: "azure_semantic_vad",
          profile: "normal",
          auto_truncate: true,
          interrupt_response: true,
          silence_duration_ms: 400,
        },
        transcription: {
          model: "azure-speech",
        },
        echo_cancellation: {
          type: "server_echo_cancellation",
        },
        noise_reduction: {
          type: "azure_deep_noise_suppression",
        },
      },
      output: {
        format: {
          type: "audio/pcm",
          rate: 24000,
        },
        voice: {
          type: "azure-standard",
          name: "en-US-Emma:DragonHDOmniLatestNeural",
        },
      },
    },
    handoff: {
      max_transfers: 16,
      max_attempts: 16,
      nodes: [
        {
          id: "end",
          description: "Close politely and end the conversation.",
          config: {
            instructions: "Say one brief, friendly goodbye in the caller's language, then call end_conversation in the same response. Do not ask another question.",
            tools: [{ type: "system", name: "end_conversation" }],
            tool_choice: "auto",
          },
        },
      ],
      edges: [
        {
          id: "entrypoint_to_end",
          source: ENTRYPOINT_ID,
          target: "end",
          description: "The caller says goodbye, asks to end the conversation, or confirms they need no further help.",
          target_response: "auto",
          cancel_on_interruption: true,
        },
      ],
    },
  };
}

export function createSampleDefinition() {
  return {
    kind: "voice",
    model: "gpt-realtime",
    instructions: "Welcome the caller, understand their goal, and route them to the right specialist.",
    tool_choice: "auto",
    tools: [],
    audio: {
      input: {
        transcription: {
          model: "whisper-1",
        },
      },
      output: {
        voice: "en-US-Ava:DragonHDLatestNeural",
      },
    },
    metadata: {
      sample: "handoff-graph-dashboard",
    },
    handoff: {
      max_transfers: 8,
      max_attempts: 10,
      nodes: [
        {
          id: "support",
          description: "Resolve product and account support questions.",
          config: {
            instructions: "Diagnose the request, explain the next step, and confirm resolution.",
            model: "gpt-realtime-mini",
            voice: "en-US-Ava:DragonHDLatestNeural",
            tools: [],
            tool_choice: "auto",
          },
        },
        {
          id: "billing",
          description: "Handle billing questions and escalation.",
          config: {
            instructions: "Review the billing context and explain charges clearly.",
            model: "gpt-realtime",
            voice: "en-US-Ava:DragonHDLatestNeural",
            tools: [],
            tool_choice: "auto",
          },
        },
      ],
      edges: [
        {
          id: "start_to_support",
          source: ENTRYPOINT_ID,
          target: "support",
          description: "Use when the caller needs product or account help.",
          transfer_message: "I’ll connect you with our support specialist.",
          target_response: "auto",
          cancel_on_interruption: true,
          delay_ms: 0,
        },
        {
          id: "start_to_billing",
          source: ENTRYPOINT_ID,
          target: "billing",
          description: "Use when the caller asks about an invoice, charge, or payment.",
          transfer_message: "I’ll bring in our billing specialist.",
          target_response: "auto",
          cancel_on_interruption: true,
          delay_ms: 0,
        },
        {
          id: "support_to_billing",
          source: "support",
          target: "billing",
          description: "Use when support discovers that the issue is billing-related.",
          transfer_message: "This is a billing matter, so I’ll transfer you now.",
          target_response: "auto",
          cancel_on_interruption: true,
          delay_ms: 0,
        },
      ],
    },
  };
}

export function ensureEditableDefinition(value) {
  if (!isObject(value)) throw new Error("The selected Agent does not contain a definition object.");
  const definition = deepClone(value);
  if (!isObject(definition.handoff)) {
    definition.handoff = {
      max_transfers: 8,
      max_attempts: 8,
      nodes: [],
      edges: [],
    };
  }
  if (!Array.isArray(definition.handoff.nodes)) definition.handoff.nodes = [];
  if (!Array.isArray(definition.handoff.edges)) definition.handoff.edges = [];
  if (definition.handoff.max_transfers === undefined) definition.handoff.max_transfers = 8;
  if (definition.handoff.max_attempts === undefined) {
    definition.handoff.max_attempts = definition.handoff.max_transfers;
  }
  return definition;
}

export function publicationDefinition(value) {
  const definition = deepClone(value);
  if (
    Array.isArray(definition.handoff?.nodes) && definition.handoff.nodes.length === 0
    && Array.isArray(definition.handoff?.edges) && definition.handoff.edges.length === 0
  ) {
    delete definition.handoff;
  }
  return definition;
}

export function extractLatestAgent(resource) {
  const latest = resource?.versions?.latest || resource;
  if (!resource?.name || !isObject(latest?.definition)) {
    throw new Error("The service returned an Agent without a latest complete definition.");
  }
  return {
    name: String(resource.name),
    version: String(latest.version || ""),
    draft: latest.draft === true,
    description: String(latest.description || ""),
    metadata: isObject(latest.metadata) ? deepClone(latest.metadata) : {},
    definition: ensureEditableDefinition(latest.definition),
  };
}

export function parseAgentJson(source) {
  let document;
  try {
    document = JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }
  return importedAgent(document);
}

export function parseAgentSource(source) {
  let document;
  try {
    document = load(source.replace(/^\uFEFF/, ""), { schema: JSON_SCHEMA, maxAliases: 0 });
  } catch (error) {
    throw new Error(`Invalid JSON or YAML: ${error.message}`);
  }
  return importedAgent(document);
}

function importedAgent(document) {
  if (!isObject(document)) throw new Error("Agent configuration must contain an object, not an array or scalar.");
  const envelope = document.versions?.latest ?? document;
  if (!isObject(envelope)) throw new Error("The imported Agent version must be an object.");
  const raw = Object.hasOwn(envelope, "definition") ? envelope.definition : envelope;
  if (!isObject(raw)) throw new Error("The imported definition must be an object.");
  const problems = definitionStructureProblems(raw);
  if (raw.sub_protocol && raw.sub_protocol !== "realtime") {
    problems.push(problem("error", "This Editor supports realtime Voice Agents, not sub_protocol: live.",
      "graph", "", "sub_protocol", "unsupported_protocol"));
  }
  if (raw.conversation_engine || raw.model_type === "hosted_agent") {
    problems.push(problem("error", "Hosted-agent wrappers are not supported by the graph Editor. Import a model-backed Voice Agent.",
      "graph", "", "conversation_engine", "unsupported_engine"));
  } else if (typeof raw.model !== "string" || !raw.model.trim()) {
    problems.push(problem("error", "A non-empty model is required.", "graph", "", "model", "model_required"));
  }
  if (raw.model_type !== undefined && !["managed", "self_deployed"].includes(raw.model_type)) {
    problems.push(problem("error", "model_type must be managed or self_deployed.",
      "graph", "", "model_type", "model_type"));
  }
  if (document.name !== undefined && (
    typeof document.name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(document.name)
  )) {
    problems.push(problem("error", "Agent name must be 1-63 letters, digits, hyphens or underscores, starting with a letter or digit.",
      "graph", "", "name", "agent_name"));
  }
  if (envelope.description !== undefined && typeof envelope.description !== "string") {
    problems.push(problem("error", "description must be a string.", "graph", "", "description", "description_type"));
  }
  if (envelope.metadata !== undefined && (
    !isObject(envelope.metadata) || Object.values(envelope.metadata).some((value) => typeof value !== "string")
  )) {
    problems.push(problem("error", "metadata must be an object with string values.", "graph", "", "metadata", "metadata_type"));
  }
  const definition = problems.length ? deepClone(raw) : ensureEditableDefinition(raw);
  if (!problems.length) problems.push(...validateDefinition(definition));
  return {
    definition,
    name: typeof document.name === "string" ? document.name : "",
    description: typeof envelope.description === "string" ? envelope.description : "",
    metadata: isObject(envelope.metadata) ? deepClone(envelope.metadata) : {},
    problems,
  };
}

function definitionStructureProblems(definition) {
  const problems = [];
  for (const path of [
    "audio", "audio.input", "audio.output", "audio.input.format", "audio.output.format",
    "audio.input.transcription", "audio.input.noise_reduction", "audio.input.echo_cancellation",
    "audio.input.turn_detection", "audio.input.turn_detection.end_of_utterance_detection", "handoff",
    "structured_inputs", "subagent_config", "avatar", "reasoning", "rai_config",
  ]) {
    const value = path.split(".").reduce((parent, key) => parent?.[key], definition);
    if (value !== undefined && value !== null && !isObject(value)) {
      problems.push(problem("error", `${path} must be an object or null.`, "graph", "", path, "object_type"));
    }
  }
  for (const path of [
    "instructions", "audio.input.transcription.model", "audio.input.transcription.prompt",
    "audio.input.transcription.delay", "audio.output.voice_type", "audio.output.voice_locale",
    "audio.input.turn_detection.type", "audio.input.noise_reduction.type",
    "audio.input.format.type", "audio.output.format.type",
  ]) {
    const value = path.split(".").reduce((parent, key) => parent?.[key], definition);
    if (value !== undefined && typeof value !== "string") {
      problems.push(problem("error", `${path} must be a string.`, "graph", "", path, "string_type"));
    }
  }
  if (definition.tools !== undefined && (
    !Array.isArray(definition.tools) || definition.tools.some((item) => !isObject(item) || typeof item.type !== "string")
  )) {
    problems.push(problem("error", "tools must be an array of tool objects with a type.", "graph", "", "tools", "tools_type"));
  }
  for (const key of ["include", "output_modalities"]) {
    if (definition[key] !== undefined && (
      !Array.isArray(definition[key]) || definition[key].some((item) => typeof item !== "string")
    )) {
      problems.push(problem("error", `${key} must be an array of strings.`, "graph", "", key, "array_type"));
    }
  }
  const customSpeech = definition.audio?.input?.transcription?.custom_speech;
  if (customSpeech !== undefined && (
    !isObject(customSpeech) || Object.values(customSpeech).some((item) => typeof item !== "string" || !item.trim())
  )) {
    problems.push(problem("error", "custom_speech must map locales to non-empty model identifiers.",
      "graph", "", "audio.input.transcription.custom_speech", "custom_speech_type"));
  }
  const voice = definition.audio?.output?.voice;
  if (voice !== undefined && typeof voice !== "string" && !isObject(voice)) {
    problems.push(problem("error", "Output voice must be a voice name or a legacy voice object.",
      "graph", "", "audio.output.voice", "voice_type"));
  }
  if (isObject(voice) && (
    typeof (voice.name ?? voice.id) !== "string"
    || (voice.type !== undefined && typeof voice.type !== "string")
  )) {
    problems.push(problem("error", "A legacy voice object requires a string name or id and a string type when supplied.",
      "graph", "", "audio.output.voice", "legacy_voice_type"));
  }
  const graph = definition.handoff;
  if (isObject(graph)) {
    for (const key of ["nodes", "edges"]) {
      if (!Array.isArray(graph[key]) || graph[key].some((item) => !isObject(item))) {
        problems.push(problem("error", `handoff.${key} must be an array of objects.`,
          "graph", "", `handoff.${key}`, "graph_array_type"));
      }
    }
    for (const [index, node] of (Array.isArray(graph.nodes) ? graph.nodes : []).entries()) {
      if (!isObject(node)) continue;
      if (typeof node.id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(node.id)) {
        problems.push(problem("error", `handoff.nodes[${index}].id must start with a lowercase letter and contain only lowercase letters, digits, hyphens or underscores (up to 64 characters).`,
          "graph", "", `handoff.nodes[${index}].id`, "node_id_format"));
      }
    }
  }
  return problems;
}

export function modelEstimate(model) {
  const name = normalizePipelineModelId(typeof model === "string" ? model : "");
  const estimate = MODEL_ESTIMATE_CATALOG[name];
  return estimate
    ? { ...estimate, source: "Estimated from Voice Live guidance and public retail tier", available: true }
    : {
        latency: "Not available",
        cost: "Not available",
        source: "No estimate for custom or unknown values",
        available: false,
      };
}

function problem(severity, message, objectKind, objectId, field, code) {
  return { severity, message, objectKind, objectId, field, code };
}

function validateInterimResponse(problems, config, objectId) {
  const interim = config?.interim_response;
  if (interim === undefined || interim === null) return;
  if (!isObject(interim)) {
    problems.push(problem(
      "error", "interim_response must be an object.", "node", objectId,
      "interim_response", "interim_response_type",
    ));
    return;
  }
  if (!["static_interim_response", "llm_interim_response"].includes(interim.type)) {
    problems.push(problem(
      "error", "interim_response.type is not supported.", "node", objectId,
      "interim_response.type", "interim_response_kind",
    ));
  }
  if (interim.triggers !== undefined && !Array.isArray(interim.triggers)) {
    problems.push(problem(
      "error", "interim_response.triggers must be an array.", "node", objectId,
      "interim_response.triggers", "interim_response_triggers",
    ));
  }
  if (
    interim.type === "static_interim_response"
    && (!Array.isArray(interim.texts) || !interim.texts.some((text) => String(text).trim()))
  ) {
    problems.push(problem(
      "error", "Static interim response requires at least one text.", "node", objectId,
      "interim_response.texts", "interim_response_texts",
    ));
  }
  if (
    interim.latency_threshold_ms !== undefined
    && (!Number.isInteger(interim.latency_threshold_ms) || interim.latency_threshold_ms < 0)
  ) {
    problems.push(problem(
      "error", "interim_response.latency_threshold_ms must be a non-negative integer.",
      "node", objectId, "interim_response.latency_threshold_ms", "interim_response_latency",
    ));
  }
  if (
    interim.type === "llm_interim_response"
    && interim.max_completion_tokens !== undefined
    && (!Number.isInteger(interim.max_completion_tokens) || interim.max_completion_tokens < 1)
  ) {
    problems.push(problem(
      "error", "interim_response.max_completion_tokens must be a positive integer.",
      "node", objectId, "interim_response.max_completion_tokens", "interim_response_tokens",
    ));
  }
}

export function validateDefinition(definition) {
  const problems = [];
  if (!isObject(definition)) {
    return [problem("error", "Definition must be an object.", "graph", "", "definition", "definition_type")];
  }
  const shapeProblems = definitionStructureProblems(definition);
  if (shapeProblems.length) return shapeProblems;
  if (definition.kind !== "voice") {
    problems.push(problem(
      "error", 'definition.kind must be "voice".', "graph", "", "kind", "definition_kind",
    ));
  }
  if (definition.store !== undefined && typeof definition.store !== "boolean") {
    problems.push(problem(
      "error", "store must be true or false.", "node", ENTRYPOINT_ID,
      "store", "store_type",
    ));
  }
  if (
    definition.output_modalities !== undefined
    && (!Array.isArray(definition.output_modalities) || !definition.output_modalities.length)
  ) {
    problems.push(problem(
      "error", "output_modalities must be a non-empty array.", "node", ENTRYPOINT_ID,
      "output_modalities", "output_modalities_type",
    ));
  }
  const rootStt = String(definition.audio?.input?.transcription?.model || "").trim();
  const languageError = transcriptionLanguageError(
    rootStt || "azure-speech", definition.audio?.input?.transcription?.language,
  );
  if (languageError) {
    problems.push(problem(
      "error", languageError, "node", ENTRYPOINT_ID,
      "audio.input.transcription.language", "invalid_transcription_language",
    ));
  }
  const transcription = definition.audio?.input?.transcription;
  if (transcription?.phrase_list !== undefined && (
    !Array.isArray(transcription.phrase_list)
    || transcription.phrase_list.some((value) => typeof value !== "string" || !value.trim())
  )) {
    problems.push(problem("error", "Phrase list must be an array of non-empty strings.",
      "node", ENTRYPOINT_ID, "audio.input.transcription.phrase_list", "phrase_list_type"));
  }
  const echo = definition.audio?.input?.echo_cancellation;
  if (echo && (
    echo.type !== "server_echo_cancellation"
    || !["server", "client"].includes(echo.reference_source ?? "server")
    || (echo.reference_source === "client" ? echo.channels !== 2 : (echo.channels ?? 1) !== 1)
  )) {
    problems.push(problem("error",
      "Echo cancellation requires type server_echo_cancellation and either server/1 channel or client/2 channels.",
      "node", ENTRYPOINT_ID, "audio.input.echo_cancellation", "echo_cancellation_config"));
  }
  if (echo?.reference_source === "client" && (
    definition.audio?.input?.format?.type !== "audio/pcm" || definition.avatar
  )) {
    problems.push(problem("error", "Client-reference echo cancellation requires PCM input and no avatar in this Portal.",
      "node", ENTRYPOINT_ID, "audio.input.echo_cancellation", "echo_cancellation_transport"));
  }
  if (definition.parallel_tool_calls !== undefined && typeof definition.parallel_tool_calls !== "boolean") {
    problems.push(problem("error", "parallel_tool_calls must be true or false.",
      "node", ENTRYPOINT_ID, "parallel_tool_calls", "parallel_tool_calls_type"));
  }
  if (definition.max_output_tokens !== undefined && definition.max_output_tokens !== "inf"
    && (!Number.isInteger(definition.max_output_tokens) || definition.max_output_tokens < 1)) {
    problems.push(problem("error", "max_output_tokens must be a positive integer or inf.",
      "node", ENTRYPOINT_ID, "max_output_tokens", "max_output_tokens_type"));
  }
  const greeting = definition.greeting;
  if (greeting !== undefined) {
    if (!isObject(greeting) || !["template", "llm_generated"].includes(greeting.type)) {
      problems.push(problem(
        "error", "greeting.type must be template or llm_generated.", "node", ENTRYPOINT_ID,
        "greeting.type", "greeting_type",
      ));
    } else if (greeting.type === "template" && !String(greeting.text || "").trim()) {
      problems.push(problem(
        "error", "Template greeting requires text.", "node", ENTRYPOINT_ID,
        "greeting.text", "greeting_text",
      ));
    } else if (greeting.type === "llm_generated" && !String(greeting.prompt || "").trim()) {
      problems.push(problem(
        "error", "LLM-generated greeting requires a prompt.", "node", ENTRYPOINT_ID,
        "greeting.prompt", "greeting_prompt",
      ));
    }
  }
  for (const [field, value] of [
    ["audio.input.format.rate", definition.audio?.input?.format?.rate],
    ["audio.output.format.rate", definition.audio?.output?.format?.rate],
  ]) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      problems.push(problem(
        "error", `${field} must be a positive integer.`, "node", ENTRYPOINT_ID,
        field, "audio_rate",
      ));
    }
  }
  const threshold = definition.audio?.input?.turn_detection?.threshold;
  if (threshold !== undefined && (typeof threshold !== "number" || threshold < 0 || threshold > 1)) {
    problems.push(problem(
      "error", "Turn detection threshold must be between 0 and 1.", "node", ENTRYPOINT_ID,
      "audio.input.turn_detection.threshold", "turn_threshold",
    ));
  }
  const turnDetection = definition.audio?.input?.turn_detection;
  for (const field of [
    "prefix_padding_ms",
    "silence_duration_ms",
    "idle_timeout_ms",
    "speech_duration_ms",
    "window_size_assistant_speaking",
    "distinct_ci_phones_assistant_speaking",
  ]) {
    const value = turnDetection?.[field];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      problems.push(problem(
        "error", `audio.input.turn_detection.${field} must be a non-negative integer.`,
        "node", ENTRYPOINT_ID, `audio.input.turn_detection.${field}`, "turn_duration",
      ));
    }
  }
  const assistantThreshold = turnDetection?.threshold_assistant_speaking;
  if (
    assistantThreshold !== undefined
    && (typeof assistantThreshold !== "number" || assistantThreshold < 0 || assistantThreshold > 1)
  ) {
    problems.push(problem(
      "error", "Assistant-speaking threshold must be between 0 and 1.", "node", ENTRYPOINT_ID,
      "audio.input.turn_detection.threshold_assistant_speaking", "assistant_turn_threshold",
    ));
  }
  validateInterimResponse(problems, definition, ENTRYPOINT_ID);
  if (!isObject(definition.handoff)) {
    problems.push(problem(
      "error", "definition.handoff must be an object.", "graph", "", "handoff", "handoff_type",
    ));
    return problems;
  }
  const graph = definition.handoff;
  for (const field of ["max_transfers", "max_attempts"]) {
    const value = graph[field];
    if (!Number.isInteger(value) || value < 1) {
      problems.push(problem(
        "error", `${field} must be a positive integer.`, "graph", "", field, "invalid_limit",
      ));
    }
  }
  if (
    Number.isInteger(graph.max_attempts)
    && Number.isInteger(graph.max_transfers)
    && graph.max_attempts < graph.max_transfers
  ) {
    problems.push(problem(
      "error",
      "max_attempts must be greater than or equal to max_transfers.",
      "graph",
      "",
      "max_attempts",
      "attempt_budget",
    ));
  }
  if (!Array.isArray(graph.nodes)) {
    problems.push(problem("error", "handoff.nodes must be an array.", "graph", "", "nodes", "nodes_type"));
    return problems;
  }
  if (!Array.isArray(graph.edges)) {
    problems.push(problem("error", "handoff.edges must be an array.", "graph", "", "edges", "edges_type"));
    return problems;
  }

  const nodeIds = new Set([ENTRYPOINT_ID]);
  for (const [index, node] of graph.nodes.entries()) {
    const id = String(node?.id || "").trim();
    const location = id || `node ${index + 1}`;
    if (!id) {
      problems.push(problem("error", "Node id is required.", "node", location, "id", "node_id_required"));
    } else if (id === ENTRYPOINT_ID) {
      problems.push(problem(
        "error", `${ENTRYPOINT_ID} is represented by the definition root and cannot appear in nodes.`,
        "node", id, "id", "reserved_node_id",
      ));
    } else if (nodeIds.has(id)) {
      problems.push(problem("error", `Duplicate node id "${id}".`, "node", id, "id", "duplicate_node_id"));
    } else {
      nodeIds.add(id);
    }
    if (!String(node?.description || "").trim()) {
      problems.push(problem(
        "error", "Node description is required for handoff routing.", "node", location,
        "description", "node_description_required",
      ));
    }
    if (!isObject(node?.config)) {
      problems.push(problem("error", "Node config must be an object.", "node", location, "config", "node_config_type"));
      continue;
    }
    if (!String(node.config.instructions || "").trim()) {
      problems.push(problem(
        "warning", "Node instructions are empty; root instructions will carry the behavior.",
        "node", location, "instructions", "node_instructions_empty",
      ));
    }
    if (node.config.tools !== undefined && !Array.isArray(node.config.tools)) {
      problems.push(problem("error", "Node tools must be an array.", "node", location, "tools", "node_tools_type"));
    }
    validateInterimResponse(problems, node.config, location);
  }

  const edgeIds = new Set();
  const pairs = new Set();
  const outgoing = new Map();
  for (const [index, edge] of graph.edges.entries()) {
    const id = String(edge?.id || "").trim();
    const location = id || `edge ${index + 1}`;
    if (!id) {
      problems.push(problem("error", "Edge id is required.", "edge", location, "id", "edge_id_required"));
    } else if (edgeIds.has(id)) {
      problems.push(problem("error", `Duplicate edge id "${id}".`, "edge", id, "id", "duplicate_edge_id"));
    } else {
      edgeIds.add(id);
    }
    const source = String(edge?.source || "").trim();
    const target = String(edge?.target || "").trim();
    if (!nodeIds.has(source)) {
      problems.push(problem(
        "error", `Source node "${source || "(empty)"}" does not exist.`, "edge", location,
        "source", "unknown_edge_source",
      ));
    }
    if (!nodeIds.has(target) || target === ENTRYPOINT_ID) {
      problems.push(problem(
        "error", `Target node "${target || "(empty)"}" does not exist or is not a specialist node.`,
        "edge", location, "target", "unknown_edge_target",
      ));
    }
    if (source && source === target) {
      problems.push(problem("error", "Self-directed edges are not supported.", "edge", location, "target", "self_edge"));
    }
    const pair = `${source}\u0000${target}`;
    if (source && target && pairs.has(pair)) {
      problems.push(problem(
        "error", `Another edge already routes ${source} to ${target}.`, "edge", location,
        "target", "duplicate_edge_route",
      ));
    }
    pairs.add(pair);
    if (!String(edge?.description || "").trim()) {
      problems.push(problem(
        "error", "Edge description is required as the model-visible route condition.",
        "edge", location, "description", "edge_description_required",
      ));
    }
    if (
      edge?.delay_ms !== undefined
      && (!Number.isInteger(edge.delay_ms) || edge.delay_ms < 0)
    ) {
      problems.push(problem(
        "error", "delay_ms must be a non-negative integer.", "edge", location,
        "delay_ms", "edge_delay",
      ));
    }
    if (
      edge?.cancel_on_interruption !== undefined
      && typeof edge.cancel_on_interruption !== "boolean"
    ) {
      problems.push(problem(
        "error", "cancel_on_interruption must be true or false.", "edge", location,
        "cancel_on_interruption", "edge_cancel_type",
      ));
    }
    if (nodeIds.has(source) && nodeIds.has(target)) {
      if (!outgoing.has(source)) outgoing.set(source, []);
      outgoing.get(source).push(target);
    }
  }

  const reachable = new Set([ENTRYPOINT_ID]);
  const pending = [ENTRYPOINT_ID];
  while (pending.length) {
    for (const target of outgoing.get(pending.shift()) || []) {
      if (!reachable.has(target)) {
        reachable.add(target);
        pending.push(target);
      }
    }
  }
  for (const node of graph.nodes) {
    if (node?.id && !reachable.has(node.id)) {
      problems.push(problem(
        "error", `Node "${node.id}" is not reachable from ${ENTRYPOINT_ID}.`,
        "node", node.id, "id", "unreachable_node",
      ));
    }
  }
  return problems;
}

export function mergeServiceProblems(localProblems, payload) {
  const details = payload?.error?.details;
  if (!Array.isArray(details)) return localProblems;
  return [
    ...localProblems,
    ...details.map((detail) => ({
      severity: "error",
      message: String(detail.message || detail.code || "Service validation failed."),
      objectKind: String(detail.object_kind || "graph"),
      objectId: String(detail.object_id || ""),
      field: String(detail.field || ""),
      code: String(detail.code || "service_validation"),
      server: true,
    })),
  ];
}

export function uniqueId(base, values) {
  const used = new Set(values);
  const normalized = String(base || "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
  if (!used.has(normalized)) return normalized;
  let suffix = 2;
  while (used.has(`${normalized}_${suffix}`)) suffix += 1;
  return `${normalized}_${suffix}`;
}
