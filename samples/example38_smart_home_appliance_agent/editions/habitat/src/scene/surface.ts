/** Original deterministic PBR artwork: separate color, tangent normal and roughness. */
import { seeded } from "@v2/scene/math";

export type SurfaceKind = "oak" | "linen" | "plaster" | "limestone";
export interface SurfacePixels {
  albedo: Uint8Array;
  normal: Uint8Array;
  roughness: Uint8Array;
  size: number;
}

const CHANNELS = 4; // RGBA byte textures use opaque alpha for all three material maps.
const BASE_COLORS: Record<SurfaceKind, [number, number, number]> = {
  oak: [225, 209, 181],
  linen: [241, 233, 217],
  plaster: [246, 243, 235],
  limestone: [239, 236, 227],
}; // Only albedo is color-managed; normal and roughness remain linear data.
const BASE_ROUGHNESS: Record<SurfaceKind, number> = {
  oak: 193,
  linen: 234,
  plaster: 193,
  limestone: 155,
}; // Linear byte values express the separate roughness recipe for each authored surface.

function relief(
  kind: SurfaceKind,
  x: number,
  y: number,
  noise: number,
): number {
  if (kind === "oak")
    return Math.sin(x * 0.24 + Math.sin(y * 0.024) * 2.2) * 0.18 + noise * 0.12;
  if (kind === "linen")
    return (
      (Math.sin(x * Math.PI * 0.5) + Math.cos(y * Math.PI * 0.5)) * 0.12 +
      noise * 0.08
    );
  if (kind === "limestone")
    return Math.sin(x * 0.04 + Math.cos(y * 0.05)) * 0.05 + noise * 0.07;
  return noise * 0.09;
}

function writeColor(
  target: Uint8Array,
  offset: number,
  color: readonly number[],
): void {
  for (let channel = 0; channel < 3; channel += 1)
    target[offset + channel] = Math.round(
      Math.max(0, Math.min(255, color[channel]!)),
    );
  target[offset + 3] = 255;
}

function fillMaps(
  kind: SurfaceKind,
  heights: Float32Array,
  maps: SurfacePixels,
): void {
  const base = BASE_COLORS[kind];
  for (let y = 0; y < maps.size; y += 1) {
    for (let x = 0; x < maps.size; x += 1) {
      const index = y * maps.size + x;
      const height = heights[index]!;
      const right = heights[y * maps.size + ((x + 1) % maps.size)]!;
      const below = heights[((y + 1) % maps.size) * maps.size + x]!;
      const normal = [-3 * (right - height), -3 * (below - height), 1];
      const length = Math.hypot(...normal);
      writeColor(
        maps.albedo,
        index * CHANNELS,
        base.map((value) => value + height * 25),
      );
      writeColor(
        maps.normal,
        index * CHANNELS,
        normal.map((value) => ((value / length) * 0.5 + 0.5) * 255),
      );
      const rough = BASE_ROUGHNESS[kind] + height * 30;
      writeColor(maps.roughness, index * CHANNELS, [rough, rough, rough]);
    }
  }
}

/**
 * Generate authored material maps locally, without assets or network calls.
 *
 * Parameters
 * ----------
 * kind : SurfaceKind
 *     Surface pattern to synthesize.
 * size : number
 *     Power-of-two texture edge size selected by the quality budget.
 *
 * Returns
 * -------
 * SurfacePixels
 *     Independent color/normal/roughness buffers suitable for DataTexture.
 *
 * Raises
 * ------
 * Error
 *     When the texture exceeds the bounded allocation or is not power-of-two.
 */
export function surfacePixels(kind: SurfaceKind, size: number): SurfacePixels {
  if (
    !Number.isInteger(size) ||
    size < 8 ||
    size > 1024 ||
    (size & (size - 1)) !== 0
  )
    throw new Error("Invalid procedural texture size");
  const random = seeded(404);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1)
      heights[y * size + x] = relief(kind, x, y, random() - 0.5);
  const maps: SurfacePixels = {
    albedo: new Uint8Array(size * size * CHANNELS),
    normal: new Uint8Array(size * size * CHANNELS),
    roughness: new Uint8Array(size * size * CHANNELS),
    size,
  };
  fillMaps(kind, heights, maps);
  return maps;
}
