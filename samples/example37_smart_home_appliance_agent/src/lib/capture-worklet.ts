/** Capture mono PCM16 without the deprecated main-thread ScriptProcessor API. */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

// Send 40 ms frames at the 24 kHz Voice Live rate to balance latency and overhead.
const FRAME_SAMPLES = 960;
const OUTPUT_RATE = 24_000;

class PcmCapture extends AudioWorkletProcessor {
  private frame = new Int16Array(FRAME_SAMPLES);
  private cursor = 0;
  private accumulator = 0;
  private count = 0;
  private phase = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const value of input) {
      this.accumulator += value;
      this.count += 1;
      this.phase += OUTPUT_RATE;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      const sample = Math.max(-1, Math.min(1, this.accumulator / this.count));
      this.frame[this.cursor++] = sample < 0 ? sample * 32768 : sample * 32767;
      this.accumulator = 0;
      this.count = 0;
      this.flush();
    }
    return true;
  }

  private flush(): void {
    if (this.cursor < FRAME_SAMPLES) return;
    this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.cursor = 0;
  }
}

registerProcessor("pcm-capture", PcmCapture);
