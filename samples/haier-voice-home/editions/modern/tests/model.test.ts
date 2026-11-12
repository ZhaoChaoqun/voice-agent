import { describe, expect, it } from "vitest";

import { defaultModel } from "../src/model";

describe("default model selection", () => {
  it("prefers Microsoft Realtime Flash even when Realtime is listed first", () => {
    expect(
      defaultModel([
        { id: "gpt-realtime-2.1", available: true },
        { id: "microsoft-realtime-flash-1", available: true },
      ]),
    ).toBe("microsoft-realtime-flash-1");
  });

  it("supports unversioned microsoft-realtime-flash model IDs", () => {
    expect(
      defaultModel([
        { id: "gpt-realtime-2.1", available: true },
        { id: "microsoft-realtime-flash", available: true },
      ]),
    ).toBe("microsoft-realtime-flash");
  });

  it("supports overseas comparison Mini when Flash is absent", () => {
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

  it("waits for model configuration", () => {
    expect(defaultModel([])).toBe("");
  });
});
