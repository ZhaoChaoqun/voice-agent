import { DEFAULTS, PROMPTS, MODELS, GPT_LIVE_METER, supportsScenario, getRates, calculate } from "./calculator.mjs";

const $ = id => document.getElementById(id);
const form = $("assumptions");
const money = value => value === null ? "Needs rate" : `$${value.toFixed(6)}`;
const volumeMoney = value => value === null ? "Needs rate" :
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const labels = {
  textInput: "Text input", textCached: "Cached text input", textOutput: "Text output",
  audioInput: "Native audio input", audioCached: "Cached native audio", audioOutput: "Native audio output",
  speechInput: "Azure STT input", speechOutput: "Azure HD output", liveMinute: "GPT Live session ($/min)",
};
const pipelines = {
  native: "Native speech-to-speech", hybrid: "Realtime text + Azure HD",
  cascade: "Azure STT + LLM + Azure HD", live: "GPT Live + reasoning",
};
const overrides = new Map();
let snapshot;
let exportedRows = [];
let selectedKey = "";

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function assumptions() {
  const a = {};
  for (const key of Object.keys(DEFAULTS)) {
    const input = form.elements.namedItem(key);
    if (input.value.trim() === "" || !input.validity.valid) throw new Error(`Enter a valid value for ${input.labels[0].textContent.trim()}.`);
    a[key] = Number(input.value);
  }
  return a;
}

function effectiveHosting(pipeline) {
  return pipeline === "live" ? "byom" : $("hosting").value;
}

function rateKey(model, pipeline) {
  return `${pipeline === "live" ? "live" : "voice"}:${effectiveHosting(pipeline)}:${model.id}`;
}

function modelRates(model, pipeline) {
  const book = getRates(snapshot, model, effectiveHosting(pipeline), pipeline);
  return { ...book, rates: { ...book.rates, ...overrides.get(rateKey(model, pipeline)) } };
}

function populateModels(preferred) {
  const pipeline = $("pipeline").value;
  const available = MODELS.filter(m => supportsScenario(m, effectiveHosting(pipeline), pipeline));
  $("model").replaceChildren(...available.map(m => {
    const option = element("option", m.name);
    option.value = m.id;
    return option;
  }));
  $("model").value = available.some(m => m.id === preferred) ? preferred :
    pipeline === "live" ? "gpt-6-sol" : available[0].id;
}

function fillDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) form.elements.namedItem(key).value = value;
}

function showError(error) {
  $("error").textContent = error.message;
  $("error").hidden = false;
  $("results").hidden = true;
  $("export").disabled = true;
}

