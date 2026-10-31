// Copyright (c) Microsoft. All rights reserved.
import { PIPELINE_COMPONENTS } from "./handoff-core.mjs";

const VOICE_TYPES = new Set(["openai", "azure-realtime-native", "azure-standard", "azure-custom", "azure-personal"]);

export function withDefaultVoiceCatalog(cfg) {
  const voices = new Map((cfg.voiceCatalog || PIPELINE_COMPONENTS.voice).map((voice) => [voice.id, voice]));
  const openai = cfg.openaiVoices || [];
  for (const id of [...openai, ...(cfg.azureVoices || []), cfg.defaultVoice, cfg.defaultAzureVoice].filter(Boolean)) {
    if (!voices.has(id)) voices.set(id, {
      id, label: id, locale: "",
      type: openai.includes(id) ? "openai" : id.includes("-") ? "azure-standard" : "azure-realtime-native",
    });
  }
  return {
    ...cfg,
    voiceCatalog: [...voices.values()],
    voiceCatalogSource: "bundled",
    voiceCatalogNotice: cfg.voiceCatalogNotice
      || "Built-in voice catalog. Project and regional availability are not verified; the service validates the chosen voice when used.",
  };
}

export async function loadLiveVoiceCatalog({ signal, timeoutMs = 8000, refresh = false } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(`/api/voices${refresh ? "?refresh=1" : ""}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Live voice discovery returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const error = payload?.error;
      const message = typeof error === "string" ? error : error?.message || `HTTP ${response.status}`;
      const id = error?.request_id || payload?.request_id || response.headers.get("X-Portal-Request-Id");
      throw new Error(`${message}${id ? ` (request ${id})` : ""}`);
    }
    if (!Array.isArray(payload?.voices) || !payload.voices.length || !payload.voices.every(
      (voice) => voice && typeof voice.id === "string" && voice.id.trim() && VOICE_TYPES.has(voice.type),
    )) throw new Error("Live voice discovery returned an invalid voice catalog.");
    if (payload.source === "bundled" && payload.discoveryError) {
      throw new Error(payload.discoveryError.reason || "Using bundled reference voices.");
    }
    return {
      voiceCatalog: payload.voices,
      voiceCatalogNotice: payload.notice || "Live voice catalog. The service validates the chosen voice when used.",
      voiceCatalogSource: "live",
    };
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) {
      throw new Error(`Live voice discovery timed out after ${timeoutMs / 1000} seconds.`);
    }
    throw error;
  }
}

export function voiceCatalogStatusText(cfg, loading, error) {
  const source = cfg?.voiceCatalogSource === "live"
    ? "Using the last loaded voice catalog."
    : "Using the built-in voice catalog.";
  if (error) return `${source} Live discovery is unavailable: ${error} Default and selected voices are unchanged.`;
  if (loading) return `${source} Checking optional live discovery…`;
  return source;
}
