/** Unit regressions for the configurable loopback WebRTC benchmark. */
import { describe, expect, it } from "vitest";

import {
  benchmarkSessionUpdate,
  mediaGatewayUrl,
  webRtcBenchmarkConfig,
} from "../server/webrtc-benchmark";

describe("WebRTC benchmark", () => {
  it("defaults to Microsoft Realtime Flash and builds the MediaGateway URL", () => {
    const config = webRtcBenchmarkConfig({
      VOICE_LIVE_ENDPOINT: "https://example.services.ai.azure.com",
      PORT: "8080",
    });
    expect(mediaGatewayUrl(config)).toBe(
      "wss://example.services.ai.azure.com/voice-live/realtime/calls?api-version=2026-07-15&model=microsoft-realtime-flash-1",
    );
  });

  it.each(["microsoft-realtime-flash-1", "gpt-realtime-2.1"])(
    "accepts approved benchmark model %s",
    (model) => {
      const config = webRtcBenchmarkConfig({
        VOICE_LIVE_ENDPOINT: "https://example.services.ai.azure.com",
        WEBRTC_MODEL: model,
      });
      expect(mediaGatewayUrl(config)).toContain(`model=${model}`);
    },
  );

  it("rejects unapproved models instead of silently changing the benchmark", () => {
    expect(() =>
      webRtcBenchmarkConfig({
        VOICE_LIVE_ENDPOINT: "https://example.services.ai.azure.com",
        WEBRTC_MODEL: "unapproved-model",
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
