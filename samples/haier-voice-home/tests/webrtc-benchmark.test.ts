/** Unit regressions for the configurable loopback WebRTC benchmark. */
import { describe, expect, it } from "vitest";

import {
  benchmarkSessionUpdate,
  mediaGatewayUrl,
  webRtcBenchmarkConfig,
} from "../server/webrtc-benchmark";

describe("WebRTC benchmark", () => {
  it("uses the requested realtime model and MediaGateway API", () => {
    const config = webRtcBenchmarkConfig({
      VOICE_LIVE_ENDPOINT: "https://example.services.ai.azure.com",
      WEBRTC_MODEL: "gpt-realtime-2.1-mini",
      PORT: "8080",
    });
    expect(mediaGatewayUrl(config)).toBe(
      "wss://example.services.ai.azure.com/voice-live/realtime/calls?api-version=2026-07-15&model=gpt-realtime-2.1-mini",
    );
  });

  it("rejects unapproved models instead of silently changing the benchmark", () => {
    expect(() =>
      webRtcBenchmarkConfig({
        VOICE_LIVE_ENDPOINT: "https://example.services.ai.azure.com",
        WEBRTC_MODEL: "microsoft-realtime-flash-1",
      }),
    ).toThrow("WEBRTC_MODEL");
  });

  it("has no default resource endpoint", () => {
    expect(() => webRtcBenchmarkConfig({})).toThrow("VOICE_LIVE_ENDPOINT");
  });

  it("configures audio VAD while keeping benchmark turns tool-free", () => {
    expect(benchmarkSessionUpdate()).toMatchObject({
      session: {
        tool_choice: "none",
        turn_detection: {
          type: "azure_semantic_vad",
          profile: "normal",
        },
      },
    });
  });
});
