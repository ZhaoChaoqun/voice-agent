import {
  ENTRYPOINT_ID,
  PIPELINE_METRICS_DISCLAIMER,
  PIPELINE_COMPONENTS,
  PIPELINE_PRESETS,
  createBlankDefinition,
  deepClone,
  deterministicYaml,
  estimatePipeline,
  ensureEditableDefinition,
  extractLatestAgent,
  formatPipelineCost as calculatedCost,
  formatPipelineLatency as estimatedLatencyRange,
  groupVoicesByLocale,
  layoutHandoffGraph,
  mergeServiceProblems,
  matchesAgentSearch,
  pipelineBrand,
  pipelineComponentOptions,
  pipelineComponentProvider,
  pipelineMetricMinimum,
  pipelineTotals,
  parseAgentSource,
  publicationFeatures,
  sideEdgeAnchors,
  sortPipelineComponents,
  smoothOuterEdgePath,
  smoothVerticalEdgePath,
  stableJson,
  uniqueId,
  validateDefinition,
  publicationDefinition,
} from "./handoff-core.mjs?v=20261028-yaml-import";
import { resolveVoiceSelection, voiceSelectionNotice } from "/static/demo/voice-selection.mjs";
import { createToolConnectRequest } from "/static/demo/tool-connection.mjs";
import { filterVoiceGroups, voiceMatchCount } from "./voice-picker.mjs?v=20261027-voice-search";
import { anchoredPopover } from "./anchored-popover.mjs";
import {
  loadLiveVoiceCatalog,
  voiceCatalogStatusText,
  withDefaultVoiceCatalog,
} from "./voice-catalog.mjs?v=20261028-optional-discovery";
import {
  INPUT_LANGUAGE_HINT,
  INPUT_LANGUAGE_SOURCE,
  displayTranscriptionLanguage,
  inputLanguageLimit,
  mountInputLanguagePicker,
  transcriptionLanguageError,
  transcriptionLanguageOptions,
} from "./transcription-languages.mjs?v=20261028-floating-help";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const CARD_WIDTH = 320;
const CARD_HEIGHT = 160;
const LAYOUT_ROW_GAP = 124;
const DEFAULT_NODE_PRESET = PIPELINE_PRESETS[0];
const NODE_ICONS = Object.freeze([
  { id: "home", label: "Start" },
  { id: "headset", label: "Support" },
  { id: "card", label: "Billing" },
  { id: "calendar", label: "Schedule" },
  { id: "shield", label: "Verify" },
  { id: "user", label: "Specialist" },
  { id: "sparkles", label: "AI" },
]);

const state = {
  cfg: null,
  voiceCatalogLoading: false,
  voiceCatalogError: "",
  agents: [],
  selectedAgentName: "",
  agentLoadGeneration: 0,
  agentListLoaded: false,
  agentListLoading: false,
  agentListError: "",
  agentListPageCount: 0,
  agentListAfter: "",
  agentListHasMore: false,
  definition: null,
  agentName: "",
  version: "",
  draft: false,
  sourceDescription: "",
  sourceMetadata: {},
  sourceSnapshot: null,
  cleanSnapshot: null,
  remoteSource: false,
  history: [],
  future: [],
  selected: { kind: "graph", id: "" },
  outlineTab: "nodes",
  nodeComponentPanel: "",
  definitionReturnFocus: null,
  // No visible toggle: open the page with ?debug=1 to show latency and cost estimates.
  debugMode: new URLSearchParams(window.location.search).get("debug") === "1",
  componentSort: {
    stt: { key: "name", direction: "asc" },
    model: { key: "name", direction: "asc" },
    voice: { key: "name", direction: "asc" },
  },
  metricDisplay: { nodeId: "", cost: 0, latency: 0 },
  selectionTimer: null,
  serverProblems: [],
  positions: new Map(),
  nodeIcons: new Map(),
  camera: { x: 70, y: 85, scale: 1 },
  format: "yaml",
  publishing: false,
  voiceLanguage: "",
  voiceRegion: "",
  templates: [],
  templateQuery: "",
  templateGrouping: "locale",
  templateGroupOpen: new Map(),
  pipelineAvailability: null,
  voiceLocale: null,
  voiceSearch: "",
  templateVersions: new Map(),
  templateCatalogLoaded: false,
  templateCatalogLoading: false,
  templateLoadingId: "",
  // Systems of the working copy's MCP tools, the per-system drafts in the Connect dialog,
  // and the tool maps of systems connected in this session (needed to switch back to mock).
  toolGroups: [],
  toolDrafts: {},
  toolConnections: {},
  toolConnectionBusy: false,
  toolConnectionEpoch: 0,
  editorSession: null,
  importCandidate: null,
  importFileName: "",
  importGeneration: 0,
  importReturnFocus: null,
  importOpenSettings: false,
  dragging: null,
  panning: null,
  connecting: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toolDisplayName(tool) {
  if (typeof tool === "string") return tool;
  return tool?.name || tool?.function?.name || tool?.type || "tool";
}

function toolKind(tool) {
  return typeof tool === "object" && tool !== null
    ? String(tool.type || (tool.function ? "function" : "tool")).toLowerCase()
    : "tool";
}

function toolTitle(tool, index) {
  if (typeof tool !== "object" || tool === null) return String(tool || `Tool ${index + 1}`);
  if (toolKind(tool) === "mcp") return tool.server_label || `MCP server ${index + 1}`;
  return tool.function?.name || tool.name || `${toolKind(tool)} tool ${index + 1}`;
}

function renderToolCard(tool, index) {
  const kind = toolKind(tool);
  const isMcp = kind === "mcp";
  const description = tool?.function?.description || tool?.description || "";
  const allowedTools = Array.isArray(tool?.allowed_tools) ? tool.allowed_tools : [];
  const endpoint = tool?.server_url
    ? `<span><b>Endpoint</b><code>${escapeHtml(tool.server_url)}</code></span>`
    : tool?.project_connection_id
      ? `<span><b>Connection</b><code>${escapeHtml(tool.project_connection_id)}</code></span>`
      : "";
  const probe = mcpProbePresentation();
  const canProbe = isMcp && Boolean(probe.mode);
  return `
    <article class="tool-config-card${isMcp ? " mcp-tool" : ""}"${isMcp ? " data-mcp-probe-scope" : ""}>
      <div class="tool-config-head">
        <span class="tool-kind-chip ${escapeHtml(kind)}">${escapeHtml(kind.toUpperCase())}</span>
        <div>
          <strong>${escapeHtml(toolTitle(tool, index))}</strong>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        </div>
        ${isMcp ? `
          <button type="button" class="button secondary compact mcp-probe-button"
            data-mcp-probe="${index}" data-node-id="${escapeHtml(state.selected.id)}" ${canProbe ? "" : "disabled"}
            title="${escapeHtml(probe.title)}">
            Test MCP
          </button>` : ""}
      </div>
      ${isMcp ? `
        <div class="tool-config-meta">
          ${endpoint || "<span><b>Endpoint</b><em>Resolved by the service</em></span>"}
          <span><b>Approval</b><code>${escapeHtml(tool?.require_approval || "default")}</code></span>
        </div>
        <div class="allowed-tools">
          <span>Allowed tools</span>
          <div>${allowedTools.length
            ? allowedTools.map((name) => `<code>${escapeHtml(name)}</code>`).join("")
            : "<em>All server tools</em>"}</div>
        </div>
        <div class="mcp-probe-status" data-mcp-probe-status="${index}" role="status">
          ${escapeHtml(probe.status)}
        </div>` : ""}
    </article>`;
}

function sourceTemplateId() {
  return String(state.sourceMetadata?.source_template_id || "").trim();
}

function sourceTemplateVersionQuery() {
  return `?version=${encodeURIComponent(state.sourceMetadata?.source_template_version || ".")}`;
}

function mcpProbeMode() {
  if (state.remoteSource && state.agentName) return "published";
  if (sourceTemplateId()) return "template";
  return "";
}

function mcpProbePresentation() {
  const mode = mcpProbeMode();
  if (mode === "published") {
    return {
      mode,
      title: "Test the MCP server declared by the currently published Agent",
      status: "Ready to test the currently published Agent",
    };
  }
  if (mode === "template") {
    return {
      mode,
      title: "Test the MCP configuration materialized from the selected template",
      status: "Ready to test the selected template MCP configuration",
    };
  }
  return {
    mode: "",
    title: "Load a published Agent or select a template before testing MCP",
    status: "Load a published Agent or select a template to test this MCP server",
  };
}

function nodeMcpTools(id) {
  return effectiveTools(id)
    .map((tool, index) => ({ tool, index }))
    .filter(({ tool }) => toolKind(tool) === "mcp");
}

function renderNodeMcpMenu(nodeId, mcpTools) {
  const probe = mcpProbePresentation();
  const canProbe = Boolean(probe.mode);
  return `
    ${mcpTools.length
      ? mcpTools.map(({ tool, index }) => `
        <article class="node-mcp-item" data-mcp-probe-scope>
          <div class="node-mcp-item-heading">
            <span><strong>${escapeHtml(toolTitle(tool, index))}</strong><small>${escapeHtml(
              tool.server_url || tool.project_connection_id || "Resolved by the service",
            )}</small></span>
            <button type="button" class="button secondary compact mcp-probe-button"
              data-mcp-probe="${index}" data-node-id="${escapeHtml(nodeId)}" ${canProbe ? "" : "disabled"}
              title="${escapeHtml(probe.title)}">
              Test MCP
            </button>
          </div>
          <div class="mcp-probe-status" data-mcp-probe-status="${index}" role="status">
            ${escapeHtml(probe.status)}
          </div>
        </article>`).join("")
      : '<div class="node-mcp-empty"><strong>No MCP configured</strong><span>Add an MCP tool in Node setup.</span></div>'}`;
}

function openNodeMcpDialog(nodeId) {
  const mcpTools = nodeMcpTools(nodeId);
  $("#node-mcp-dialog-title").textContent = "MCP connections";
  $("#node-mcp-dialog-subtitle").textContent = `${mcpTools.length} configured for ${nodeId}`;
  $("#node-mcp-dialog-body").innerHTML = renderNodeMcpMenu(nodeId, mcpTools);
  $$("[data-mcp-probe]", $("#node-mcp-dialog-body")).forEach((button) => {
    button.addEventListener("click", () => testNodeMcpTool(button));
  });
  $("#node-mcp-dialog").hidden = false;
  $("#close-node-mcp-dialog").focus({ preventScroll: true });
}

function closeNodeMcpDialog() {
  $("#node-mcp-dialog").hidden = true;
  $("#node-mcp-dialog-body").replaceChildren();
}

function normalizedModelId(value) {
  const name = modelName(value);
  if (name === "gpt-realtime-2025-08-28") return "gpt-realtime";
  if (name === "gpt-realtime-mini-2025-12-15") return "gpt-realtime-mini";
  if (name === "gpt-realtime-1.5-2026-02-23") return "gpt-realtime-1.5";
  if (name === "gpt-5.4-2026-03-05") return "gpt-5.4";
  return name;
}

function effectiveVoice(id) {
  const config = nodeConfig(id);
  return id === ENTRYPOINT_ID ? rootVoice() : (config.voice ?? rootVoice());
}

function effectiveVoiceType(id) {
  const config = nodeConfig(id);
  if (config.voice?.type || config.voice_type) return config.voice?.type || config.voice_type;
  if (id === ENTRYPOINT_ID || !config.voice) {
    return rootVoice()?.type || state.definition?.audio?.output?.voice_type || "";
  }
  return "";
}

function nodePipeline(id) {
  return selectedPipeline(
    effectiveModel(id), effectiveVoice(id), rootSttModel(), {
      voiceType: effectiveVoiceType(id),
      customSpeech: Boolean(state.definition?.audio?.input?.transcription?.custom_speech),
    },
  ).pipeline;
}

function setMessage(message, error = "") {
  $("#operation-status").textContent = message;
  $("#operation-status").title = message;
  $("#operation-error").textContent = error;
  $("#operation-error").title = error;
  $("#operation-error").hidden = !error;
}

function serviceError(payload, status, fallbackText = "", responseRequestId = "") {
  const detail = payload?.error;
  const code = typeof detail === "object" ? detail.code : payload?.code || "";
  const message = typeof detail === "string"
    ? detail
    : detail?.message || payload?.message || fallbackText;
  const requestId = detail?.request_id || payload?.request_id || responseRequestId;
  const reference = requestId && !String(message).includes(requestId)
    ? `Request ID: ${requestId}`
    : "";
  return [code, message || `Request failed with HTTP ${status}`, reference]
    .filter(Boolean)
    .join(": ");
}

async function readResponse(response) {
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text.slice(0, 1200) };
    }
  }
  if (!response.ok) {
    const requestId = response.headers.get("X-Portal-Request-Id")
      || response.headers.get("x-ms-request-id")
      || "";
    const error = new Error(
      serviceError(payload, response.status, text.slice(0, 1200), requestId),
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function featureHeader(draft = false) {
  return publicationFeatures(state.cfg?.foundryFeatures, draft);
}

function serviceUrl(path, params = {}) {
  const query = new URLSearchParams({ "api-version": state.cfg.apiVersion, ...params });
  return `${path}?${query}`;
}

async function serviceRequest(path, options = {}, { draft = false } = {}) {
  const headers = {
    "Foundry-Features": featureHeader(draft),
    ...(options.headers || {}),
  };
  const response = await fetch(path, { ...options, headers });
  return readResponse(response);
}

function currentProblems() {
  if (!state.definition) return [];
  return mergeServiceProblems(validateDefinition(state.definition), state.serverProblems);
}

function isDirty() {
  if (!state.definition) return false;
  return state.cleanSnapshot === null || stableJson(state.definition, 0) !== state.cleanSnapshot;
}

function selectionProblems(field = "") {
  return currentProblems().filter((item) => {
    const selectionMatch = item.objectKind === state.selected.kind
      && (!item.objectId || item.objectId === state.selected.id);
    return selectionMatch && (!field || item.field === field);
  });
}

function hasError(kind, id) {
  return currentProblems().some(
    (item) => item.severity === "error" && item.objectKind === kind
      && (!item.objectId || item.objectId === id),
  );
}

function modelName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.name || value.id || "Custom model";
  return "";
}

function voiceName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.name || value.id || "";
  return "";
}

function rootVoice() {
  return state.definition?.audio?.output?.voice;
}

function rootSttModel() {
  return state.definition?.audio?.input?.transcription?.model || "azure-speech";
}

function setRootSttModel(definition, model) {
  definition.audio ||= {};
  definition.audio.input ||= {};
  definition.audio.input.transcription ||= {};
  definition.audio.input.transcription.model = model;
}

function pipelineIcon(name) {
  const paths = {
    audio: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
    bolt: '<path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>',
    brain: '<path d="M9.5 4.5A3 3 0 0 0 4 6v2a3 3 0 0 0 0 5v2a3 3 0 0 0 5.5 1.5M14.5 4.5A3 3 0 0 1 20 6v2a3 3 0 0 1 0 5v2a3 3 0 0 1-5.5 1.5M9.5 4.5v12M14.5 4.5v12M8 9h3M13 13h3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.6-.7-1.5-1-2.7-1-1.5 0-2.5.7-2.5 1.8 0 2.8 5.2 1.3 5.2 4.4 0 1.2-1.1 2-2.8 2-1.3 0-2.4-.4-3.2-1.2M12 5.5v13"/>',
    leaf: '<path d="M20 4C12 4 6 7 5 13c-.5 3 1.5 5.5 4.5 5.5C16 18.5 20 11 20 4Z"/><path d="M4 20c3-5 7-8 12-10"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
    headset: '<path d="M4 13v-1a8 8 0 0 1 16 0v1M4 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 1-2ZM20 13h-3v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-1-2ZM17 19c-1 2-3 2-5 2"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    shield: '<path d="M12 3 4 6v5c0 5 3 8 8 10 5-2 8-5 8-10V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    sparkles: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM19 13l.7 1.8 1.8.7-1.8.7L19 18l-.7-1.8-1.8-.7 1.8-.7L19 13Z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    model: '<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/>',
    mcp: '<rect x="3" y="7" width="6" height="10" rx="2"/><rect x="15" y="7" width="6" height="10" rx="2"/><path d="M9 12h6M6 10v4M18 10v4"/>',
    route: '<path d="M5 5v5c0 2 2 3 4 3h6"/><path d="m13 9 4 4-4 4"/><circle cx="5" cy="5" r="2"/>',
    scales: '<path d="M12 3v18M5 6h14M7 6l-4 7h8L7 6ZM17 6l-4 7h8l-4-7ZM8 21h8"/>',
    voice: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M9 22h6"/>',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.model}</svg>`;
}

function pipelineBrandIcon(brand) {
  const glyphs = {
    mai: '<path d="M4 17V7l4 6 4-8 4 8 4-6v10"/><circle cx="4" cy="17" r="1.4"/><circle cx="20" cy="17" r="1.4"/>',
    whisper: '<path d="M3 12h2.5L7 7l2.2 10L12 4l2.8 16L17 9l1.5 6H21"/>',
    azure: '<path class="azure-back" d="M9 3h6.2L9 21H3.2L9 3Z"/><path class="azure-front" d="m14.5 9 6.3 12H9.2l2.2-5.1h4.2L12.8 9h1.7Z"/>',
    voice: '<path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Z"/><path d="M5.5 11.5v.5a6.5 6.5 0 0 0 13 0v-.5M12 18.5V21M9 21h6"/>',
    speech: '<path d="M4 12h3l2-5 3 10 2.5-7 2 4H20"/>',
    generic: '<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/>',
  };
  if (brand === "gpt") {
    return '<span class="pipeline-brand-mark gpt" aria-hidden="true"><b>GPT</b></span>';
  }
  return `<span class="pipeline-brand-mark ${brand}" aria-hidden="true">
    <svg viewBox="0 0 24 24">${glyphs[brand] || glyphs.generic}</svg>
  </span>`;
}

function nodePipelineStage(kind, component) {
  const stageLabels = { stt: "STT", model: "LLM", voice: "TTS" };
  const brand = pipelineBrand(kind, component.id);
  return `
    <button type="button" class="node-pipeline-stage brand-${brand}"
      data-node-pipeline="${kind}"
      aria-label="${stageLabels[kind]}: ${escapeHtml(component.label)}. Configure ${stageLabels[kind]}."
      title="${stageLabels[kind]} · ${escapeHtml(component.label)}">
      ${pipelineBrandIcon(brand)}
    </button>`;
}

function presetTotals(preset) {
  return pipelineTotals(preset);
}

function selectedPipeline(model, voice, stt, { voiceType = "", customSpeech = false } = {}) {
  return estimatePipeline({
    model: normalizedModelId(model),
    voice: voiceName(voice),
    voiceType: voiceType || (typeof voice === "object" && voice !== null ? voice.type || "" : ""),
    customSpeech,
    stt,
  });
}

function componentCostLabel(component) {
  return component?.noAdditionalCost
    ? "No extra STT cost"
    : calculatedCost(component?.costPerMinute);
}

function estimatedLatency(value) {
  return value === null || value === undefined
    ? "Not available"
    : `${value.toLocaleString()} ms`;
}

function pipelineBar(pipeline, metric) {
  const totals = pipelineTotals(pipeline);
  if (!pipeline || !totals) return '<div class="pipeline-bar unavailable"><span></span></div>';
  if (metric === "latencyMs") {
    return `<div class="pipeline-bar">
      <span class="pipeline-segment model" style="width:100%"
        title="${estimatedLatencyRange(totals)}"></span>
    </div>`;
  }
  const total = [pipeline.stt, pipeline.model, pipeline.voice]
    .reduce((sum, component) => sum + component[metric], 0);
  return `<div class="pipeline-bar">
    ${["stt", "model", "voice"].map((kind) => {
      const value = pipeline[kind][metric];
      return `<span class="pipeline-segment ${kind}" style="width:${(value / total) * 100}%"
        title="${escapeHtml(pipeline[kind].label)} · ${componentCostLabel(pipeline[kind])}"></span>`;
    }).join("")}
  </div>`;
}

function nodeConfig(id) {
  if (id === ENTRYPOINT_ID) return state.definition;
  return state.definition?.handoff?.nodes?.find((node) => node.id === id)?.config || {};
}

function defaultNodeIcon(id) {
  const normalized = id.toLowerCase();
  if (id === ENTRYPOINT_ID) return "home";
  if (normalized.includes("bill") || normalized.includes("payment")) return "card";
  if (normalized.includes("support") || normalized.includes("help")) return "headset";
  if (normalized.includes("schedule") || normalized.includes("book")) return "calendar";
  if (normalized.includes("verify") || normalized.includes("auth")) return "shield";
  return "user";
}

function nodeIcon(id) {
  return state.nodeIcons.get(id) || defaultNodeIcon(id);
}

function effectiveModel(id) {
  const config = nodeConfig(id);
  return config.model ?? state.definition?.model ?? "";
}

function effectiveTools(id) {
  const config = nodeConfig(id);
  const value = config.tools ?? state.definition?.tools;
  return Array.isArray(value) ? value : [];
}

function graphIds() {
  return [
    ENTRYPOINT_ID,
    ...(state.definition?.handoff?.nodes || []).map((node) => node.id),
  ];
}

function ensurePositions() {
  const ids = new Set(graphIds());
  for (const id of state.positions.keys()) {
    if (!ids.has(id)) state.positions.delete(id);
  }
  graphIds().forEach((id, index) => {
    if (!state.positions.has(id)) {
      state.positions.set(id, { x: 80 + (index % 3) * 372, y: 100 + Math.floor(index / 3) * 350 });
    }
  });
}

function setDefinition(
  definition,
  {
    name = "",
    version = "",
    draft = false,
    description = "",
    metadata = {},
    remote = false,
    message = "",
  } = {},
) {
  state.definition = ensureEditableDefinition(definition);
  state.voiceLanguage = "";
  if (!remote) state.agentLoadGeneration += 1;
  state.agentName = name;
  state.version = version;
  state.draft = draft;
  state.sourceDescription = description;
  state.sourceMetadata = deepClone(metadata);
  state.sourceSnapshot = deepClone(state.definition);
  state.cleanSnapshot = remote ? stableJson(state.definition, 0) : null;
  state.voiceLocale = null;
  state.voiceSearch = "";
  state.remoteSource = remote;
  state.history = [];
  state.future = [];
  state.serverProblems = [];
  state.selected = { kind: "graph", id: "" };
  state.outlineTab = "nodes";
  state.positions = new Map();
  state.nodeIcons = new Map(graphIds().map((id) => [id, defaultNodeIcon(id)]));
  autoLayout({ shouldFit: false });
  state.toolConnections = {};
  state.toolGroups = [];
  render();
  requestAnimationFrame(() => centerGraphAtScale(1));
  setMessage(message || "Definition loaded into the local working copy.");
  if (workingCopyMockTools().length) void refreshToolGroups();
}

function mutate(label, callback) {
  if (!state.definition) return;
  const before = deepClone(state.definition);
  callback(state.definition);
  if (stableJson(before, 0) === stableJson(state.definition, 0)) return;
  state.history.push(before);
  if (state.history.length > 100) state.history.shift();
  state.future = [];
  state.serverProblems = [];
  setMessage(`${label}. Changes remain local until you publish.`);
  render();
}

function undo() {
  if (!state.history.length || !state.definition) return;
  state.future.push(deepClone(state.definition));
  state.definition = state.history.pop();
  state.serverProblems = [];
  render();
}

function redo() {
  if (!state.future.length || !state.definition) return;
  state.history.push(deepClone(state.definition));
  state.definition = state.future.pop();
  state.serverProblems = [];
  render();
}

async function loadConfig() {
  const response = await fetch("/config");
  const cfg = withDefaultVoiceCatalog(await readResponse(response));
  state.cfg = cfg;
  document.body.classList.toggle("playground-mode", cfg.playground === true);
  $("#environment").textContent = `${cfg.backend} · ${cfg.project} · API ${cfg.apiVersion}`;
  void loadPipelineAvailability();
  void refreshVoiceCatalog();
}

function renderVoiceCatalogStatus() {
  const banner = $("#voice-catalog-status");
  banner.hidden = !state.cfg || (
    state.cfg.voiceCatalogSource === "live" && !state.voiceCatalogLoading && !state.voiceCatalogError
  );
  $("#voice-catalog-status-text").textContent = voiceCatalogStatusText(
    state.cfg, state.voiceCatalogLoading, state.voiceCatalogError,
  );
  $("#retry-voice-catalog").disabled = state.voiceCatalogLoading;
  $("#retry-voice-catalog").textContent = state.voiceCatalogLoading
    ? "Checking voices…" : "Retry live voice discovery";
}

async function refreshVoiceCatalog(refresh = false) {
  if (!state.cfg || state.voiceCatalogLoading) return;
  state.voiceCatalogLoading = true;
  renderVoiceCatalogStatus();
  try {
    const catalog = await loadLiveVoiceCatalog({ refresh });
    Object.assign(state.cfg, catalog);
    state.voiceCatalogError = "";
    if (state.nodeComponentPanel === "voice" && !$("#node-component-panel").hidden) {
      const active = document.activeElement;
      const field = active instanceof HTMLInputElement ? active.id : "";
      const selection = field ? [active.selectionStart, active.selectionEnd] : null;
      renderNodeComponentPanel();
      if (field && document.getElementById(field)) {
        const input = document.getElementById(field);
        input.focus();
        if (selection[0] !== null) input.setSelectionRange(...selection);
      }
    }
  } catch (error) {
    console.warn("Optional live voice discovery failed; retaining the current voice catalog.", error);
    state.voiceCatalogError = error.message;
  } finally {
    state.voiceCatalogLoading = false;
    renderVoiceCatalogStatus();
  }
}

// Choices probed against one Project by portal/tools/probe_pipeline_availability.py.
async function loadPipelineAvailability() {
  try {
    const response = await fetch("/static/handoff/pipeline-availability.json");
    if (!response.ok) return;
    const data = await response.json();
    if (!data?.project || data.project !== state.cfg?.project) return;
    state.pipelineAvailability = data;
    if (!$("#node-component-panel").hidden) renderNodeComponentPanel();
  } catch {
    // Without probe results every catalog choice stays visible.
  }
}

// Hide choices the hosted policy rejects or the probe found unavailable; unknown stays visible.
function pipelineChoiceAvailable(kind, id) {
  if (kind === "voice") return true;
  if (
    kind === "model" && state.cfg?.playground && Array.isArray(state.cfg.models)
    && !state.cfg.models.includes(id)
  ) return false;
  const key = { model: "models", stt: "stt", voice: "voices" }[kind];
  return state.pipelineAvailability?.[key]?.[id]?.available !== false;
}

function sortedAgents(agentMap) {
  return [...agentMap.values()].sort(
    (left, right) => right.createdAt - left.createdAt || left.name.localeCompare(right.name),
  );
}

function renderAgentLoadState() {
  $("#agent-select").setAttribute("aria-busy", String(state.agentListLoading));
  const more = $("#load-more-agents");
  more.hidden = !state.agentListHasMore;
  more.disabled = state.agentListLoading;
  more.textContent = state.agentListLoading && state.agentListPageCount ? "Loading…" : "Load more Agents";
  const status = $("#agent-load-state");
  if (state.agentListError) {
    status.textContent = "Load failed";
    status.className = "source-load-state error";
  } else if (state.agentListLoading) {
    status.textContent = `${state.agents.length} loaded…`;
    status.className = "source-load-state loading";
  } else if (state.agentListLoaded) {
    status.textContent = `${state.agents.length} loaded`;
    status.className = "source-load-state ready";
  } else {
    status.textContent = "Connecting…";
    status.className = "source-load-state";
  }
}

// Each list page carries full Agent definitions, so load the newest few and
// fetch older ones only on request.
const AGENT_PAGE_SIZE = 10;

async function loadAgentPage(agents) {
  const params = { kind: "voice", limit: String(AGENT_PAGE_SIZE) };
  if (state.agentListAfter) params.after = state.agentListAfter;
  const payload = await serviceRequest(serviceUrl("/agents", params));
  for (const resource of payload.data || []) {
    const latest = resource?.versions?.latest || resource;
    if (resource?.name && latest?.definition?.kind === "voice") {
      agents.set(resource.name, {
        name: resource.name,
        version: String(latest.version || ""),
        createdAt: Number(latest.created_at) || 0,
      });
    }
  }
  const after = payload.has_more ? String(payload.last_id || "") : "";
  if (payload.has_more && (!after || after === state.agentListAfter)) {
    throw new Error("Agent list returned an unusable pagination cursor.");
  }
  state.agentListPageCount += 1;
  state.agentListAfter = after;
  state.agentListHasMore = Boolean(payload.has_more);
  state.agents = sortedAgents(agents);
}

async function loadAgentList({ force = false, announce = true } = {}) {
  if (!state.cfg) return;
  if (state.agentListLoading || (state.agentListLoaded && !force)) return;
  state.agentListLoading = true;
  state.agentListLoaded = false;
  state.agentListError = "";
  state.agentListPageCount = 0;
  state.agentListAfter = "";
  state.agentListHasMore = false;
  $("#refresh-agents").disabled = true;
  const agents = new Map(
    (force ? state.agents.filter((item) => item.name === state.agentName) : state.agents)
      .map((item) => [item.name, item]),
  );
  state.agents = sortedAgents(agents);
  renderAgentOptions();
  if (announce) setMessage(`Loading the latest voice Agents from ${state.cfg.project}…`);
  try {
    await loadAgentPage(agents);
    state.agentListLoaded = true;
    renderAgentOptions();
    if (announce) setMessage(
      state.agents.length
        ? `Loaded ${state.agents.length} voice Agents${state.agentListHasMore ? "; use Load more for older ones" : ""}. Select one to load its latest complete definition.`
        : "No voice Agents were returned for this Foundry project.",
    );
  } catch (error) {
    state.agentListError = error.message;
    renderAgentOptions();
    if (announce || !state.definition) setMessage(
      "Agent list could not be loaded. Your working copy was not replaced.",
      error.message,
    );
  } finally {
    state.agentListLoading = false;
    $("#refresh-agents").disabled = false;
    renderAgentLoadState();
  }
}

async function loadMoreAgents() {
  if (!state.cfg || state.agentListLoading || !state.agentListHasMore) return;
  state.agentListLoading = true;
  state.agentListError = "";
  $("#refresh-agents").disabled = true;
  renderAgentOptions();
  try {
    await loadAgentPage(new Map(state.agents.map((item) => [item.name, item])));
  } catch (error) {
    state.agentListError = error.message;
    setMessage("More Agents could not be loaded. Your working copy was not replaced.", error.message);
  } finally {
    state.agentListLoading = false;
    $("#refresh-agents").disabled = false;
    renderAgentOptions();
  }
}

async function ensureAgentListLoaded() {
  if (!state.agentListLoaded && !state.agentListLoading) await loadAgentList();
}

function selectAgentOption(name, { focus = false } = {}) {
  state.selectedAgentName = name;
  const root = $("#agent-select");
  const options = $$("[data-agent-name]", root);
  const selected = options.find((option) => option.dataset.agentName === name);
  for (const option of options) {
    option.setAttribute("aria-selected", String(option === selected));
    option.tabIndex = option === selected ? 0 : -1;
  }
  root.tabIndex = selected ? -1 : 0;
  if (focus) selected?.focus({ preventScroll: true });
}

function renderAgentOptions() {
  const query = $("#agent-search").value;
  const filtered = state.agents.filter((item) => matchesAgentSearch(item.name, query));
  const root = $("#agent-select");
  const focused = root.contains(document.activeElement);
  const previous = state.selectedAgentName || state.agentName;
  const selected = filtered.some((item) => item.name === previous) ? previous : filtered[0]?.name || "";
  root.innerHTML = filtered.length
    ? filtered
      .map((item) => `
        <button type="button" class="agent-option" role="option" data-agent-name="${escapeHtml(item.name)}"
          aria-label="${escapeHtml(item.name)}" title="${escapeHtml(item.name)}">
          <span class="agent-option-icon">${pipelineIcon("audio")}</span>
          <span class="agent-option-copy">
            <strong>${escapeHtml(item.name)}</strong>
            <small>Voice Agent <span class="agent-option-version">v${escapeHtml(item.version || "—")}</span></small>
          </span>
          <span class="agent-option-check" aria-hidden="true">${pipelineIcon("check")}</span>
        </button>`)
      .join("")
    : `<div class="agent-list-empty" role="status">${state.agentListError
      ? "Could not load Agents. Use refresh to try again."
      : state.agentListLoading ? "Loading Agents…"
      : query.trim() ? (state.agentListHasMore
        ? "No matching Agents loaded yet. Load more to search older ones."
        : "No matching Agents. Try another name.")
      : "No voice Agents in this project yet."}</div>`;
  selectAgentOption(selected, { focus: focused });
  $("#agent-result-count").textContent = query.trim()
    ? `${filtered.length} matching · ${state.agents.length} loaded`
    : state.agentListHasMore ? `${state.agents.length} loaded` : `${state.agents.length} available`;
  renderAgentLoadState();
}

async function loadAgentByName(name) {
  if (!name || !state.cfg) return;
  const generation = ++state.agentLoadGeneration;
  setMessage(`Loading the latest complete definition for ${name}…`);
  try {
    const payload = await serviceRequest(
      serviceUrl(`/agents/${encodeURIComponent(name)}`),
    );
    if (generation !== state.agentLoadGeneration) return;
    const agent = extractLatestAgent(payload);
    const existing = state.agents.find((item) => item.name === agent.name);
    if (existing) {
      existing.version = agent.version;
    } else {
      state.agents.unshift({
        name: agent.name,
        version: agent.version,
        createdAt: Number(agent.createdAt) || Date.now(),
      });
    }
    state.selectedAgentName = agent.name;
    setDefinition(agent.definition, {
      ...agent,
      remote: true,
      message: `Loaded ${agent.name} version ${agent.version || "latest"} from Foundry.`,
    });
    const url = new URL(window.location.href);
    url.searchParams.set("agent", agent.name);
    window.history.replaceState(null, "", url);
  } catch (error) {
    if (generation !== state.agentLoadGeneration) return;
    setMessage(
      `Could not load ${name}. The current working copy was preserved.`,
      error.message,
    );
  }
}

async function loadSelectedAgent() {
  await loadAgentByName(state.selectedAgentName);
}

function loadBlank() {
  const definition = createBlankDefinition();
  setDefinition(definition, {
    name: `handoff-graph-agent-${crypto.randomUUID().slice(0, 8)}`,
    version: "local",
    message: "Created a ready-to-run working copy with $entrypoint -> end. Choose Try it now, or customize the nodes and settings.",
  });
  const url = new URL(window.location.href);
  url.searchParams.delete("agent");
  window.history.replaceState(null, "", url);
}

function openAgentImport() {
  state.importReturnFocus = document.activeElement;
  state.importOpenSettings = !$("#node-editor").hidden
    && state.selected.kind === "node" && state.selected.id === ENTRYPOINT_ID;
  state.importCandidate = null;
  state.importFileName = "";
  state.importGeneration += 1;
  $("#agent-import-file").value = "";
  $("#agent-import-source").value = "";
  $("#agent-import-errors").hidden = true;
  $("#agent-import-errors").replaceChildren();
  $("#agent-import-status").textContent =
    "Choose a JSON or YAML file, or paste your configuration, then validate. Import stays local; Foundry validates service availability when you publish.";
  $("#agent-import-replace-label").hidden = !state.definition;
  $("#agent-import-replace").checked = false;
  $("#apply-agent-import").disabled = true;
  $("#agent-import-dialog").showModal();
}

function closeAgentImport() {
  state.importGeneration += 1;
  $("#agent-import-dialog").close();
  state.importReturnFocus?.focus();
}

function invalidateAgentImport() {
  state.importCandidate = null;
  $("#apply-agent-import").disabled = true;
  $("#agent-import-errors").hidden = true;
  $("#agent-import-status").textContent = "Configuration changed. Validate it before importing.";
}

function validateAgentImport() {
  invalidateAgentImport();
  const source = $("#agent-import-source").value;
  let problems;
  try {
    if (new TextEncoder().encode(source).length > 2 * 1024 * 1024) {
      throw new Error("Agent configuration exceeds the 2 MB import limit.");
    }
    const candidate = parseAgentSource(source);
    problems = candidate.problems;
    if (!problems.some((item) => item.severity === "error")) state.importCandidate = candidate;
  } catch (error) {
    problems = [{ severity: "error", field: "JSON / YAML", message: error.message }];
  }
  const root = $("#agent-import-errors");
  root.replaceChildren(...problems.map((item) => {
    const row = document.createElement("li");
    const field = document.createElement("code");
    field.textContent = [item.objectId, item.field].filter(Boolean).join(" / ");
    const message = document.createElement("span");
    message.textContent = `${item.severity === "warning" ? "Warning: " : ""}${item.message}`;
    row.append(field, message);
    return row;
  }));
  root.hidden = !problems.length;
  $("#apply-agent-import").disabled = !state.importCandidate;
  $("#agent-import-status").textContent = state.importCandidate
    ? `Local validation passed${problems.length ? ` with ${problems.length} warning(s)` : ""}. Review and import your working copy. Nothing has been published.`
    : "Import blocked. Fix the errors below; your current working copy has not changed.";
}

async function readAgentImportFile() {
  const file = $("#agent-import-file").files[0];
  if (!file) return;
  const generation = ++state.importGeneration;
  invalidateAgentImport();
  state.importFileName = "";
  $("#agent-import-source").value = "";
  $("#agent-import-status").textContent = `Reading ${file.name}…`;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("Agent configuration exceeds the 2 MB import limit.");
    const source = await file.text();
    if (generation !== state.importGeneration) return;
    state.importFileName = file.name;
    $("#agent-import-source").value = source;
    validateAgentImport();
  } catch (error) {
    if (generation !== state.importGeneration) return;
    $("#agent-import-status").textContent = `Cannot import ${file.name}: ${error.message}`;
  }
}

