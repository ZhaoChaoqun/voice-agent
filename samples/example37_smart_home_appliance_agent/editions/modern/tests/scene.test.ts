/** Pure deterministic tests for bounded scene animation and framing. */
import { describe, expect, it } from "vitest";

import { advanceTime, homeFraming, seeded } from "../src/scene/math";
import { copy } from "../src/copy";

describe("Atelier scene math", () => {
  it("frames both layouts at the same fixed eye level and rejects invalid viewports", () => {
    const portrait = homeFraming(390 / 680);
    const desktop = homeFraming(1172 / 594);
    expect(portrait.position[2]).toBe(desktop.position[2]);
    expect(portrait.position[1]).toBe(portrait.target[1]);
    expect(desktop.position[1]).toBe(desktop.target[1]);
    expect(desktop.position[2] - desktop.target[2]).toBeLessThan(7);
    expect(portrait.position[0]).toBe(portrait.target[0]);
    expect(desktop.position[0]).toBe(desktop.target[0]);
    expect(portrait.fov).toBeGreaterThan(desktop.fov);
    expect(() => homeFraming(0)).toThrow("Invalid viewport aspect");
    expect(() => homeFraming(Number.NaN)).toThrow("Invalid viewport aspect");
  });
  it("freezes every animation on pause without freezing the camera", () => {
    expect(advanceTime(10, 0.016, true)).toBe(10);
    expect(advanceTime(10, 0.016, false)).toBe(10.016);
  });
  it("bounds suspended tab deltas and nonfinite timing", () => {
    expect(advanceTime(10, 300, false)).toBe(10.05);
    expect(advanceTime(10, -5, false)).toBe(10);
    expect(advanceTime(10, Number.NaN, false)).toBe(10);
  });
  it("procedural artwork repeats exactly with the same seed", () => {
    const first = seeded(520);
    const second = seeded(520);
    const values = Array.from({ length: 100 }, () => first());
    expect(values).toEqual(Array.from({ length: 100 }, () => second()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBe(100);
  });
  it("both UI languages expose the same functionality", () => {
    expect(Object.keys(copy("zh"))).toEqual(Object.keys(copy("en")));
    expect(copy("zh").auto).toContain("自动识别");
    expect(copy("en").auto).toContain("Auto");
  });
});
