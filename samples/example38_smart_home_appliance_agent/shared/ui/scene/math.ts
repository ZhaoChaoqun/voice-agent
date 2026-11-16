/** Deterministic animation and artwork math shared by both editions and their tests. */
export type Atmosphere = "dusk" | "day" | "cinema";

const LCG_MULTIPLIER = 1664525; // Numerical Recipes LCG multiplier for repeatable artwork.
const LCG_INCREMENT = 1013904223; // Numerical Recipes LCG increment paired with the multiplier.
const UINT32_RANGE = 4294967296; // Normalize the unsigned 32-bit state to [0, 1).
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