function applyAgentImport() {
  if (!state.importCandidate) return;
  if (state.definition && !$("#agent-import-replace").checked) {
    $("#agent-import-status").textContent = "Confirm replacement of the current working copy before importing.";
    $("#agent-import-replace").focus();
    return;
  }
  const candidate = state.importCandidate;
  const filename = state.importFileName.replace(/(?:\.handoff\.definition)?\.(?:json|ya?ml)$/i, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^[^a-zA-Z0-9]+/, "").slice(0, 63);
  const openSettings = state.importOpenSettings;
  closeAgentImport();
  closeDefinition();
  hideNodeEditor();
  hideEdgeEditor();
  state.editorSession = null;
  setDefinition(candidate.definition, {
    name: candidate.name || filename || `imported-agent-${crypto.randomUUID().slice(0, 8)}`,
    version: "local",
    description: candidate.description,
    metadata: candidate.metadata,
    message: "Imported validated Agent configuration into the local working copy. Review it before publishing.",
  });
  const url = new URL(window.location.href);
  url.searchParams.delete("agent");
  window.history.replaceState(null, "", url);
  if (openSettings) openEntrypointSettings();
}

const templateLanguageNames = new Intl.DisplayNames(["en"], { type: "language" });

function templateLocale(template) {
  const code = template.target_locale || "";
  return {
    code,
    label: code ? templateLanguageNames.of(code) : "Locale not specified",
    group: code.startsWith("en-") ? "en-*" : code || "unspecified",
  };
}

function templateLocaleGroups(templates) {
  const groups = new Map();
  for (const template of templates) {
    const locale = templateLocale(template);
    if (!groups.has(locale.group)) {
      groups.set(locale.group, {
        id: locale.group,
        label: locale.group === "en-*" ? "English" : locale.label,
        code: locale.code ? locale.group : "Not specified",
        templates: [],
      });
    }
    groups.get(locale.group).templates.push(template);
  }
  const priority = (group) => group.id === "hi-IN" ? 0
    : group.id === "en-*" ? 1 : group.id === "unspecified" ? 3 : 2;
  return [...groups.values()].sort((left, right) =>
    priority(left) - priority(right) || left.label.localeCompare(right.label));
}

function templateDomainGroups(templates) {
  const groups = new Map();
  const priority = new Map([["Customer support", 0], ["Financial services", 1]]);
  for (const template of templates) {
    const domain = template.category || "Other workflows";
    if (!groups.has(domain)) groups.set(domain, { id: domain, label: domain, templates: [] });
    groups.get(domain).templates.push(template);
  }
  return [...groups.values()].sort((left, right) =>
    (priority.get(left.id) ?? priority.size) - (priority.get(right.id) ?? priority.size)
    || left.label.localeCompare(right.label));
}

function rememberTemplateGroupExpansion() {
  if (state.templateQuery.trim()) return;
  $$("#template-picker-grid details").forEach((group) => {
    const id = group.dataset.localeGroup ?? group.dataset.domainGroup;
    state.templateGroupOpen.set(`${state.templateGrouping}:${id}`, group.open);
  });
}

// Search includes the declared conversation locale, not the prompt language.
function templateMatchesQuery(template, query, languageQueries) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const systems = Array.isArray(template.tool_systems) ? template.tool_systems : [];
  const locale = templateLocale(template);
  const text = [
    template.name, template.id, template.category, template.summary,
    locale.code, locale.label,
    ...systems.map((system) => system.label),
  ].filter(Boolean).join(" ").toLowerCase();
  const localeText = `${locale.code} ${locale.label}`.toLowerCase();
  return terms.every((term) => {
    if (languageQueries.has(term)) return localeText.includes(term);
    if (/^[a-z]{2,3}-\*$/.test(term)) return locale.code.toLowerCase().startsWith(term.slice(0, -1));
    return text.includes(term);
  });
}

function renderTemplateCatalog() {
  const root = $("#template-picker-grid");
  root.replaceChildren();
  const groups = templateLocaleGroups(state.templates);
  $$("[data-template-grouping]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.templateGrouping === state.templateGrouping));
    button.disabled = state.templateCatalogLoading || Boolean(state.templateLoadingId);
  });
  const count = $("#template-picker-count");
  count.textContent = "";
  if (state.templateCatalogLoading) {
    root.innerHTML = `
      <div class="template-picker-loading">
        <span aria-hidden="true"></span>
        Reading the template catalog…
      </div>`;
    return;
  }
  if (!state.templates.length) {
    root.innerHTML = `
      <div class="template-picker-empty">
        <strong>No templates are available.</strong>
        <span>Check the Portal template catalog configuration.</span>
      </div>`;
    return;
  }
  const query = state.templateQuery.trim();
  const languageQueries = new Set(groups.filter((group) => group.id !== "unspecified")
    .map((group) => templateLanguageNames.of(group.id.split("-")[0]).toLowerCase()));
  const matches = state.templates.filter((template) => templateMatchesQuery(template, query, languageQueries));
  count.textContent = `${matches.length} of ${state.templates.length}`;
  if (!matches.length) {
    root.innerHTML = `
      <div class="template-picker-empty">
        <strong>No templates match “${escapeHtml(query)}”.</strong>
        <span>Try another name, locale, category or system.</span>
      </div>`;
    return;
  }
  const containers = new Map();
  const localeGrouping = state.templateGrouping === "locale";
  const displayGroups = localeGrouping ? templateLocaleGroups(matches) : templateDomainGroups(matches);
  for (const [index, group] of displayGroups.entries()) {
    const section = document.createElement("details");
    section.className = "template-locale-group";
    const groupKey = `${state.templateGrouping}:${group.id}`;
    section.open = Boolean(query) || (state.templateGroupOpen.get(groupKey) ?? true);
    section.addEventListener("toggle", () => {
      if (section.isConnected && !state.templateQuery.trim()) {
        state.templateGroupOpen.set(groupKey, section.open);
      }
    });
    if (localeGrouping) section.dataset.localeGroup = group.id;
    else section.dataset.domainGroup = group.id;
    section.setAttribute("aria-labelledby", `template-locale-heading-${index}`);
    const badge = group.id === "unspecified" ? "?" : group.id.slice(0, 2).toUpperCase();
    const description = localeGrouping
      ? `${group.code} · Customer conversation language`
      : "Business domain · Each card shows its target locale";
    section.innerHTML = `
      <summary class="template-locale-heading">
        <span class="template-locale-monogram" aria-hidden="true">${escapeHtml(badge)}</span>
        <div>
          <h3 id="template-locale-heading-${index}">${escapeHtml(group.label)}</h3>
          <p>${escapeHtml(description)}</p>
        </div>
        <span>${group.templates.length} template${group.templates.length === 1 ? "" : "s"}</span>
      </summary>
      <div class="template-locale-templates"></div>`;
    containers.set(group.id, section.querySelector(".template-locale-templates"));
    root.append(section);
  }
  for (const template of matches) {
    const locale = templateLocale(template);
    const card = document.createElement("div");
    card.className = "template-choice-card";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "template-choice";
    button.dataset.templateId = template.id;
    button.dataset.targetLocale = locale.code;
    button.disabled = Boolean(state.templateLoadingId);
    button.style.setProperty("--template-accent", template.accent_color || template.accent || "#0f9f76");
    const systems = Array.isArray(template.tool_systems) ? template.tool_systems : [];
    button.innerHTML = `
      <span class="template-choice-orbit" aria-hidden="true"></span>
      <span class="template-choice-topline">
        <span class="template-choice-category">${escapeHtml(template.category || "Voice Agent")}</span>
        <span class="template-choice-locale" title="Target locale: ${escapeHtml(locale.label)}">${escapeHtml(locale.code || "Not specified")}</span>
        ${template.mock_tools
          ? '<span class="template-choice-mcp">Mock tools</span>'
          : template.requires_mcp ? '<span class="template-choice-mcp">MCP</span>' : ""}
      </span>
      <strong>${escapeHtml(template.name || template.id)}</strong>
      <span class="template-choice-id">${escapeHtml(template.id)}</span>
      <span class="template-choice-summary">${escapeHtml(template.summary || "Voice Agent template.")}</span>
      ${systems.length ? `<span class="template-choice-systems">${systems.map((system) => `
        <span class="${system.connectable ? "" : "mock-only"}" title="${system.connectable
          ? "Mock tool calls by default; you can connect a real tool"
          : "Mock only in the shared Playground"}">${escapeHtml(system.label)}${system.connectable ? "" : " · mock only"}</span>`).join("")}
      </span>` : ""}
      <span class="template-choice-metrics">
        <span>${Number(template.node_count || 0) ? `${Number(template.node_count)} nodes` : "single Agent"}</span>
        <span>${Number(template.edge_count || 0)} edges</span>
        <span>${Number(template.tool_count || 0)} tools</span>
      </span>
      <span class="template-choice-load">
        ${state.templateLoadingId === template.id ? "Loading…" : systems.some((system) => system.connectable) ? "Load with mock tool calls" : "Load into canvas"}
        <span aria-hidden="true">→</span>
      </span>`;
    const versions = template.versions || [{ id: ".", name: "Default" }];
    const selectedVersion = state.templateVersions.get(template.id);
    const version = versions.some((item) => item.id === selectedVersion)
      ? selectedVersion
      : template.default_version || ".";
    state.templateVersions.set(template.id, version);
    const label = document.createElement("label");
    label.className = "template-choice-version";
    label.textContent = "Version";
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Version for ${template.name || template.id}`);
    select.disabled = Boolean(state.templateLoadingId) || versions.length < 2;
    for (const item of versions) {
      select.add(new Option(item.name, item.id));
    }
    select.value = version;
    button.querySelector(".template-choice-metrics").hidden = version !== (template.default_version || ".");
    select.addEventListener("change", () => {
      state.templateVersions.set(template.id, select.value);
      button.querySelector(".template-choice-metrics").hidden = select.value !== (template.default_version || ".");
    });
    label.append(select);
    const options = document.createElement("div");
    options.className = "template-choice-options";
    options.append(label);
    const loadWithTools = systems.some((system) => system.connectable);
    if (loadWithTools) {
      const real = document.createElement("button");
      real.type = "button";
      real.className = "template-choice-real";
      real.disabled = Boolean(state.templateLoadingId);
      real.title = "Load this template and connect a real tool for each system";
      real.innerHTML = 'Connect real tools <span aria-hidden="true">→</span>';
      real.addEventListener("click", () =>
        loadTemplateIntoGraph(template.id, select.value, { connectTools: true }));
      options.append(real);
    }
    card.append(button, options);
    button.addEventListener("click", () => loadTemplateIntoGraph(template.id, select.value));
    containers.get(localeGrouping ? locale.group : template.category || "Other workflows").append(card);
  }
}

async function loadTemplateCatalog({ force = false } = {}) {
  rememberTemplateGroupExpansion();
  if (state.templateCatalogLoading || (state.templateCatalogLoaded && !force)) {
    renderTemplateCatalog();
    return;
  }
  state.templateCatalogLoading = true;
  $("#template-picker-status").textContent = "Loading the template catalog…";
  renderTemplateCatalog();
  renderHeader();
  try {
    const suffix = force ? "?reload=1" : "";
    const payload = await readResponse(await fetch(`/api/templates${suffix}`));
    if (!payload.available) {
      throw new Error(payload.reason || "The template catalog is unavailable.");
    }
    state.templates = Array.isArray(payload.templates) ? payload.templates : [];
    state.templateCatalogLoaded = true;
    $("#template-picker-status").textContent = state.templates.length
      ? `${state.templates.length} curated workflow${state.templates.length === 1 ? "" : "s"} · select one to replace the local working copy`
      : "The catalog is available but contains no templates.";
    for (const error of payload.errors || []) {
      const warning = document.createElement("p");
      warning.textContent = `${error.id}${error.version ? ` (${error.version})` : ""}: ${error.error}`;
      $("#template-picker-status").append(warning);
    }
  } catch (error) {
    state.templates = [];
    state.templateCatalogLoaded = false;
    $("#template-picker-status").textContent = `Template catalog failed: ${error.message}`;
  } finally {
    state.templateCatalogLoading = false;
    renderTemplateCatalog();
    renderHeader();
  }
}

function openTemplatePicker() {
  state.templateGrouping = "locale";
  state.templateGroupOpen.clear();
  state.templateQuery = "";
  $("#template-picker-search").value = "";
  $("#template-picker").hidden = false;
  renderTemplateCatalog();
  $("#template-picker-grid").scrollTop = 0;
  void loadTemplateCatalog();
  requestAnimationFrame(() => $("#template-picker-search").focus());
}

function closeTemplatePicker() {
  $("#template-picker").hidden = true;
}

/* Tool connections: replace a working copy's mock tools with the user's MCP servers. */

const MOCK_TOOL_PREFIX = "mock_tool_call_";

function workingCopyMockTools() {
  const names = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      if (value.type === "mcp") {
        for (const name of value.allowed_tools || []) {
          if (String(name).startsWith(MOCK_TOOL_PREFIX)) names.add(name);
        }
      }
      Object.values(value).forEach(visit);
    }
  };
  visit(state.definition);
  return [...names];
}

async function toolRequest(path, body) {
  return readResponse(await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definition: state.definition, ...body }),
  }));
}

async function refreshToolGroups() {
  if (!state.definition) {
    state.toolGroups = [];
    renderToolConnections();
    return;
  }
  try {
    state.toolGroups = (await toolRequest("/api/tools/groups", {})).groups || [];
  } catch (error) {
    state.toolGroups = [];
    $("#tool-connections-status").textContent = `Could not read the working copy's tools: ${error.message}`;
  }
  renderToolConnections();
}

function renderToolBanner() {
  const mockTools = state.definition ? workingCopyMockTools() : [];
  const banner = $("#mock-tools-banner");
  banner.hidden = mockTools.length === 0;
  if (banner.hidden) return;
  const groups = state.toolGroups || [];
  const covered = new Set(groups.flatMap((group) => group.tools));
  if (mockTools.some((name) => !covered.has(name)) && !state.toolGroupsRefreshing) {
    // Undo, redo, or a manual edit changed the tools; re-read their systems.
    state.toolGroupsRefreshing = true;
    void refreshToolGroups().finally(() => { state.toolGroupsRefreshing = false; });
  }
  const labels = groups
    .filter((group) => group.tools.some((name) => mockTools.includes(name)))
    .map((group) => group.label);
  const systems = labels.length < 2
    ? labels[0] || "business"
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  $("#mock-tools-banner-text").textContent = (
    `Its ${systems} tools make mock tool calls with fictional data, so nothing real is booked, `
    + "sent, or saved. Connect a real tool per system to use them for real."
  );
}

function openToolConnections({ fromPicker = false } = {}) {
  if (!state.definition) return;
  state.toolDrafts = {};
  state.toolConnectionEpoch += 1;
  state.toolSummaryOpen = false;
  // Opened from Connect real tools: closing returns to the template list.
  state.toolDialogFromPicker = fromPicker === true;
  $("#close-tool-connections").setAttribute(
    "aria-label", state.toolDialogFromPicker ? "Back to templates" : "Close tool connections",
  );
  $("#tool-connections").hidden = false;
  $("#tool-connections-status").textContent = "Reading the working copy's tools…";
  void refreshToolGroups();
  requestAnimationFrame(() => $("#close-tool-connections").focus());
}

function closeToolConnections({ returnToPicker = true } = {}) {
  state.toolConnectionEpoch += 1;
  $("#tool-connections").hidden = true;
  const fromPicker = state.toolDialogFromPicker;
  state.toolDialogFromPicker = false;
  if (fromPicker && returnToPicker === true) openTemplatePicker();
}

function shortToolName(name) {
  return String(name).replace(/^mock_tool_call_/, "");
}

function toolGroupMode(group) {
  if (group.connected) return "real";
  if (!group.connectable) return "locked";
  return state.toolDrafts[group.id]?.url.trim() ? "pending" : "mock";
}

const TOOL_MODE_LABELS = {
  real: "Connected to real tool",
  mock: "Using mock tool calls",
  pending: "URL not connected",
  locked: "Mock only",
};

function toolConnectionsSummary(groups) {
  const real = groups.filter((group) => group.connected);
  const mock = groups.filter((group) => !group.connected);
  return { real, mock, text: `${real.length} real · ${mock.length} mock tool calls` };
}

function renderToolSummary(groups) {
  const { real, mock } = toolConnectionsSummary(groups);
  const row = (group) => {
    const mode = toolGroupMode(group);
    const detail = group.connected
      ? escapeHtml(serverHost(group.connected.server_url))
      : mode === "pending"
        ? "The URL you entered was not connected, so this system uses mock tool calls."
        : mode === "locked" ? "Can't be connected with an MCP URL yet." : "Mock tool calls with fictional data.";
    return `<li class="${mode}"><strong>${escapeHtml(group.label)}</strong><span>${detail}</span></li>`;
  };
  return `
    <section class="tool-summary">
      <h3>Review before you continue</h3>
      <div class="tool-summary-column real">
        <h4>Real tools</h4>
        ${real.length ? `<ul>${real.map(row).join("")}</ul>` : `<p>None. Every system uses mock tool calls.</p>`}
      </div>
      <div class="tool-summary-column mock">
        <h4>Mock tool calls · nothing real is booked, sent, or saved</h4>
        ${mock.length ? `<ul>${mock.map(row).join("")}</ul>` : `<p>None.</p>`}
      </div>
      <p class="tool-summary-next">Confirm and try it now publishes the Agent with these choices and starts a test session. Select Back to change a system, or × to close without publishing.</p>
    </section>`;
}

function renderToolConnections() {
  renderToolBanner();
  if ($("#tool-connections").hidden) return;
  const groups = state.toolGroups || [];
  $("#tool-connections-status").textContent = groups.length
    ? `This Agent uses ${groups.length} system${groups.length === 1 ? "" : "s"}.`
    : "This working copy has no MCP tools to connect.";
  const summaryOpen = Boolean(state.toolSummaryOpen && groups.length);
  $("#tool-connection-groups").innerHTML = summaryOpen ? renderToolSummary(groups) : groups.map(toolGroupCard).join("");
  $("#tool-connections-summary").textContent = groups.length ? toolConnectionsSummary(groups).text : "";
  $("#tool-connections-back").hidden = !summaryOpen;
  $("#tool-connections-done").textContent = summaryOpen ? "Confirm and try it now" : "Done";
  $("#tool-connections-done").disabled = state.toolConnectionBusy;
}

function finishToolConnections() {
  if (state.toolConnectionBusy) return;
  if (!state.toolSummaryOpen && (state.toolGroups || []).length) {
    state.toolSummaryOpen = true;
    renderToolConnections();
    return;
  }
  state.toolSummaryOpen = false;
  closeToolConnections({ returnToPicker: false });
  if (!$("#publish-run-action").disabled) void publishAndRun();
}

function backToToolConnections() {
  state.toolSummaryOpen = false;
  renderToolConnections();
}

const TOOL_URL_STORAGE = "voice-agent.tool-url.";
const TOOL_GUIDES = {
  salesforce: ["/guide/logic-apps-mcp", "How to build a Salesforce MCP server (Azure Logic Apps)"],
  zendesk: ["/guide/logic-apps-mcp", "How to build a Zendesk MCP server (Azure Logic Apps)"],
};

function rememberedToolUrl(groupId) {
  try {
    return window.localStorage.getItem(TOOL_URL_STORAGE + groupId) || "";
  } catch {
    return "";
  }
}

