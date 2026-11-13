/** Mock browser audio nodes to verify timing and resource cleanup deterministically. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserAudio } from "../src/lib/audio";
import { encodePcm } from "../src/lib/pcm";

class SourceStub {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  connect = vi.fn();
  disconnect = vi.fn();
}

class ContextStub {
  static current: ContextStub;
  currentTime = 0;
  destination = {};
  sources: SourceStub[] = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  constructor() {
    ContextStub.current = this;
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, copyToChannel: vi.fn() };
  }
  createBufferSource(): SourceStub {
    const source = new SourceStub();
    this.sources.push(source);
    return source;
  }
}

describe("ordered audio playback", () => {
  let audio: BrowserAudio;
  let drained = vi.fn<() => void>();
  const second = encodePcm(new Uint8Array(48_000));

  beforeEach(async () => {
    vi.stubGlobal("AudioContext", ContextStub);
    drained = vi.fn<() => void>();
    audio = new BrowserAudio(drained, vi.fn());
    await audio.initialize();
  });
  afterEach(() => {
    audio.close();
    vi.unstubAllGlobals();
  });

  it("schedules PCM chunks back-to-back without overlapping", () => {
    audio.play(second, "item1");
    audio.play(second, "item1");
    const [first, next] = ContextStub.current.sources;
    expect(first?.start).toHaveBeenCalledWith(0.045);
    expect(next?.start).toHaveBeenCalledWith(1.045);
    expect(audio.isPlaying).toBe(true);
  });

  it("truncates to heard audio, not the whole queued response", () => {
    audio.play(second, "item1");
    audio.play(second, "item1");
    ContextStub.current.currentTime = 0.545;
    expect(audio.interrupt()).toEqual({ itemId: "item1", audioMs: 500 });
    expect(
      ContextStub.current.sources.every(
        (source) => source.stop.mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(audio.isPlaying).toBe(false);
  });

  it("does not truncate an already finished response and signals the drained queue", () => {
    audio.play(second, "item1");
    ContextStub.current.sources[0]?.onended?.();
    expect(drained).toHaveBeenCalledOnce();
    expect(audio.interrupt()).toBeNull();
  });

  it("resets the playback cursor when interrupted before a new response", () => {
    audio.play(second, "item1");
    ContextStub.current.currentTime = 0.25;
    audio.interrupt();
    audio.play(second, "item2");
    expect(ContextStub.current.sources[1]?.start).toHaveBeenCalledWith(0.295);
    expect(audio.interrupt()?.itemId).toBe("item2");
  });

  it("closes the audio context exactly once even when called repeatedly", () => {
    const context = ContextStub.current;
    audio.close();
    audio.close();
    expect(context.close).toHaveBeenCalledOnce();
  });
});
