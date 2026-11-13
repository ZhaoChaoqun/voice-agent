import { RATE } from "./pcm.mjs";

export class VoiceAudio {
  constructor(onError, onPlaying) {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.context = new Context({ latencyHint: "interactive" });
    this.onError = onError;
    this.onPlaying = onPlaying;
    this.queue = [];
    this.frames = 0;
    this.nodes = new Set();
    this.nextTime = 0;
    this.closed = false;
    this.timer = setInterval(() => {
      try { this.pump(); }
      catch (error) { this.onError(error); }
    }, 20);
  }

  async capture(onPacket) {
    await this.context.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (this.closed) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        if (!this.closed) this.onError(new Error("Microphone disconnected."));
      });
    }
    await this.context.audioWorklet.addModule("/assets/pcm-worklet.mjs");
    if (this.closed) return;
    this.source = this.context.createMediaStreamSource(stream);
    this.captureNode = new AudioWorkletNode(this.context, "northstar-capture");
    this.silentGain = this.context.createGain();
    this.silentGain.gain.value = 0;
    this.source.connect(this.captureNode).connect(this.silentGain).connect(this.context.destination);
    this.captureNode.port.onmessage = event => {
      if (!this.closed) onPacket(event.data);
    };
    this.context.onstatechange = () => {
      if (!this.closed && this.context.state !== "running") this.onError(new Error("Audio context suspended."));
    };
  }

  play(encoded) {
    const raw = atob(encoded);
    if (!raw.length || raw.length % 2) throw new Error("Invalid PCM16 audio.");
    if (this.frames / RATE + Math.max(0, this.nextTime - this.context.currentTime)
        + raw.length / 2 / RATE > 120) throw new Error("Playback buffer exceeds 120 seconds.");
    const bytes = Uint8Array.from(raw, value => value.charCodeAt(0));
    this.queue.push({ view: new DataView(bytes.buffer), offset: 0 });
    this.frames += bytes.byteLength / 2;
    this.pump();
  }

  pump() {
    if (this.closed || !this.queue.length) return;
    if (this.context.state !== "running") throw new Error("Audio playback is paused.");
    this.nextTime = Math.max(this.nextTime, this.context.currentTime + 0.03);
    while (this.queue.length && this.nextTime < this.context.currentTime + 0.25) {
      const entry = this.queue[0];
      const count = Math.min(2400, entry.view.byteLength / 2 - entry.offset);
      const buffer = this.context.createBuffer(1, count, RATE);
      const values = buffer.getChannelData(0);
      for (let index = 0; index < count; index++) {
        values[index] = entry.view.getInt16((entry.offset + index) * 2, true) / 32768;
      }
      const node = this.context.createBufferSource();
      node.buffer = buffer;
      node.connect(this.context.destination);
      this.nodes.add(node);
      node.onended = () => {
        this.nodes.delete(node);
        node.disconnect();
        this.onPlaying(this.nodes.size > 0 || this.queue.length > 0);
      };
      node.start(this.nextTime);
      this.nextTime += buffer.duration;
      this.frames -= count;
      entry.offset += count;
      if (entry.offset * 2 === entry.view.byteLength) this.queue.shift();
    }
    this.onPlaying(true);
  }

  interrupt() {
    for (const node of this.nodes) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    this.nodes.clear();
    this.queue = [];
    this.frames = 0;
    this.nextTime = 0;
    this.onPlaying(false);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.interrupt();
    this.source?.disconnect();
    this.captureNode?.disconnect();
    this.silentGain?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.context.onstatechange = null;
    await this.context.close();
  }
}