function rememberToolUrl(groupId, url) {
  try {
    window.localStorage.setItem(TOOL_URL_STORAGE + groupId, url);
  } catch {
    // Storage can be unavailable; the URL is simply not prefilled next time.
  }
}

function toolDraft(groupId) {
  if (!state.toolDrafts[groupId]) {
    state.toolDrafts[groupId] = {
      url: rememberedToolUrl(groupId), tools: null, mapping: {}, message: "", error: false, busy: false,
    };
  }
  return state.toolDrafts[groupId];
}

function serverHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function toolGroupHint(mode) {
  return mode === "pending"
    ? "Not connected yet. Select Connect real tool to use this URL, or Use mock tool calls to clear it."
    : "Leave the URL empty to keep mock tool calls for this system.";
}

function toolGroupCard(group) {
  const connected = group.connected;
  const mode = toolGroupMode(group);
  const id = escapeHtml(group.id);
  let body = "";
  if (mode === "locked") {
    body = `<p class="tool-group-note">${escapeHtml(group.note)}</p>`;
  } else if (connected) {
    const known = Boolean(state.toolConnections[group.id]);
    body = `
      <div class="tool-group-row">
        <p class="tool-group-state good">Calls your real tool at <strong>${escapeHtml(serverHost(connected.server_url))}</strong></p>
        ${known
          ? `<button type="button" data-tool-action="use-mock" data-group="${id}" ${state.toolConnectionBusy ? "disabled" : ""}>Use mock tool calls</button>`
          : ""}
      </div>
      ${known ? "" : `<p class="tool-group-hint">To switch back to mock tool calls, use Undo or load the template again.</p>`}`;
  } else {
    const draft = toolDraft(group.id);
    const missing = draft.tools ? group.tools.filter((name) => !draft.mapping[name]) : [];
    const mapping = missing.length
      ? `<details class="tool-group-map" open>
          <summary>Match the tools by hand</summary>
          <ul>${missing.map((name) => `
            <li>
              <code>${escapeHtml(shortToolName(name))}</code>
              <span class="tool-map-arrow" aria-hidden="true">→</span>
              <select data-tool-map="${escapeHtml(name)}" data-group="${id}"
                aria-label="Server tool for ${escapeHtml(shortToolName(name))}">
                <option value="">Choose a tool on your server…</option>
                ${draft.tools.map((tool) => `<option value="${escapeHtml(tool)}">${escapeHtml(tool)}</option>`).join("")}
              </select>
            </li>`).join("")}</ul>
        </details>`
      : "";
    const [guide, guideText] = TOOL_GUIDES[group.id]
      || ["/guide/real-tools", `How to build a ${group.label} MCP server`];
    const empty = !draft.url.trim();
    body = `
      <div class="tool-group-row">
        <input type="url" data-tool-url="${id}" value="${escapeHtml(draft.url)}"
          ${state.toolConnectionBusy ? "disabled" : ""}
          placeholder="https://your-server.example.com/mcp" autocomplete="off" spellcheck="false" maxlength="2048"
          aria-label="${escapeHtml(group.label)} MCP server URL">
        <button type="button" class="tool-group-action" data-tool-action="connect" data-group="${id}"
          ${state.toolConnectionBusy || empty ? "disabled" : ""}>${draft.busy ? "Connecting…" : "Connect real tool"}</button>
        <button type="button" data-tool-action="use-mock" data-group="${id}" ${state.toolConnectionBusy || empty ? "disabled" : ""}>Use mock tool calls</button>
      </div>
      ${draft.message
        ? `<p class="tool-group-state ${draft.error ? "bad" : "good"}">${escapeHtml(draft.message)}</p>`
        : `<p class="tool-group-hint" data-tool-hint>${toolGroupHint(mode)}</p>`}
      ${mapping}
      <a class="tool-group-guide" href="${guide}" target="_blank" rel="noreferrer">${escapeHtml(guideText)}</a>`;
  }
  return `
    <article class="tool-group mode-${mode}" data-group-card="${id}">
      <header><strong>${escapeHtml(group.label)}</strong>
        <span class="tool-group-status mode-${mode}" data-tool-status>${TOOL_MODE_LABELS[mode]}</span></header>
      ${body}
    </article>`;
}

function replaceWorkingDefinition(label, definition) {
  mutate(label, (current) => {
    for (const key of Object.keys(current)) delete current[key];
    Object.assign(current, deepClone(definition));
  });
}

function toolConnectionScope() {
  return { epoch: state.toolConnectionEpoch, definition: stableJson(state.definition) };
}

function assertToolConnectionScope(scope) {
  if (scope.epoch !== state.toolConnectionEpoch || scope.definition !== stableJson(state.definition)) {
    throw new Error("The working copy or dialog changed while connecting. Connect again to apply this choice.");
  }
}

async function connectToolGroup(group, draft) {
  const url = draft.url.trim();
  const scope = toolConnectionScope();
  const missing = group.tools.filter((name) => !draft.mapping[name]);
  if (draft.tools && draft.discoveredUrl === url && missing.length) {
    Object.assign(draft, {
      message: `This server doesn't offer every ${group.label} action the template needs. Match the remaining tools below, then select Connect again.`,
      error: true,
    });
    return;
  }
  const result = await toolRequest("/api/tools/connect", createToolConnectRequest(group.id, draft));
  assertToolConnectionScope(scope);
  if (!result.connected) {
    Object.assign(draft, {
      url: result.server_url, discoveredUrl: result.server_url,
      tools: result.tools, mapping: { ...result.mapping },
      message: "Match the remaining tools below, then select Connect again.", error: true,
    });
    return;
  }
  draft.url = result.server_url;
  rememberToolUrl(group.id, draft.url);
  state.toolConnections[group.id] = { server_url: draft.url, tool_map: result.tool_map };
  delete state.toolDrafts[group.id];
  replaceWorkingDefinition(`Connected ${group.label} to ${serverHost(draft.url)}`, result.definition);
  state.toolGroups = result.groups;
}

async function handleToolAction(event) {
  const button = event.target.closest("[data-tool-action]");
  if (!button) return;
  if (state.toolConnectionBusy) return;
  const groupId = button.dataset.group;
  const group = (state.toolGroups || []).find((item) => item.id === groupId);
  if (!group) return;
  const action = button.dataset.toolAction;
  const draft = state.toolDrafts[groupId];
  if (action === "use-mock" && !group.connected) {
    state.toolDrafts[groupId] = {
      url: "", tools: null, mapping: {}, message: "", error: false, busy: false,
    };
    renderToolConnections();
    return;
  }
  if (action === "connect" && draft && !draft.busy) {
    state.toolConnectionBusy = true;
    Object.assign(draft, { busy: true, message: "", error: false });
    renderToolConnections();
    try {
      await connectToolGroup(group, draft);
    } catch (error) {
      Object.assign(draft, { message: `Could not connect: ${error.message}`, error: true });
      setMessage("Tool connection was not applied.", error.message);
    } finally {
      state.toolConnectionBusy = false;
      draft.busy = false;
    }
    renderToolConnections();
    return;
  }
  if (action === "use-mock" && state.toolConnections[groupId]) {
    const scope = toolConnectionScope();
    let switchError = "";
    state.toolConnectionBusy = true;
    renderToolConnections();
    try {
      const result = await toolRequest("/api/tools/disconnect", {
        group: groupId, tool_map: state.toolConnections[groupId].tool_map,
      });
      assertToolConnectionScope(scope);
      delete state.toolConnections[groupId];
      state.toolDrafts[groupId] = {
        url: "", tools: null, mapping: {}, message: "", error: false, busy: false,
      };
      replaceWorkingDefinition(`Moved ${group.label} tools back to mock tool calls`, result.definition);
      state.toolGroups = result.groups;
    } catch (error) {
      switchError = `Could not switch back: ${error.message}`;
    } finally {
      state.toolConnectionBusy = false;
    }
    renderToolConnections();
    if (switchError) $("#tool-connections-status").textContent = switchError;
  }
}

function handleToolInput(event) {
  const url = event.target.closest("[data-tool-url]");
  if (url) {
    const draft = state.toolDrafts[url.dataset.toolUrl];
    if (!draft) return;
    draft.url = url.value;
    if (url.value.trim() !== (draft.discoveredUrl || "")) {
      Object.assign(draft, { tools: null, mapping: {}, message: "", error: false });
    }
    const card = url.closest(".tool-group");
    const group = (state.toolGroups || []).find((item) => item.id === url.dataset.toolUrl);
    if (card && group) {
      const mode = toolGroupMode(group);
      const status = card.querySelector("[data-tool-status]");
      status.textContent = TOOL_MODE_LABELS[mode];
      status.className = `tool-group-status mode-${mode}`;
      card.className = `tool-group mode-${mode}`;
      const hint = card.querySelector("[data-tool-hint]");
      if (hint) hint.textContent = toolGroupHint(mode);
      card.querySelectorAll('[data-tool-action="connect"], [data-tool-action="use-mock"]').forEach((button) => {
        button.disabled = draft.busy || !url.value.trim();
      });
      $("#tool-connections-summary").textContent = toolConnectionsSummary(state.toolGroups).text;
    }
    return;
  }
  const select = event.target.closest("[data-tool-map]");
  if (select) {
    const draft = state.toolDrafts[select.dataset.group];
    if (draft) draft.mapping[select.dataset.toolMap] = select.value;
  }
}

async function loadTemplateIntoGraph(templateId, version = ".", { connectTools = false } = {}) {
  if (!templateId || state.templateLoadingId) return;
  state.templateLoadingId = templateId;
  $("#template-picker-status").textContent = `Materializing ${templateId} for ${state.cfg?.project || "the selected project"}…`;
  renderTemplateCatalog();
  renderHeader();
  try {
    const detail = await readResponse(
      await fetch(`/api/templates/${encodeURIComponent(templateId)}?version=${encodeURIComponent(version)}`),
    );
    if (!detail.definition || detail.definition.kind !== "voice") {
      throw new Error("The template did not return an editable Voice Agent definition.");
    }
    setDefinition(detail.definition, {
      name: detail.suggested_agent_name,
      version: "local",
      description: detail.description || detail.summary || "",
      metadata: {
        source_template_id: detail.id,
        source_template_name: detail.name,
        source_template_version: detail.version,
      },
      message: `Loaded ${detail.name} (${detail.version === "." ? "Default" : detail.version}) into a temporary local working copy. The Template remains read-only.`,
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("agent");
    window.history.replaceState(null, "", url);
    closeTemplatePicker();
    if (connectTools) openToolConnections({ fromPicker: true });
  } catch (error) {
    $("#template-picker-status").textContent = `Could not load ${templateId}: ${error.message}`;
  } finally {
    state.templateLoadingId = "";
    renderTemplateCatalog();
    renderHeader();
  }
}

function addNode() {
  if (!state.definition) return;
  const  ids = state.definition.handoff.nodes.map((node) => node.id);
  const id = uniqueId("specialist", ids);
  const editorSnapshot = captureEditorSession("node", id);
  mutate(`Added node ${id}`, (definition) => {
    definition.handoff.nodes.push({
      id,
      description: "",
      config: {
        instructions: "",
        model: DEFAULT_NODE_PRESET.model.id,
        voice: DEFAULT_NODE_PRESET.voice.id,
        tools: [],
        tool_choice: "auto",
      },
    });
  });
  state.selected = { kind: "node", id };
  const source = state.positions.get(ENTRYPOINT_ID) || { x: 60, y: 100 };
  state.positions.set(id, {
    x: source.x + (ids.length % 3 - 1) * 120,
    y: source.y + CARD_HEIGHT + LAYOUT_ROW_GAP,
  });
  state.nodeIcons.set(id, "user");
  render();
  openNodeEditor(id, editorSnapshot);
}

function deleteSelectedNode() {
  if (!state.definition || state.selected.kind !== "node" || state.selected.id === ENTRYPOINT_ID) return;
  const id = state.selected.id;
  mutate(`Deleted node ${id}`, (definition) => {
    definition.handoff.nodes = definition.handoff.nodes.filter((node) => node.id !== id);
    definition.handoff.edges = definition.handoff.edges.filter(
      (edge) => edge.source !== id && edge.target !== id,
    );
  });
  state.positions.delete(id);
  state.nodeIcons.delete(id);
  state.selected = { kind: "graph", id: "" };
  render();
}

function confirmDeleteSelectedNode() {
  if (!state.definition || state.selected.kind !== "node" || state.selected.id === ENTRYPOINT_ID) return false;
  const id = state.selected.id;
  const connectedEdges = state.definition.handoff.edges.filter(
    (edge) => edge.source === id || edge.target === id,
  ).length;
  const edgeConsequence = connectedEdges
    ? `\n\nThis also deletes ${connectedEdges} connected edge${connectedEdges === 1 ? "" : "s"}.`
    : "";
  const confirmed = window.confirm(
    `Delete node "${id}"?${edgeConsequence}\n\nYou can undo this change before publishing.`,
  );
  if (confirmed) {
    deleteSelectedNode();
    commitEditorSession("node", `Deleted node ${id}`);
  }
  return true;
}

function addEdge() {
  if (!state.definition) return;
  const ids = graphIds();
  if (ids.length < 2) {
    setMessage("Add a specialist node before creating an edge.", "An edge needs a specialist target.");
    return;
  }
  const source = state.selected.kind === "node" && ids.includes(state.selected.id)
    ? state.selected.id
    : ENTRYPOINT_ID;
  const target = ids.find((id) => id !== source && id !== ENTRYPOINT_ID) || ids.find((id) => id !== source);
  createEdgeBetween(source, target);
}

function createEdgeBetween(source, target) {
  if (!state.definition || source === target || target === ENTRYPOINT_ID) return;
  if (state.definition.handoff.edges.some((edge) => edge.source === source && edge.target === target)) {
    setMessage(`An edge from ${source} to ${target} already exists.`);
    return;
  }
  const edgeIds = state.definition.handoff.edges.map((edge) => edge.id);
  const id = uniqueId(`${source.replace("$", "")}_to_${target}`, edgeIds);
  const editorSnapshot = captureEditorSession("edge", id);
  mutate(`Added edge ${id}`, (definition) => {
    definition.handoff.edges.push({
      id,
      source,
      target,
      description: `Use this route when the user needs help best handled by ${target}.`,
      transfer_message: "",
      target_response: "auto",
      cancel_on_interruption: true,
      delay_ms: 0,
    });
  });
  state.outlineTab = "edges";
  focusEdgeAndOpen(id, editorSnapshot);
}

function deleteEdgeById(id) {
  if (!state.definition) return;
  mutate(`Deleted edge ${id}`, (definition) => {
    definition.handoff.edges = definition.handoff.edges.filter((edge) => edge.id !== id);
  });
  if (state.selected.kind === "edge" && state.selected.id === id) {
    state.selected = { kind: "graph", id: "" };
  }
  $("#edge-editor").hidden = true;
  render();
}

function deleteSelectedEdge() {
  if (state.selected.kind === "edge") deleteEdgeById(state.selected.id);
}

function confirmDeleteEdgeById(id) {
  const edge = state.definition?.handoff?.edges?.find((item) => item.id === id);
  if (!edge) return false;
  const confirmed = window.confirm(
    `Delete edge "${edge.id}"?\n\n${edge.source} → ${edge.target}\n\nYou can undo this change before publishing.`,
  );
  if (confirmed) {
    deleteEdgeById(id);
    commitEditorSession("edge", `Deleted edge ${id}`);
  }
  return true;
}

function confirmDeleteSelectedGraphObject() {
  if (state.selected.kind === "node") return confirmDeleteSelectedNode();
  if (state.selected.kind === "edge") return confirmDeleteEdgeById(state.selected.id);
  return false;
}

function isTextEditingTarget(target) {
  return target instanceof Element
    && Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"));
}

function autoLayout({ shouldFit = true, announce = false } = {}) {
  if (!state.definition) return;
  state.positions = layoutHandoffGraph(
    graphIds(),
    state.definition.handoff.edges,
    {
      nodeWidth: CARD_WIDTH,
      nodeHeight: CARD_HEIGHT,
      rowGap: LAYOUT_ROW_GAP,
    },
  );
  if (announce) {
    setMessage(
      "Arranged nodes from top to bottom and fitted the graph. You can still drag any card to fine-tune it.",
    );
  }
  if (shouldFit) {
    requestAnimationFrame(() => {
      fitGraph();
      $("#canvas").focus({ preventScroll: true });
    });
  }
}

function nodeBounds(id) {
  const position = state.positions.get(id);
  if (!position) return null;
  const card = $$(".node-card", $("#node-transform")).find((item) => item.dataset.node === id);
  return {
    ...position,
    width: card?.offsetWidth || CARD_WIDTH,
    height: card?.offsetHeight || CARD_HEIGHT,
  };
}

function graphBounds() {
  const bounds = graphIds().map(nodeBounds).filter(Boolean);
  if (!bounds.length) return null;
  return {
    minX: Math.min(...bounds.map((item) => item.x)),
    minY: Math.min(...bounds.map((item) => item.y)),
    maxX: Math.max(...bounds.map((item) => item.x + item.width)),
    maxY: Math.max(...bounds.map((item) => item.y + item.height)),
  };
}

function edgeUsesOuterLane(edge) {
  const source = nodeBounds(edge.source);
  const target = nodeBounds(edge.target);
  if (!source || !target) return false;
  return target.y <= source.y;
}

function edgeIsJump(edge) {
  const source = nodeBounds(edge.source);
  const target = nodeBounds(edge.target);
  if (!source || !target) return false;
  return edgeUsesOuterLane(edge)
    || target.y - source.y > CARD_HEIGHT + LAYOUT_ROW_GAP + 1;
}

function feedbackLane(edge) {
  const bounds = graphBounds();
  if (!bounds) return 0;
  const source = nodeBounds(edge.source);
  const target = nodeBounds(edge.target);
  const outerEdges = state.definition.handoff.edges.filter(edgeUsesOuterLane);
  const laneIndex = Math.max(0, outerEdges.findIndex((item) => item.id === edge.id));
  const useLeft = ((source.x + source.width / 2) + (target.x + target.width / 2)) / 2
    < (bounds.minX + bounds.maxX) / 2;
  return useLeft
    ? bounds.minX - 72 - laneIndex * 22
    : bounds.maxX + 72 + laneIndex * 22;
}

function sideEdgeGeometry(edge) {
  const source = nodeBounds(edge.source);
  const target = nodeBounds(edge.target);
  if (!source || !target) return null;
  const laneX = feedbackLane(edge);
  return {
    laneX,
    ...sideEdgeAnchors(source, target, laneX),
  };
}

function nodeSidePorts(id) {
  const sides = {
    left: { incoming: false, outgoing: false },
    right: { incoming: false, outgoing: false },
  };
  for (const edge of state.definition.handoff.edges.filter(edgeUsesOuterLane)) {
    if (edge.source !== id && edge.target !== id) continue;
    const geometry = sideEdgeGeometry(edge);
    if (!geometry) continue;
    if (edge.source === id) sides[geometry.side].outgoing = true;
    if (edge.target === id) sides[geometry.side].incoming = true;
  }
  return Object.entries(sides)
    .filter(([, roles]) => roles.incoming || roles.outgoing)
    .map(([side, roles]) => {
      const role = roles.incoming && roles.outgoing
        ? "bidirectional"
        : roles.incoming ? "incoming" : "outgoing";
      return `<span class="node-side-port ${side} ${role}" aria-hidden="true"
        title="${role === "bidirectional" ? "Reverse edge input and output" : `Reverse edge ${role}`}"></span>`;
    })
    .join("");
}

function visualGraphBounds() {
  const bounds = graphBounds();
  if (!bounds) return null;
  const lanes = state.definition.handoff.edges
    .filter(edgeUsesOuterLane)
    .map(feedbackLane);
  return {
    minX: Math.min(bounds.minX, ...lanes),
    minY: bounds.minY,
    maxX: Math.max(bounds.maxX, ...lanes),
    maxY: bounds.maxY,
  };
}

function centerGraphAtScale(scale = 1) {
  if (!state.definition || !state.positions.size) return;
  const canvas = $("#canvas");
  const rect = canvas.getBoundingClientRect();
  const bounds = visualGraphBounds();
  if (!rect.width || !rect.height || !bounds) return;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  state.camera.scale = scale;
  state.camera.x = (rect.width - width * scale) / 2 - bounds.minX * scale;
  state.camera.y = (rect.height - height * scale) / 2 - bounds.minY * scale;
  applyCamera();
}

function fitGraph() {
  const canvas = $("#canvas");
  const rect = canvas.getBoundingClientRect();
  const bounds = visualGraphBounds();
  if (!rect.width || !rect.height || !bounds) return;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const scale = Math.max(.38, Math.min(1.15, (rect.width - 140) / width, (rect.height - 150) / height));
  centerGraphAtScale(scale);
}

function zoomBy(delta, center) {
  const canvas = $("#canvas");
  const rect = canvas.getBoundingClientRect();
  const point = center || { x: rect.width / 2, y: rect.height / 2 };
  const oldScale = state.camera.scale;
  const nextScale = Math.max(.35, Math.min(1.8, oldScale + delta));
  const worldX = (point.x - state.camera.x) / oldScale;
  const worldY = (point.y - state.camera.y) / oldScale;
  state.camera.scale = nextScale;
  state.camera.x = point.x - worldX * nextScale;
  state.camera.y = point.y - worldY * nextScale;
  applyCamera();
}

function applyCamera() {
  const { x, y, scale } = state.camera;
  $("#node-transform").style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  $("#edge-transform").setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
  $("#canvas").style.setProperty("--grid-size", `${24 * scale}px`);
  $("#canvas").style.setProperty("--grid-x", `${x % (24 * scale)}px`);
  $("#canvas").style.setProperty("--grid-y", `${y % (24 * scale)}px`);
  $("#zoom-level").value = `${Math.round(scale * 100)}%`;
  $("#zoom-level").textContent = `${Math.round(scale * 100)}%`;
}

function edgePath(edge) {
  const source = nodeBounds(edge.source);
  const target = nodeBounds(edge.target);
  if (!source || !target) return "";
  if (edgeUsesOuterLane(edge)) {
    const geometry = sideEdgeGeometry(edge);
    return smoothOuterEdgePath(
      geometry.sourceX,
      geometry.sourceY,
      geometry.targetX,
      geometry.targetY,
      geometry.laneX,
    );
  }
  return smoothVerticalEdgePath(
    source.x + source.width / 2,
    source.y + source.height,
    target.x + target.width / 2,
    target.y,
  );
}

function renderGraph() {
  const empty = !state.definition;
  $("#canvas-empty").hidden = !empty;
  $("#node-transform").replaceChildren();
  $("#edge-transform").replaceChildren();
  if (empty) {
    applyCamera();
    return;
  }
  ensurePositions();
  for (const edge of state.definition.handoff.edges) {
    const path = edgePath(edge);
    if (!path) continue;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("edge-group");
    if (edgeIsJump(edge)) group.classList.add("jump");
    if (state.selected.kind === "edge" && state.selected.id === edge.id) group.classList.add("selected");
    if (hasError("edge", edge.id)) group.classList.add("error");
    group.dataset.edge = edge.id;
    group.innerHTML = `<path class="edge-hit" d="${path}"></path><path class="edge-visible" d="${path}"></path>`;
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      focusEdgeAndOpen(edge.id);
    });
    $("#edge-transform").append(group);
  }

  const cards = [
    {
      id: ENTRYPOINT_ID,
      description: state.definition.instructions || "Root Voice Agent behavior",
      entry: true,
    },
    ...state.definition.handoff.nodes,
  ];
  for (const node of cards) {
    const position = state.positions.get(node.id);
    const toolItems = effectiveTools(node.id).filter(
      (tool) => tool?.type !== "handoff"
        && toolKind(tool) !== "mcp"
        && !toolDisplayName(tool).startsWith("handoff_"),
    );
    const mcpTools = nodeMcpTools(node.id);
    const tools = toolItems.length;
    const pipeline = nodePipeline(node.id);
    const totals = pipeline ? presetTotals(pipeline) : null;
    const outgoingEdges = state.definition.handoff.edges.filter((edge) => edge.source === node.id);
    const outgoing = outgoingEdges.length;
    const errors = currentProblems().filter(
      (item) => item.severity === "error" && item.objectKind === "node" && item.objectId === node.id,
    ).length;
    const card = document.createElement("article");
    card.className = [
      "node-card",
      node.entry ? "entry" : "",
      state.selected.kind === "node" && state.selected.id === node.id ? "selected" : "",
      errors ? "error" : "",
    ].filter(Boolean).join(" ");
    card.dataset.node = node.id;
    card.style.left = `${position.x}px`;
    card.style.top = `${position.y}px`;
    card.innerHTML = `
      ${node.entry ? `<button class="node-overall-settings" type="button" aria-label="Overall settings"
        aria-describedby="entrypoint-settings-hint" aria-controls="node-editor" aria-haspopup="dialog">
        ${pipelineIcon("sliders")}
        <span>
          <strong class="node-role">Overall settings</strong>
          <span id="entrypoint-settings-hint" class="node-settings-hint">Click to configure the entire Agent</span>
        </span>
        <span aria-hidden="true">↗</span>
      </button>` : ""}
      <div class="node-card-heading">
        <button class="node-select" type="button"
          aria-label="${node.entry ? "Configure overall settings on $entrypoint" : `Select ${escapeHtml(node.id)} node`}"
          ${node.entry ? 'aria-describedby="entrypoint-settings-hint"' : ""}>
          <span class="node-identity">
            <span class="node-icon">${pipelineIcon(nodeIcon(node.id))}</span>
            <span class="node-name-row">
              <span class="node-name">${escapeHtml(node.id)}</span>
              ${errors ? `<span class="node-status error">${errors} error${errors === 1 ? "" : "s"}</span>` : ""}
            </span>
          </span>
        </button>
        <div class="node-pipeline" aria-label="Node speech pipeline">
          ${nodePipelineStage("stt", pipeline.stt)}
          ${nodePipelineStage("model", pipeline.model)}
          ${nodePipelineStage("voice", pipeline.voice)}
        </div>
      </div>
      <div class="node-utility">
        <div class="node-mcp">
          <button type="button" class="node-mcp-button${mcpTools.length ? " configured" : ""}"
            aria-haspopup="dialog" title="Show MCP connections and test connectivity">
            ${pipelineIcon("mcp")}<span>MCP</span><strong>${mcpTools.length}</strong>
          </button>
        </div>
        <span class="node-tool-summary" title="${toolItems.length
          ? escapeHtml(toolItems.map(toolDisplayName).join(", "))
          : "No tools configured"}">
          ${pipelineIcon("sliders")}<strong>${tools}</strong> tool${tools === 1 ? "" : "s"}
        </span>
        <div class="node-outgoing">
        <button type="button" class="outgoing-edges-button" aria-expanded="false">
          ${pipelineIcon("route")}<span>${outgoing} route${outgoing === 1 ? "" : "s"}</span>
        </button>
        <div class="outgoing-edge-menu" hidden>
          ${outgoingEdges.length
            ? outgoingEdges.map((edge) => `<button type="button" data-edge-id="${escapeHtml(edge.id)}">
                ${pipelineIcon("route")}<span>${escapeHtml(edge.source)} → ${escapeHtml(edge.target)}</span>
              </button>`).join("")
            : '<span>No outgoing edges</span>'}
        </div>
        </div>
      </div>
      ${state.debugMode ? `<details class="node-metric-details">
        <summary class="node-metrics"
          aria-label="Show cost and latency disclaimer for ${escapeHtml(node.id)}">
          <div class="metric${totals ? "" : " unavailable"}">
            <span>${pipelineIcon("coin")} Cost</span>
            <strong>${totals ? calculatedCost(totals.costPerMinute) : "N/A"}<i class="metric-caret" aria-hidden="true">⌄</i></strong>
          </div>
          <div class="metric${totals ? "" : " unavailable"}">
            <span>${pipelineIcon("clock")} Latency</span>
            <strong>${totals ? estimatedLatencyRange(totals) : "N/A"}<i class="metric-caret" aria-hidden="true">⌄</i></strong>
          </div>
        </summary>
        <div class="node-metric-breakdown">
          <p><strong>Disclaimer</strong> ${PIPELINE_METRICS_DISCLAIMER}</p>
        </div>
      </details>` : ""}
      ${nodeSidePorts(node.id)}
      ${node.entry ? "" : `<button class="node-handle input" type="button" data-node-handle="input"
        data-node-id="${escapeHtml(node.id)}" aria-label="Input handle for ${escapeHtml(node.id)}" title="Drop an edge here"></button>`}
      <button class="node-handle output" type="button" data-node-handle="output"
        data-node-id="${escapeHtml(node.id)}" aria-label="Output handle for ${escapeHtml(node.id)}" title="Drag to another node"></button>
      ${node.entry ? "" : `<button class="node-delete-card" type="button" aria-label="Delete node ${escapeHtml(node.id)}"
        title="Delete ${escapeHtml(node.id)}">${pipelineIcon("trash")}</button>`}`;
    $(".node-overall-settings", card)?.addEventListener("click", () => focusNodeAndOpen(node.id));
    const button = $(".node-select", card);
    button.addEventListener("click", (event) => {
      if (event.detail === 0) focusNodeAndOpen(node.id);
    });
    button.addEventListener("pointerdown", (event) => startNodeDrag(event, node.id, card));
    $$("[data-node-pipeline]", card).forEach((stage) => {
      stage.addEventListener("click", () => {
        focusNodeComponentAndOpen(node.id, stage.dataset.nodePipeline);
      });
    });
    const metricDetails = $(".node-metric-details", card);
    metricDetails?.addEventListener("toggle", () => {
      card.classList.toggle("metrics-open", metricDetails.open);
      requestAnimationFrame(renderEdgesOnly);
      if (!metricDetails.open) return;
      $$(".node-metric-details").forEach((other) => {
        if (other !== metricDetails) other.open = false;
      });
    });
    const outputHandle = $('[data-node-handle="output"]', card);
    outputHandle.addEventListener("pointerdown", (event) => startEdgeConnection(event, node.id));
    const mcpButton = $(".node-mcp-button", card);
    mcpButton.addEventListener("click", () => openNodeMcpDialog(node.id));
    const outgoingButton = $(".outgoing-edges-button", card);
    const outgoingMenu = $(".outgoing-edge-menu", card);
    outgoingButton.addEventListener("click", () => {
      $$(".outgoing-edge-menu").forEach((menu) => {
        if (menu !== outgoingMenu) menu.hidden = true;
      });
      outgoingMenu.hidden = !outgoingMenu.hidden;
      outgoingButton.setAttribute("aria-expanded", String(!outgoingMenu.hidden));
    });
    $$("[data-edge-id]", outgoingMenu).forEach((edgeButton) => {
      edgeButton.addEventListener("click", () => focusEdgeAndOpen(edgeButton.dataset.edgeId));
    });
    const deleteButton = $(".node-delete-card", card);
    deleteButton?.addEventListener("click", () => {
      state.selected = { kind: "node", id: node.id };
      confirmDeleteSelectedNode();
    });
    $("#node-transform").append(card);
  }
  renderEdgesOnly();
  applyCamera();
}