function rateEditor(model, pipeline, book) {
  selectedKey = rateKey(model, pipeline);
  const fields = ["textInput", "textCached", "textOutput"];
  if (["native", "hybrid"].includes(pipeline)) fields.push("audioInput", "audioCached");
  if (pipeline === "native") fields.push("audioOutput");
  if (pipeline === "cascade") fields.push("speechInput");
  if (["hybrid", "cascade"].includes(pipeline)) fields.push("speechOutput");
  if (pipeline === "live") fields.push("liveMinute");
  const edited = overrides.get(selectedKey) || {};
  $("rates").replaceChildren(...fields.map(key => {
    const label = element("label", labels[key]);
    const input = element("input");
    input.type = "number";
    input.min = "0";
    input.step = "any";
    input.dataset.rate = key;
    input.value = book.rates[key] ?? "";
    input.placeholder = "Enter list price";
    const source = book.sources[key];
    const state = Object.hasOwn(edited, key) ? "User-supplied / edited" :
      book.rates[key] === null ? "Unverified - manual rate required" :
      source?.armRegionName === "centralindia" ? `${key === "speechOutput" ? "Azure HD" : "Voice Live"} / Central India reference` :
      source?.processingScope === "Global" ? "Azure OpenAI / South India Global reference" : "Azure retail snapshot / South India";
    label.append(input, element("small", state, "rate-status"));
    return label;
  }));
  $("evidence").replaceChildren(...book.evidence.map(name => {
    const meter = snapshot.meters.find(m => m.meterName === name);
    return element("li", `${name}: $${meter.retailPrice} / ${meter.unitOfMeasure}; region ${meter.armRegionName || snapshot.region}${meter.processingScope ? ` / ${meter.processingScope}` : ""}; meter ${meter.meterId}`);
  }));
  const hosting = effectiveHosting(pipeline);
  $("price-note").textContent = hosting === "managed" ?
    "Managed models with a published tier use Central India Voice Live tier references because no South India tier meters were found. Azure HD also uses Central India standard-speech output. All token fields below are USD per 1M." :
    "BYOM uses Azure OpenAI South India Global model prices plus Central India BYO speech input/output references; no South India Voice Live BYO meters were found. Azure HD remains Central India as requested. GPT-6 is explicitly GPT-6 Sol, short-context Standard pricing. Global processing does not guarantee India-only inference or deployment availability. All token fields below are USD per 1M.";
  if (book.usesGlobalReference) {
    $("price-note").textContent = "No published managed Voice Live tier was found for this model. This is an AOAI Global model-price reference plus Central India BYO speech, not a confirmed managed Voice Live tariff or availability claim. Published model rates use South India Global meters; missing inference prices remain manual. All token fields below are USD per 1M.";
  }
  if (pipeline === "live") $("price-note").textContent += " GPT Live uses Azure OpenAI's South India Global voice rate: $3/hour = $0.05/minute in this snapshot. Backend model usage is charged separately. GPT Live generates its own audio, so no Azure HD charge is added.";
  if (model.oss && (hosting === "byom" || book.usesGlobalReference)) $("price-note").textContent += " No OSS cached-input meter was found; reused text is conservatively charged at full input price.";
  if (model.managedPipeline) {
    $("price-note").textContent += ` ${model.name} uses native audio input/output billing; no separate Azure STT, HD voice, or GPT Live session charge is added.`;
    $("price-note").textContent += " Audio token rates remain editable assumptions, not verified Azure Realtime tokenization.";
  }
  if (model.tierAssumption) $("price-note").textContent += " Azure Realtime Fast uses the user-specified Voice Live Lite tier reference, not a verified published Fast tariff.";
}

function renderOverview(a, model, pipeline, result, book) {
  $("scenario").textContent = `${model.name} / ${pipelines[pipeline]}`;
  $("list-call").textContent = money(result.list);
  $("list-minute").textContent = money(result.listPerMinute);
  $("volume-list").textContent = volumeMoney(result.list === null ? null : result.list * a.calls);
  $("volume-note").textContent = `${a.calls.toLocaleString("en-US")} calls / ${(a.calls * a.duration / 60).toLocaleString("en-US")} minutes`;
  const badge = $("estimate-badge");
  badge.textContent = result.list === null ? "Missing rates" :
    model.tierAssumption ? "Lite-tier assumption" :
    book.usesGlobalReference ? "AOAI Global reference" : "List-price estimate";
  badge.className = `badge${result.list === null ? "" : " good"}`;
  $("summary").textContent = result.missing.length ?
    `List estimate needs: ${result.missing.map(key => labels[key]).join(", ")}. Enter missing values in the price book below.` :
    `${result.inputAudio.toLocaleString("en-US")} fresh caller audio tokens / ${result.outputAudio.toLocaleString("en-US")} generated speech tokens / ${a.turns} user + ${a.turns} agent turns. Audio usage includes ${a.silencePercent}% silence reduction; text and session minutes are unchanged.`;
  $("model-note").textContent = pipeline === "live" ?
    "Backend model + GPT Live voice use Azure OpenAI South India Global references ($0.05/minute for voice). Availability must be confirmed." :
    book.usesGlobalReference ?
    "Managed tariff unavailable: showing an AOAI Global model-price + Central India BYO speech reference instead. This does not establish managed model support." :
    `Economic scenario only. ${$("hosting").value === "managed" ? `Central India managed-tier reference: ${model.tier || "unverified"}.` : "Model rates: South India Global. STT: Central India BYO reference."} Azure HD: Central India. Confirm model and transport availability.`;
  if (model.managedPipeline) {
    $("model-note").textContent = `${model.tierAssumption ? "User-specified Lite-tier reference, not a verified published Azure Realtime Fast tariff." : "Central India Voice Live Pro tier reference."} Native audio input/output billing; no separate STT/HD charge. Confirm regional availability and actual audio token rates.`;
  }
}

