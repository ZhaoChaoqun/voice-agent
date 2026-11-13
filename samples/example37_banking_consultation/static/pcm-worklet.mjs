import { PcmEncoder } from "./pcm.mjs";

class NorthstarCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.encoder = new PcmEncoder(sampleRate);
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) {
      for (let index = 0; index < mono.length; index++) mono[index] += channel[index] / channels.length;
    }
    for (const packet of this.encoder.push(mono)) this.port.postMessage(packet, [packet]);
    return true;
  }
}
registerProcessor("northstar-capture", NorthstarCapture);