function startNodeDrag(event, id, card) {
  if (event.button !== 0) return;
  const position = state.positions.get(id);
  state.dragging = {
    id,
    card,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: position.x,
    y: position.y,
    moved: false,
  };
  card.setPointerCapture?.(event.pointerId);
}

function clientToWorld(clientX, clientY) {
  const rect = $("#canvas").getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.camera.x) / state.camera.scale,
    y: (clientY - rect.top - state.camera.y) / state.camera.scale,
  };
}

function startEdgeConnection(event, sourceId) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  state.connecting = { pointerId: event.pointerId, sourceId };
  state.selected = { kind: "node", id: sourceId };
  const source = state.positions.get(sourceId);
  const point = clientToWorld(event.clientX, event.clientY);
  const preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
  preview.id = "edge-preview";
  preview.classList.add("edge-preview");
  preview.setAttribute("d", smoothVerticalEdgePath(
    source.x + CARD_WIDTH / 2,
    source.y + (nodeBounds(sourceId)?.height || CARD_HEIGHT),
    point.x,
    point.y,
  ));
  $("#edge-transform").append(preview);
}

function updateEdgeConnection(event) {
  if (!state.connecting || state.connecting.pointerId !== event.pointerId) return;
  const source = state.positions.get(state.connecting.sourceId);
  const point = clientToWorld(event.clientX, event.clientY);
  $("#edge-preview")?.setAttribute("d", smoothVerticalEdgePath(
    source.x + CARD_WIDTH / 2,
    source.y + (nodeBounds(state.connecting.sourceId)?.height || CARD_HEIGHT),
    point.x,
    point.y,
  ));
  $$(".node-handle.input").forEach((handle) => handle.classList.remove("connect-target"));
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-handle="input"]');
  if (target && target.dataset.nodeId !== state.connecting.sourceId) target.classList.add("connect-target");
}

function finishEdgeConnection(event) {
  if (!state.connecting || state.connecting.pointerId !== event.pointerId) return;
  const { sourceId } = state.connecting;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-handle="input"]');
  state.connecting = null;
  $("#edge-preview")?.remove();
  $$(".node-handle.input").forEach((handle) => handle.classList.remove("connect-target"));
  if (target && target.dataset.nodeId !== sourceId) createEdgeBetween(sourceId, target.dataset.nodeId);
}

function renderOutline() {
  const nodeRoot = $("#node-outline");
  const edgeRoot = $("#edge-outline");
  nodeRoot.replaceChildren();
  edgeRoot.replaceChildren();
  $("#nodes-tab").setAttribute("aria-selected", String(state.outlineTab === "nodes"));
  $("#edges-tab").setAttribute("aria-selected", String(state.outlineTab === "edges"));
  nodeRoot.hidden = state.outlineTab !== "nodes";
  edgeRoot.hidden = state.outlineTab !== "edges";
  if (!state.definition) {
    nodeRoot.innerHTML = '<p class="hint">No graph loaded.</p>';
    edgeRoot.innerHTML = '<p class="hint">No graph loaded.</p>';
    $("#node-count").textContent = "0";
    $("#edge-count").textContent = "0";
    return;
  }
  const nodes = [
    { id: ENTRYPOINT_ID, label: "$entrypoint", entry: true },
    ...state.definition.handoff.nodes.map((node) => ({
      id: node.id, label: node.id, entry: false,
    })),
  ];
  for (const item of nodes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "outline-item",
      item.entry ? "entry" : "",
      state.selected.kind === "node" && state.selected.id === item.id ? "selected" : "",
    ].filter(Boolean).join(" ");
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(state.selected.kind === "node" && state.selected.id === item.id));
    button.innerHTML = `<span class="outline-icon">${pipelineIcon(nodeIcon(item.id))}</span><span>${escapeHtml(item.label)}</span><small>${item.entry ? "overall" : "node"}</small>`;
    button.addEventListener("click", () => focusNodeAndOpen(item.id));
    nodeRoot.append(button);
  }
  for (const edge of state.definition.handoff.edges) {
    const row = document.createElement("div");
    row.className = "edge-outline-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "outline-item",
      state.selected.kind === "edge" && state.selected.id === edge.id ? "selected" : "",
    ].filter(Boolean).join(" ");
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(state.selected.kind === "edge" && state.selected.id === edge.id));
    button.innerHTML = `<span class="outline-icon">${pipelineIcon("route")}</span><span>${escapeHtml(`${edge.source} → ${edge.target}`)}</span><small>edge</small>`;
    button.addEventListener("click", () => focusEdgeAndOpen(edge.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "edge-delete";
    remove.setAttribute("aria-label", `Delete edge ${edge.id}`);
    remove.title = `Delete ${edge.id}`;
    remove.innerHTML = pipelineIcon("trash");
    remove.addEventListener("click", () => confirmDeleteEdgeById(edge.id));
    row.append(button, remove);
    edgeRoot.append(row);
  }
  if (!state.definition.handoff.edges.length) {
    edgeRoot.innerHTML = '<p class="hint">No routes yet. Add an edge to connect nodes.</p>';
  }
  $("#node-count").textContent = String(nodes.length);
  $("#edge-count").textContent = String(state.definition.handoff.edges.length);
}

function fieldError(field) {
  const item = selectionProblems(field).find((problem) => problem.severity === "error");
  return item ? `<p class="field-error">${escapeHtml(item.message)}</p>` : "";
}

function fieldLabel(label, field, help = "") {
  if (!help) {
    return `<span class="field-label"><label for="field-${escapeHtml(field)}">${escapeHtml(label)}</label></span>`;
  }
  const detail = typeof help === "object" ? help : { text: help };
  const popupId = `field-help-${field.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
  return `
    <span class="field-label field-label-help edge-field-label">
      <label for="field-${escapeHtml(field)}">${escapeHtml(label)}</label>
      <button type="button" class="field-help-toggle" aria-label="Explain ${escapeHtml(label)}"
        aria-expanded="false" aria-describedby="${escapeHtml(popupId)}">?</button>
      <span id="${escapeHtml(popupId)}" class="field-help-popup" role="tooltip" popover="manual" hidden>
        <span class="field-help-kicker">What this controls</span>
        ${helpParagraphs(detail.text || "")}
        ${detail.example ? `
          <span class="field-help-example">
            <span>Example</span>
            <code>${escapeHtml(detail.example)}</code>
            ${detail.exampleNote ? `<small>${escapeHtml(detail.exampleNote)}</small>` : ""}
          </span>` : ""}
      </span>
    </span>`;
}

function nodeFieldLabel(label, controlId, help) {
  const popupId = `${controlId}-help`;
  return `
    <span class="field-label field-label-help">
      <label for="${escapeHtml(controlId)}">${escapeHtml(label)}</label>
      <button type="button" class="field-help-toggle" aria-label="Explain ${escapeHtml(label)}"
        aria-expanded="false" aria-describedby="${escapeHtml(popupId)}">?</button>
      <span id="${escapeHtml(popupId)}" class="field-help-popup" role="tooltip" popover="manual" hidden>
        <span class="field-help-kicker">What this controls</span>
        ${helpParagraphs(help)}
      </span>
    </span>`;
}

function helpParagraphs(text) {
  return text.split("\n\n").map((paragraph) => `<span class="field-help-copy">${escapeHtml(paragraph)}</span>`).join("");
}

function bindFieldHelp() {
  let active;
  let timer;
  const close = () => {
    clearTimeout(timer);
    active?.floating.hide();
    active = null;
  };
  const anchorFor = (target) => target.closest(".field-label-help, .component-header-help");
  const open = (anchor) => {
    clearTimeout(timer);
    if (active?.anchor === anchor) return;
    close();
    const button = anchor.matches("button") ? anchor : $(".field-help-toggle", anchor);
    const popup = document.getElementById(button.getAttribute("aria-describedby"));
    const floating = anchoredPopover(popup, anchor, { width: 560, onClose: () => {
      button.setAttribute("aria-expanded", "false");
      if (active?.popup === popup) active = null;
    } });
    active = { anchor, popup, button, floating, pinned: false };
    button.setAttribute("aria-expanded", "true");
    floating.show();
  };
  document.addEventListener("pointerover", (event) => {
    if (active?.popup.contains(event.target)) clearTimeout(timer);
    const anchor = anchorFor(event.target);
    if (anchor && (!active?.pinned || active.anchor === anchor)) open(anchor);
  });
  document.addEventListener("pointerout", (event) => {
    if (!active || active.pinned || active.button === document.activeElement || active.anchor.contains(event.relatedTarget)
      || active.popup.contains(event.relatedTarget)) return;
    timer = setTimeout(close, 150);
  });
  document.addEventListener("focusin", (event) => {
    const anchor = anchorFor(event.target);
    if (anchor) open(anchor);
    else close();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".field-help-toggle, .component-header-help");
    if (button) {
      const anchor = anchorFor(button);
      if (active?.anchor === anchor && active.pinned) close();
      else {
        open(anchor);
        if (active) active.pinned = true;
      }
    } else if (active && !active.popup.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && active && !active.popup.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
  }, true);
}

function inputField(label, field, value, options = {}) {
  const invalid = selectionProblems(field).some((problem) => problem.severity === "error");
  const type = options.type || "text";
  return `
    ${fieldLabel(label, field, options.help)}
    <input id="field-${escapeHtml(field)}" data-field="${escapeHtml(field)}" type="${type}"
      value="${escapeHtml(value)}"${options.min !== undefined ? ` min="${options.min}"` : ""}
      ${options.readonly ? "readonly" : ""} aria-invalid="${invalid}">
    ${fieldError(field)}`;
}

function textareaField(label, field, value, options = {}) {
  const invalid = selectionProblems(field).some((problem) => problem.severity === "error");
  return `
    ${fieldLabel(label, field, options.help)}
    <textarea id="field-${escapeHtml(field)}" data-field="${escapeHtml(field)}"
      rows="${options.rows || 4}" aria-invalid="${invalid}">${escapeHtml(value)}</textarea>
    ${fieldError(field)}`;
}

function selectField(label, field, value, values, options = {}) {
  const invalid = selectionProblems(field).some((problem) => problem.severity === "error");
  return `
    ${fieldLabel(label, field, options.help)}
    <select id="field-${escapeHtml(field)}" data-field="${escapeHtml(field)}" aria-invalid="${invalid}">
      ${values.map((item) => `<option value="${escapeHtml(item.value)}"${String(value) === String(item.value) ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
    </select>
    ${fieldError(field)}`;
}

function presetField(label, field, value, values, options = {}) {
  const matched = values.some((item) => String(item.value) === String(value));
  const selectedValue = matched ? value : "__custom__";
  return `
    <div class="preset-field${matched ? "" : " custom-active"}" data-preset-field="${escapeHtml(field)}">
      ${selectField(label, field, selectedValue, [
        ...values,
        { value: "__custom__", label: options.customLabel || "Custom…" },
      ], { help: options.help })}
      <div class="custom-field" ${matched ? "hidden" : ""}>
        <label class="visually-hidden" for="custom-${escapeHtml(field)}">Custom ${escapeHtml(label)}</label>
        ${options.multiline
          ? `<textarea id="custom-${escapeHtml(field)}" data-custom-field="${escapeHtml(field)}" rows="${options.rows || 3}" placeholder="${escapeHtml(options.placeholder || `Enter custom ${label.toLowerCase()}`)}">${escapeHtml(value)}</textarea>`
          : `<input id="custom-${escapeHtml(field)}" data-custom-field="${escapeHtml(field)}" type="${options.type || "text"}" value="${escapeHtml(value)}"${options.min !== undefined ? ` min="${options.min}"` : ""} placeholder="${escapeHtml(options.placeholder || `Enter custom ${label.toLowerCase()}`)}">`}
      </div>
    </div>`;
}

function editableValue(value) {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : stableJson(value);
}

function clonePositionMap(map) {
  return new Map([...map].map(([key, value]) => [key, { ...value }]));
}

function captureEditorSession(kind, id) {
  return {
    kind,
    id,
    definition: deepClone(state.definition),
    history: deepClone(state.history),
    future: deepClone(state.future),
    serverProblems: deepClone(state.serverProblems),
    positions: clonePositionMap(state.positions),
    nodeIcons: new Map(state.nodeIcons),
    selected: { ...state.selected },
    outlineTab: state.outlineTab,
  };
}

function beginEditorSession(kind, id, snapshot = null) {
  state.editorSession = snapshot || captureEditorSession(kind, id);
  state.editorSession.kind = kind;
  state.editorSession.id = id;
}

function hideNodeEditor() {
  $("#node-editor").hidden = true;
  $("#node-editor").classList.remove("component-panel-open");
  state.nodeComponentPanel = "";
  $("#node-component-panel").hidden = true;
}

function hideEdgeEditor() {
  $("#edge-editor").hidden = true;
}

function restoreEditorSession(kind) {
  const session = state.editorSession;
  if (!session || session.kind !== kind) return false;
  state.definition = deepClone(session.definition);
  state.history = deepClone(session.history);
  state.future = deepClone(session.future);
  state.serverProblems = deepClone(session.serverProblems);
  state.positions = clonePositionMap(session.positions);
  state.nodeIcons = new Map(session.nodeIcons);
  state.selected = { ...session.selected };
  state.outlineTab = session.outlineTab;
  state.editorSession = null;
  return true;
}

function cancelEditorSession(kind) {
  const label = kind === "node" && state.selected.id === ENTRYPOINT_ID ? "entrypoint" : kind;
  const session = state.editorSession;
  const changed = Boolean(
    session
    && session.kind === kind
    && stableJson(session.definition, 0) !== stableJson(state.definition, 0)
  );
  restoreEditorSession(kind);
  if (kind === "node") hideNodeEditor();
  else hideEdgeEditor();
  setMessage(changed ? `Discarded unsaved ${label} changes.` : `Closed ${label} editor.`);
  render();
}

function commitEditorSession(kind, message = "") {
  const label = kind === "node" && state.selected.id === ENTRYPOINT_ID ? "entrypoint" : kind;
  const session = state.editorSession;
  if (session?.kind === kind) {
    const changed = stableJson(session.definition, 0) !== stableJson(state.definition, 0);
    state.history = deepClone(session.history);
    state.future = [];
    if (changed) {
      state.history.push(deepClone(session.definition));
      if (state.history.length > 100) state.history.shift();
    } else {
      state.future = deepClone(session.future);
    }
    state.editorSession = null;
    setMessage(message || (changed
      ? `Saved ${label} changes to the local working copy.`
      : `Closed ${label} editor with no changes.`));
  }
  if (kind === "node") hideNodeEditor();
  else hideEdgeEditor();
  render();
}

function focusGraphObjectAndOpen(kind, id, callback) {
  if (state.selectionTimer) window.clearTimeout(state.selectionTimer);
  state.selected = { kind, id };
  if (kind === "edge") state.outlineTab = "edges";
  if (kind === "node") state.outlineTab = "nodes";
  render();
  requestAnimationFrame(() => {
    const selected = kind === "node"
      ? $(`.node-card[data-node="${CSS.escape(id)}"]`)
      : $(`.edge-group[data-edge="${CSS.escape(id)}"]`);
    selected?.classList.add("selection-pulse");
  });
  const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;
  state.selectionTimer = window.setTimeout(() => {
    state.selectionTimer = null;
    callback(id);
  }, delay);
}

function focusNodeAndOpen(id, editorSnapshot = null) {
  focusGraphObjectAndOpen("node", id, (nodeId) => openNodeEditor(nodeId, editorSnapshot));
}

function focusNodeComponentAndOpen(id, kind, editorSnapshot = null) {
  focusGraphObjectAndOpen("node", id, () => {
    openNodeEditor(id, editorSnapshot);
    state.nodeComponentPanel = kind;
    renderNodeEditor();
  });
}

function focusEdgeAndOpen(id, editorSnapshot = null) {
  focusGraphObjectAndOpen("edge", id, (edgeId) => openEdgeEditor(edgeId, editorSnapshot));
}

function openNodeEditor(id, editorSnapshot = null) {
  if (!state.definition) return;
  const entry = id === ENTRYPOINT_ID;
  if (!entry && !state.definition.handoff.nodes.some((node) => node.id === id)) return;
  beginEditorSession("node", id, editorSnapshot);
  if (state.metricDisplay.nodeId !== id) {
    state.metricDisplay = { nodeId: id, cost: 0, latency: 0 };
  }
  state.nodeComponentPanel = "";
  $("#node-editor").classList.remove("component-panel-open");
  $("#node-component-panel").hidden = true;
  state.selected = { kind: "node", id };
  render();
  renderNodeEditor();
  $("#node-editor").hidden = false;
}

function openEntrypointSettings({ focusInputLanguage = false } = {}) {
  if (!state.definition) return;
  if (state.selectionTimer) {
    window.clearTimeout(state.selectionTimer);
    state.selectionTimer = null;
  }
  openNodeEditor(ENTRYPOINT_ID, state.editorSession);
  if (focusInputLanguage) $("#component-stt-language").focus();
  else $("#done-node-editor").focus();
}

function openEdgeEditor(id, editorSnapshot = null) {
  if (!state.definition.handoff.edges.some((edge) => edge.id === id)) return;
  beginEditorSession("edge", id, editorSnapshot);
  state.selected = { kind: "edge", id };
  state.outlineTab = "edges";
  render();
  renderEdgeEditor();
  $("#edge-editor").hidden = false;
}

function setEdgeEditorTitle(edge) {
  const title = $("#edge-editor-title");
  title.textContent = edge.id;
  title.classList.remove("editing");
  title.removeAttribute("contenteditable");
  title.setAttribute("role", "button");
  title.setAttribute("aria-label", `Edge name ${edge.id}. Double-click or press Enter to rename.`);
  title.title = "Double-click to rename edge";
  title.tabIndex = 0;
}

function beginEdgeTitleEdit() {
  const edge = state.definition?.handoff?.edges?.find((item) => item.id === state.selected.id);
  const title = $("#edge-editor-title");
  if (!edge || title.isContentEditable) return;

  const originalId = edge.id;
  let active = true;
  title.classList.add("editing");
  title.setAttribute("contenteditable", "true");
  title.setAttribute("role", "textbox");
  title.setAttribute("aria-label", "Edit edge name");
  title.removeAttribute("title");
  title.spellcheck = false;
  title.focus();

  const range = document.createRange();
  range.selectNodeContents(title);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const finish = (save) => {
    if (!active) return;
    active = false;
    const nextId = title.textContent.trim();
    title.removeEventListener("keydown", onKeyDown);
    if (save && nextId !== originalId) applyEdgeFieldChange("id", nextId);
    renderEdgeEditor();
  };
  const onKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  title.addEventListener("keydown", onKeyDown);
  title.addEventListener("blur", () => finish(true), { once: true });
}

function renderEdgeEditor() {
  const edge = state.definition?.handoff?.edges?.find((item) => item.id === state.selected.id);
  if (!edge) {
    $("#edge-editor").hidden = true;
    return;
  }
  const routePresets = [
    {
      value: `Use this route when the user needs help best handled by ${edge.target}.`,
      label: `User needs ${edge.target}`,
    },
    {
      value: `Use this route after ${edge.source} completes its task and ${edge.target} should continue.`,
      label: `${edge.source} completes its task`,
    },
    {
      value: `Use this route when the conversation matches the ${edge.target} specialization.`,
      label: `Intent matches ${edge.target}`,
    },
  ];
  const transferMessagePresets = [
    { value: "", label: "No transfer message" },
    { value: "One moment while I connect you.", label: "Brief transition" },
    {
      value: `One moment — I’ll connect you with ${edge.target}.`,
      label: `Introduce ${edge.target}`,
    },
  ];
  setEdgeEditorTitle(edge);
  $("#edge-editor-body").innerHTML = `
    <div class="edge-context-banner">
      <div class="edge-context-node edge-context-source">
        <span class="node-icon">${pipelineIcon(nodeIcon(edge.source))}</span>
        <span class="edge-context-copy"><small>Source</small><strong>${escapeHtml(edge.source)}</strong></span>
        <span class="edge-context-port" aria-hidden="true"></span>
      </div>
      <div class="edge-context-route" aria-label="Selected handoff route">
        <div class="edge-route-track" aria-hidden="true">
          <span class="edge-route-packet"></span>
          <span class="edge-route-packet secondary"></span>
          <span class="edge-route-arrow"></span>
        </div>
        <span class="edge-route-chip"><i aria-hidden="true"></i> Handoff</span>
      </div>
      <div class="edge-context-node edge-context-target">
        <span class="edge-context-port" aria-hidden="true"></span>
        <span class="node-icon">${pipelineIcon(nodeIcon(edge.target))}</span>
        <span class="edge-context-copy"><small>Target</small><strong>${escapeHtml(edge.target)}</strong></span>
      </div>
    </div>
    <div class="edge-section edge-identity-section">
      <div class="edge-section-heading">
        <span class="edge-section-number">01</span>
        <div>
          <span class="edge-section-kicker">Routing rule</span>
          <h3>Route condition</h3>
          <p>Define exactly when this handoff should activate.</p>
        </div>
      </div>
      ${presetField("Route condition", "description", edge.description || "", routePresets, {
        multiline: true,
        rows: 4,
        help: {
          text: "Tell the source node's model the observable situation that should activate this route. Be specific about the caller's intent or a verified task state, and distinguish this route from the source's other outgoing edges. This is a routing instruction, not the target's full behavior prompt or a sentence spoken to the caller. Avoid vague conditions such as when appropriate; put the target's detailed workflow in its own Instructions.",
          example: `Use this route when the caller asks to search, update, or review an existing ${edge.target} case.`,
          exampleNote: "A concrete condition helps the model distinguish this route from other outgoing edges.",
        },
        customLabel: "Custom route condition…",
        placeholder: "Describe the observable condition that should trigger this route.",
      })}
    </div>
    <div class="edge-section transfer-section">
      <div class="edge-section-heading">
        <span class="edge-section-number">02</span>
        <div>
          <span class="edge-section-kicker">Conversation handoff</span>
          <h3>Transfer behavior</h3>
          <p>Control what the caller hears and how the target starts.</p>
        </div>
      </div>
      ${presetField("Transfer message", "transfer_message", edge.transfer_message ?? "", transferMessagePresets, {
        multiline: true,
        rows: 3,
        help: {
          text: "Optional speech the caller hears while the target node is being prepared. It explains the transition without replacing the target's reply or changing the route condition. Keep it short and natural; do not claim a tool action or a transfer has already succeeded before completion. If the source already announced the handoff, leaving this empty avoids repeating the same message.",
          example: `One moment — I’ll connect you with ${edge.target}.`,
          exampleNote: "Leave this empty when the transfer should be silent or when the source already explained the handoff.",
        },
        customLabel: "Custom transfer message…",
        placeholder: "Write the short sentence the caller should hear during transfer.",
      })}
      ${selectField("Target response", "target_response", editableValue(edge.target_response ?? "auto"), [
        { value: "auto", label: "Auto · target responds immediately" },
        { value: "none", label: "None · wait for the next user turn" },
      ], {
        help: {
          text: "Choose whether the target node should begin speaking as soon as the handoff completes. Auto lets the target continue immediately using its instructions and the conversation context. None leaves the target silent until the next caller turn or another response request. This does not cancel the handoff; it only controls the target's opening response. Combine it with Transfer message carefully so the caller does not hear two redundant introductions or unexpected silence.",
          example: "Auto · target responds immediately",
          exampleNote: "Use Auto for a warm handoff. Use None when the target must wait for the caller or for another event.",
        },
      })}
      <div class="field-row">
        <div>${selectField("Cancel on interruption", "cancel_on_interruption", String(edge.cancel_on_interruption ?? false), [
          { value: "true", label: "Yes · cancel pending transfer" },
          { value: "false", label: "No · complete the transfer" },
        ], {
          help: {
            text: "Controls a handoff that has started but has not completed. With Yes, a caller interruption during that window can cancel the pending transfer so the source can listen and respond. With No, the transfer continues despite that interruption. This does not reverse a completed handoff or replace the Agent-wide Allow interruption setting for speech. Choose based on whether callers should be able to correct a routing request before it completes.",
            example: "Yes · cancel pending transfer",
            exampleNote: "Choose Yes for conversational barge-in. Choose No when the workflow must complete the transfer once it starts.",
          },
        })}</div>
        <div>${presetField("Delay", "delay_ms", String(edge.delay_ms ?? 0), [
          { value: "0", label: "No delay" },
          { value: "250", label: "250 ms · subtle pause" },
          { value: "500", label: "500 ms · short pause" },
          { value: "1000", label: "1 second" },
        ], {
          type: "number",
          min: 0,
          help: {
            text: "Adds a deliberate wait before the transfer begins, in milliseconds; 1000 means one second. This changes handoff timing, not the condition that selects the route or a timeout for preparing the target. Prefer no delay unless you need intentional speech pacing or coordination with an external transition. Large values increase the time the caller waits and can sound like an unresponsive Agent.",
            example: "250 ms · subtle pause",
            exampleNote: "A short pause can make a spoken transfer message feel natural; large delays can sound like dead air.",
          },
          customLabel: "Custom delay…",
          placeholder: "Milliseconds",
        })}</div>
      </div>
    </div>`;
  $$("[data-field]", $("#edge-editor-body")).forEach((field) => {
    field.addEventListener("change", () => {
      const preset = field.closest("[data-preset-field]");
      if (field.value === "__custom__") {
        preset?.classList.add("custom-active");
        const custom = $("[data-custom-field]", preset);
        if (custom) {
          custom.closest(".custom-field").hidden = false;
          custom.focus();
          custom.select();
        }
        return;
      }
      applyEdgeFieldChange(field.dataset.field, field.value);
      renderEdgeEditor();
    });
  });
  $$("[data-custom-field]", $("#edge-editor-body")).forEach((field) => {
    field.addEventListener("change", () => {
      applyEdgeFieldChange(field.dataset.customField, field.value);
      renderEdgeEditor();
    });
  });
}

// The service accepts a bare name only for OpenAI voices; Azure voices must be {type, name}.
function voiceDefinitionValue(voice) {
  if (typeof voice !== "string") return voice;
  const known = (state.cfg?.voiceCatalog || PIPELINE_COMPONENTS.voice).find((item) => item.id === voice);
  return !known || known.type === "openai" ? voice : { type: known.type, name: voice };
}

function applyNodeModelSelection(modelId) {
  if (state.selected.kind !== "node") return;
  const selectedId = state.selected.id;
  const entry = selectedId === ENTRYPOINT_ID;
  mutate(`Updated ${selectedId} model; voice and STT unchanged`, (definition) => {
    const node = entry
      ? null
      : definition.handoff.nodes.find((item) => item.id === selectedId);
    const config = entry ? definition : (node.config ||= {});
    config.model = modelId;
  });
}

function animateMetricElement(element, from, to, formatter) {
  if (!element) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === to) {
    element.innerHTML = formatter(to);
    return;
  }
  const started = performance.now();
  const duration = 520;
  const step = (now) => {
    if (!element.isConnected) return;
    const progress = Math.min(1, (now - started) / duration);
    const shifted = progress - 1;
    const eased = 1 + 2.70158 * shifted ** 3 + 1.70158 * shifted ** 2;
    element.innerHTML = formatter(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function componentDescription(kind, id) {
  const descriptions = {
    "mai-transcribe-2": "High-accuracy managed transcription with detailed speech features.",
    "mai-transcribe": "Managed MAI transcription alias resolved by Voice Live.",
    "mai-transcribe-2-streaming": "Preview streaming MAI transcription.",
    "azure-speech": "Managed Azure Speech transcription for broad language and enterprise scenarios.",
    "whisper-1": "Whisper transcription; lifecycle and availability remain region dependent.",
    "gpt-realtime-2.1": "Current default Pro speech-to-speech model.",
    "gpt-realtime-2.1-mini": "Standard-tier speech-to-speech model.",
    "gpt-5.4": "Recommended Pro cascaded text model.",
    "gpt-5.6-terra": "Recommended Pro cascaded Responses model.",
    "gpt-5.6-luna": "Standard-tier cascaded Responses model.",
    "gpt-6-sol": "Pro cascaded Responses model.",
    "gpt-6.1-sol": "Pro cascaded Responses model.",
    "gpt-6-luna": "Lite cascaded Responses model.",
    "gpt-oss-120b": "Standard-tier cascaded open-weight model.",
    ava: "Azure Realtime native voice.",
    emma: "Azure Realtime native voice.",
    alloy: "OpenAI native voice for GPT Realtime models.",
    "en-US-Ava:DragonHDLatestNeural": "Azure Dragon HD voice for managed speech output.",
    "en-US-Emma:DragonHDOmniLatestNeural": "Emma Azure Speech TTS voice using Dragon HD Omni.",
    "en-US-Brian:DragonHDOmniLatestNeural": "Brian Azure Speech TTS voice using Dragon HD Omni.",
    "en-IN-Diya:DragonHDLatestNeural": "Azure Dragon HD voice for Indian languages and Indian English.",
  };
  return descriptions[id] || `Supported ${kind} option. Availability remains region and model dependent.`;
}

function componentEvidence(kind, component) {
  const description = componentDescription(kind, component.id);
  if (!state.debugMode) return description;
  const evidence = [
    component.latencySource ? `Latency source: ${component.latencySource}.` : "",
    component.publicRateLabel ? `Public rate: ${component.publicRateLabel}.` : "",
    component.costSource ? `Rate source: ${component.costSource}.` : "",
  ].filter(Boolean).join(" ");
  return evidence ? `${description} ${evidence}` : description;
}

function componentHeaderHelp(kind, key) {
  if (key === "latency") {
    return `Latency estimates compare the time a component adds before the caller hears a response. STT, model generation, and speech synthesis measure different stages; a native Realtime path may already include speech output, so component values must not simply be added. Network, region, utterance length, tools, and warm-up also affect the actual session. Use recordings and runtime traces to measure your scenario. ${PIPELINE_METRICS_DISCLAIMER}`;
  }
  if (key === "cost") {
    return `Cost estimates help compare component choices, not predict a bill. Transcription, model tokens, and synthesized speech use different billing units; a bundled component may have no additional charge even though the full session still costs money. Duration, token usage, region, and your pricing agreement affect the total. Check current Azure pricing and measured usage before budgeting. ${PIPELINE_METRICS_DISCLAIMER}`;
  }
  return "";
}

function componentSortHeader(kind, key, label) {
  const sort = state.componentSort[kind];
  const active = sort.key === key;
  const arrow = active ? (sort.direction === "asc" ? "↑" : "↓") : "↕";
  const help = componentHeaderHelp(kind, key);
  return `
    <span class="component-column-heading">
      <button type="button" class="component-sort${active ? " active" : ""}"
        data-component-sort="${key}" aria-label="Sort by ${label}">
        <span class="component-sort-label">${label}</span>
        <span aria-hidden="true">${arrow}</span>
      </button>
      ${help ? `
        <button type="button" class="component-header-help" data-component-header-help="${key}"
          aria-label="Explain ${label}" aria-expanded="false" aria-describedby="component-help-${key}">?</button>
        <span id="component-help-${key}" class="component-header-popup" data-component-header-popup="${key}"
          role="tooltip" popover="manual" hidden>
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(help)}</span>
        </span>` : ""}
    </span>`;
}

function componentMetricTableCell(component, metric, maximum) {
  if (metric === "latency" && component.latencyIncludedInModel) {
    return `<span class="component-metric-unavailable">Included <small>in model TTFA</small></span>`;
  }
  const value = pipelineMetricMinimum(component, metric);
  if (value === null) {
    return `<span class="component-metric-unavailable">—<small>Not available</small></span>`;
  }
  const width = maximum > 0 ? Math.max(6, (value / maximum) * 100) : 0;
  let label;
  if (metric === "latency") {
    label = `~${(value / 1000).toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 3,
    })} s`;
  } else {
    label = component.noAdditionalCost
      ? "No extra STT cost"
      : calculatedCost(value);
  }
  return `
    <span class="component-table-metric">
      <span class="component-table-metric-label">${escapeHtml(label)}</span>
      <span class="component-table-bar" aria-hidden="true">
        <i style="width:${width.toFixed(1)}%"></i>
      </span>
    </span>`;
}

function componentTableRow(kind, component, selected, maxima) {
  const provider = pipelineComponentProvider(kind, component);
  const displayName = String(component.label || component.id).split(" · ")[0];
  return `
    <tr class="${selected ? "selected " : ""}${component.locked ? "locked" : ""}">
      <td class="component-name-cell">
        <button type="button" class="component-select"
          data-component-kind="${kind}" data-component-value="${escapeHtml(component.id)}"
          aria-pressed="${selected}" ${component.locked ? "disabled" : ""}
          title="${escapeHtml(component.incompatibility || `Select ${displayName}`)}">
          <span class="component-option-icon">${pipelineIcon(kind === "stt" ? "audio" : kind)}</span>
          <span class="component-option-copy">
            <strong>${escapeHtml(displayName)}</strong>
            ${kind === "voice" ? `<code class="voice-option-id">${escapeHtml(component.id)}</code>` : ""}
            <small>${escapeHtml(component.incompatibility || componentEvidence(kind, component))}</small>
          </span>
          ${selected ? '<span class="component-current">Current</span>' : ""}
        </button>
      </td>
      <td><span class="component-provider">${escapeHtml(provider)}</span></td>
      ${state.debugMode ? `<td>${component.locked
        ? '<span class="component-incompatible">Not compatible</span>'
        : componentMetricTableCell(component, "latency", maxima.latency)}</td>
      <td>${component.locked
        ? '<span class="component-incompatible">Not compatible</span>'
        : componentMetricTableCell(component, "cost", maxima.cost)}</td>` : ""}
    </tr>`;
}

function closeNodeComponentPanel() {
  state.nodeComponentPanel = "";
  $("#node-editor").classList.remove("component-panel-open");
  $("#node-component-panel").hidden = true;
  renderNodeEditor();
}

function renderNodeComponentPanel() {
  const kind = state.nodeComponentPanel;
  const panel = $("#node-component-panel");
  if (!kind || !state.definition || state.selected.kind !== "node") {
    $("#node-editor").classList.remove("component-panel-open");
    panel.hidden = true;
    return;
  }
  const config = nodeConfig(state.selected.id);
  panel.dataset.component = kind;
  const selection = {
    model: normalizedModelId(config.model ?? state.definition.model),
    stt: rootSttModel(),
    customSpeech: Boolean(state.definition?.audio?.input?.transcription?.custom_speech),
    voice: voiceName(state.selected.id === ENTRYPOINT_ID ? rootVoice() : (config.voice ?? rootVoice())),
    voices: state.cfg.voiceCatalog,
  };
  const currentPipeline = selectedPipeline(
    selection.model, selection.voice, selection.stt, {
      voiceType: effectiveVoiceType(state.selected.id),
      customSpeech: selection.customSpeech,
    },
  ).pipeline;
  const current = currentPipeline[kind].id;
  const titles = { stt: "Transcriber", model: "Model", voice: "Voice" };
  $("#component-panel-kicker").textContent = kind === "stt" ? "Agent-level input - all graph nodes" : "Node pipeline";
  $("#component-panel-title").textContent = titles[kind];
  const availableComponents = pipelineComponentOptions(kind, selection)
    .filter((component) => kind === "stt" || component.id === current || pipelineChoiceAvailable(kind, component.id))
    .map((component) => ({
      ...component,
      locked: component.compatible === false,
    }));
  if (kind === "voice" && selection.model !== "azure-realtime"
      && ["realtime", "cascaded"].includes(currentPipeline.architecture)) {
    for (const id of state.cfg?.azureVoices || []) {
      if (!availableComponents.some((component) => component.id === id)) {
        availableComponents.push({ id, label: id, type: "azure-standard", compatible: true });
      }
    }
  }
  const components = availableComponents.some((component) => component.id === current)
    ? availableComponents
    : [currentPipeline[kind], ...availableComponents];
  const sortedComponents = sortPipelineComponents(
    kind,
    components,
    state.componentSort[kind],
  );
  const voiceGroups = kind === "voice" ? groupVoicesByLocale(sortedComponents) : [];
  const visibleVoiceGroups = filterVoiceGroups(voiceGroups, state.voiceLocale || "", state.voiceSearch);
  const voiceRows = (groups) => groups.length ? groups.map((group) => `
    <tbody data-voice-locale="${escapeHtml(group.locale)}">
      <tr class="voice-locale-heading"><td colspan="${state.debugMode ? 4 : 2}">
        <strong>${escapeHtml(group.label)}</strong><span>${group.items.length} voices</span>
      </td></tr>
      ${group.items.map((component) => componentTableRow(kind, component, component.id === current, maxima)).join("")}
    </tbody>`).join("") : `<tbody><tr><td colspan="${state.debugMode ? 4 : 2}" class="voice-empty-state">
      No voices match. Try another locale or clear the filters.
    </td></tr></tbody>`;
  const maxima = {
    latency: Math.max(
      0,
      ...components.map((component) => pipelineMetricMinimum(component, "latency") || 0),
    ),
    cost: Math.max(
      0,
      ...components.map((component) => pipelineMetricMinimum(component, "cost") || 0),
    ),
  };
  const sttContext = kind === "stt" ? `
    <aside class="stt-model-context" role="note" aria-labelledby="stt-model-context-title">
      <span class="stt-context-icon" aria-hidden="true">${pipelineIcon("model")}</span>
      <h4 id="stt-model-context-title">Transcription choices</h4>
      <p>All nodes share one STT setting. Every listed transcription model is selectable, including Azure Speech and Whisper.</p>
      <p>Changing a node's model does not replace your STT selection.</p>
      <p>The service validates model, project, and regional support when you publish or start a session. Any rejection is shown without changing your selection.</p>
    </aside>` : "";
  let advanced = "";
  if (kind === "stt") {
    const realtime = currentPipeline.architecture === "realtime";
    advanced = `
      <div class="component-advanced">
        <h4>Recognition settings</h4>
        <p>Input language is configured on $entrypoint under Overall settings and applies to all graph nodes.</p>
        <button type="button" class="button secondary" id="open-agent-input-language">Open entrypoint input language</button>
        <div class="detail-row"><span>Scope</span><strong>All graph nodes</strong></div>
        <div class="detail-row"><span>Pipeline</span><strong>${realtime ? "Native speech-to-speech" : "Cascaded"}</strong></div>
        ${realtime
          ? `<div class="detail-row"><span>Selected transcript model</span><strong>${escapeHtml(rootSttModel())}</strong></div>
            <p>The Realtime model consumes audio directly. This separate STT selection still produces transcript events for observability and text-dependent client logic; it does not feed the Realtime model.</p>`
          : "<p>This STT output feeds text to cascaded models. Transcription is shared at Agent level; service support is checked when publishing or starting a session.</p>"}
      </div>`;
  } else if (kind === "model") {
    advanced = `
      <div class="component-advanced">
        <h4>Generation settings</h4>
        <div class="detail-row"><span>Scope</span><strong>${escapeHtml(state.selected.id)}</strong></div>
        <div class="detail-row"><span>Provider</span><strong>Voice Live managed</strong></div>
        <div class="empty-config-state">
          ${pipelineIcon("sliders")}
          <strong>Advanced model controls</strong>
          <p>This panel is reserved for contract-backed tuning such as temperature, speed, style, and provider-specific options.</p>
        </div>
      </div>`;
  }
  if (kind === "voice" && state.selected.id === ENTRYPOINT_ID) {
    advanced = `
      <div class="component-advanced">
        <label for="component-voice-language">Automatic voice language</label>
        <select id="component-voice-language">
          <option value="">Keep authored voice; fallback if unavailable</option>
          ${(state.cfg?.voiceLanguages || []).map((language) => `<option value="${language}"${state.voiceLanguage === language ? " selected" : ""}>${language}</option>`).join("")}
        </select>
        <label for="component-voice-region">Project region (optional)</label>
        <input id="component-voice-region" value="${escapeHtml(state.voiceRegion)}" placeholder="Auto-detect">
        <p>Voice selection applies to this working copy. It does not translate prompts or greetings. Region is read from Foundry; enter its actual region if discovery is unavailable.</p>
      </div>`;
  }
  $("#node-component-panel-body").innerHTML = `
    ${state.debugMode ? `<div class="component-estimate-disclaimer" role="note" aria-label="Latency and cost disclaimer">
      <span aria-hidden="true">!</span>
      <div>
        <strong>Disclaimer</strong>
        <p>${PIPELINE_METRICS_DISCLAIMER}</p>
      </div>
    </div>` : ""}
    ${kind === "voice" ? `<div class="voice-locale-filter">
      <p class="voice-picker-current">Selected voice <code>${escapeHtml(current)}</code></p>
      <label for="component-voice-locale">Voice locale</label>
      <input id="component-voice-locale" type="search" list="component-voice-locales"
        value="${escapeHtml(state.voiceLocale || "")}" autocomplete="off" spellcheck="false"
        placeholder="All locales — type en-US or Hindi">
      <datalist id="component-voice-locales">
        <option value="All locales"></option>
        ${voiceGroups.map((group) => `<option value="${escapeHtml(group.locale || group.label)}" label="${escapeHtml(group.label)} (${group.items.length})"></option>`).join("")}
      </datalist>
      <label for="component-voice-search">Search voices</label>
      <input id="component-voice-search" type="search" value="${escapeHtml(state.voiceSearch)}"
        autocomplete="off" placeholder="Ava, Swara, Dragon HD, or a full voice ID">
      <div class="voice-picker-results">
        <span id="component-voice-count" role="status">${voiceMatchCount(visibleVoiceGroups)} / ${components.length} voices match</span>
        <button id="clear-voice-filters" type="button">Clear filters</button>
      </div>
      <details class="voice-catalog-source"><summary>Catalog source and availability</summary>
        <p>${escapeHtml(state.cfg.voiceCatalogNotice)}</p>
      </details>
    </div>` : ""}
    ${kind === "stt" ? '<div class="stt-selection-layout"><div class="stt-selection-main">' : ""}
    ${kind === "stt" ? advanced : ""}
    <div class="component-table-wrap">
      <table class="component-table${state.debugMode ? "" : " without-metrics"}">
        <thead>
          <tr>
            <th>${componentSortHeader(kind, "name", titles[kind])}</th>
            <th>${componentSortHeader(kind, "provider", "Provider")}</th>
            ${state.debugMode ? `<th>${componentSortHeader(kind, "latency", "Latency")}</th>
            <th>${componentSortHeader(kind, "cost", "Cost")}</th>` : ""}
          </tr>
        </thead>
        ${kind === "voice" ? voiceRows(visibleVoiceGroups) : `<tbody>
          ${sortedComponents.map(
            (component) => componentTableRow(
              kind,
              component,
              component.id === current,
              maxima,
            ),
          ).join("")}
        </tbody>`}
      </table>
    </div>
    ${kind === "stt" ? "" : advanced}
    ${kind === "stt" ? `</div>${sttContext}</div>` : ""}
  `;
  $("#open-agent-input-language")?.addEventListener("click", () => {
    openEntrypointSettings({ focusInputLanguage: true });
  });
  $$("[data-component-sort]", $("#node-component-panel-body")).forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.componentSort;
      const previous = state.componentSort[kind];
      state.componentSort[kind] = {
        key,
        direction: previous.key === key && previous.direction === "asc" ? "desc" : "asc",
      };
      renderNodeComponentPanel();
    });
  });
  const bindComponentChoices = () => {
    $$("[data-component-value]", $("#node-component-panel-body")).forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.componentValue;
        if (kind === "stt") {
          mutate("Updated Agent-level STT", (definition) => setRootSttModel(definition, value));
        } else if (kind === "model") {
          applyNodeModelSelection(value);
        } else {
          if (state.selected.id === ENTRYPOINT_ID) state.voiceLanguage = "";
          const voice = voiceDefinitionValue(value);
          applyNodeFieldChange(kind, typeof voice === "string" ? voice : JSON.stringify(voice));
        }
        renderNodeEditor();
      });
    });
  };
  bindComponentChoices();
  if (kind === "voice") {
    const updateVoiceResults = () => {
      state.voiceLocale = $("#component-voice-locale").value;
      state.voiceSearch = $("#component-voice-search").value;
      const groups = filterVoiceGroups(voiceGroups, state.voiceLocale, state.voiceSearch);
      const table = $(".component-table", $("#node-component-panel-body"));
      $$("tbody", table).forEach((body) => body.remove());
      table.insertAdjacentHTML("beforeend", voiceRows(groups));
      $("#component-voice-count").textContent = `${voiceMatchCount(groups)} / ${components.length} voices match`;
      bindComponentChoices();
    };
    for (const id of ["#component-voice-locale", "#component-voice-search"]) {
      $(id).addEventListener("input", updateVoiceResults);
    }
    $("#clear-voice-filters").addEventListener("click", () => {
      $("#component-voice-locale").value = "";
      $("#component-voice-search").value = "";
      updateVoiceResults();
      $("#component-voice-search").focus();
    });
  }
  $("#component-voice-language")?.addEventListener("change", async (event) => {
    state.voiceLanguage = event.target.value;
    await applyLanguageVoice();
    renderNodeEditor();
  });
  $("#component-voice-region")?.addEventListener("change", (event) => {
    state.voiceRegion = event.target.value.trim();
  });
  $("#node-editor").classList.add("component-panel-open");
  panel.hidden = false;
}

