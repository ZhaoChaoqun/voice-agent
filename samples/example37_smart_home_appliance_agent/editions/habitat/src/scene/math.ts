/** Eye-height framing and explicit, bounded rendering budgets. */
export interface Quality {
  name: "balanced" | "compact";
  pixelRatio: number;
  textureSize: number;
  shadowSize: number;
  cubeSize: number;
  aoScale: number;
  aoSamples: number;
  fpsLimit: number;
}

export interface Framing {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export const ROOM_SCALE = 0.72; // Convert the shared authored appliance geometry to interior meters.
export const EYE_HEIGHT = 1.68; // Both portrait and landscape cameras stay at standing human eye height.
const COMPACT_WIDTH = 760; // Small viewports use lower GPU/texture budgets, without dropping the AO pass.
const LANDSCAPE_RATIO = 1.4; // Wider panes can show the kitchen without the portrait viewing angle.

/**
 * Choose a bounded startup budget without pretending a disabled effect ran.
 *
 * Parameters
 * ----------
 * width : number
 *     Initial browser viewport width in CSS pixels.
 * dpr : number
 *     Device pixel ratio.
 *
 * Returns
 * -------
 * Quality
 *     Actual limits used by the renderer and postprocessing.
 */
export function qualityFor(width: number, dpr: number): Quality {
  const compact = width < COMPACT_WIDTH;
  return {
    name: compact ? "compact" : "balanced",
    pixelRatio: Math.max(1, Math.min(dpr || 1, compact ? 1.25 : 1.5)),
    textureSize: compact ? 256 : 512,
    shadowSize: compact ? 1024 : 2048,
    cubeSize: compact ? 64 : 128,
    aoScale: 0.5,
    aoSamples: compact ? 8 : 12,
    fpsLimit: compact ? 30 : 45,
  };
}

/**
 * Compose an enclosed room, never an elevated external dollhouse.
 *
 * Parameters
 * ----------
 * aspect : number
 *     Render pane width divided by height.
 *
 * Returns
 * -------
 * Framing
 *     Horizontal eye-height camera and stable target.
 *
 * Raises
 * ------
 * Error
 *     When the viewport has no finite positive aspect.
 */
export function framing(aspect: number): Framing {
  if (!Number.isFinite(aspect) || aspect <= 0)
    throw new Error("Invalid Habitat viewport aspect");
  return {
    position: [-0.85, EYE_HEIGHT, 3.8],
    target: [-0.35, EYE_HEIGHT, -3.2],
    fov: aspect > LANDSCAPE_RATIO ? 58 : 68,
  };
}
