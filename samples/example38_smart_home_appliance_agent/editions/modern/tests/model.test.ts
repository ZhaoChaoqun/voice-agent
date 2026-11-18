import { describe, expect, it } from "vitest";

import { defaultModel } from "@shared/ui/model";

describe("default model selection", () => {
  it("prefers Microsoft Realtime Flash even when Realtime is listed first", () => {
    expect(
      defaultModel([
        { id: "gpt-realtime-2.1", available: true },
        { id: "microsoft-realtime-flash-1", available: true },
      ]),
    ).toBe("microsoft-realtime-flash-1");
  });

  it("ignores an unsupported model even if the backend advertises it as available", () => {
    expect(
      defaultModel([
        { id: "gpt-realtime-2.1", available: true },
        { id: "unsupported-model", available: true },
      ]),
    ).toBe("gpt-realtime-2.1");
  });

  it("does not select an unsupported model when no supported model is available", () => {
    expect(defaultModel([{ id: "unsupported-model", available: true }])).toBe(
      "",
    );
  });

  it("falls back to the available Realtime model", () => {
    expect(
      defaultModel([
        { id: "microsoft-realtime-flash-1", available: false },
        { id: "gpt-realtime-2.1", available: true },
      ]),
    ).toBe("gpt-realtime-2.1");
  });

  it("does not select an unavailable model", () => {
    expect(
      defaultModel([{ id: "microsoft-realtime-flash-1", available: false }]),
    ).toBe("");
  });

  it("never prefers GPT Live over an available realtime model", () => {
    expect(
      defaultModel([
        { id: "gpt-live-1", available: true },
        { id: "gpt-realtime-2.1", available: true },
      ]),
    ).toBe("gpt-realtime-2.1");
  });

  it("selects GPT Live when it is the only available model", () => {
    expect(
      defaultModel([
        { id: "microsoft-realtime-flash-1", available: false },
        { id: "gpt-live-1", available: true },
      ]),
    ).toBe("gpt-live-1");
  });

  it("waits for model configuration", () => {
    expect(defaultModel([])).toBe("");
  });
});