async function applyLanguageVoice() {
  const source = stableJson(state.definition);
  const language = state.voiceLanguage;
  try {
    const result = await resolveVoiceSelection(state.definition, {
      language: state.voiceLanguage, region: state.voiceRegion,
      mode: state.voiceLanguage ? "automatic" : "fallback",
    });
    if (source !== stableJson(state.definition) || language !== state.voiceLanguage) {
      setMessage("The working copy changed while checking voices. Apply the voice selection again.");
      return;
    }
    mutate("Applied language-aware voice selection", (definition) => {
      Object.assign(definition, result.definition);
    });
    setMessage(voiceSelectionNotice(result));
  } catch (error) {
    setMessage("Voice selection failed; no voice was silently replaced.", error.message);
  }
}

const DELETE_RUNTIME_VALUE = Symbol("delete-runtime-value");

function nestedValue(root, path) {
  return path.split(".").reduce((value, key) => value?.[key], root);
}

function setNestedValue(root, path, value) {
  const keys = path.split(".");
  const parents = [];
  let target = root;
  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
      target[key] = {};
    }
    parents.push([target, key]);
    target = target[key];
  }
  const leaf = keys.at(-1);
  if (value === DELETE_RUNTIME_VALUE) delete target[leaf];
  else target[leaf] = value;
  for (const [parent, key] of parents.reverse()) {
    if (Object.keys(parent[key] || {}).length) break;
    delete parent[key];
  }
}

function runtimeControlId(path) {
  return `runtime-${path.replaceAll(".", "-")}`;
}

