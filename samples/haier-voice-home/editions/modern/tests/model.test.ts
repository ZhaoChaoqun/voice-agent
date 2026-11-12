import { describe, expect, it } from "vitest";

import { defaultModel } from "../src/model";

describe("default model selection", () => {
  it("prefers Mini even when Realtime is listed first", () => {
    expect(
      defaultModel([
        { id: "gpt-realtime-2.1", available: true },
        { id: "gpt-realtime-2.1-mini", available: true },
      ]),
    ).toBe("gpt-realtime-2.1-mini");
  });

  it("falls back to the available Realtime model", () => {
    expect(
      defaultModel([
        { id: "gpt-realtime-2.1-mini", available: false },
        { id: "gpt-realtime-2.1", available: true },
      ]),
    ).toBe("gpt-realtime-2.1");
  });

  it("does not select an unavailable model", () => {
    expect(
      defaultModel([{ id: "gpt-realtime-2.1-mini", available: false }]),
    ).toBe("");
  });

  it("waits for model configuration", () => {
    expect(defaultModel([])).toBe("");
  });
});
