// Copyright (c) Microsoft Corporation. All rights reserved.
// Gapless playback of 24 kHz mono PCM16 chunks, with immediate stop for barge-in.
const RATE = 24000;

export class AudioPlayer {
  constructor(context) {
    this.context = context;
    this.nextTime = 0;
    this.nodes = new Set();
  }

  enqueue(arrayBuffer) {
    if (!arrayBuffer.byteLength || arrayBuffer.byteLength % 2) return;
    const view = new DataView(arrayBuffer);
    const count = arrayBuffer.byteLength / 2;
    const buffer = this.context.createBuffer(1, count, RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < count; i++) data[i] = view.getInt16(i * 2, true) / 32768;
    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.context.destination);
    this.nextTime = Math.max(this.nextTime, this.context.currentTime + 0.03);
    node.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.nodes.add(node);
    node.onended = () => { this.nodes.delete(node); node.disconnect(); };
  }

  stop() {
    for (const node of this.nodes) { try { node.stop(); } catch { /* already stopped */ } node.disconnect(); }
    this.nodes.clear();
    this.nextTime = 0;
  }
}
