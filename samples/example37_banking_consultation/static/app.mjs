import { translations } from "./i18n.mjs";
import { VoiceAudio } from "./audio.mjs";
import { chooseModel, chooseVoice, readPreferences, savePreferences, updateTranscript } from "./state.mjs";

const $ = id => document.getElementById(id);
let config;
let choice;
let language = "de";
let scenario = "overdraft";
let active = false;
let ready = false;
let view = "home";
let captions = true;
let muted = false;
let status = "idle";
let socket;
let audio;
let attempt = 0;
let timeout;
let callChoice;
let responseId;
let ignoredResponse;
let failure;
const messages = new Map();
const text = () => translations[language];

function renderMessages() {
  const scroll = $("screen");
  const follow = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
  $("messages").replaceChildren(...[...messages.values()].map(message => {
    const row = document.createElement("article");
    row.className = `message ${message.role}`;
    const label = document.createElement("small");
    label.textContent = message.role === "user" ? text().you : "Nora";
    const content = document.createElement("p");
    content.textContent = message.text;
    row.append(label, content);
    return row;
  }));
  $("empty").hidden = messages.size > 0;
  if (view !== "home" && captions && follow) scroll.scrollTop = scroll.scrollHeight;
}

function render() {
  const t = text();
  document.documentElement.lang = t.lang;
  document.title = t.title;
  const fields = {
    tagline: "tagline", "model-label": "model", "voice-label": "voice", "language-label": "language",
    headline: "headline", introduction: "introduction", "assistant-name": "assistant",
    "topics-heading": "topics", "overdraft-title": "overdraft", "overdraft-detail": "overdraftDetail",
    "investing-title": "investing", "investing-detail": "investingDetail",
    "conversation-heading": "conversation", original: "original", empty: "empty",
    privacy: "privacy", "back-home": "home", history: "history", captions: "captions",
    "close-info": "close", "info-title": "infoTitle", "info-body": "infoBody",
    "products-title": "productsTitle", products: "products", profile: "profile",
    risk: "risk", processing: "processing", "offline-info": "offlineInfo",
    "storage-warning": "storage",
  };
  for (const [id, key] of Object.entries(fields)) $(id).textContent = t[key];
  $("about").setAttribute("aria-label", t.about);
  document.querySelector(".choices").setAttribute("aria-label", t.settings);
  $("phone").dataset.active = String(active);
  $("model-select").disabled = $("voice-select").disabled = $("language-select").disabled = active || !config;
  $("selection-help").textContent = active ? t.locked : t.selection;
  $("home").hidden = view !== "home";
  $("chat").hidden = view === "home";
  $("messages").hidden = !captions;
  $("empty").hidden = !captions || messages.size > 0;
  $("back-home").hidden = active || view === "home";
  $("history").disabled = active || messages.size === 0;
  $("captions").disabled = view === "home";
  $("captions").setAttribute("aria-pressed", String(captions));
  $("mute").disabled = !ready || config?.mode === "demo";
  $("mute").setAttribute("aria-pressed", String(muted));
  $("mute").textContent = muted ? t.unmute : t.mute;
  $("start").disabled = !config;
  $("start").textContent = active ? (ready ? t.stop : t.cancel) : config?.mode === "demo" ? t.preview : t.start;
  $("status").textContent = t[status];
  $("mode-badge").textContent = config?.mode === "demo" ? t.demo : t.cloud;
  $("error").hidden = !failure;
  if (failure) $("error").textContent = t.errors[failure] ?? t.errors.connection;
  if (choice) {
    $("model-select").value = choice.model;
    $("voice-select").value = choice.voice;
  }
  $("language-select").value = language;
  $("call-choice").textContent = callChoice ? `${callChoice.modelLabel} · ${callChoice.voiceLabel}` : "";
  for (const button of document.querySelectorAll("[data-scenario]")) {
    const selected = button.dataset.scenario === scenario;
    button.disabled = active;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  renderMessages();
}

function voiceOptions() {
  $("voice-select").replaceChildren(...config.models[choice.model].voices.map(voice => {
    const option = document.createElement("option");
    option.value = voice.id;
    option.textContent = voice.label;
    return option;
  }));
}

function save() {
  $("storage-warning").hidden = savePreferences(choice, language, config.models);
}

async function finish(code) {
  attempt++;
  clearTimeout(timeout);
  active = ready = muted = false;
  view = "home";
  status = "ended";
  failure = code;
  const currentSocket = socket;
  socket = null;
  if (currentSocket) {
    currentSocket.onmessage = currentSocket.onclose = currentSocket.onerror = null;
    currentSocket.close();
  }
  const currentAudio = audio;
  audio = null;
  render();
  $("screen").scrollTop = 0;
  if (currentAudio) {
    try { await currentAudio.close(); }
    catch (error) {
      console.error("Northstar demo audio cleanup failed:", error.name);
      failure = "playback";
      render();
    }
  }
}

function handle(event) {
  if (!event || typeof event.type !== "string") throw new TypeError("Invalid voice event.");
  if (event.type === "ready") {
    if (event.model !== callChoice.model || event.voice !== callChoice.voice || event.mode !== config.mode) {
      void finish("configuration");
      return;
    }
    clearTimeout(timeout);
    ready = true;
    view = "call";
    status = config.mode === "demo" ? "demoActive" : "listening";
  } else if (event.type === "error") {
    void finish(event.code);
    return;
  } else if (event.type === "transcript") {
    updateTranscript(messages, event);
  } else if (event.type === "turn_failed") {
    // One utterance or reply failed; keep the call open and say so in the captions.
    if (!["user", "assistant"].includes(event.role)) throw new TypeError("Invalid failed turn.");
    updateTranscript(messages, {
      role: event.role, id: event.id, final: true,
      text: event.role === "user" ? text().unheard : text().incompleteReply,
    });
    if (event.role === "assistant" && !audio?.nodes.size && !audio?.queue.length) status = "listening";
  } else if (event.type === "interrupt") {
    ignoredResponse = responseId;
    audio?.interrupt();
    status = "listening";
  } else if (event.type === "response") {
    responseId = event.id;
    status = "thinking";
  } else if (event.type === "audio") {
    if (!ready) throw new Error("Audio arrived before configuration confirmation.");
    if (!ignoredResponse || event.response_id !== ignoredResponse) {
      audio.play(event.pcm);
      status = "speaking";
    }
  } else if (event.type === "status") {
    if (!["listening", "thinking"].includes(event.status)) throw new TypeError("Invalid voice status.");
    if (!audio?.nodes.size && !audio?.queue.length) status = event.status;
  } else throw new TypeError("Unknown voice event.");
  render();
}

async function start() {
  if (active) {
    await finish();
    return;
  }
  const current = ++attempt;
  const option = config.models[choice.model].voices.find(row => row.id === choice.voice);
  callChoice = Object.freeze({
    ...choice, modelLabel: config.models[choice.model].label, voiceLabel: option.label,
  });
  active = true;
  ready = muted = false;
  failure = null;
  status = "connecting";
  view = "call";
  captions = true;
  messages.clear();
  ignoredResponse = responseId = null;
  render();
  // The deadline also covers a microphone permission dialog that never resolves.
  timeout = setTimeout(() => {
    if (current === attempt) void finish("connection");
  }, 60000);
  try {
    if (config.mode === "cloud") {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia
          || !globalThis.AudioWorkletNode || !(globalThis.AudioContext || globalThis.webkitAudioContext)) {
        await finish("browser");
        return;
      }
      const currentAudio = new VoiceAudio(
        () => { if (current === attempt) void finish("playback"); },
        playing => {
          if (current === attempt && ready) {
            const next = playing ? "speaking" : "listening";
            if (status !== next) {
              status = next;
              render();
            }
          }
        },
      );
      audio = currentAudio;
      await currentAudio.capture(packet => {
        if (current !== attempt || !ready || muted) return;
        if (socket.bufferedAmount > 256000) {
          void finish("network");
          return;
        }
        if (socket.readyState === WebSocket.OPEN) socket.send(packet);
      });
      if (current !== attempt) {
        await currentAudio.close();
        return;
      }
    }
    const url = new URL("/api/voice", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    for (const [key, value] of Object.entries({ ...choice, scenario, language })) url.searchParams.set(key, value);
    socket = new WebSocket(url);
    socket.onmessage = ({ data }) => {
      if (current !== attempt) return;
      try { handle(JSON.parse(data)); }
      catch (error) {
        console.error("Northstar demo protocol/audio failure:", error.name);
        void finish("playback");
      }
    };
    socket.onclose = socket.onerror = () => {
      if (current === attempt) void finish("connection");
    };
  } catch (error) {
    if (current === attempt) {
      console.warn("Northstar demo microphone/connection failure:", error.name);
      await finish("microphone");
    }
  }
}

$("start").addEventListener("click", () => { void start(); });
$("model-select").addEventListener("change", () => {
  choice = chooseModel(choice, $("model-select").value, active, config.models);
  voiceOptions();
  save();
  render();
});
$("voice-select").addEventListener("change", () => {
  choice = chooseVoice(choice, $("voice-select").value, active, config.models);
  save();
  render();
});
$("language-select").addEventListener("change", () => {
  if (!active && Object.hasOwn(translations, $("language-select").value)) {
    language = $("language-select").value;
    save();
  }
  render();
});
for (const button of document.querySelectorAll("[data-scenario]")) {
  button.addEventListener("click", () => {
    if (!active) scenario = button.dataset.scenario;
    render();
  });
}
$("mute").addEventListener("click", () => {
  if (!ready || config.mode === "demo") return;
  muted = !muted;
  for (const track of audio.stream.getAudioTracks()) track.enabled = !muted;
  if (muted && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "clear" }));
  render();
});
$("captions").addEventListener("click", () => {
  captions = !captions;
  render();
});
$("history").addEventListener("click", () => {
  if (active || !messages.size) return;
  view = "history";
  captions = true;
  render();
});
$("back-home").addEventListener("click", () => {
  if (active) return;
  view = "home";
  render();
  $("screen").scrollTop = 0;
});
$("about").addEventListener("click", () => $("info-dialog").showModal());
$("close-info").addEventListener("click", () => $("info-dialog").close());
window.addEventListener("pagehide", () => { if (active) void finish(); });
window.addEventListener("offline", () => { if (active) void finish("network"); });

render();
try {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error("Config request failed.");
  config = await response.json();
  const saved = readPreferences(config.models, config.default_model);
  choice = { model: saved.model, voice: saved.voice };
  language = saved.language;
  $("model-select").replaceChildren(...Object.entries(config.models).map(([id, model]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = model.label;
    return option;
  }));
  voiceOptions();
  render();
} catch (error) {
  console.error("Northstar demo configuration failure:", error.name);
  config = null;
  failure = "config";
  render();
}