function renderChart(a, pipeline, rates) {
  const metric = $("metric").value;
  const results = PROMPTS.map(prompt => ({ prompt, result: calculate({ ...a, prompt }, pipeline, rates) }));
  const max = Math.max(...results.map(r => r.result[metric] ?? 0), 0.000001);
  $("prompt-chart").replaceChildren(...results.map(({ prompt, result }) => {
    const row = element("div", undefined, "bar-row");
    const track = element("div", undefined, "bar-track");
    const bar = element("div", undefined, "bar");
    bar.style.width = `${(result[metric] ?? 0) / max * 100}%`;
    if (result[metric] === null) bar.style.display = "none";
    track.append(bar);
    row.append(element("span", `${prompt.toLocaleString("en-US")} tokens`), track, element("strong", money(result[metric])));
    return row;
  }));
}

function scenarios() {
  const defs = [{ model: MODELS.find(m => m.id === "gpt-6-sol"), pipeline: "live" }];
  for (const model of MODELS) {
    if (model.realtime) {
      defs.push({ model, pipeline: "native" }, { model, pipeline: "hybrid" });
    } else if (model.id !== "gpt-6-sol") {
      defs.push({ model, pipeline: "cascade" });
    }
  }
  const currentModel = MODELS.find(m => m.id === $("model").value);
  const currentPipeline = $("pipeline").value;
  if (!defs.some(s => s.model.id === currentModel.id && s.pipeline === currentPipeline)) {
    defs.unshift({ model: currentModel, pipeline: currentPipeline });
  }
  return defs.filter(({ model, pipeline }) => supportsScenario(model, effectiveHosting(pipeline), pipeline));
}

function renderComparison(a) {
  const heading = element("tr");
  heading.append(element("th", "Pipeline / model"), ...PROMPTS.map(p => element("th", `${p.toLocaleString("en-US")} tokens`)));
  $("comparison").tHead.replaceChildren(heading);
  exportedRows = [];
  const body = scenarios().map(({ model, pipeline }) => {
    const { rates, sources, usesGlobalReference } = modelRates(model, pipeline);
    const modelMeter = sources.textInput || sources.audioInput;
    const liveMeter = pipeline === "live" ? snapshot.meters.find(m => m.meterName === GPT_LIVE_METER) : null;
    const row = element("tr");
    const title = element("td", model.name);
    title.append(element("small", `${pipelines[pipeline]} / ${model.tierAssumption ? "USER-SPECIFIED LITE TIER REFERENCE" : usesGlobalReference ? "AOAI GLOBAL REFERENCE (managed tariff unavailable)" : effectiveHosting(pipeline).toUpperCase()}${modelMeter?.armRegionName === "southindia" ? " / model: South India Global reference" : ""}${liveMeter ? " / voice: South India Global reference" : ""}`));
    row.append(title);
    for (const prompt of PROMPTS) {
      const result = calculate({ ...a, prompt }, pipeline, rates);
      const cell = element("td", money(result.listPerMinute), result.listPerMinute === null ? "missing" : "");
      cell.title = result.missing.length ? `Missing list rates: ${result.missing.map(k => labels[k]).join(", ")}` :
        `List price: ${money(result.list)}/call; ${money(result.listPerMinute)}/minute`;
      row.append(cell);
      exportedRows.push({
        model: model.id, pipeline, hosting: effectiveHosting(pipeline), region: snapshot.region,
        pricing_basis: model.tierAssumption ? "user-specified-voice-live-lite-reference" :
          usesGlobalReference ? "aoai-global-model-plus-byo-speech-reference" :
          effectiveHosting(pipeline) === "managed" ? "voice-live-tier-reference" : "byom",
        prompt_tokens: prompt, silence_percent: a.silencePercent, list_per_call: result.list,
        list_per_minute: result.listPerMinute, missing_list_rates: result.missing.join("; "),
        price_snapshot: snapshot.retrievedAt,
        model_rate_region: modelMeter ? modelMeter.armRegionName || snapshot.region : "",
        model_rate_scope: modelMeter?.processingScope || "",
        model_rate_meter: modelMeter?.meterId || "",
        speech_input_region: pipeline === "cascade" ? sources.speechInput?.armRegionName || "" : "",
        speech_input_meter: pipeline === "cascade" ? sources.speechInput?.meterId || "" : "",
        hd_voice_region: ["hybrid", "cascade"].includes(pipeline) ? sources.speechOutput?.armRegionName || "" : "",
        hd_voice_meter: ["hybrid", "cascade"].includes(pipeline) ? sources.speechOutput?.meterId || "" : "",
        live_session_region: liveMeter?.armRegionName || "",
        live_session_scope: liveMeter?.processingScope || "",
        live_session_meter: liveMeter?.meterId || "",
        live_session_per_minute: pipeline === "live" ? rates.liveMinute : null,
        rate_overrides: JSON.stringify(overrides.get(rateKey(model, pipeline)) || {}),
        assumptions: JSON.stringify({ ...a, prompt }),
      });
    }
    return row;
  });
  $("comparison").tBodies[0].replaceChildren(...body);
}

