/** Deterministic framing and animation math shared by scene and tests. */
export type Atmosphere = "dusk" | "day" | "cinema";

export interface Framing {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

const LCG_MULTIPLIER = 1664525; // Numerical Recipes LCG multiplier for repeatable artwork.
const LCG_INCREMENT = 1013904223; // Numerical Recipes LCG increment paired with the multiplier.
const UINT32_RANGE = 4294967296; // Normalize the unsigned 32-bit state to [0, 1).

/** Frame the living-room wall at eye level, without an exterior or elevated overview. */
export function homeFraming(aspect: number): Framing {
  if (!Number.isFinite(aspect) || aspect <= 0)
    throw new Error("Invalid viewport aspect");
  if (aspect < 1)
    return { position: [-2.7, 2.3, 1.8], target: [-2.7, 2.3, -4.5], fov: 64 };
  if (aspect < 1.6)
    return { position: [-0.5, 2.3, 1.8], target: [-0.5, 2.3, -4.5], fov: 64 };
  return { position: [0, 2.3, 1.8], target: [0, 2.3, -4.5], fov: 44 };
}

/** A bounded animation clock never jumps after tab suspension. */
export function advanceTime(
  time: number,
  delta: number,
  paused: boolean,
): number {
  if (paused) return time;
  return time + Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 0.05));
}

/** Stable seeded values keep procedural artwork reproducible. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state / UINT32_RANGE;
  };
}
