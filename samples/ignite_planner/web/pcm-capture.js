class IgniteCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new ArrayBuffer(4800);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }
  process(inputs) {
    for (const value of inputs[0]?.[0] || []) {
      const sample = Math.max(-1, Math.min(1, value));
      this.view.setInt16(this.offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      this.offset += 2;
      if (this.offset === this.buffer.byteLength) {
        this.port.postMessage(this.buffer, [this.buffer]);
        this.buffer = new ArrayBuffer(4800);
        this.view = new DataView(this.buffer);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('ignite-capture', IgniteCapture);