function runtimeSelect(scope, path, label, value, options, help, valueType = "string") {
  const current = value === undefined || value === null ? "" : String(value);
  const values = options.some((item) => String(item.value) === current)
    ? options
    : [...options, { value: current, label: `${current} · current` }];
  const id = runtimeControlId(`${scope}-${path}`);
  return `
    <div class="runtime-field">
      ${nodeFieldLabel(label, id, help)}
      <select id="${id}" data-runtime-scope="${scope}" data-runtime-path="${path}"
        data-runtime-type="${valueType}">
        ${values.map((item) => `<option value="${escapeHtml(item.value)}"${String(item.value) === current ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
      </select>
    </div>`;
}

function runtimeInput(scope, path, label, value, help, options = {}) {
  const id = runtimeControlId(`${scope}-${path}`);
  return `
    <div class="runtime-field">
      ${nodeFieldLabel(label, id, help)}
      <input id="${id}" data-runtime-scope="${scope}" data-runtime-path="${path}"
        data-runtime-type="${options.valueType || "optional-string"}"
        type="${options.type || "text"}" value="${escapeHtml(value ?? "")}"
        ${options.min !== undefined ? `min="${options.min}"` : ""}
        ${options.max !== undefined ? `max="${options.max}"` : ""}
        ${options.step !== undefined ? `step="${options.step}"` : ""}>
    </div>`;
}

function runtimeTextarea(scope, path, label, value, help, options = {}) {
  const id = runtimeControlId(`${scope}-${path}`);
  return `
    <div class="runtime-field ${options.wide ? "wide" : ""}">
      ${nodeFieldLabel(label, id, help)}
      <textarea id="${id}" data-runtime-scope="${scope}" data-runtime-path="${path}"
        data-runtime-type="${options.valueType || "optional-string"}"
        rows="${options.rows || 3}">${escapeHtml(value ?? "")}</textarea>
    </div>`;
}

const BOOLEAN_OPTIONS = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

const OPTIONAL_BOOLEAN_OPTIONS = [
  { value: "", label: "Service default" },
  ...BOOLEAN_OPTIONS,
];

function settingsToggle(name, label, checked, help = "", disabled = false) {
  return `<div class="settings-toggle-row">
    <label class="settings-switch">
      <input type="checkbox" role="switch" data-setting-control="${name}"
        ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
      <span class="settings-switch-track" aria-hidden="true"></span>
      <span>${label}</span>
    </label>
    ${help ? `<p class="settings-hint">${help}</p>` : ""}
  </div>`;
}

function renderAgentRuntimeSettings(definition) {
  const greeting = definition.greeting || {};
  const input = definition.audio?.input || {};
  const output = definition.audio?.output || {};
  const turn = input.turn_detection || {};
  const endOfUtterance = turn.end_of_utterance_detection || {};
  const modalities = Array.isArray(definition.output_modalities)
    ? definition.output_modalities.join(",")
    : "audio";
  const language = input.transcription?.language || "";
  const stt = rootSttModel();
  const languageError = transcriptionLanguageError(stt, language);
  const phraseListSupported = stt.startsWith("azure-")
    || (stt.startsWith("mai-transcribe") && stt !== "mai-transcribe-1");
  const phraseList = input.transcription?.phrase_list;
  const enhanced = Boolean(input.noise_reduction || input.echo_cancellation);
  const sttOptions = pipelineComponentOptions("stt", {
    model: modelName(definition.model), stt,
  })
    .map((component) => ({ value: component.id, label: component.label }));
  return `
    <section class="runtime-config-section" aria-label="Overall Agent settings">
      <div class="runtime-config-heading">
        <div><span class="kicker">Overall settings</span><strong>Session, greeting, audio, and turn-taking</strong></div>
        <span>Shared across the entire Agent</span>
      </div>
      <div class="runtime-settings-grid">
        <details class="runtime-settings-card input-language-settings" open>
          <summary><span>${pipelineIcon("audio")} Speech input</span><small>All graph nodes</small></summary>
          <div class="runtime-settings-body">
            ${runtimeSelect("definition", "audio.input.transcription.model", "User transcript model", stt, sttOptions,
              "Selects the speech-to-text (STT) model that turns the caller's audio into transcript text for every graph node. In a cascaded pipeline, this text is what the language model receives. A native Realtime model receives audio directly; the separate transcript model provides transcript events rather than replacing that audio path.\n\nChanging this model changes the available input languages and recognition features, not the output voice. All listed choices remain selectable, but the service checks project, region, and model support when publishing or starting a session.")}
            <div class="input-language-field">
              ${nodeFieldLabel("Input language", "component-stt-language",
                `Tells the shared speech recognizer which languages the caller is expected to speak. This applies to every graph node, not just the entrypoint. Auto leaves language detection to the transcript model; checking the expected candidates narrows recognition and can improve accuracy.\n\nThe selected ${stt} model accepts ${inputLanguageLimit(stt) > 1 ? "up to 10 candidates; the first selection is primary. For Hindi and English callers in India, select hi-IN first and then en-IN" : "one explicit language, or Auto; use an Azure Speech model if you need multiple candidates"}. Choose only one locale per language, such as en-IN or en-US, not both. Streaming Azure Speech requires an explicit language and cannot use Auto.\n\nThis controls recognition, not the Agent's output voice, response language, or translation. Configure the output voice separately and describe the desired response language in Instructions.`)}
              <div class="input-language-combobox">
                <input id="component-stt-language" type="text" role="combobox" readonly
                  value="${escapeHtml(displayTranscriptionLanguage(language))}" autocomplete="off" spellcheck="false"
                  aria-haspopup="listbox" aria-expanded="false" aria-controls="component-stt-languages"
                  aria-describedby="component-stt-language-hint component-stt-language-error"
                  aria-invalid="${Boolean(languageError)}">
                <button id="component-stt-language-toggle" type="button" class="input-language-toggle" aria-label="Show input languages">▾</button>
                <div class="input-language-options" hidden>
                  <div id="component-stt-languages" role="listbox" aria-label="Input languages"></div>
                </div>
              </div>
              <p id="component-stt-language-hint">${INPUT_LANGUAGE_HINT}</p>
              <p id="component-stt-language-error" role="alert"${languageError ? "" : " hidden"}>${escapeHtml(languageError)}</p>
              <a href="${INPUT_LANGUAGE_SOURCE}" target="_blank" rel="noopener noreferrer">Voice Live supported input languages</a>
            </div>
            ${settingsToggle("phrase-list", "Phrase list", Array.isArray(phraseList),
              phraseListSupported ? "Help recognize product names and domain terms." : "This transcript model does not support phrase lists.",
              !phraseListSupported && !Array.isArray(phraseList))}
            ${Array.isArray(phraseList) ? runtimeTextarea("definition", "audio.input.transcription.phrase_list",
              "Recognition phrases", phraseList.join("\n"), "Adds hints for words the recognizer may otherwise miss, such as product names, acronyms, or specialist terminology. Enter one word or phrase per line, for example Contoso or invoice number. These hints bias recognition; they do not restrict what the caller may say, translate audio, or add instructions for the Agent. Support depends on the selected transcript model.", { valueType: "lines" }) : ""}
            <div class="audio-enhancement-settings">
              ${settingsToggle("audio-enhancement", "Audio enhancement", enhanced,
                "Reduce background noise and prevent playback from being recognized as caller speech.")}
              ${enhanced ? `<div class="audio-enhancement-options">
                <label class="settings-checkbox">
                  <input type="checkbox" data-setting-control="noise-suppression" ${input.noise_reduction ? "checked" : ""}>
                  <span>Noise suppression</span>
                </label>
                ${input.noise_reduction ? runtimeSelect("definition", "audio.input.noise_reduction.type", "Noise reduction",
                  input.noise_reduction.type || "", [
                    { value: "near_field", label: "Near field" },
                    { value: "far_field", label: "Far field" },
                    { value: "azure_deep_noise_suppression", label: "Azure deep noise suppression" },
                  ], "Chooses how background noise is removed before the caller's speech is processed. Near field targets a microphone close to the speaker; far field targets speech captured farther away; Azure deep noise suppression uses the Azure denoiser. This does not change the output voice. Compare recordings from the real microphone environment before changing the mode, because overly aggressive filtering can also affect quiet speech.") : ""}
                <label class="settings-checkbox">
                  <input type="checkbox" data-setting-control="echo-cancellation" ${input.echo_cancellation ? "checked" : ""}>
                  <span>Echo cancellation</span>
                </label>
                ${input.echo_cancellation ? runtimeSelect("definition", "audio.input.echo_cancellation.reference_source",
                  "Echo reference", input.echo_cancellation.reference_source || "server", [
                    { value: "server", label: "Server playback · mono" },
                    { value: "client", label: "Client playback · stereo" },
                  ], "Selects the playback signal used to distinguish the Agent's own voice from real caller speech, reducing false recognition and interruptions. Server reference uses the service's playback signal with mono input. Client reference sends microphone audio and the audio actually played by the browser on separate channels.\n\nClient reference requires WebSocket transport and stereo PCM16 input; the Portal selects matching capture settings. It cannot be combined with an avatar in this Portal. Use server reference unless your client and transport can supply the required playback channel.") : ""}
                ${input.echo_cancellation?.reference_source === "client" ? `<p class="settings-hint">
                  Requires WebSocket and stereo PCM16 input. Runtime selects the matching capture mode.
                  Client reference cannot be combined with an avatar in this Portal.</p>` : ""}
              </div>` : ""}
            </div>
          </div>
        </details>
        <details class="runtime-settings-card" open>
          <summary><span>${pipelineIcon("model")} Session behavior</span><small>${escapeHtml(definition.model_type || "managed")}</small></summary>
          <div class="runtime-settings-body two-column">
            ${runtimeSelect("definition", "model_type", "Model serving", definition.model_type || "managed", [
              { value: "managed", label: "Managed" },
              { value: "self_deployed", label: "Self-deployed" },
            ], "Specifies who hosts the selected language model. Managed uses a Voice Live-managed model; Self-deployed refers to a model deployment you provide. The model identifier must match the chosen serving mode and be accessible to the project.\n\nThis is separate from Realtime versus cascaded audio processing: changing serving mode does not automatically change the model, deployment, or voice. Keep Managed for the supplied managed-model templates; choose Self-deployed only when you have configured the corresponding deployment.")}
            ${runtimeSelect("definition", "output_modalities", "Output modalities", modalities, [
              { value: "audio", label: "Audio" },
              { value: "text", label: "Text only" },
              { value: "text,audio", label: "Text + audio" },
              { value: "audio,animation", label: "Audio + animation" },
              { value: "audio,avatar", label: "Audio + avatar" },
            ], "Chooses the kinds of output the session requests: spoken audio, text, or audio with animation/avatar data. Audio enables spoken replies; Text only requests no synthesized speech; Text + audio requests both. Animation and avatar output also require compatible configuration and service support.\n\nThis does not choose the voice or convert an ordinary audio Agent into a configured avatar. Match the requested output to what your client can render; unsupported combinations are rejected by the service.", "list")}
            ${runtimeSelect("definition", "store", "Persist conversation", String(definition.store ?? false), BOOLEAN_OPTIONS,
              "Controls whether Foundry stores the conversation timeline and raw audio for later retrieval and review. Enable it when you need service-side session history for debugging or evaluation and have permission to retain the caller's data.\n\nDisabling this does not remove previously stored sessions and is not a switch for every kind of Portal log or client-side recording. Consider consent, sensitive data, and your project's retention/access rules before enabling it.", "boolean")}
            ${runtimeInput("definition", "max_output_tokens", "Max output tokens", definition.max_output_tokens,
              "Caps how many output tokens the model may generate for a single response. Tokens are pieces of model output, not words or milliseconds; the supported count and treatment of audio depend on the model. A smaller cap can limit long replies, but can also cut an answer short.\n\nEnter a positive token count, use inf to request no finite cap where supported, or leave blank to omit the override. Use Instructions to ask for concise replies rather than relying on a very small cap.", { valueType: "token" })}
            ${runtimeSelect("definition", "parallel_tool_calls", "Parallel tool calls", definition.parallel_tool_calls ?? "",
              OPTIONAL_BOOLEAN_OPTIONS, "Allows the model to request multiple tool calls in the same response when the model and tools support it. This can reduce waiting time for independent operations, such as fetching two unrelated records. It does not force tool calls or change which tools are available.\n\nChoose No when operations must run in order or modify shared state, such as updating a record before reading its new value. Service default omits the override. Tool choice separately controls whether a tool call is optional, required, or forbidden.", "optional-boolean")}
          </div>
        </details>

        <details class="runtime-settings-card" open>
          <summary><span>${pipelineIcon("sparkles")} Greeting</span><small>${escapeHtml(greeting.type || "none")}</small></summary>
          <div class="runtime-settings-body two-column">
            ${runtimeSelect("definition", "greeting.type", "Greeting mode", greeting.type || "", [
              { value: "", label: "No automatic greeting" },
              { value: "template", label: "Template · deterministic text" },
              { value: "llm_generated", label: "LLM-generated" },
            ], "Chooses what happens at the start of a new voice session, before the caller's first turn. No automatic greeting waits for the caller. Template speaks the text you supply, while LLM-generated asks the model to compose an opening from the greeting prompt.\n\nUse Template for a predictable introduction or disclosure; use LLM-generated when the opening needs to vary. This is an Agent-wide session opening, not a greeting repeated each time a handoff node becomes active.")}
            ${greeting.type === "llm_generated" ? runtimeSelect(
              "definition", "greeting.tool_choice", "Greeting tool choice", greeting.tool_choice || "none", [
                { value: "none", label: "None" },
                { value: "auto", label: "Auto" },
                { value: "required", label: "Required" },
              ], "Controls tool use only while the model generates the initial greeting. None prevents tool calls during that opening; Auto lets the model decide; Required asks it to call a tool before completing the greeting.\n\nThis does not replace the node's normal Tool choice setting. Only require a greeting tool when the opening genuinely needs external data and that tool is configured, because a slow or unavailable tool can delay the caller's first message.",
            ) : ""}
            ${greeting.type === "template" ? runtimeTextarea(
              "definition", "greeting.text", "Greeting text", greeting.text || "",
              "The opening text spoken when Greeting mode is Template. Use a short, complete sentence such as Hello, you have reached Contoso support. Handlebars placeholders can insert configured session values; make sure those values are supplied by the session client.\n\nThis text is not an instruction to the model. Include any wording that must be spoken exactly here, and keep normal conversation behavior in Instructions.", { rows: 3, wide: true },
            ) : ""}
            ${greeting.type === "llm_generated" ? runtimeTextarea(
              "definition", "greeting.prompt", "Greeting prompt", greeting.prompt || "",
              "Instructions used specifically to generate the session's first spoken message. Describe the purpose, language, tone, and required content, for example Greet the caller in Hindi and ask how you can help. The resulting wording may vary between sessions.\n\nThis is not the fixed text the caller will necessarily hear and does not replace the node's general Instructions. Choose a Template greeting instead if a disclosure or introduction must be spoken verbatim.", { rows: 4, wide: true },
            ) : ""}
            ${greeting.type ? runtimeInput(
              "definition", "greeting.fallback_text", "Fallback text", greeting.fallback_text || "",
              "A backup opening for the service to use when the normal greeting cannot be produced. Supply a short sentence that is safe without optional session data, such as Hello, how can I help you today?\n\nThis is not a second greeting spoken after a successful opening, and it does not guarantee recovery from a disconnected session or unsupported configuration. Leave it blank to omit a custom fallback.",
            ) : ""}
          </div>
        </details>

        <details class="runtime-settings-card audio-transport-settings" open>
          <summary><span>${pipelineIcon("audio")} Audio transport</span><small>${escapeHtml(output.voice_type || "service default")}</small></summary>
          <div class="runtime-settings-body two-column">
            ${runtimeInput("definition", "audio.input.format.type", "Input format", input.format?.type,
              "Declares the encoding of audio sent from the client to the service, using an audio MIME type such as audio/pcm. The declaration must match the actual captured or encoded bytes; changing this field alone does not convert an arbitrary client stream.\n\nThis is an advanced transport setting. Keep the existing value unless you are changing the client audio pipeline, and check the sample rate and any echo-reference channel requirements at the same time.", { valueType: "optional-string" })}
            ${runtimeInput("definition", "audio.input.format.rate", "Input sample rate", input.format?.rate,
              "The number of audio samples per second in the caller's input stream, measured in hertz (Hz). For example, 24000 means 24,000 samples each second. The client must send audio at the declared rate.\n\nA mismatch can make speech play or be recognized at the wrong speed and pitch. This is not a latency or speech-speed control; keep it aligned with Input format and the client capture settings.", { type: "number", min: 1, valueType: "number" })}
            ${runtimeInput("definition", "audio.output.format.type", "Output format", output.format?.type,
              "Declares the encoding requested for the Agent's generated speech, such as audio/pcm. Your client must be able to decode and play the chosen format, and the service must support it for the selected output path.\n\nThis changes audio transport, not the words, voice identity, or spoken language. Keep the existing format unless you are also updating the receiving playback pipeline.", { valueType: "optional-string" })}
            ${runtimeInput("definition", "audio.output.format.rate", "Output sample rate", output.format?.rate,
              "The requested number of samples per second in generated speech, in hertz (Hz), for example 24000 for 24 kHz. The playback client must use the matching rate or resample correctly.\n\nA higher rate is not a faster speaking speed and can increase audio data volume. Choose a rate supported by the selected format, voice, and transport; leave blank to omit this override.", { type: "number", min: 1, valueType: "number" })}
            ${runtimeSelect("definition", "audio.output.voice_type", "Voice type", output.voice_type || "", [
              { value: "", label: "Service default" },
              { value: "openai", label: "OpenAI" },
              { value: "azure-standard", label: "Azure standard" },
              { value: "azure-custom", label: "Azure custom" },
              { value: "azure-personal", label: "Azure personal" },
              { value: "azure-realtime-native", label: "Azure realtime native" },
              { value: "avatar-voice-sync", label: "Avatar voice sync" },
            ], "Identifies the voice provider or category paired with the selected voice name, such as Azure standard, Azure custom, or OpenAI/native speech. A voice ID and its type must form a compatible pair for the selected model and output path.\n\nThis field does not select a particular speaker or an input language. Prefer the Voice picker, which selects a voice with its matching metadata. Use Service default only when you want to omit an explicit type and let the service resolve it.", "optional-string")}
          </div>
        </details>

        <details class="runtime-settings-card turn-settings" open>
          <summary><span>${pipelineIcon("bolt")} Automatic turn detection</span><small>${escapeHtml(turn.type || "disabled")}</small></summary>
          <div class="runtime-settings-body two-column">
            <div class="runtime-field wide">
              ${settingsToggle("turn-detection", "Automatic turn detection", Boolean(turn.type),
                "Detect when the caller starts and finishes speaking.")}
              ${turn.type ? `<div class="turn-detection-modes" role="group" aria-label="Turn detection strategy">
                ${[
                  ["azure_semantic_vad_multilingual", "Azure semantic", turn.type.startsWith("azure_")],
                  ["server_vad", "Basic", turn.type === "server_vad"],
                  ["semantic_vad", "OpenAI semantic", turn.type === "semantic_vad"],
                ].map(([value, label, selected]) => `<button type="button" data-turn-mode="${value}"
                  aria-pressed="${selected}">${label}</button>`).join("")}
              </div><p class="settings-hint">${turn.type.startsWith("azure_")
                ? "Uses speech understanding to detect turn boundaries."
                : turn.type === "server_vad" ? "Detects speech and silence using audio activity."
                  : "Uses the model's understanding of speech to decide when the caller has finished."}</p>` : ""}
            </div>
            ${runtimeSelect("definition", "audio.input.turn_detection.type", "Detection type", turn.type || "", [
              { value: "", label: "Disabled" },
              { value: "server_vad", label: "Server VAD" },
              { value: "semantic_vad", label: "Semantic VAD" },
              { value: "azure_semantic_vad", label: "Azure semantic VAD" },
              { value: "azure_semantic_vad_en", label: "Azure semantic VAD · English" },
              { value: "azure_semantic_vad_multilingual", label: "Azure semantic VAD · multilingual" },
            ], "Selects how the service decides that the caller has started and finished speaking. Server VAD uses audio activity and silence; semantic modes also use speech understanding to distinguish a pause from a completed thought. Azure variants have different language support.\n\nA faster detector can respond sooner but may cut in during a pause; a more patient detector may wait longer. Disabled removes automatic turn detection, so the client must manage turn boundaries. This does not change the transcript model or the output voice.")}
            ${turn.type === "semantic_vad" ? runtimeSelect(
              "definition", "audio.input.turn_detection.eagerness", "Eagerness", turn.eagerness || "auto", [
                { value: "auto", label: "Auto" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ], "Adjusts how readily OpenAI semantic VAD treats the caller's utterance as complete. High favors earlier responses; Low is more patient with pauses or unfinished thoughts; Auto leaves the choice to the service.\n\nUse a more patient setting for callers who dictate numbers or pause while thinking. Faster completion may feel responsive but can interrupt a caller who has not finished. This is a semantic-VAD setting, not a silence duration in milliseconds.",
            ) : ""}
            ${turn.type && turn.type !== "semantic_vad" ? runtimeInput(
              "definition", "audio.input.turn_detection.threshold", "Activation threshold", turn.threshold,
              "The voice-activity score required to treat input audio as speech, from 0 to 1. A higher threshold is less sensitive and can reject background sounds, but may miss quiet callers; a lower threshold detects softer speech but may trigger on noise.\n\nTune this using recordings from the expected microphone and environment. It affects speech detection, not recognition confidence or the model's willingness to answer. Leave blank to use the service's default threshold.", { type: "number", min: 0, max: 1, step: 0.05, valueType: "number" },
            ) : ""}
            ${turn.type && turn.type !== "semantic_vad" ? runtimeInput(
              "definition", "audio.input.turn_detection.prefix_padding_ms", "Prefix padding", turn.prefix_padding_ms,
              "Keeps a short amount of audio from before speech was detected, in milliseconds. This helps preserve the beginning of a word when the detector takes a moment to activate; 300 means include the preceding 0.3 seconds.\n\nToo little padding can clip the first syllable, while more padding includes additional lead-in sound. This does not add a deliberate pause to the Agent's reply. Leave blank for the service default.", { type: "number", min: 0, valueType: "number" },
            ) : ""}
            ${turn.type && turn.type !== "semantic_vad" ? runtimeInput(
              "definition", "audio.input.turn_detection.silence_duration_ms", "Silence duration", turn.silence_duration_ms,
              "How long the caller must remain silent before audio activity detection treats speech as ended, in milliseconds. For example, 500 means a half-second pause. A shorter value can speed up responses but may split a caller's sentence; a longer value tolerates thinking pauses but adds waiting time.\n\nThis is only one part of turn detection. Semantic end detection can also influence when the turn completes. Test pauses, account numbers, and noisy calls before lowering it.", { type: "number", min: 0, valueType: "number" },
            ) : ""}
            ${turn.type && turn.type !== "semantic_vad" ? runtimeInput(
              "definition", "audio.input.turn_detection.idle_timeout_ms", "Idle timeout", turn.idle_timeout_ms,
              "The maximum idle interval before the selected detector ends a turn, in milliseconds; 15000 means 15 seconds. This is a turn-detection timeout, not a limit on the full call's duration and not the normal short silence used to finish every sentence.\n\nUse it to bound long waiting periods where supported. The resulting timeout behavior depends on the detector and client; it does not by itself configure a custom reminder or hang-up message. Leave blank to omit the override.", { type: "number", min: 0, valueType: "number" },
            ) : ""}
            ${turn.type && turn.type !== "semantic_vad" ? runtimeInput(
              "definition", "audio.input.turn_detection.speech_duration_ms", "Minimum speech", turn.speech_duration_ms,
              "The minimum amount of speech required to trigger the detector, in milliseconds. It can help reject very short noises or accidental sounds instead of treating them as caller turns.\n\nA larger value may also reject short but valid answers such as yes or a single digit. Tune with the actual responses your workflow expects; it is not the minimum length of an Agent response. Leave blank for the service default.", { type: "number", min: 0, valueType: "number" },
            ) : ""}
            ${turn.type ? runtimeSelect("definition", "audio.input.turn_detection.create_response", "Create response",
              String(turn.create_response ?? true), BOOLEAN_OPTIONS, "Controls whether the service automatically starts an Agent response after the detector finishes the caller's turn. Yes supports a normal hands-free conversation. No still permits speech detection, but the client must explicitly request a response when it is ready.\n\nChoose No only if your application manages that response timing, for example after validating external data. Otherwise the caller may finish speaking and hear no reply. This does not control whether interruptions are allowed.", "boolean") : ""}
            ${turn.type ? runtimeSelect("definition", "audio.input.turn_detection.interrupt_response", "Allow interruption",
              String(turn.interrupt_response ?? true), BOOLEAN_OPTIONS, "Allows detected caller speech to interrupt an Agent response that is still in progress. Yes lets the caller correct or redirect the Agent without waiting for it to finish. No prevents automatic interruption by this detector.\n\nUse recordings to check that background noise or the Agent's own playback is not mistaken for caller speech. This setting is different from cancelling a pending graph handoff, which is configured on the edge.", "boolean") : ""}
            ${turn.type ? runtimeSelect("definition", "audio.input.turn_detection.auto_truncate", "Auto truncate",
              String(turn.auto_truncate ?? false), BOOLEAN_OPTIONS, "Controls whether the service automatically truncates the input audio buffer when speech stops. The buffer is the audio currently accumulated for speech processing; this setting concerns that input-buffer lifecycle, not the maximum reply length or deletion of stored session recordings.\n\nKeep the template's value unless your client explicitly manages audio buffers. Changing it without matching client behavior can affect which audio is retained for later input processing.", "boolean") : ""}
            ${turn.type?.startsWith("azure_")
              ? settingsToggle("remove-filler-words", "Remove user filler words", Boolean(turn.remove_filler_words)) : ""}
            ${["azure_semantic_vad", "azure_semantic_vad_multilingual"].includes(turn.type) ? runtimeInput(
              "definition", "audio.input.turn_detection.languages", "Detection languages",
              Array.isArray(turn.languages) ? turn.languages.join(", ") : "",
              "Language hints for the Azure semantic turn detector, written as comma-separated language/region codes such as hi-IN, en-IN. They help configure the speech-understanding detector for the expected callers where the selected mode supports them.\n\nThese are not the same field as Input language: that setting configures transcript recognition. They also do not select a voice or translate responses. Keep them consistent with the conversation's expected languages and the detector's supported language set.", { valueType: "list" },
            ) : ""}
            ${turn.type ? runtimeInput(
              "definition", "audio.input.turn_detection.profile", "Latency profile", turn.profile,
              "An optional named tuning profile for the selected turn detector, such as normal or eager where supported. Profiles bundle service-specific choices about responsiveness; they are not a duration, a transcript model, or a guarantee of a particular response time.\n\nKeep the template's profile or leave blank to omit it unless you are deliberately comparing supported profiles with call recordings. The Portal preserves the supplied value; the service determines whether it is valid for this detector.",
            ) : ""}
          </div>
          ${turn.type && turn.type !== "semantic_vad" ? `
            <details class="runtime-advanced">
              <summary>Semantic end detection and assistant-speaking tuning</summary>
              <div class="runtime-settings-body two-column">
                ${runtimeSelect("definition", "audio.input.turn_detection.end_of_utterance_detection.model",
                  "End-of-utterance model", endOfUtterance.model || "", [
                    { value: "", label: "Disabled" },
                    { value: "semantic_detection_v1", label: "Semantic detection v1" },
                    { value: "semantic_detection_v1_en", label: "Semantic detection v1 · English" },
                    { value: "semantic_detection_v1_multilingual", label: "Semantic detection v1 · multilingual" },
                    { value: "smart_end_of_turn_detection", label: "Smart end-of-turn detection" },
                  ], "Adds a semantic end-of-utterance detector on top of voice activity detection. Rather than relying only on silence, it helps decide whether the caller has completed a thought, reducing premature replies during natural pauses. Select a language-compatible model; Disabled omits this extra detector.\n\nThis does not change the Agent's conversational model or the STT model. It can change the balance between waiting and cutting in, so compare real caller pauses before overriding the template.")}
                ${endOfUtterance.model ? runtimeSelect(
                  "definition", "audio.input.turn_detection.end_of_utterance_detection.threshold_level",
                  "Semantic threshold", endOfUtterance.threshold_level || "default", [
                    { value: "default", label: "Default" },
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ], "Selects the threshold preset used by the semantic end-of-utterance model when deciding that the caller has finished. This works with the chosen semantic model and is separate from the numeric voice-activity Activation threshold.\n\nThe preset's exact behavior depends on the service/model; do not treat it as a probability or a number of milliseconds. Start with Default or the template's value and compare examples of both short answers and longer pauses before tuning.",
                ) : ""}
                ${endOfUtterance.model ? runtimeInput(
                  "definition", "audio.input.turn_detection.end_of_utterance_detection.timeout_ms",
                  "Semantic timeout", endOfUtterance.timeout_ms,
                  "Bounds how long semantic end detection may wait, in milliseconds. For example, 2000 is two seconds. It gives the semantic detector a waiting limit rather than changing the voice-activity silence threshold.\n\nA short limit can favor responsiveness but give the detector less time to resolve an unfinished utterance. This is not a timeout for tools or the whole call. Leave blank to use the service default.", { type: "number", min: 0, valueType: "number" },
                ) : ""}
                ${runtimeInput("definition", "audio.input.turn_detection.threshold_assistant_speaking",
                  "Assistant-speaking threshold", turn.threshold_assistant_speaking,
                  "Overrides the speech-activation threshold specifically while the Agent's audio is playing, from 0 to 1. A higher value can reduce false interruptions from playback or noise but can also make a quiet caller harder to detect.\n\nThis is separate from the ordinary Activation threshold used outside that playback period. Tune it only with real overlap and echo examples, and use echo cancellation when playback leaks into the microphone. Leave blank to omit this advanced override.", { type: "number", min: 0, max: 1, step: 0.05, valueType: "number" })}
                ${runtimeInput("definition", "audio.input.turn_detection.window_size_assistant_speaking",
                  "Assistant window size", turn.window_size_assistant_speaking,
                  "A service-specific analysis-window setting used to detect caller speech while the Agent is speaking. It tunes the evidence considered during overlapping audio, not the Agent's response length or the normal silence interval.\n\nThis is an advanced detector parameter; its scale and supported values depend on the service. Keep the existing template value or leave blank unless you have model-specific guidance and recorded overlap cases to compare. Do not interpret it as milliseconds.", { type: "number", min: 0, valueType: "number" })}
                ${runtimeInput("definition", "audio.input.turn_detection.distinct_ci_phones_assistant_speaking",
                  "Distinct CI phones", turn.distinct_ci_phones_assistant_speaking,
                  "An advanced speech-evidence threshold used while the Agent's audio is playing. CI phones are context-independent speech-sound units, not telephone numbers; the setting concerns distinct detected speech sounds when deciding whether caller speech is present.\n\nIt does not choose recognition languages or a minimum number of words. Supported values and behavior are service-specific, so retain the template's value or leave blank unless you are tuning recorded overlap cases with detector guidance.", { type: "number", min: 0, valueType: "number" })}
              </div>
            </details>` : ""}
        </details>
      </div>
    </section>`;
}

function renderInterimResponseSettings(config, scope) {
  const interim = config.interim_response || {};
  const type = interim.type || "";
  return `
    <section class="runtime-config-section interim-config-section">
      <div class="runtime-config-heading">
        <div><span class="kicker">Latency UX</span><strong>Interim response</strong></div>
        <span>${scope === "definition" ? "Starter" : "This node"}</span>
      </div>
      <div class="runtime-settings-body two-column">
        ${runtimeSelect(scope, "interim_response.type", "Mode", type, [
          { value: "", label: "Disabled" },
          { value: "static_interim_response", label: "Static text" },
          { value: "llm_interim_response", label: "LLM-generated" },
        ], "Plays a short acknowledgement while the caller waits for a tool or a slow operation, for example Let me check that for you. Static text selects from your candidate messages; LLM-generated composes an acknowledgement using the configured interim model and instructions. Disabled removes this interim-response configuration.\n\nThis does not replace the final answer or make a slow operation complete faster. Keep acknowledgements short so they reassure the caller without making unsupported claims about the result.")}
        ${type ? runtimeSelect(scope, "interim_response.triggers", "Triggers",
          Array.isArray(interim.triggers) ? interim.triggers.join(",") : "latency", [
            { value: "latency", label: "Latency" },
            { value: "tool", label: "Tool call" },
            { value: "latency,tool", label: "Latency + tool call" },
          ], "Chooses which events may cause an interim acknowledgement. Latency uses the waiting threshold; Tool call enables acknowledgements associated with a tool operation; the combined choice permits both kinds of trigger.\n\nThese triggers do not force a tool call and are separate from the node's Tool choice setting. Choose the events that actually create noticeable waiting in your workflow, rather than adding an acknowledgement to every normal reply.", "list") : ""}
        ${type ? runtimeInput(scope, "interim_response.latency_threshold_ms", "Latency threshold",
          interim.latency_threshold_ms, "The wait before a latency-triggered interim acknowledgement becomes eligible, in milliseconds; 1000 means one second. This applies when Latency is included in Triggers and is not a tool execution timeout.\n\nToo small a value can add unnecessary acknowledgements to quick replies; too large a value leaves the caller waiting in silence. Choose it from observed response times for this node. Leave blank to omit an explicit threshold.",
          { type: "number", min: 0, valueType: "number" }) : ""}
        ${type === "static_interim_response" ? runtimeTextarea(
          scope, "interim_response.texts", "Candidate texts",
          Array.isArray(interim.texts) ? interim.texts.join("\n") : "",
          "The messages available to Static text interim responses, one complete sentence per line. For example, enter Let me check that for you and I am still looking into it on separate lines.\n\nTreat every candidate as something the caller might hear before the operation finishes. Avoid promising success, quoting unconfirmed results, or saying that a transfer is complete before it actually is. These messages do not replace the final tool-based answer.", { rows: 3, wide: true, valueType: "lines" },
        ) : ""}
        ${type === "llm_interim_response" ? runtimeInput(
          scope, "interim_response.model", "Interim model", interim.model,
          "An optional model identifier used to compose LLM-generated interim acknowledgements. This is separate from the node's main conversational model; changing it does not change the final-answer model, transcript recognizer, or voice.\n\nUse a model supported by your project and this feature. Leave blank to omit the override rather than guessing a deployment name. Keep the interim instructions focused on a short acknowledgement, not on answering before tool results arrive.",
        ) : ""}
        ${type === "llm_interim_response" ? runtimeInput(
          scope, "interim_response.max_completion_tokens", "Max completion tokens",
          interim.max_completion_tokens, "Caps the generated acknowledgement in model output tokens. Tokens are pieces of text, not words or seconds. The cap applies to one interim response, separately from the main response's Max output tokens.\n\nKeep acknowledgements brief, but avoid a cap so small that it cuts a sentence in half. Use Interim instructions to ask for one short sentence and test how that fits the supported model's token budget.",
          { type: "number", min: 1, valueType: "number" },
        ) : ""}
        ${type === "llm_interim_response" ? runtimeTextarea(
          scope, "interim_response.instructions", "Interim instructions", interim.instructions || "",
          "Guides the model only when composing an interim acknowledgement. Specify a short, truthful message in the caller's language, for example Acknowledge that you are checking the account; do not invent a result or repeat the greeting.\n\nThese instructions do not replace the node's main Instructions or provide the final answer. The operation may still be running, so do not claim that a payment, update, or transfer has succeeded.", { rows: 3, wide: true },
        ) : ""}
      </div>
    </section>`;
}

function parseRuntimeValue(value, type) {
  if (type === "boolean") return value === "true";
  if (type === "optional-boolean") return value === "" ? DELETE_RUNTIME_VALUE : value === "true";
  if (type === "number") return value === "" ? DELETE_RUNTIME_VALUE : Number(value);
  if (type === "token") {
    if (value === "") return DELETE_RUNTIME_VALUE;
    return /^\d+$/.test(value) ? Number(value) : value;
  }
  if (type === "list") {
    const items = value.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean);
    return items.length ? items : DELETE_RUNTIME_VALUE;
  }
  if (type === "lines") {
    const items = value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
    return items.length ? items : DELETE_RUNTIME_VALUE;
  }
  if (type === "optional-string") return value === "" ? DELETE_RUNTIME_VALUE : value;
  return value;
}

function applyRuntimeFieldChange(scope, path, rawValue, valueType) {
  const selectedId = state.selected.id;
  mutate(`Updated ${path}`, (definition) => {
    const target = scope === "definition"
      ? definition
      : definition.handoff.nodes.find((node) => node.id === selectedId)?.config;
    if (!target) return;
    if (path === "audio.input.transcription.model") {
      setRootSttModel(target, rawValue);
      return;
    }
    if (path === "audio.input.echo_cancellation.reference_source") {
      if (rawValue === "client" && (target.avatar || (
        target.audio?.input?.format?.type && target.audio.input.format.type !== "audio/pcm"
      ))) {
        setMessage("Echo reference was not changed.", "Client reference requires PCM input and no avatar in this Portal.");
        return;
      }
      const current = nestedValue(target, "audio.input.echo_cancellation") || {};
      setNestedValue(target, "audio.input.echo_cancellation", {
        ...current, type: "server_echo_cancellation", reference_source: rawValue,
        channels: rawValue === "client" ? 2 : 1,
      });
      if (rawValue === "client" && !target.audio.input.format?.type) {
        target.audio.input.format = { rate: 24000, ...target.audio.input.format, type: "audio/pcm" };
      }
      return;
    }
    if (path === "greeting.type") {
      if (!rawValue) {
        delete target.greeting;
        return;
      }
      target.greeting = { ...(target.greeting || {}), type: rawValue };
      if (rawValue === "template") {
        delete target.greeting.prompt;
        delete target.greeting.tool_choice;
      } else {
        delete target.greeting.text;
      }
      return;
    }
    if (path === "audio.input.noise_reduction.type" && !rawValue) {
      setNestedValue(target, "audio.input.noise_reduction", DELETE_RUNTIME_VALUE);
      return;
    }
    if (path === "audio.input.turn_detection.type") {
      if (!rawValue) {
        setNestedValue(target, "audio.input.turn_detection", DELETE_RUNTIME_VALUE);
        return;
      }
      const current = nestedValue(target, "audio.input.turn_detection") || {};
      const next = { ...current, type: rawValue };
      if (rawValue === "semantic_vad") {
        for (const key of ["threshold", "prefix_padding_ms", "silence_duration_ms", "idle_timeout_ms",
          "speech_duration_ms", "end_of_utterance_detection", "profile", "threshold_assistant_speaking",
          "window_size_assistant_speaking", "distinct_ci_phones_assistant_speaking"]) delete next[key];
      } else {
        delete next.eagerness;
      }
      if (!rawValue.startsWith("azure_")) delete next.remove_filler_words;
      if (!["azure_semantic_vad", "azure_semantic_vad_multilingual"].includes(rawValue)) delete next.languages;
      setNestedValue(target, "audio.input.turn_detection", next);
      return;
    }
    if (path === "audio.input.turn_detection.end_of_utterance_detection.model" && !rawValue) {
      setNestedValue(target, "audio.input.turn_detection.end_of_utterance_detection", DELETE_RUNTIME_VALUE);
      return;
    }
    if (path === "interim_response.type") {
      if (!rawValue) {
        delete target.interim_response;
        return;
      }
      const current = target.interim_response || {};
      target.interim_response = { ...current, type: rawValue };
      if (rawValue === "static_interim_response") {
        delete target.interim_response.model;
        delete target.interim_response.instructions;
        delete target.interim_response.max_completion_tokens;
      } else {
        delete target.interim_response.texts;
      }
      return;
    }
    setNestedValue(target, path, parseRuntimeValue(rawValue, valueType));
  });
}

function bindAgentRuntimeSettings(root) {
  const languageInput = $("#component-stt-language", root);
  if (languageInput) {
    mountInputLanguagePicker({
      input: languageInput,
      toggle: $("#component-stt-language-toggle", root),
      list: $("#component-stt-languages", root),
      model: rootSttModel(),
      value: state.definition.audio?.input?.transcription?.language,
      onError: (error) => {
        $("#component-stt-language-error", root).textContent = error;
        $("#component-stt-language-error", root).hidden = !error;
      },
      onChange: (language) => {
        mutate("Updated Agent-level input language", (definition) => {
          setRootSttModel(definition, rootSttModel());
          if (language) definition.audio.input.transcription.language = language;
          else delete definition.audio.input.transcription.language;
        });
      },
    });
  }
  $$("[data-setting-control]", root).forEach((field) => {
    field.addEventListener("change", () => {
      const enabled = field.checked;
      const control = field.dataset.settingControl;
      mutate(`Updated ${control}`, (definition) => {
        const set = (path, value) => setNestedValue(definition, `audio.input.${path}`, value);
        if (control === "phrase-list") {
          set("transcription.phrase_list", enabled ? [] : DELETE_RUNTIME_VALUE);
        } else if (control === "audio-enhancement") {
          if (enabled) set("noise_reduction", { type: "azure_deep_noise_suppression" });
          else {
            set("noise_reduction", DELETE_RUNTIME_VALUE);
            set("echo_cancellation", DELETE_RUNTIME_VALUE);
          }
        } else if (control === "noise-suppression") {
          set("noise_reduction", enabled ? { type: "azure_deep_noise_suppression" } : DELETE_RUNTIME_VALUE);
        } else if (control === "echo-cancellation") {
          set("echo_cancellation", enabled
            ? { type: "server_echo_cancellation", reference_source: "server", channels: 1 }
            : DELETE_RUNTIME_VALUE);
        } else if (control === "turn-detection") {
          set("turn_detection", enabled ? { type: "azure_semantic_vad_multilingual" } : DELETE_RUNTIME_VALUE);
        } else if (control === "remove-filler-words") {
          set("turn_detection.remove_filler_words", enabled);
        }
      });
      renderNodeEditor();
    });
  });
  $$("[data-turn-mode]", root).forEach((button) => {
    button.addEventListener("click", () => {
      applyRuntimeFieldChange("definition", "audio.input.turn_detection.type", button.dataset.turnMode, "string");
      renderNodeEditor();
    });
  });
  $$("[data-runtime-path]", root).forEach((field) => {
    field.addEventListener("change", () => {
      applyRuntimeFieldChange(
        field.dataset.runtimeScope,
        field.dataset.runtimePath,
        field.value,
        field.dataset.runtimeType,
      );
      renderNodeEditor();
    });
  });
}

function renderNodeEditor() {
  if (!state.definition || state.selected.kind !== "node") {
    state.editorSession = null;
    hideNodeEditor();
    return;
  }
  const id = state.selected.id;
  const entry = id === ENTRYPOINT_ID;
  $("#import-agent-settings").hidden = !entry;
  $("#node-editor").setAttribute("aria-label", entry ? "Entrypoint overall settings" : "Node setup");
  $("#node-editor-description-text").textContent = entry
    ? "Configure overall Agent settings and the entrypoint's model, voice, instructions, and tools in one place."
    : "Configure this node's model, voice, instructions, and tools.";
  $("#done-node-editor").textContent = "Save node";
  const node = entry
    ? null
    : state.definition.handoff.nodes.find((item) => item.id === id);
  if (!entry && !node) {
    state.editorSession = null;
    hideNodeEditor();
    return;
  }
  const config = entry ? state.definition : (node.config || {});
  const model = editableValue(config.model ?? "");
  const effectiveModelName = modelName(config.model ?? state.definition.model) || "Custom / inherited";
  const voice = editableValue(entry ? rootVoice() : config.voice);
  const effectiveVoice = entry ? rootVoice() : (config.voice ?? rootVoice());
  const sttModel = rootSttModel();
  const { preset, pipeline } = selectedPipeline(
    config.model ?? state.definition.model, effectiveVoice, sttModel, {
      voiceType: effectiveVoiceType(id),
      customSpeech: Boolean(state.definition?.audio?.input?.transcription?.custom_speech),
    },
  );
  const totals = pipeline ? presetTotals(pipeline) : null;
  const previousMetrics = { ...state.metricDisplay };
  const stt = pipeline?.stt || {
    id: sttModel,
    label: sttModel,
    latencyMs: null,
    costPerMinute: null,
  };
  const tools = stableJson(config.tools ?? [], 2);
  const toolChoice = config.tool_choice ?? "auto";
  const namedToolChoice = typeof toolChoice === "object" && toolChoice !== null;
  const toolList = Array.isArray(config.tools) ? config.tools : [];
  $("#node-editor-title").textContent = entry ? "Entrypoint / Overall settings" : id;
  $("#node-editor-kind-label").textContent = entry ? "Overall settings" : "Node";
  $("#node-editor-kind-icon").innerHTML = pipelineIcon(nodeIcon(id));
  $("#delete-node-editor").hidden = entry;
  $("#node-editor-body").innerHTML = `
    <section class="settings-scope-note" aria-label="Node configuration scope">
      <div>
        <strong>${entry ? "Overall settings and entrypoint behavior" : "Editing this node"}</strong>
        <p>${entry
          ? "Input language, STT, greeting, audio transport, and turn detection are shared across the graph. The model, voice, instructions, and tools below configure the entrypoint; specialist nodes keep their own overrides."
          : "Input language, greeting, audio, and turn detection are configured on $entrypoint under Overall settings. Edit this node's model, voice, instructions, and tools here."}</p>
      </div>
    </section>
    ${state.debugMode ? `<section class="pipeline-overview" aria-label="Pipeline metrics">
      <div class="overview-metric">
        <div class="overview-label">${pipelineIcon("coin")}<span>Cost</span></div>
        <strong id="node-cost-value">${totals ? calculatedCost(totals.costPerMinute) : "Not available"}</strong>
        ${pipelineBar(pipeline, "costPerMinute")}
        <div class="bar-legend"><span class="stt">STT</span><span class="model">Model</span><span class="voice">Voice</span></div>
      </div>
      <div class="overview-metric">
        <div class="overview-label">${pipelineIcon("clock")}<span>Latency</span></div>
        <strong id="node-latency-value">${totals ? estimatedLatencyRange(totals) : "Not available"}</strong>
        ${pipelineBar(pipeline, "latencyMs")}
        <p>Disclaimer: ${PIPELINE_METRICS_DISCLAIMER}</p>
      </div>
    </section>` : ""}
    <section class="node-icon-section">
      <div class="preset-heading">
        <div>
          <span class="kicker">Node icon</span>
          <strong>Choose a visual role for the graph</strong>
        </div>
        <span>UI annotation only; it is not added to the published definition.</span>
      </div>
      <div class="node-icon-picker">
        ${NODE_ICONS.map((item) => `
          <button type="button" class="node-icon-option${nodeIcon(id) === item.id ? " selected" : ""}"
            data-node-icon="${item.id}" aria-pressed="${nodeIcon(id) === item.id}">
            ${pipelineIcon(item.id)} <span>${escapeHtml(item.label)}</span>
          </button>`).join("")}
      </div>
    </section>
    <section class="pipeline-cards" aria-label="Node pipeline">
      <article class="pipeline-card transcriber-card${state.nodeComponentPanel === "stt" ? " component-selected" : ""}"
        data-component-card="stt" role="button" tabindex="0">
        <div class="pipeline-card-heading">
          <span>${pipelineIcon("audio")} Transcriber</span>
          <span class="pipeline-dot"></span>
        </div>
        <strong>${escapeHtml(stt.label)}</strong>
        <button type="button" class="component-edit-button" data-node-component="stt">
          ${pipelineIcon("sliders")} Configure Agent-level STT
        </button>
        ${state.debugMode ? `<div class="component-metrics">
          <span>Latency <b>${stt.latencyMs === 0
            ? "No separate STT stage"
            : estimatedLatency(stt.latencyMs)}</b></span>
          <span>STT-only cost <b>${componentCostLabel(stt)}</b></span>
        </div>` : ""}
        <p>${pipeline.architecture === "realtime"
          ? "The model reads audio natively; auxiliary STT runs in parallel and is excluded from the serial total."
          : "Agent-level STT feeds every cascaded node. All listed transcribers are selectable; the service validates support."}
          ${escapeHtml(state.debugMode && stt.latencySource ? ` Source: ${stt.latencySource}.` : "")}</p>
      </article>
      <article class="pipeline-card model-card${state.nodeComponentPanel === "model" ? " component-selected" : ""}"
        data-component-card="model" role="button" tabindex="0">
        <div class="pipeline-card-heading">
          <span>${pipelineIcon("model")} Model</span>
          <span class="pipeline-dot"></span>
        </div>
        <strong>${escapeHtml(pipeline?.model.label || effectiveModelName)}</strong>
        <button type="button" class="component-edit-button" data-node-component="model">
          ${pipelineIcon("sliders")} Configure model
        </button>
        ${state.debugMode ? `<div class="component-metrics">
          <span>Latency <b>${estimatedLatencyRange(pipeline.model)}</b></span>
          <span>Model-only cost <b>${calculatedCost(pipeline.model.costPerMinute)}</b></span>
        </div>` : ""}
        <p>${escapeHtml(preset?.summary || (totals
          ? `${pipeline.architecture === "realtime" ? "Speech-to-speech" : "Cascaded"} · ${pipeline.tier} retail tier.`
          : "Custom or unavailable model: estimate unavailable."))}</p>
      </article>
      <article class="pipeline-card voice-card${state.nodeComponentPanel === "voice" ? " component-selected" : ""}"
        data-component-card="voice" role="button" tabindex="0">
        <div class="pipeline-card-heading">
          <span>${pipelineIcon("voice")} Voice</span>
          <span class="pipeline-dot"></span>
        </div>
        <strong>${escapeHtml(pipeline?.voice.label || voice || "Inherited from root Agent")}</strong>
        <button type="button" class="component-edit-button" data-node-component="voice">
          ${pipelineIcon("sliders")} Configure voice
        </button>
        ${state.debugMode ? `<div class="component-metrics">
          <span>Latency <b>${pipeline.voice.latencyIncludedInModel
            ? "Included in model TTFA"
            : estimatedLatency(pipeline.voice.latencyMs)}</b></span>
          <span>TTS-only cost <b>${calculatedCost(pipeline.voice.costPerMinute)}</b></span>
        </div>
        <p>${pipeline.voice.latencyIncludedInModel
          ? "Native speech output is already inside the model TTFA and must not be added again."
          : "Independent Azure Speech TTS first-byte estimate; add it only in a cascaded serial path."}
          ${escapeHtml(pipeline.voice.latencySource ? ` Source: ${pipeline.voice.latencySource}.` : "")}</p>` : ""}
      </article>
    </section>
    <div class="pipeline-compatibility-note">
      <strong>${pipeline?.architecture === "realtime" ? "Realtime" : "Cascaded"} audio path</strong>
      <span>${pipeline?.architecture === "realtime"
        ? "Caller audio goes directly to the model. STT runs in parallel for transcripts. Output may use a compatible native or Azure Speech voice."
        : "STT converts caller audio to text before the model. Output requires a compatible Azure Speech voice."}</span>
    </div>
    ${entry ? renderAgentRuntimeSettings(state.definition) : ""}
    <section class="node-editor-form">
      <div class="node-editor-meta">
        <div>
          ${nodeFieldLabel(
            "Node name",
            "node-editor-id",
            entry
              ? "$entrypoint is the fixed identifier for the graph's starting node and represents the root Agent definition. A new session begins with its behavior, while Overall settings on this editor also apply to the rest of the graph. It cannot be renamed; edit the Agent's name separately if you want to change the published Agent identity."
              : "The identifier used to refer to this specialist in the published handoff graph. Choose a stable, meaningful name such as billing_support. Renaming it updates connected graph edges in the working copy; check any instructions or external references that mention the old name, because free-text references are not rewritten automatically.",
          )}
          <input id="node-editor-id" data-node-editor-field="id" value="${escapeHtml(id)}"
            ${entry ? "readonly" : ""}>
          ${fieldError("id")}
        </div>
        <div>
          ${nodeFieldLabel(
            "Description",
            "node-editor-description",
            "A short summary of this node's responsibility, for example Handles invoice questions and payment status. It helps authors distinguish specialists when reading the graph. The entrypoint shows a fixed description because it represents root behavior.\n\nThis summary does not replace Instructions or determine when a handoff occurs. Put observable routing conditions on the connected edges and put detailed behavior and restrictions in the node's Instructions.",
          )}
          <input id="node-editor-description" data-node-editor-field="description"
            value="${escapeHtml(entry ? "Definition root behavior" : node.description || "")}"
            ${entry ? "readonly" : ""}>
          ${entry ? "" : fieldError("description")}
        </div>
      </div>
      ${nodeFieldLabel(
        "Instructions",
        "node-editor-instructions",
        "The prompt that defines this node's role, speaking style, permitted actions, and workflow. State what information to collect, which tools to use, what must be verified, and when to hand off or finish. For example, require an account lookup before giving a balance, and prohibit inventing a tool result.\n\nThese instructions configure the entrypoint or selected specialist, not every specialist's overrides. They do not themselves create tools, change speech recognition, or publish the Agent. Save the working copy and publish a new version when you are ready to use the changes.",
      )}
      <textarea id="node-editor-instructions" data-node-editor-field="instructions"
        rows="12" placeholder="Define this node's focused behavior…">${escapeHtml(config.instructions || "")}</textarea>
      ${fieldError("instructions")}
    </section>
    ${renderInterimResponseSettings(config, entry ? "definition" : "node")}
    <section class="tool-config-section">
      <div class="tool-config-heading">
        <div>
          <span class="kicker">Tools & MCP</span>
          <strong>Configure the tools available in this node</strong>
          <p>Test a published Agent or the MCP configuration supplied by a selected template.</p>
        </div>
        <div class="tool-choice-control">
          ${nodeFieldLabel(
            "Tool choice",
            "node-editor-tool-choice",
            "Controls whether this node's model may use its configured tools. Auto lets the model choose between replying and calling a tool; Required requires a tool call rather than a text-only response; None prevents tool calls. It does not add tools or decide whether independent tool calls run in parallel.\n\nRequired without suitable tools can prevent a useful response. Use Auto for normal conversation, and require a tool only where the workflow needs one. An advanced named function/MCP selection can also be preserved and edited below.",
          )}
          <select id="node-editor-tool-choice" data-node-editor-field="tool_choice">
            ${namedToolChoice ? '<option value="__named__" selected disabled>Specific named tool</option>' : ""}
            <option value="auto"${toolChoice === "auto" ? " selected" : ""}>Auto · model decides</option>
            <option value="required"${toolChoice === "required" ? " selected" : ""}>Required · must call a tool</option>
            <option value="none"${toolChoice === "none" ? " selected" : ""}>None · tools disabled</option>
          </select>
        </div>
      </div>
      ${namedToolChoice ? `
        ${nodeFieldLabel(
          "Specific function or MCP tool selection",
          "node-editor-named-tool-choice",
          "The structured tool_choice object that restricts selection to a named function, an MCP server, or an MCP tool. It must reference an actual tool available to this node and use the service's expected object shape.\n\nThis is not the tool declaration itself. Changing a name here does not create or rename a tool. Keep the existing object unless you intend to change the restriction, or choose Auto, Required, or None above to use a general policy.",
        )}
        <textarea id="node-editor-named-tool-choice" data-node-editor-field="tool_choice"
          rows="4">${escapeHtml(stableJson(toolChoice, 2))}</textarea>` : ""}
      <div class="tool-config-list">
        ${toolList.length
          ? toolList.map((tool, index) => renderToolCard(tool, index)).join("")
          : '<div class="tool-config-empty"><strong>No tools configured</strong><span>Add an MCP, function, system, or toolbox declaration in the JSON editor below.</span></div>'}
      </div>
      <details class="tool-json-editor">
        <summary>Edit tools JSON <span>${toolList.length} configured</span></summary>
        ${nodeFieldLabel(
          "Tools (JSON array)",
          "node-editor-tools",
          "The full JSON array of tools made available to this node, including MCP server connections, allowed tool names, function parameter schemas, system tools, or toolboxes. This is configuration, not a list of tool calls that have already run.\n\nKeep each declaration in the service's expected shape; valid JSON alone does not guarantee a reachable server or correct tool contract. Removing a tool also removes the model's ability to invoke it from this node. Review endpoint access and schemas, test the MCP configuration where applicable, and publish before expecting live sessions to use the change.",
        )}
        <textarea id="node-editor-tools" data-node-editor-field="tools" rows="10"
          spellcheck="false">${escapeHtml(tools)}</textarea>
        ${fieldError("tools")}
      </details>
    </section>`;
  const nodeEditorBody = $("#node-editor-body");
  bindAgentRuntimeSettings(nodeEditorBody);
  $(".node-editor-form", nodeEditorBody).before($(".tool-config-section", nodeEditorBody));
  $$("[data-node-editor-field]", nodeEditorBody).forEach((field) => {
    field.addEventListener("change", () => {
      applyNodeFieldChange(field.dataset.nodeEditorField, field.value);
      renderNodeEditor();
    });
  });
  $$("[data-component-card]", nodeEditorBody).forEach((card) => {
    const open = () => {
      const kind = card.dataset.componentCard;
      const activeField = document.activeElement;
      if (activeField instanceof HTMLElement && nodeEditorBody.contains(activeField)) {
        activeField.blur();
      }
      state.nodeComponentPanel = kind;
      renderNodeEditor();
    };
    card.addEventListener("pointerdown", (event) => {
      // Commit the focused field on click, before its rerender can replace this card.
      if (event.button === 0) event.preventDefault();
    });
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
  $$("[data-node-icon]", nodeEditorBody).forEach((button) => {
    button.addEventListener("click", () => {
      state.nodeIcons.set(state.selected.id, button.dataset.nodeIcon);
      setMessage(`Updated ${state.selected.id} icon locally. Definition data was not changed.`);
      render();
      renderNodeEditor();
    });
  });
  $$("[data-mcp-probe]", nodeEditorBody).forEach((button) => {
    button.addEventListener("click", () => testNodeMcpTool(button));
  });
  if (state.debugMode && totals) {
    animateMetricElement(
      $("#node-cost-value"),
      previousMetrics.cost,
      totals.costPerMinute,
      (value) => calculatedCost(Math.max(0, value)),
    );
    $("#node-latency-value").textContent = estimatedLatencyRange(totals);
    state.metricDisplay = {
      nodeId: id,
      cost: totals.costPerMinute,
      latency: totals.latencyMs,
    };
  }
  renderNodeComponentPanel();
}

async function testNodeMcpTool(button) {
  const index = Number(button.dataset.mcpProbe);
  const nodeId = button.dataset.nodeId || state.selected.id;
  const tool = effectiveTools(nodeId)[index];
  const scope = button.closest("[data-mcp-probe-scope]");
  const status = $(`[data-mcp-probe-status="${index}"]`, scope);
  const probeMode = mcpProbeMode();
  if (!tool || toolKind(tool) !== "mcp" || !status || !probeMode) return;

  button.disabled = true;
  button.textContent = "Testing…";
  status.className = "mcp-probe-status running";
  status.textContent = probeMode === "template"
    ? "Checking the selected template MCP configuration…"
    : "Connecting to the published MCP server…";
  try {
    const response = probeMode === "template"
      ? await fetch(`/api/templates/${encodeURIComponent(sourceTemplateId())}/mcp/probe${sourceTemplateVersionQuery()}`)
      : await fetch("/api/mcp/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: state.agentName,
          server_label: tool.server_label || "",
        }),
      });
    const result = await response.json();
    if (probeMode === "template") {
      const normalizeUrl = (value) => String(value || "").replace(/\/+$/, "");
      const sameServer = !tool.server_url
        || normalizeUrl(tool.server_url) === normalizeUrl(result.server_url);
      const sameConnection = !tool.project_connection_id
        || tool.project_connection_id === result.project_connection_id;
      if (!sameServer || !sameConnection) {
        status.className = "mcp-probe-status bad";
        status.textContent = "Test failed · local MCP settings differ from the selected template";
        return;
      }
    }
    if (result.ok) {
      status.className = "mcp-probe-status good";
      const latency = Number.isFinite(result.latency_ms) ? `${result.latency_ms} ms` : "ready";
      status.textContent = result.project_connection_auth
        ? `Connected · ${latency} · Project connection authentication ready`
        : `Connected · ${latency} · ${Array.isArray(result.tools) ? result.tools.length : 0} server tools`;
    } else if (result.connection_only) {
      status.className = "mcp-probe-status bad";
      status.textContent = "Test failed · no direct MCP URL is available for this project connection";
    } else if (result.no_mcp) {
      status.className = "mcp-probe-status bad";
      status.textContent = "Test failed · the published Agent does not contain this MCP server";
    } else if (result.reached) {
      status.className = "mcp-probe-status bad";
      status.textContent = `Test failed · HTTP ${result.http_status} · ${result.latency_ms} ms`;
    } else {
      status.className = "mcp-probe-status bad";
      status.textContent = `Test failed · ${result.error || `HTTP ${response.status}`}`;
    }
  } catch (error) {
    status.className = "mcp-probe-status bad";
    status.textContent = `Test failed · ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "Test MCP";
  }
}

function parseJsonArray(value, field) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("value must be an array");
    return parsed;
  } catch (error) {
    setMessage("The field was not changed.", `${field}: ${error.message}`);
    throw error;
  }
}

