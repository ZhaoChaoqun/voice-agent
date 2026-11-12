/** Pure quality/material/origin regressions, without network or a mocked AI. */
import { describe, expect, it } from "vitest";

import { validOrigin } from "../src/origin";
import { EYE_HEIGHT, framing, qualityFor } from "../src/scene/math";
import { surfacePixels, type SurfaceKind } from "../src/scene/surface";

describe("Habitat camera", () => {
  it.each([0.6, 1, 1.8, 2.4])(
    "keeps aspect %s at horizontal human eye height",
    (aspect) => {
      const view = framing(aspect);
      expect(view.position[1]).toBe(EYE_HEIGHT);
      expect(view.target[1]).toBe(EYE_HEIGHT);
      expect(view.position[2]).toBeLessThan(4.5);
      expect(view.fov).toBeGreaterThanOrEqual(58);
      expect(view.fov).toBeLessThanOrEqual(74);
    },
  );
  it.each([0, -1, NaN, Infinity])("rejects invalid aspect %s", (aspect) => {
    expect(() => framing(aspect)).toThrow("Invalid Habitat viewport aspect");
  });
});

describe("Habitat quality budgets", () => {
  it("bounds retina desktop without disabling material or contact detail", () => {
    const quality = qualityFor(1512, 3);
    expect(quality.name).toBe("balanced");
    expect(quality.pixelRatio).toBe(1.5);
    expect(quality.shadowSize).toBe(2048);
    expect(quality.textureSize).toBe(512);
    expect(quality.aoScale).toBe(0.5);
    expect(quality.aoSamples).toBe(12);
  });
  it("lowers actual mobile allocations while preserving the pipeline", () => {
    const quality = qualityFor(390, 3);
    expect(quality.name).toBe("compact");
    expect(quality.pixelRatio).toBe(1.25);
    expect(quality.shadowSize).toBe(1024);
    expect(quality.cubeSize).toBe(64);
    expect(quality.textureSize).toBe(256);
    expect(quality.aoSamples).toBe(8);
    expect(quality.fpsLimit).toBe(30);
  });
});

describe("original procedural surfaces", () => {
  it.each<SurfaceKind>(["oak", "linen", "plaster", "limestone"])(
    "%s produces repeatable independent color, normal and roughness data",
    (kind) => {
      const maps = surfacePixels(kind, 32);
      expect(maps.albedo).toEqual(surfacePixels(kind, 32).albedo);
      expect(maps.albedo).not.toEqual(maps.normal);
      expect(maps.albedo).not.toEqual(maps.roughness);
      expect(maps.normal).not.toEqual(maps.roughness);
      expect(maps.albedo.length).toBe(32 * 32 * 4);
      expect(new Set(maps.roughness).size).toBeGreaterThan(3);
      expect(new Set(maps.normal).size).toBeGreaterThan(8);
      for (let offset = 0; offset < maps.normal.length; offset += 4) {
        const x = (maps.normal[offset]! / 255) * 2 - 1;
        const y = (maps.normal[offset + 1]! / 255) * 2 - 1;
        const z = (maps.normal[offset + 2]! / 255) * 2 - 1;
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 1);
        expect(maps.albedo[offset + 3]).toBe(255);
      }
    },
  );
  it.each([0, -1, 13, 4096, NaN])(
    "rejects unbounded texture edge %s",
    (size) => {
      expect(() => surfacePixels("oak", size)).toThrow(
        "Invalid procedural texture size",
      );
    },
  );
});

describe("dedicated proxy boundary", () => {
  it.each(["127.0.0.1", "localhost"])(
    "allows V4 same-origin host %s only",
    (host) => {
      expect(
        validOrigin({ host: `${host}:5184`, origin: `http://${host}:5184` }),
      ).toBe(true);
    },
  );
  it("accepts a separate isolated preview port while preserving exact same-origin matching", () => {
    expect(
      validOrigin({
        host: "127.0.0.1:5197",
        origin: "http://127.0.0.1:5197",
      }),
    ).toBe(true);
  });
  it.each([
    {},
    { host: "127.0.0.1:5184" },
    { host: "127.0.0.1:5184", origin: "http://localhost:5184" },
    { host: "evil.invalid:5184", origin: "http://evil.invalid:5184" },
    { host: "localhost:5184", origin: "https://evil.invalid" },
    { host: "localhost:5184", origin: "null" },
  ])("rejects non-V4 or foreign original headers %#", (headers) => {
    expect(validOrigin(headers)).toBe(false);
  });
});
