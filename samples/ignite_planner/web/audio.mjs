// The Python prototype's audio player with an output bus and analysers, so the voice orb can follow
// the real microphone and Agent speech: level plus a log-spaced spectrum (bass → treble).
// Playback, buffering and interruption are unchanged.
const RATE = 24000;
const BANDS = 40, LOW_HZ = 70, HIGH_HZ = 7000;
const MAX_BUFFER_SECONDS = 120;
const SCHEDULE_AHEAD_SECONDS = .25;
const CHUNK_SAMPLES = 2400;

export class VoiceAudio {
  constructor(onSpeaking, onStatus = () => {}, onError = error => { throw error; }) {
    this.onStatus = onStatus;
    this.onError = onError;
    this.receivedChunks = 0;
    this.receivedSamples = 0;
    this.renderedSamples = 0;
    this.context = new AudioContext({sampleRate: 24000});
    this.resumed = this.context.resume();
    this.onSpeaking = onSpeaking;
    this.nodes = new Set();
    this.queue = [];
    this.queuedSamples = 0;
    this.timer = null;
    this.items = new Map();
    this.blockedResponses = new Set();
    this.interruptions = 0;
    this.lastInterruptionCutAudio = false;
    this.droppedChunks = 0;
    this.nextTime = 0;
    this.disposed = false;
    this.output = this.context.createGain();
    this.outputAnalyser = this.context.createAnalyser();
    this.outputAnalyser.fftSize = 1024;
    this.outputAnalyser.smoothingTimeConstant = .6;
    this.output.connect(this.outputAnalyser);
    this.output.connect(this.context.destination);
    this.inputAnalyser = null;
    this.levelBuffer = new Float32Array(512);
    this.frequencyBuffer = new Float32Array(512);
    this.context.addEventListener('statechange', () => {
      if (this.disposed) return;
      this.onStatus(this.snapshot());
      if (this.context.state === 'running') this.pumpSafely();
    });
  }

  partialSamples(item) {
    let played = 0;
    for (const segment of item.segments.values())
      played += Math.max(0, Math.min(segment.samples, Math.floor((this.context.currentTime - segment.start) * RATE)));
    return played;
  }

  bufferedSamples() {
    let pending = 0;
    for (const item of this.items.values())
      pending += item.receivedSamples - item.playedSamples - this.partialSamples(item);
    return pending;
  }

  snapshot() {
    let partial = 0;
    for (const item of this.items.values()) partial += this.partialSamples(item);
    return {
      state: this.context.state, sampleRate: this.context.sampleRate,
      receivedChunks: this.receivedChunks, receivedSeconds: this.receivedSamples / 24000,
      renderedSeconds: (this.renderedSamples + partial) / RATE, pendingSources: this.nodes.size,
      bufferedSeconds: this.bufferedSamples() / RATE, queuedSeconds: this.queuedSamples / RATE,
      scheduledAheadSeconds: Math.max(0, this.nextTime - this.context.currentTime),
      bufferLimitSeconds: MAX_BUFFER_SECONDS,
      interruptions: this.interruptions, droppedChunks: this.droppedChunks,
    };
  }

  // Root-mean-square level (0..1) of the latest microphone and Agent audio frames.
  levels() {
    const rms = analyser => {
      if (!analyser || this.disposed) return 0;
      analyser.getFloatTimeDomainData(this.levelBuffer);
      let sum = 0;
      for (const sample of this.levelBuffer) sum += sample * sample;
      return Math.sqrt(sum / this.levelBuffer.length);
    };
    return {input: rms(this.inputAnalyser), output: rms(this.outputAnalyser)};
  }

