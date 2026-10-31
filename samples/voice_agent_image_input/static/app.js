// Copyright (c) Microsoft Corporation. All rights reserved.
import { FRAME_INTERVAL_MS, captureJpeg, readFileAsDataUrl, validateImageFile } from "./frames.mjs";
import { AudioPlayer } from "./playback.js";

const $ = (id) => document.getElementById(id);
const config = await (await fetch("/api/config")).json();
let socket = null;
let audioContext = null;
let player = null;
let micNode = null;
let micStream = null;
let cameraStream = null;
let cameraTimer = null;
let attachments = [];
let assistantLine = null;

for (let n = config.retain_min; n <= config.retain_max; n++) {
  $("retain").append(new Option(String(n), String(n), false, n === config.retain_default));
}

function setStatus(text) { $("status").textContent = text; }

function addLine(role, text, images = []) {
  const li = document.createElement("li");
  li.className = role;
  li.textContent = text;
  for (const src of images) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Sent image";
    li.append(img);
  }
  $("log").append(li);
  li.scrollIntoView({ block: "end" });
  return li;
}

function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(typeof message === "string" || message instanceof ArrayBuffer ? message : JSON.stringify(message));
  return true;
}

function renderPreviews() {
  $("previews").replaceChildren(...attachments.map((src, index) => {
    const wrap = document.createElement("span");
    const img = document.createElement("img");
    img.src = src;
    img.alt = `Attachment ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remove";
    remove.onclick = () => { attachments.splice(index, 1); renderPreviews(); };
    wrap.append(img, remove);
    return wrap;
  }));
}

$("file").onchange = async (event) => {
  for (const file of event.target.files) {
    if (attachments.length >= config.max_images) { addLine("notice", `Attach at most ${config.max_images} images.`); break; }
    const error = validateImageFile(file, config.max_image_bytes);
    if (error) { addLine("notice", error); continue; }
    attachments.push(await readFileAsDataUrl(file));
  }
  event.target.value = "";
  renderPreviews();
};

$("composer").onsubmit = (event) => {
  event.preventDefault();
  const text = $("text").value.trim();
  if (!text && !attachments.length) return;
  player?.stop();
  const ok = attachments.length ? send({ type: "image", text, images: attachments }) : send({ type: "text", text });
  if (!ok) return;
  if (attachments.length) addLine("user", text || "(describe the image)", attachments);
  $("text").value = "";
  attachments = [];
  renderPreviews();
};

async function startMicrophone() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  await audioContext.audioWorklet.addModule("/static/pcm-worklet.js");
  micNode = new AudioWorkletNode(audioContext, "pcm-capture");
  micNode.port.onmessage = (event) => send(event.data);
  audioContext.createMediaStreamSource(micStream).connect(micNode);
}

function onServerMessage(event) {
  if (event.data instanceof ArrayBuffer) { player?.enqueue(event.data); return; }
  const message = JSON.parse(event.data);
  switch (message.type) {
    case "progress": setStatus(message.message); break;
    case "ready":
      setStatus(`Connected: ${message.agent}`);
      $("send").disabled = false;
      $("camera").disabled = false;
      break;
    case "transcript":
      if (message.role === "user" && !/\[\+\d+ image/.test(message.text)) addLine("user", message.text);
      break;
    case "assistant_delta":
      assistantLine ??= addLine("assistant", "");
      assistantLine.textContent += message.delta;
      break;
    case "response":
      if (message.state !== "started") {
        assistantLine = null;
        if (message.total_ms != null) $("latency").textContent += ` · response done ${message.total_ms} ms`;
      } else {
        $("latency").textContent = "";
      }
      break;
    case "latency": $("latency").textContent = `First audio ${message.first_audio_ms} ms after the turn was sent`; break;
    case "interrupt": player?.stop(); assistantLine = null; break;
    case "camera":
      $("camera-status").textContent = message.error
        ? `Camera context error: ${message.error}`
        : `Camera frames in context: ${message.retained}/${message.max_frames} (synced ${message.synced})`;
      break;
    case "notice": addLine("notice", message.message); break;
    case "error": addLine("error", message.message); break;
    default: break;
  }
}

async function connect() {
  audioContext = new AudioContext({ sampleRate: 24000 });
  player = new AudioPlayer(audioContext);
  socket = new WebSocket(`ws://${location.host}/ws`);
  socket.binaryType = "arraybuffer";
  socket.onmessage = onServerMessage;
  socket.onclose = () => disconnect();
  setStatus("Connecting…");
  $("connect").textContent = "Disconnect";
  if ($("mic").checked) {
    try { await startMicrophone(); } catch (error) { addLine("error", `Microphone unavailable: ${error.message}`); }
  }
}

function stopCamera() {
  clearInterval(cameraTimer);
  cameraTimer = null;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  $("video").srcObject = null;
  $("live").textContent = "OFF";
  $("live").classList.remove("on");
  $("camera").textContent = "Start camera";
}

function disconnect() {
  stopCamera();
  micStream?.getTracks().forEach((track) => track.stop());
  micNode?.disconnect();
  player?.stop();
  audioContext?.close();
  if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  socket = micNode = micStream = audioContext = player = null;
  $("send").disabled = true;
  $("camera").disabled = true;
  $("connect").textContent = "Connect";
  setStatus("Disconnected");
}

$("connect").onclick = () => (socket ? disconnect() : connect());

$("camera").onclick = async () => {
  if (cameraStream) { stopCamera(); send({ type: "camera_clear" }); return; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: "environment" } },
    });
  } catch (error) {
    addLine("error", `Camera unavailable: ${error.message}`);
    return;
  }
  $("video").srcObject = cameraStream;
  await $("video").play();
  $("live").textContent = "LIVE";
  $("live").classList.add("on");
  $("camera").textContent = "Stop camera";
  const capture = () => {
    try { send({ type: "camera_frame", image: captureJpeg($("video"), $("canvas")) }); }
    catch (error) { $("camera-status").textContent = error.message; }
  };
  capture();
  cameraTimer = setInterval(capture, FRAME_INTERVAL_MS);
};

$("retain").onchange = (event) => send({ type: "camera_retain", count: Number(event.target.value) });
