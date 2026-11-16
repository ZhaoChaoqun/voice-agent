/** Deterministic Modern camera framing shared by scene and tests. */
export interface Framing {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

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
