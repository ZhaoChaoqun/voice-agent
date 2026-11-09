// Page side of the GPT Live sample: microphone in, teacher audio out, three text panes.
// The page opens the GPT Live session itself with the Projects SDK, sending the learner's name
// and level as structured inputs. The local server only creates the agents and returns an
// access token from your az login session.
import { LiveSession } from "./live-session.js";
import { openLiveSession } from "./live-transport.js";
import { PcmAudio } from "./pcm-audio.js";

const $ = (id) => document.getElementById(id);
const startButton = $("start");
const stopButton = $("stop");
const statusLine = $("status");
const downloadHint = $("download");
const panes = { teacher: $("teacher"), user: $("user") };
const delegationPane = $("delegation");
const nameInput = $("learner-name");
const levelSelect = $("level");
const delegations = new Map();
let config;
let session;
let audio;
let microphone;
let lastRole;
let failed = false;

const loaded = fetch("/config")
  .then((response) => response.json())
  .then((value) => {
    config = value;
    $("agent").textContent =
      `Agent ${config.agent.name}, version ${config.agent.version} · ` +
      `${config.delegation} delegation → ${config.agent.backendModel}`;
    for (const level of config.levels) levelSelect.add(new Option(level, level, false, level === config.defaultLevel));
    // An AGENT_NAME agent may declare no structured inputs; then there is nothing to send.
    nameInput.disabled = !config.agent.inputs.includes("learner_name");
    levelSelect.disabled = !config.agent.inputs.includes("level");
    if (config.agent.clientDelegation || config.agent.managedDelegation) {
      $("hint").textContent = "Try: “What is 17 plus 25?” or “What is the current date and time?”";
    }
  })
  .catch(() => {
    $("agent").textContent = "Could not read the agent configuration from the server.";
  });

function setStatus(text, error = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle("error", error);
}

function scrollToEnd(element) {
  element.scrollTop = element.scrollHeight;
}

// Start a new paragraph whenever the other speaker talked in between.
function appendTranscript(role, delta) {
  const pane = panes[role];
  let paragraph = pane.lastElementChild;
  if (!paragraph || lastRole !== role) {
    paragraph = document.createElement("p");
    pane.append(paragraph);
  }
  lastRole = role;
  paragraph.textContent += delta;
  scrollToEnd(pane);
}

// One card per delegation: title, ID, latest status, and backend guidance text.
function updateDelegation({ id, title, status, delta }) {
  let item = delegations.get(id);
  if (!item) {
    const element = document.createElement("div");
    element.className = "delegation-item";
    item = {};
    for (const part of ["title", "id", "state", "text"]) {
      item[part] = document.createElement("div");
      item[part].className = part;
      element.append(item[part]);
    }
    item.id.textContent = id;
    delegationPane.append(element);
    delegations.set(id, item);
  }
  if (title) item.title.textContent = title;
  if (status) item.state.textContent = status;
  if (delta) item.text.textContent += delta;
  scrollToEnd(delegationPane);
}

/** The learner's name and level, for the inputs the agent declares. */
function structuredInputs() {
  const values = { learner_name: nameInput.value.trim() || "friend", level: levelSelect.value };
  const declared = Object.entries(values).filter(([name]) => config.agent.inputs.includes(name));
  return declared.length ? Object.fromEntries(declared) : undefined;
}

/** The shared Python downloader's command; shown only for agents the server keeps. */
function showDownloadCommand(conversationId) {
  if (!config.downloader || !conversationId) return;
  downloadHint.textContent =
    `Set AZURE_VOICE_AGENTS_ENDPOINT to ${config.endpoint}, then run from the repository root:\n` +
    `python "${config.downloader}" "${config.agent.name}" "${conversationId}"`;
  downloadHint.hidden = false;
}

async function handle(message) {
  switch (message.type) {
    case "status":
      if (!failed) setStatus(message.text);
      break;
    case "ready":
      setStatus("Ready. Speak into your microphone; click Stop to end the lesson.");
      await audio.startCapture(microphone, (chunk) => session?.sendAudio(chunk));
      break;
    case "audio":
      audio.play(message.delta);
      break;
    case "transcript":
      appendTranscript(message.role, message.delta);
      break;
    case "delegation":
      updateDelegation(message);
      break;
    case "error":
      failed = true;
      setStatus(message.message, true);
      break;
    case "closed": {
      const summary = [
        message.closeReason ? `Session closed: ${message.closeReason}` : "Session ended",
        message.usageSeconds !== undefined ? `Live usage ${message.usageSeconds} s` : undefined,
        message.conversationId ? `Conversation id ${message.conversationId}` : undefined,
      ].filter(Boolean);
      setStatus(failed ? `${statusLine.textContent} ${summary.join(". ")}.` : `${summary.join(". ")}.`, failed);
      showDownloadCommand(message.conversationId);
      break;
    }
  }
}

function releaseMicrophone() {
  audio?.stopCapture();
  for (const track of microphone?.getTracks() ?? []) track.stop();
  microphone = undefined;
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  failed = false;
  lastRole = undefined;
  delegations.clear();
  downloadHint.hidden = true;
  for (const pane of [...Object.values(panes), delegationPane]) pane.replaceChildren();
  // Create audio in the click handler so the browser allows playback; replace any
  // previous session's context only now, so its last reply could finish playing.
  audio?.close();
  audio = new PcmAudio();
  try {
    await loaded;
    if (!config) throw new Error("The agent configuration is unavailable; check the server console.");
    // Foundry fills these into the agent's instructions and greeting for this session.
    const inputs = structuredInputs();
    setStatus("Waiting for microphone permission…");
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    session = new LiveSession({
      openLive: (agent) => openLiveSession({ endpoint: config.endpoint, structuredInputs: inputs }, agent),
      agent: config.agent,
      onMessage: (message) =>
        handle(message).catch((error) => {
          failed = true;
          setStatus(error.message, true);
          stopButton.click();
        }),
      log: (line) => console.warn(line),
    });
    stopButton.disabled = false;
    await session.run();
  } catch (error) {
    failed = true;
    setStatus(error.message, true);
  }
  releaseMicrophone();
  session = undefined;
  startButton.disabled = false;
  stopButton.disabled = true;
});

stopButton.addEventListener("click", () => {
  stopButton.disabled = true;
  releaseMicrophone();
  session?.stop();
});