function parseFlexible(value) {
  const text = value.trim();
  if (!text) return undefined;
  if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);
  return text;
}

function applyNodeFieldChange(field, value) {
  const oldId = state.selected.id;
  const entry = oldId === ENTRYPOINT_ID;
  if (field === "id" && !entry) {
    const nextId = value.trim();
    if (!nextId) {
      setMessage("The node id was not changed.", "Node id cannot be empty.");
      renderNodeEditor();
      return;
    }
    if (state.definition.handoff.nodes.some((item) => item.id === nextId && item.id !== oldId)) {
      setMessage("The node id was not changed.", `Node id "${nextId}" is already in use.`);
      renderNodeEditor();
      return;
    }
    mutate(`Renamed ${oldId} to ${nextId || "(empty)"}`, (definition) => {
      const node = definition.handoff.nodes.find((item) => item.id === oldId);
      node.id = nextId;
      definition.handoff.edges.forEach((edge) => {
        if (edge.source === oldId) edge.source = nextId;
        if (edge.target === oldId) edge.target = nextId;
      });
    });
    const position = state.positions.get(oldId);
    const icon = state.nodeIcons.get(oldId);
    state.positions.delete(oldId);
    state.nodeIcons.delete(oldId);
    if (position) state.positions.set(nextId, position);
    if (icon) state.nodeIcons.set(nextId, icon);
    state.selected.id = nextId;
    render();
    return;
  }
  mutate(`Updated ${oldId}.${field}`, (definition) => {
    const node = entry
      ? null
      : definition.handoff.nodes.find((item) => item.id === oldId);
    const config = entry ? definition : (node.config ||= {});
    if (field === "description") {
      node.description = value;
    } else if (field === "tools") {
      config.tools = parseJsonArray(value, "tools");
    } else if (field === "voice") {
      const parsed = parseFlexible(value);
      if (entry) {
        definition.audio ||= {};
        definition.audio.output ||= {};
        if (parsed === undefined) delete definition.audio.output.voice;
        else definition.audio.output.voice = parsed;
      } else if (parsed === undefined) {
        delete config.voice;
      } else {
        config.voice = parsed;
      }
    } else if (["model", "tool_choice"].includes(field)) {
      const parsed = parseFlexible(value);
      if (parsed === undefined) delete config[field];
      else config[field] = parsed;
    } else {
      config[field] = value;
    }
  });
}

function applyEdgeFieldChange(field, value) {
  const oldId = state.selected.id;
  if (field === "id") {
    const nextId = value.trim();
    if (!nextId) {
      setMessage("The edge id was not changed.", "Edge id cannot be empty.");
      renderEdgeEditor();
      return;
    }
    if (state.definition.handoff.edges.some((item) => item.id === nextId && item.id !== oldId)) {
      setMessage("The edge id was not changed.", `Edge id "${nextId}" is already in use.`);
      renderEdgeEditor();
      return;
    }
    value = nextId;
  }
  mutate(`Updated ${oldId}.${field}`, (definition) => {
    const edge = definition.handoff.edges.find((item) => item.id === oldId);
    if (field === "delay_ms") {
      if (value === "") delete edge.delay_ms;
      else edge.delay_ms = Number(value);
    } else if (field === "cancel_on_interruption") {
      edge.cancel_on_interruption = value === "true";
    } else {
      edge[field] = value;
    }
  });
  if (field === "id") state.selected.id = value.trim();
  render();
}

