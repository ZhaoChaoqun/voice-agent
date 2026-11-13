/** Deterministic client regressions; no external service or real microphone. */
import { describe, expect, it } from "vitest";

import {
  parseEvent,
  readableTranscript,
  updateTranscript,
} from "../src/lib/conversation";
import { decodePcm, encodePcm } from "../src/lib/pcm";

describe("PCM transport", () => {
  it("encodes and decodes signed little-endian PCM without losing byte order", () => {
    const bytes = new Uint8Array([0, 0, 255, 127, 0, 128, 0, 64]);
    const encoded = encodePcm(bytes);
    expect([...decodePcm(encoded)]).toEqual([0, 32767 / 32768, -1, 0.5]);
  });

  it("rejects a partial PCM16 sample rather than playing corrupted sound", () => {
    expect(() => decodePcm(btoa("x"))).toThrow("Invalid PCM16 byte count");
  });

  it("supports transport frames larger than a JavaScript argument limit", () => {
    const bytes = new Uint8Array(200_000).fill(123);
    expect(atob(encodePcm(bytes)).length).toBe(bytes.length);
  });
});

describe("streaming transcript", () => {
  it("merges deltas and replaces them with the authoritative final text", () => {
    const first = updateTranscript([], {
      id: "a1",
      role: "assistant",
      text: "欢迎",
      final: false,
    });
    const second = updateTranscript(first, {
      id: "a1",
      role: "assistant",
      text: "回家",
      final: false,
    });
    expect(second[0]?.text).toBe("欢迎回家");
    const done = updateTranscript(second, {
      id: "a1",
      role: "assistant",
      text: "欢迎回家！",
      final: true,
    });
    expect(done).toEqual([
      { id: "a1", role: "assistant", text: "欢迎回家！", final: true },
    ]);
  });

  it("preserves separate user and assistant messages and bounds visible history", () => {
    let messages = updateTranscript([], {
      id: "user",
      role: "user",
      text: "Hello",
      final: true,
    });
    for (let index = 0; index < 85; index += 1) {
      messages = updateTranscript(messages, {
        id: String(index),
        role: "assistant",
        text: "Hi",
        final: true,
      });
    }
    expect(messages).toHaveLength(80);
    expect(messages[0]?.id).toBe("5");
  });

  it("hides supported expression tags without removing ordinary bracketed content", () => {
    expect(
      readableTranscript(
        "[cheerful] Welcome home! [neutral] It's 24°C. [Section 4]",
      ),
    ).toBe("Welcome home!  It's 24°C. [Section 4]");
  });

  it("rejects malformed or untyped realtime payloads", () => {
    expect(parseEvent('{"type":"demo.ready"}')).toEqual({ type: "demo.ready" });
    expect(() => parseEvent('{"unexpected":true}')).toThrow(
      "Invalid realtime event",
    );
    expect(() => parseEvent("null")).toThrow("Invalid realtime event");
  });
});
