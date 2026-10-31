// Copyright (c) Microsoft. All rights reserved.
// Config loading + model/voice helpers (mirrors the demo's /config contract).
import { groupVoicesByLocale, pipelineComponentOptions, PIPELINE_COMPONENTS } from "../../static/handoff/handoff-core.mjs";
import { withDefaultVoiceCatalog } from "../../static/handoff/voice-catalog.mjs";

async function readJson(response, path) {
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    const detail = payload?.error;
    const message = typeof detail === "string"
      ? detail
      : detail?.message || payload?.message || `${path} HTTP ${response.status}`;
    const requestId = detail?.request_id
      || payload?.request_id
      || response.headers.get("X-Portal-Request-Id")
      || response.headers.get("x-ms-request-id");
    const reference = requestId && !message.includes(requestId)
      ? ` (request ${requestId})`
      : "";
    throw new Error(`${message}${reference}`);
  }
  return payload;
}

export async function loadConfig() {
  const resp = await fetch("/config");
  const cfg = await readJson(resp, "/config");
  return withDefaultVoiceCatalog(cfg);
}

// Dynamically discover the BYOM Foundry account's usable deployments (realtime + cascaded), so BYOM
// mode isn't limited to hardcoded names. The backend returns `{realtime:[{deployment,model}], cascaded,
// account, source}` and already degrades to the static fallback list on any ARM/auth error, so this
// never throws for the caller's purposes — but guard anyway and let callers keep the /config fallback.
export async function loadDeployments() {
  const resp = await fetch("/deployments");
  return readJson(resp, "/deployments");
}

// Cascaded models (e.g. gpt-4.1) use Azure Neural TTS and ONLY accept Azure voices. Covers both the
// managed model names and the BYOM cascaded deployment names.
export function isCascaded(cfg, model) {
  return (cfg?.cascadedModels || []).includes(model) || (cfg?.byomCascadedModels || []).includes(model);
}

const PREVIEW_TRANSCRIPTION_MODELS = new Set([
  "mai-transcribe-2-streaming",
  "gpt-live-transcribe",
  "gpt-realtime-whisper",
  "gpt-transcribe",
]);

export function transcriptionGroups(cfg) {
  const all = [...new Set([
    ...pipelineComponentOptions("stt").map((item) => item.id),
    ...(cfg?.transcriptionModels || []),
    ...(cfg?.realtimeTranscriptionModels || []),
    ...(cfg?.cascadedTranscriptionModels || []),
  ])].filter((value) => value !== "native-realtime-audio");
  const items = all.map((value) => ({
    value,
    label: `${value}${PREVIEW_TRANSCRIPTION_MODELS.has(value) ? " · Preview" : ""}`,
  }));
  return [
    {
      label: "Input transcription",
      items,
    },
  ];
}

export function defaultTranscriptionFor(cfg) {
  return cfg?.inputTranscriptionModel || "azure-speech";
}

// Build grouped options for a <select> of models: Realtime vs Cascaded. When `byom` is true, offer the
// BYOM DEPLOYMENT names (self_deployed) rather than the managed model names — Voice Live connects to
// the deployment directly, so it must be a real, reachable deployment (not a managed model name).
export function modelGroups(cfg, byom) {
  const realtime = byom ? (cfg?.byomRealtimeModels || []) : (cfg?.realtimeModels || []);
  const cascaded = byom ? (cfg?.byomCascadedModels || []) : (cfg?.cascadedModels || []);
  const groups = [
    { label: byom ? "Realtime — BYOM deployment" : "Realtime (native speech-to-speech)", items: realtime },
    { label: byom ? "Cascaded — BYOM deployment" : "Cascaded (text model + STT/TTS)", items: cascaded },
  ];
  if (!byom) {
    const known = new Set([...realtime, ...cascaded]);
    const other = (cfg.models || []).filter((m) => !known.has(m));
    if (other.length) groups.push({ label: "Other", items: other });
  }
  return groups.filter((g) => g.items.length);
}

export function voiceGroups(cfg) {
  const catalog = cfg.voiceCatalog || PIPELINE_COMPONENTS.voice;
  const entries = new Map(catalog.map((voice) => [
    voice.id, { ...voice, value: voice.id, label: voice.id },
  ]));
  for (const value of [...(cfg.openaiVoices || []), ...(cfg.azureVoices || [])]) {
    if (!entries.has(value)) entries.set(value, { value, label: value });
  }
  const voices = [...entries.values()].sort((left, right) => left.value.localeCompare(right.value));
  return groupVoicesByLocale(voices);
}

// Default voice to preselect for a given model family. DragonHD is the recommended default for
// BOTH realtime and cascaded; it is an Azure voice and is valid in every mode.
export function defaultVoiceFor(cfg, model) {
  if (cfg?.defaultAzureVoice) return cfg.defaultAzureVoice;
  if (cfg?.defaultVoice) return cfg.defaultVoice;
  if (isCascaded(cfg, model)) return (cfg.azureVoices || [])[0] || "en-US-Ava:DragonHDLatestNeural";
  return (cfg.openaiVoices || [])[0] || "alloy";
}