function renderProblems() {
  const problems = currentProblems();
  $(".rail .problems").hidden = !problems.length;
  const errors = problems.filter((item) => item.severity === "error").length;
  const warnings = problems.length - errors;
  $("#problem-count").textContent = errors ? `${errors}E${warnings ? ` · ${warnings}W` : ""}` : String(warnings);
  const root = $("#problem-list");
  root.replaceChildren();
  if (!problems.length) {
    root.innerHTML = '<p class="problem-empty">No local validation problems.</p>';
    return;
  }
  for (const item of problems) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `problem ${item.severity}`;
    button.innerHTML = `
      <span class="problem-mark" aria-hidden="true"></span>
      <span><strong>${escapeHtml(item.message)}</strong><span>${escapeHtml([item.objectKind, item.objectId, item.field, item.code].filter(Boolean).join(" · "))}</span></span>`;
    button.addEventListener("click", () => {
      if (item.objectKind === "node" && item.objectId) {
        openNodeEditor(item.objectId);
        requestAnimationFrame(() => {
          if (item.field) $(`#node-editor-${CSS.escape(item.field)}`)?.focus();
        });
        return;
      }
      if (item.objectKind === "edge" && item.objectId) {
        openEdgeEditor(item.objectId);
        requestAnimationFrame(() => {
          if (item.field) $(`#field-${CSS.escape(item.field)}`, $("#edge-editor-body"))?.focus();
        });
        return;
      }
      state.selected = { kind: item.objectKind || "graph", id: item.objectId || "" };
      render();
    });
    root.append(button);
  }
}

function renderHeader() {
  const problems = currentProblems();
  const errors = problems.filter((item) => item.severity === "error").length;
  const dirty = isDirty();
  $("#agent-title").textContent = state.agentName || "No Agent selected";
  // Draw attention to templates until something is loaded into the canvas.
  $("#template-action").classList.toggle("attention", !state.definition);
  $("#version-badge").textContent = state.definition
    ? `${state.draft ? "Draft " : "Version "}${state.version || "local"}`
    : "Version —";
  $("#dirty-badge").textContent = dirty ? "Unsaved" : "Clean";
  $("#dirty-badge").className = `badge ${dirty ? "dirty" : "quiet"}`;
  $("#valid-badge").textContent = !state.definition ? "Not loaded" : errors ? `${errors} error${errors === 1 ? "" : "s"}` : "Valid";
  $("#valid-badge").className = `badge ${!state.definition ? "quiet" : errors ? "invalid" : "valid"}`;
  const canTry = Boolean(
    state.definition && state.agentName.trim()
      && !state.publishing,
  );
  $("#publish-run-action").disabled = !canTry;
  $("#publish-run-action").textContent = state.publishing
    ? "Publishing…"
    : "Try it now";
  $("#create-blank-action").disabled = state.publishing || Boolean(state.templateLoadingId);
  $("#template-action").disabled = state.publishing || Boolean(state.templateLoadingId);
  $("#view-agent-yaml").disabled = state.publishing || Boolean(state.templateLoadingId);
  $("#add-node").disabled = !state.definition;
  $("#add-node-canvas").disabled = !state.definition;
  $("#add-edge").disabled = !state.definition;
  $("#layout-action").disabled = !state.definition;
  $("#fit-action").disabled = !state.definition;
  $("#undo-action").disabled = !state.history.length;
  $("#redo-action").disabled = !state.future.length;
}

function renderDefinition() {
  if ($("#definition-drawer").hidden) return;
  let value = "No Agent definition loaded. Choose Import from agent to import a working copy.";
  if (state.definition) {
    value = state.format === "json"
      ? `${stableJson(state.definition, 2)}\n`
      : deterministicYaml(state.definition);
  }
  $("#definition-output").textContent = value;
  $("#export-format-label").textContent = state.format.toUpperCase();
  $("#export-format-guidance").textContent = state.format === "json"
    ? "JSON can be placed directly in the version request's definition property."
    : "YAML is portable authoring text. Parse it into an object first, then place that object in the JSON version request's definition property.";
  $("#export-api-path").textContent = (
    `POST /agents/<agent-name>/versions?api-version=${state.cfg?.apiVersion || "v1"}`
  );
  $("#export-feature-header").textContent = (
    `Foundry-Features: ${state.cfg?.foundryFeatures || "VoiceAgents=V1Preview"}`
  );
  $$(".definition-tabs button").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.format === state.format));
  });
}

function render() {
  renderHeader();
  renderToolBanner();
  renderAgentOptions();
  renderOutline();
  renderGraph();
  renderProblems();
  renderDefinition();
}

function openDefinition() {
  state.definitionReturnFocus = document.activeElement;
  $("#definition-drawer").hidden = false;
  renderDefinition();
  $("#close-definition").focus();
}

function openAgentYaml() {
  state.format = "yaml";
  openDefinition();
}

function closeDefinition() {
  if ($("#definition-drawer").hidden) return;
  $("#definition-drawer").hidden = true;
  if (state.definitionReturnFocus?.isConnected) state.definitionReturnFocus.focus();
  state.definitionReturnFocus = null;
}

function returnedVersion(payload) {
  const latest = payload?.versions?.latest || payload;
  return {
    name: String(payload?.name || state.agentName),
    version: String(latest?.version || payload?.version || ""),
    draft: latest?.draft === true || payload?.draft === true,
  };
}

const PUBLISH_STEP_IDS = ["validate", "mcp", "publish", "verify", "open"];

function setPublishStep(id, status, detail = "") {
  const item = $(`[data-publish-step="${id}"]`, $("#publish-progress"));
  if (!item) return;
  item.dataset.status = status;
  const indicator = $(".publish-step-indicator", item);
  indicator.textContent = {
    pending: "",
    running: "···",
    complete: "✓",
    skipped: "—",
    failed: "!",
  }[status] || "";
  if (detail) $("small", item).textContent = detail;
}

function openPublishProgress() {
  $("#publish-progress-agent").textContent = state.agentName || "Unnamed Agent";
  $("#publish-progress-project").textContent = state.cfg?.project || state.cfg?.backend || "Current Project";
  $("#publish-progress-summary").textContent = "Preparing publication…";
  $("#publish-progress-error").hidden = true;
  $("#publish-progress-error").textContent = "";
  $("#publish-progress-done").hidden = true;
  $("#close-publish-progress").disabled = true;
  for (const id of PUBLISH_STEP_IDS) setPublishStep(id, "pending");
  $("#publish-progress").hidden = false;
}

function finishPublishProgress(summary, error = "") {
  $("#publish-progress-summary").textContent = summary;
  $("#publish-progress-error").textContent = error;
  $("#publish-progress-error").hidden = !error;
  $("#publish-progress-done").hidden = false;
  $("#close-publish-progress").disabled = false;
  $("#publish-progress-done").focus({ preventScroll: true });
}

function closePublishProgress() {
  if (state.publishing) return;
  $("#publish-progress").hidden = true;
}

async function publishDefinition() {
  if (!state.definition || state.publishing) return null;
  setPublishStep("validate", "running", "Checking graph topology and required Agent fields…");
  const localProblems = validateDefinition(state.definition);
  const errors = localProblems.filter((item) => item.severity === "error");
  const name = state.agentName.trim();
  if (!name) {
    setPublishStep("validate", "failed", "A publication name is required.");
    finishPublishProgress("Publication stopped during validation.", "Set an Agent publication name and try again.");
    setMessage("Publication blocked.", "Agent name is required.");
    state.selected = { kind: "graph", id: "" };
    render();
    requestAnimationFrame(() => $("#field-agent_name")?.focus());
    return null;
  }
  const warnings = localProblems.length - errors.length;
  setPublishStep(
    "validate",
    errors.length ? "skipped" : "complete",
    errors.length
      ? `${errors.length} local issue${errors.length === 1 ? "" : "s"} noted; submitting to Foundry without blocking.`
      : warnings
      ? `Validation passed with ${warnings} warning${warnings === 1 ? "" : "s"}.`
      : "Validation passed with no blocking problems.",
  );
  state.publishing = true;
  state.serverProblems = [];
  const templateId = sourceTemplateId();
  setMessage(
    templateId
      ? `Configuring the template MCP connection for ${name}…`
      : `Publishing release for ${name} through the server-held Foundry credential…`,
  );
  render();
  if (templateId) {
    setPublishStep("mcp", "running", "Configuring the template MCP endpoint and any required Project connection…");
    try {
      await readResponse(
        await fetch(
          `/api/templates/${encodeURIComponent(templateId)}/mcp/configure${sourceTemplateVersionQuery()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
        ),
      );
      setPublishStep("mcp", "complete", "Template MCP configuration is ready.");
    } catch (error) {
      state.publishing = false;
      setPublishStep("mcp", "failed", error.message);
      finishPublishProgress("Publication stopped while configuring MCP.", error.message);
      setMessage("MCP configuration failed. The Agent was not published.", error.message);
      render();
      return null;
    }
  } else {
    setPublishStep("mcp", "skipped", "No Template MCP configuration needs to be checked.");
  }
  setPublishStep("publish", "running", `Creating a release for ${name}…`);
  setMessage(`Publishing release for ${name} through the server-held Foundry credential…`);
  render();
  let posted;
  try {
    posted = await serviceRequest(
      serviceUrl(`/agents/${encodeURIComponent(name)}/versions`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          definition: publicationDefinition(state.definition),
          description: state.sourceDescription || "Handoff Graph dashboard publication",
          metadata: {
            ...state.sourceMetadata,
            authoring_surface: "handoff-graph-dashboard",
          },
          draft: false,
        }),
      },
      { draft: false },
    );
  } catch (error) {
    state.serverProblems = error.payload || {};
    state.publishing = false;
    setPublishStep("publish", "failed", `HTTP ${error.status || "network"} · ${error.message}`);
    finishPublishProgress("Publication failed while creating the Agent version.", error.message);
    setMessage(
      "Publication failed. The local working copy was preserved.",
      `HTTP ${error.status || "network"} · ${error.message}`,
    );
    render();
    return null;
  }

  const returned = returnedVersion(posted);
  setPublishStep(
    "publish",
    "complete",
    `Created version ${returned.version || "(service did not return a version number)"}.`,
  );
  state.agentName = returned.name;
  state.version = returned.version;
  state.draft = returned.draft;

  try {
    setPublishStep("verify", "running", "Reading the published version back from Foundry…");
    const readbackPath = returned.version
      ? `/agents/${encodeURIComponent(returned.name)}/versions/${encodeURIComponent(returned.version)}`
      : `/agents/${encodeURIComponent(returned.name)}`;
    const readback = await serviceRequest(
      serviceUrl(readbackPath),
      {},
      { draft: false },
    );
    const readbackResource = readback?.name
      ? readback
      : { name: returned.name, versions: { latest: readback } };
    const agent = extractLatestAgent(readbackResource);
    const expectedVersion = returned.version;
    state.definition = agent.definition;
    state.agentName = agent.name;
    state.version = agent.version || expectedVersion;
    state.draft = agent.draft;
    state.sourceDescription = agent.description;
    state.sourceMetadata = agent.metadata;
    state.sourceSnapshot = deepClone(agent.definition);
    state.cleanSnapshot = stableJson(agent.definition, 0);
    state.remoteSource = true;
    state.history = [];
    state.future = [];
    state.serverProblems = [];
    state.publishing = false;
    const authoringUrl = new URL(window.location.href);
    authoringUrl.searchParams.set("agent", agent.name);
    window.history.replaceState(null, "", authoringUrl);
    const mismatch = expectedVersion && agent.version && expectedVersion !== agent.version;
    setPublishStep(
      "verify",
      "complete",
      mismatch
        ? `Readback latest is ${agent.version}; the publish response returned ${expectedVersion}.`
        : `Verified ${agent.name}, version ${agent.version || expectedVersion || "(not returned)"}.`,
    );
    setMessage(
      `Published Agent ${agent.name}, version ${expectedVersion || agent.version || "(not returned)"}.`,
      mismatch
        ? `Readback latest is version ${agent.version}, not returned version ${expectedVersion}. Review concurrent publication activity.`
        : "",
    );
    render();
    return { name: agent.name, version: agent.version || expectedVersion, draft: agent.draft };
  } catch (error) {
    state.publishing = false;
    setPublishStep("verify", "failed", error.message);
    finishPublishProgress(
      "The version was published, but verification failed.",
      `${error.message} The working copy remains marked unsaved.`,
    );
    setMessage(
      `Published Agent ${returned.name}, version ${returned.version || "(not returned)"}, but readback could not be verified.`,
      `${error.message} The working copy remains unsaved so it is not mistaken for verified server state.`,
    );
    render();
    return null;
  }
}

function openAgentInDemo(agentName, { startSession = false } = {}) {
  if (!agentName) return;
  if (startSession) {
    try {
      // A one-shot, same-tab request must not turn shared Agent URLs into auto-start links.
      window.sessionStorage.setItem("voice-agent-editor-run", agentName);
    } catch (error) {
      setMessage("Could not prepare the Runtime session.", error.message);
      if (!$("#publish-progress").hidden) {
        setPublishStep("open", "failed", error.message);
        finishPublishProgress("Could not start Runtime.", error.message);
      }
      return;
    }
  }
  window.location.assign(`/runtime/?agent=${encodeURIComponent(agentName)}&view=handoff`);
}

const AUTO_AGENT_NAME_KEY = "voice-agent-editor-auto-name";
const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
let agentNameResolve = null;
// The automatic name offered when the dialog opened, and what the user typed before choosing it.
let agentNameAutomatic = "";
let agentNameTyped = "";

function autoAgentNameEnabled() {
  try {
    return window.sessionStorage.getItem(AUTO_AGENT_NAME_KEY) === "1";
  } catch {
    return false;
  }
}

function agentNameProblem(name) {
  if (!name) return "Enter a name for the Agent.";
  if (!AGENT_NAME_PATTERN.test(name)) {
    return "Use up to 63 letters, numbers, dots, hyphens or underscores, starting with a letter or number.";
  }
  // The hosted Playground reserves pg- for its per-user Agent prefix.
  if (state.cfg?.playground && /^pg-/i.test(name)) return "Names cannot start with pg-.";
  return "";
}

function existingAgentNamed(name) {
  return (state.agents || []).some((agent) =>
    agent.name === name || agent.name.replace(/^pg-[0-9a-f]+-/, "") === name);
}

function updateAgentNameHint() {
  if ($("#agent-name-auto").checked) {
    $("#agent-name-hint").textContent = "";
    $("#agent-name-hint").classList.remove("error");
    $("#confirm-agent-name").disabled = false;
    return;
  }
  const name = $("#agent-name-input").value.trim();
  const problem = agentNameProblem(name);
  const hint = $("#agent-name-hint");
  hint.textContent = problem || (existingAgentNamed(name)
    ? `You already have an Agent named ${name}. Publishing adds a new version to it.`
    : "");
  hint.classList.toggle("error", Boolean(problem));
  $("#confirm-agent-name").disabled = Boolean(problem);
}

// Resolves with the chosen name, or null when the user cancels.
function requestAgentName() {
  return new Promise((resolve) => {
    agentNameResolve = resolve;
    const input = $("#agent-name-input");
    agentNameAutomatic = state.agentName;
    agentNameTyped = state.agentName;
    input.value = state.agentName;
    input.disabled = false;
    $("#agent-name-auto").checked = false;
    updateAgentNameHint();
    $("#agent-name-dialog").hidden = false;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

function closeAgentNameDialog(name = null) {
  if ($("#agent-name-dialog").hidden) return;
  $("#agent-name-dialog").hidden = true;
  const resolve = agentNameResolve;
  agentNameResolve = null;
  resolve?.(name);
}

// Automatic naming shows the generated name, greyed out, instead of the editable one.
function toggleAutomaticAgentName() {
  const input = $("#agent-name-input");
  if ($("#agent-name-auto").checked) {
    agentNameTyped = input.value;
    input.value = agentNameAutomatic;
    input.disabled = true;
  } else {
    input.value = agentNameTyped;
    input.disabled = false;
    input.focus();
  }
  updateAgentNameHint();
}

function submitAgentName(event) {
  event.preventDefault();
  const automatic = $("#agent-name-auto").checked;
  const name = automatic ? agentNameAutomatic : $("#agent-name-input").value.trim();
  if (!automatic && agentNameProblem(name)) {
    updateAgentNameHint();
    return;
  }
  if (automatic) {
    try {
      window.sessionStorage.setItem(AUTO_AGENT_NAME_KEY, "1");
    } catch {
      // Without session storage the dialog simply asks again next time.
    }
  }
  closeAgentNameDialog(name);
}

async function publishAndRun() {
  if (!state.definition || state.publishing || !$("#agent-name-dialog").hidden) return;
  const startSession = state.remoteSource;
  if (startSession && !state.draft && !isDirty()) {
    openAgentInDemo(state.agentName, { startSession: true });
    return;
  }
  // A new working copy becomes a new Agent, so let the user name it first.
  if (!state.remoteSource && !autoAgentNameEnabled()) {
    const name = await requestAgentName();
    if (!name) return;
    if (name !== state.agentName) {
      state.agentName = name;
      render();
    }
  }
  openPublishProgress();
  const published = await publishDefinition();
  if (!published) return;
  setPublishStep("open", "running", "Opening the published Agent in Runtime…");
  setMessage(
    `Published Agent ${published.name}, version ${published.version || "(not returned)"}.`,
    "Opening the published release with its runtime graph expanded…",
  );
  setPublishStep(
    "open",
    "complete",
    `Opening ${published.name}, version ${published.version || "(not returned)"}.`,
  );
  $("#publish-progress-summary").textContent = "Publication complete. Opening Runtime…";
  await new Promise((resolve) => window.setTimeout(resolve, 900));
  openAgentInDemo(published.name, { startSession });
}

const PLAYGROUND_WELCOME_KEY = "voice-agent-playground-welcome-v1";

function showPlaygroundWelcome() {
  try {
    if (window.sessionStorage.getItem(PLAYGROUND_WELCOME_KEY) === "dismissed") return;
  } catch (error) {
    console.warn("Could not read the playground welcome preference.", error);
  }
  $("#playground-welcome-dialog").showModal();
}

function bindEvents() {
  bindFieldHelp();
  $("#playground-welcome-dialog").addEventListener("close", () => {
    try {
      window.sessionStorage.setItem(PLAYGROUND_WELCOME_KEY, "dismissed");
    } catch (error) {
      console.warn("Could not save the playground welcome preference.", error);
    }
    $("#create-blank-action").focus({ preventScroll: true });
  });
  $("#retry-voice-catalog").addEventListener("click", () => void refreshVoiceCatalog(true));
  let canvasSize = null;
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (canvasSize && state.definition) {
      state.camera.x += (width - canvasSize.width) / 2;
      state.camera.y += (height - canvasSize.height) / 2;
      applyCamera();
    }
    canvasSize = { width, height };
  }).observe($("#canvas"));
  $("#refresh-agents").addEventListener("click", () => loadAgentList({ force: true, announce: true }));
  $("#load-more-agents").addEventListener("click", loadMoreAgents);
  $("#agent-search").addEventListener("focus", ensureAgentListLoaded);
  $("#agent-search").addEventListener("input", renderAgentOptions);
  $("#agent-select").addEventListener("pointerdown", ensureAgentListLoaded);
  $("#agent-select").addEventListener("click", (event) => {
    const option = event.target.closest("[data-agent-name]");
    if (!option) return;
    selectAgentOption(option.dataset.agentName);
    void loadSelectedAgent();
  });
  $("#agent-select").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void loadSelectedAgent();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = $$("[data-agent-name]", $("#agent-select"));
    if (!options.length) return;
    event.preventDefault();
    const current = options.findIndex((option) => option.dataset.agentName === state.selectedAgentName);
    const index = event.key === "Home" ? 0
      : event.key === "End" ? options.length - 1
        : Math.max(0, Math.min(options.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
    selectAgentOption(options[index].dataset.agentName, { focus: true });
    options[index].scrollIntoView({ block: "nearest" });
  });
  $("#create-blank-action").addEventListener("click", loadBlank);
  $$("[data-agent-import]").forEach((button) => button.addEventListener("click", openAgentImport));
  $("#close-agent-import").addEventListener("click", closeAgentImport);
  $("#agent-import-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAgentImport();
  });
  $("#agent-import-file").addEventListener("change", readAgentImportFile);
  $("#agent-import-source").addEventListener("input", () => {
    state.importGeneration += 1;
    state.importFileName = "";
    invalidateAgentImport();
  });
  $("#validate-agent-import").addEventListener("click", validateAgentImport);
  $("#apply-agent-import").addEventListener("click", applyAgentImport);
  $("#template-action").addEventListener("click", openTemplatePicker);
  $("#open-tool-connections").addEventListener("click", openToolConnections);
  $("#close-tool-connections").addEventListener("click", closeToolConnections);
  $("#tool-connections-done").addEventListener("click", finishToolConnections);
  $("#tool-connections-back").addEventListener("click", backToToolConnections);
  $("#tool-connection-groups").addEventListener("click", (event) => void handleToolAction(event));
  $("#tool-connection-groups").addEventListener("input", handleToolInput);
  $("#tool-connection-groups").addEventListener("change", handleToolInput);
  $("#tool-connection-groups").addEventListener("keydown", (event) => {
    const url = event.target.closest("[data-tool-url]");
    if (url && event.key === "Enter") {
      event.preventDefault();
      $(`[data-tool-action="discover"][data-group="${CSS.escape(url.dataset.toolUrl)}"]`)?.click();
    }
  });
  $("#publish-run-action").addEventListener("click", publishAndRun);
  $("#agent-name-form").addEventListener("submit", submitAgentName);
  $("#agent-name-input").addEventListener("input", updateAgentNameHint);
  $("#agent-name-auto").addEventListener("change", toggleAutomaticAgentName);
  $("#close-agent-name-dialog").addEventListener("click", () => closeAgentNameDialog());
  $("#cancel-agent-name").addEventListener("click", () => closeAgentNameDialog());
  $("#agent-name-dialog").addEventListener("click", (event) => {
    if (event.target === $("#agent-name-dialog")) closeAgentNameDialog();
  });
  $("#close-publish-progress").addEventListener("click", closePublishProgress);
  $("#publish-progress-done").addEventListener("click", closePublishProgress);
  $("#close-node-mcp-dialog").addEventListener("click", closeNodeMcpDialog);
  $("#node-mcp-dialog").addEventListener("click", (event) => {
    if (event.target === $("#node-mcp-dialog")) closeNodeMcpDialog();
  });
  $("#close-template-picker").addEventListener("click", closeTemplatePicker);
  $("#reload-template-picker").addEventListener("click", () => loadTemplateCatalog({ force: true }));
  $$("[data-template-grouping]").forEach((button) => {
    button.addEventListener("click", () => {
      rememberTemplateGroupExpansion();
      state.templateGrouping = button.dataset.templateGrouping;
      renderTemplateCatalog();
      $("#template-picker-grid").scrollTop = 0;
    });
  });
  $("#template-picker-search").addEventListener("input", (event) => {
    rememberTemplateGroupExpansion();
    state.templateQuery = event.target.value;
    renderTemplateCatalog();
    $("#template-picker-grid").scrollTop = 0;
  });
  $("#template-picker").addEventListener("click", (event) => {
    if (event.target === $("#template-picker")) closeTemplatePicker();
  });
  $("#nodes-tab").addEventListener("click", () => {
    state.outlineTab = "nodes";
    renderOutline();
  });
  $("#edges-tab").addEventListener("click", () => {
    state.outlineTab = "edges";
    renderOutline();
  });
  $("#add-node").addEventListener("click", addNode);
  $("#add-node-canvas").addEventListener("click", addNode);
  $("#add-edge").addEventListener("click", addEdge);
  $("#undo-action").addEventListener("click", undo);
  $("#redo-action").addEventListener("click", redo);
  $("#zoom-out").addEventListener("click", () => zoomBy(-.1));
  $("#zoom-in").addEventListener("click", () => zoomBy(.1));
  $("#fit-action").addEventListener("click", fitGraph);
  $("#layout-action").addEventListener("click", () => {
    autoLayout({ announce: true });
    renderGraph();
  });
  $$("[data-agent-yaml]").forEach((button) => button.addEventListener("click", openAgentYaml));
  $("#close-definition").addEventListener("click", closeDefinition);
  $$(".definition-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      state.format = button.dataset.format;
      renderDefinition();
    });
  });
  $("#close-node-editor").addEventListener("click", () => cancelEditorSession("node"));
  $("#done-node-editor").addEventListener("click", () => commitEditorSession("node"));
  $("#delete-node-editor").addEventListener("click", confirmDeleteSelectedNode);
  $("#close-component-panel").addEventListener("click", closeNodeComponentPanel);
  $("#close-edge-editor").addEventListener("click", () => cancelEditorSession("edge"));
  $("#done-edge-editor").addEventListener("click", () => commitEditorSession("edge"));
  $("#delete-edge-editor").addEventListener("click", () => confirmDeleteEdgeById(state.selected.id));
  $("#edge-editor").addEventListener("click", (event) => {
    if (event.target === $("#edge-editor")) cancelEditorSession("edge");
  });
  $("#edge-editor-title").addEventListener("dblclick", (event) => {
    event.preventDefault();
    beginEdgeTitleEdit();
  });
  $("#edge-editor-title").addEventListener("keydown", (event) => {
    if ($("#edge-editor-title").isContentEditable) return;
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      beginEdgeTitleEdit();
    }
  });

  const canvas = $("#canvas");
  canvas.addEventListener("click", (event) => {
    if (event.target === canvas || event.target.classList.contains("canvas-grid")) {
      state.selected = { kind: "graph", id: "" };
      render();
    }
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomBy(event.deltaY < 0 ? .08 : -.08, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }, { passive: false });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".node-card") || event.target.closest(".edge-group")) return;
    state.panning = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: state.camera.x,
      y: state.camera.y,
    };
    canvas.setPointerCapture?.(event.pointerId);
  });
  window.addEventListener("pointermove", (event) => {
    updateEdgeConnection(event);
    if (state.dragging && state.dragging.pointerId === event.pointerId) {
      const dx = (event.clientX - state.dragging.startX) / state.camera.scale;
      const dy = (event.clientY - state.dragging.startY) / state.camera.scale;
      if (Math.abs(dx) + Math.abs(dy) > 2) state.dragging.moved = true;
      const position = { x: state.dragging.x + dx, y: state.dragging.y + dy };
      state.positions.set(state.dragging.id, position);
      state.dragging.card.style.left = `${position.x}px`;
      state.dragging.card.style.top = `${position.y}px`;
      renderEdgesOnly();
    }
    if (state.panning && state.panning.pointerId === event.pointerId) {
      state.camera.x = state.panning.x + event.clientX - state.panning.startX;
      state.camera.y = state.panning.y + event.clientY - state.panning.startY;
      applyCamera();
    }
  });
  window.addEventListener("pointerup", (event) => {
    finishEdgeConnection(event);
    if (state.dragging?.pointerId === event.pointerId) {
      const { id, moved } = state.dragging;
      state.dragging = null;
      if (!moved) focusNodeAndOpen(id);
    }
    if (state.panning?.pointerId === event.pointerId) state.panning = null;
  });
  window.addEventListener("keydown", (event) => {
    if ($("#playground-welcome-dialog").open) return;
    if ($("#agent-import-dialog").open) return;
    // The naming dialog is modal: graph shortcuts must not edit the canvas behind it.
    if (!$("#agent-name-dialog").hidden && event.key !== "Escape") return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    if (
      !event.repeat
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && (event.key === "Delete" || event.key === "Backspace")
      && !isTextEditingTarget(event.target)
      && confirmDeleteSelectedGraphObject()
    ) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      if (!$("#agent-name-dialog").hidden) {
        closeAgentNameDialog();
        return;
      }
      if (!$("#node-mcp-dialog").hidden) {
        closeNodeMcpDialog();
        return;
      }
      if (!$("#template-picker").hidden) {
        closeTemplatePicker();
        return;
      }
      if (!$("#tool-connections").hidden) {
        closeToolConnections();
        return;
      }
      if (!$("#definition-drawer").hidden) {
        closeDefinition();
        return;
      }
      if (!$("#node-component-panel").hidden) {
        closeNodeComponentPanel();
        return;
      }
      if (!$("#node-editor").hidden) {
        cancelEditorSession("node");
        return;
      }
      if (!$("#edge-editor").hidden) {
        cancelEditorSession("edge");
        return;
      }
      closeDefinition();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function renderEdgesOnly() {
  for (const group of $$(".edge-group", $("#edge-transform"))) {
    const edge = state.definition.handoff.edges.find((item) => item.id === group.dataset.edge);
    const path = edge && edgePath(edge);
    $$("path", group).forEach((element) => element.setAttribute("d", path || ""));
  }
}

async function start() {
  bindEvents();
  render();
  showPlaygroundWelcome();
  try {
    await loadConfig();
    const requested = new URLSearchParams(window.location.search).get("agent");
    if (requested) {
      state.agents = [{ name: requested, version: "", createdAt: Date.now() }];
      state.selectedAgentName = requested;
      renderAgentOptions();
      await loadAgentByName(requested);
      void loadAgentList({ announce: false });
    } else {
      void loadAgentList({ announce: true });
    }
  } catch (error) {
    state.agentListError = error.message;
    renderAgentLoadState();
    setMessage(
      "Foundry configuration could not be loaded. You can still create a new local Agent.",
      error.message,
    );
    render();
  }
}

start();