function renderBreakdown(result) {
  $("breakdown").tBodies[0].replaceChildren(...result.rows.map(r => {
    const row = element("tr");
    row.append(element("td", r.label),
      element("td", `${r.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })}${r.unit === "minutes" ? " min" : ""}`),
      element("td", r.rate === null ? "Needs rate" : `$${r.rate}`),
      element("td", money(r.list)));
    return row;
  }));
}

function update(rebuildRates = false) {
  try {
    const a = assumptions();
    const model = MODELS.find(m => m.id === $("model").value);
    const pipeline = $("pipeline").value;
    const book = modelRates(model, pipeline);
    if (rebuildRates || selectedKey !== rateKey(model, pipeline)) rateEditor(model, pipeline, book);
    for (const input of $("rates").querySelectorAll("input")) {
      if (!input.validity.valid) throw new Error(`Enter a non-negative price for ${labels[input.dataset.rate]}, or leave it blank for unknown.`);
    }
    const result = calculate(a, pipeline, book.rates);
    renderOverview(a, model, pipeline, result, book);
    renderChart(a, pipeline, book.rates);
    renderComparison(a);
    renderBreakdown(result);
    $("error").hidden = true;
    $("results").hidden = false;
    $("export").disabled = false;
  } catch (error) {
    showError(error);
  }
}

form.addEventListener("submit", event => event.preventDefault());
form.addEventListener("input", event => {
  if (event.target.tagName === "SELECT") return;
  update();
});
$("hosting").addEventListener("change", () => {
  populateModels($("model").value);
  update(true);
});
$("pipeline").addEventListener("change", () => {
  populateModels($("model").value);
  update(true);
});
$("model").addEventListener("change", () => update(true));
$("metric").addEventListener("change", () => update());
$("rates").addEventListener("input", event => {
  const input = event.target;
  if (!input.dataset.rate) return;
  if (!input.validity.valid) {
    showError(new Error(`Enter a non-negative price for ${labels[input.dataset.rate]}, or leave it blank for unknown.`));
    return;
  }
  const values = { ...overrides.get(selectedKey), [input.dataset.rate]: input.value.trim() === "" ? null : Number(input.value) };
  overrides.set(selectedKey, values);
  input.parentElement.querySelector(".rate-status").textContent = "User-supplied / edited";
  update();
});
$("reset").addEventListener("click", () => {
  fillDefaults();
  overrides.clear();
  $("hosting").value = "managed";
  $("pipeline").value = "native";
  $("metric").value = "list";
  populateModels();
  update(true);
});
$("export").addEventListener("click", () => {
  if ($("results").hidden || !exportedRows.length) return;
  const columns = Object.keys(exportedRows[0]);
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [columns, ...exportedRows.map(row => columns.map(c => row[c]))].map(row => row.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = element("a");
  link.href = url;
  link.download = "voice-agent-costs-southindia.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

fillDefaults();
populateModels();
try {
  const response = await fetch("./prices.json");
  if (!response.ok) throw new Error(`Price snapshot could not be loaded (HTTP ${response.status}).`);
  snapshot = await response.json();
  if (snapshot.region !== "southindia" || snapshot.currency !== "USD" || !Array.isArray(snapshot.meters)) {
    throw new Error("Price snapshot must contain South India USD reference prices.");
  }
  $("snapshot-date").textContent = `Price snapshot / ${snapshot.retrievedAt}`;
  update(true);
} catch (error) {
  showError(new Error(`Calculator could not start: ${error.message} Serve this directory over HTTP, not file://.`));
}