  // 40 log-spaced bands from 70 Hz to 7 kHz (0..1, noise-gated; each band takes its strongest bin,
  // because voice harmonics are narrow lines), plus low (<280 Hz: voice pitch), mid (280 Hz–1.8 kHz:
  // vowels) and high (>1.8 kHz: consonants, sibilants) energy, each the mean of its three strongest
  // bands, and the spectral centroid (0 = dark/low voice, 1 = bright/high).
  spectrum(kind) {
    const analyser = kind === 'input' ? this.inputAnalyser : this.outputAnalyser;
    if (!analyser || this.disposed) return null;
    analyser.getFloatFrequencyData(this.frequencyBuffer);
    const binHz = this.context.sampleRate / analyser.fftSize;
    const bands = new Float32Array(BANDS);
    let weighted = 0, total = 0;
    for (let band = 0; band < BANDS; band++) {
      const from = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (band / BANDS), to = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((band + 1) / BANDS);
      const start = Math.floor(from / binHz), end = Math.max(start + 1, Math.ceil(to / binHz));
      let peak = -Infinity;
      for (let bin = start; bin < end; bin++) peak = Math.max(peak, this.frequencyBuffer[bin]);
      bands[band] = Math.max(0, Math.min(1, (peak + 85) / 50));
      weighted += bands[band] * band;
      total += bands[band];
    }
    const strongest = (from, to) => [...bands.slice(from, to)].sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0) / 3;
    return {bands, low: strongest(0, 12), mid: strongest(12, 28), high: strongest(28, BANDS),
      centroid: total ? weighted / total / (BANDS - 1) : 0};
  }

  async resume() {
    if (this.disposed) throw new Error('Audio playback is closed. Reconnect the session.');
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Browser audio is still paused. Check tab mute and sound permissions.');
    this.pump();
    this.onStatus(this.snapshot());
  }

  async testSpeaker() {
    await this.resume();
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0, this.context.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, this.context.currentTime + 0.02);
    gain.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.45);
    oscillator.connect(gain).connect(this.output);
    await new Promise(resolve => {
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); resolve(); };
      oscillator.start();
      oscillator.stop(this.context.currentTime + 0.5);
    });
  }

  async capture(stream, onAudio) {
    await this.resumed;
    if (this.context.sampleRate !== 24000) throw new Error('24 kHz audio is required. Try current Edge or Chrome.');
    await this.context.audioWorklet.addModule(new URL('pcm-capture.js', import.meta.url));
    if (this.disposed) return;
    this.source = this.context.createMediaStreamSource(stream);
    this.inputAnalyser = this.context.createAnalyser();
    this.inputAnalyser.fftSize = 1024;
    this.inputAnalyser.smoothingTimeConstant = .6;
    this.source.connect(this.inputAnalyser);
    this.worklet = new AudioWorkletNode(this.context, 'ignite-capture');
    this.worklet.port.onmessage = event => {
      if (this.disposed) return;
      const bytes = new Uint8Array(event.data);
      onAudio(btoa(String.fromCharCode(...bytes)));
    };
    this.silent = this.context.createGain();
    this.silent.gain.value = 0;
    this.source.connect(this.worklet).connect(this.silent).connect(this.context.destination);
  }

  play(base64, metadata) {
    if (this.disposed) return false;
    const {item_id: itemId, response_id: responseId, content_index: contentIndex} = metadata;
    if (typeof itemId !== 'string' || !itemId || typeof responseId !== 'string' || !responseId || contentIndex !== 0)
      throw new Error('Output audio is missing its response, item or content identifier.');
    if (this.blockedResponses.has(responseId)) { this.droppedChunks++; return false; }
    const bytes = atob(base64);
    if (bytes.length % 2) throw new Error('The service sent incomplete PCM audio.');
    const count = bytes.length / 2;
    if (!count) return false;
    if (this.bufferedSamples() + count > MAX_BUFFER_SECONDS * RATE)
      throw new Error('Speech exceeds the bounded 120-second playback buffer. Ask for a shorter reply and reconnect.');
    let item = this.items.get(itemId);
    if (!item) {
      if (this.items.size >= 64) throw new Error('Too many unacknowledged audio items. Reconnect.');
      item = {responseId, contentIndex, receivedSamples: 0, playedSamples: 0, segments: new Map()};
      this.items.set(itemId, item);
    } else if (item.responseId !== responseId || item.contentIndex !== contentIndex) {
      throw new Error('Audio item metadata changed during playback.');
    }
    const pcm = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index++) pcm[index] = bytes.charCodeAt(index);
    this.receivedChunks++;
    this.receivedSamples += count;
    item.receivedSamples += count;
    this.queue.push({pcm: new DataView(pcm.buffer), offset: 0, item});
    this.queuedSamples += count;
    this.pump();
    this.onSpeaking(true);
    this.onStatus(this.snapshot());
    return true;
  }

  pumpSafely() {
    try { this.pump(); }
    catch (error) {
      this.stopTimer();
      this.onError(error);
    }
  }

  stopTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  pump() {
    if (this.disposed || this.context.state !== 'running' || !this.queue.length) return;
    this.nextTime = Math.max(this.nextTime, this.context.currentTime + .02);
    while (this.queue.length && this.nextTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const entry = this.queue[0];
      const count = Math.min(CHUNK_SAMPLES, entry.pcm.byteLength / 2 - entry.offset);
      const buffer = this.context.createBuffer(1, count, RATE);
      const samples = buffer.getChannelData(0);
      for (let index = 0; index < count; index++)
        samples[index] = entry.pcm.getInt16((entry.offset + index) * 2, true) / 32768;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.output);
      this.nodes.add(source);
      const item = entry.item;
      const start = this.nextTime;
      item.segments.set(source, {start, samples: count});
      source.onended = () => {
        source.disconnect();
        if (!this.nodes.delete(source)) return;
        item.segments.delete(source);
        item.playedSamples += count;
        this.renderedSamples += count;
        this.pumpSafely();
        this.onSpeaking(this.nodes.size > 0 || this.queue.length > 0);
        this.onStatus(this.snapshot());
      };
      source.start(start);
      this.nextTime += buffer.duration;
      entry.offset += count;
      this.queuedSamples -= count;
      if (entry.offset * 2 === entry.pcm.byteLength) this.queue.shift();
    }
    if (this.queue.length && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pumpSafely();
      }, 25);
    }
  }

  interrupt(packet) {
    if (!Array.isArray(packet.items) || packet.items.length > 64)
      throw new Error('Invalid playback interruption.');
    const reports = [];
    const seen = new Set();
    let partialSamples = 0;
    let cutAudio = Boolean(packet.active_response);
    if (packet.response_id) this.blockedResponses.add(packet.response_id);
    for (const requested of packet.items) {
      const item = this.items.get(requested.item_id);
      if (!item || seen.has(requested.item_id) || requested.content_index !== item.contentIndex)
        throw new Error('Cannot reconcile the interrupted playback item.');
      seen.add(requested.item_id);
      let played = item.playedSamples;
      const partial = this.partialSamples(item);
      played += partial;
      partialSamples += partial;
      reports.push({item_id: requested.item_id, content_index: item.contentIndex, audio_end_ms: Math.floor(played * 1000 / 24000)});
      if (played < item.receivedSamples) cutAudio = true;
      this.blockedResponses.add(item.responseId);
    }
    if (seen.size !== this.items.size) throw new Error('Playback interruption omitted an audio item.');
    if (this.blockedResponses.size > 1000) throw new Error('Interruption limit reached. Reconnect.');
    for (const source of this.nodes) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.stopTimer();
    this.nodes.clear();
    this.queue = [];
    this.queuedSamples = 0;
    this.items.clear();
    this.renderedSamples += partialSamples;
    this.nextTime = this.context.currentTime;
    this.lastInterruptionCutAudio = cutAudio;
    if (cutAudio) this.interruptions++;
    this.onSpeaking(false);
    this.onStatus(this.snapshot());
    return reports;
  }

  async dispose() {
    this.disposed = true;
    this.stopTimer();
    for (const source of this.nodes) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.nodes.clear();
    this.queue = [];
    this.queuedSamples = 0;
    this.items.clear();
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.port.close();
      this.worklet.disconnect();
    }
    this.source?.disconnect();
    this.silent?.disconnect();
    this.output.disconnect();
    await this.context.close();
  }
}
