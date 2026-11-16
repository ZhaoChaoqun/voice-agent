/** Material recipes retain the shared appliance palette, with new authored PBR maps. */
import * as THREE from "three";

import { palette, type Palette } from "@v2/scene/craft";
import { surfacePixels, type SurfaceKind } from "@habitat/scene/surface";

const SURFACE_ANISOTROPY = 4; // Preserve oblique floor grain without the cost of maximum driver anisotropy.

function texture(
  data: Uint8Array,
  size: number,
  { color = false }: { color?: boolean } = {},
): THREE.DataTexture {
  const map = new THREE.DataTexture(data, size, size);
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = SURFACE_ANISOTROPY;
  map.needsUpdate = true;
  return map;
}

function applySurface(
  material: THREE.MeshStandardMaterial,
  kind: SurfaceKind,
  size: number,
): void {
  const maps = surfacePixels(kind, size);
  material.map?.dispose();
  material.map = texture(maps.albedo, size, { color: true });
  material.normalMap = texture(maps.normal, size);
  material.roughnessMap = texture(maps.roughness, size);
  material.color.set("#ffffff");
  material.normalScale.setScalar(kind === "linen" ? 0.3 : 0.18);
  material.roughness = 1;
}

/**
 * Give shared appliances and original architecture one daylight material family.
 *
 * Parameters
 * ----------
 * textureSize : number
 *     Resolution selected by the actual GPU quality budget.
 *
 * Returns
 * -------
 * Palette
 *     Shared compatible materials with independent PBR texture channels.
 */
export function habitatPalette(textureSize: number): Palette {
  const p = palette();
  applySurface(p.wood, "oak", textureSize);
  applySurface(p.fabric, "linen", textureSize);
  applySurface(p.stone, "limestone", textureSize);
  applySurface(p.darkWood, "plaster", textureSize);
  p.porcelain.color.set("#fffdf7");
  p.porcelain.roughness = 0.24;
  p.metal.color.set("#fafbf9");
  p.metal.metalness = 0.22;
  p.metal.roughness = 0.29;
  p.bronze.color.set("#b6a48b");
  p.warm.emissiveIntensity = 0.7;
  return p;
}
