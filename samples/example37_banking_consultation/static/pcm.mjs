export const RATE = 24000;
export const PACKET_FRAMES = 1200;

export class PcmEncoder {
  constructor(inputRate) {
    if (!Number.isFinite(inputRate) || inputRate < 8000) throw new RangeError("Invalid capture sample rate.");
    this.step = inputRate / RATE;
    this.samples = [];
    this.position = 0;
    this.packet = new DataView(new ArrayBuffer(PACKET_FRAMES * 2));
    this.offset = 0;
  }

  push(samples) {
    const packets = [];
    for (const sample of samples) this.samples.push(sample);
    while (this.position + 1 < this.samples.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const value = Math.max(-1, Math.min(1,
        this.samples[index] * (1 - fraction) + this.samples[index + 1] * fraction,
      ));
      this.packet.setInt16(this.offset++ * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      if (this.offset === PACKET_FRAMES) {
        packets.push(this.packet.buffer);
        this.packet = new DataView(new ArrayBuffer(PACKET_FRAMES * 2));
        this.offset = 0;
      }
      this.position += this.step;
    }
    const consumed = Math.min(Math.floor(this.position), Math.max(0, this.samples.length - 1));
    this.samples = this.samples.slice(consumed);
    this.position -= consumed;
    return packets;
  }
}
