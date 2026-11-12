/** Original procedural PBR surfaces and small architectural modeling primitives. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { seeded } from "@v2/scene/math";

export interface Piece {
  size: [number, number, number];
  at: [number, number, number];
  material: THREE.Material;
  radius?: number;
}

/** Place a softly beveled piece with real cast/received shadows. */
export function block(parent: THREE.Object3D, spec: Piece): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(...spec.size, 2, spec.radius ?? 0.035),
    spec.material,
  );
  mesh.position.set(...spec.at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Place a lathed furniture detail. */
export function round(
  parent: THREE.Object3D,
  spec: {
    radius: number;
    height: number;
    at: [number, number, number];
    material: THREE.Material;
    top?: number;
  },
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(
      spec.top ?? spec.radius,
      spec.radius,
      spec.height,
      48,
    ),
    spec.material,
  );
  mesh.position.set(...spec.at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** An original deterministic grain map; no runtime remote textures. */
export function grain(kind: "wood" | "stone" | "fabric"): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create material artwork");
  context.fillStyle = kind === "wood" ? "#e4cba7" : "#f2eee5";
  context.fillRect(0, 0, 512, 512);
  const random = seeded(91);
  const count = kind === "fabric" ? 1400 : 500; // Grain density is bounded and generated only at startup.
  for (let index = 0; index < count; index += 1) {
    const x = random() * 512;
    const y = random() * 512;
    context.strokeStyle = `rgba(${kind === "wood" ? "47,25,11" : "55,66,67"},${random() * 0.11})`;
    context.lineWidth = random() * 2 + 0.3;
    context.beginPath();
    context.moveTo(x, y);
    if (kind === "wood")
      context.bezierCurveTo(
        x + 2,
        y + 100,
        x - 3,
        y + 160,
        x + random() * 5,
        y + 300,
      );
    else context.lineTo(x + random() * 15, y + random() * 8);
    context.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

export interface Palette {
  stone: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  darkWood: THREE.MeshStandardMaterial;
  fabric: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  warm: THREE.MeshStandardMaterial;
  cool: THREE.MeshStandardMaterial;
  porcelain: THREE.MeshStandardMaterial;
}

/** A coherent luxury palette uses measured roughness differences, not flat colors. */
export function palette(): Palette {
  return {
    stone: new THREE.MeshStandardMaterial({
      color: "#faf8f3",
      map: grain("stone"),
      roughness: 0.27,
      metalness: 0.04,
    }),
    wood: new THREE.MeshStandardMaterial({
      color: "#e5d2b5",
      map: grain("wood"),
      roughness: 0.58,
    }),
    darkWood: new THREE.MeshStandardMaterial({
      color: "#f0eee7",
      roughness: 0.45,
    }),
    fabric: new THREE.MeshStandardMaterial({
      color: "#fff8e9",
      map: grain("fabric"),
      roughness: 0.94,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: "#eeefec",
      metalness: 0.38,
      roughness: 0.26,
    }),
    black: new THREE.MeshStandardMaterial({
      color: "#101b21",
      metalness: 0.42,
      roughness: 0.3,
    }),
    bronze: new THREE.MeshStandardMaterial({
      color: "#b7ada0",
      metalness: 0.5,
      roughness: 0.4,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: "#e9f4f7",
      metalness: 0.12,
      roughness: 0.1,
      transparent: true,
      opacity: 0.075,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    warm: new THREE.MeshStandardMaterial({
      color: "#f8d098",
      emissive: "#ffb858",
      emissiveIntensity: 1.4,
      roughness: 0.3,
    }),
    cool: new THREE.MeshStandardMaterial({
      color: "#8be5f1",
      emissive: "#31c7e4",
      emissiveIntensity: 2,
      roughness: 0.2,
    }),
    porcelain: new THREE.MeshStandardMaterial({
      color: "#e9e9dc",
      roughness: 0.2,
      metalness: 0.07,
    }),
  };
}

/** A geometry-based LED strip with controlled bloom. */
export function strip(
  parent: THREE.Object3D,
  size: [number, number, number],
  at: [number, number, number],
  material: THREE.Material,
): THREE.Mesh {
  return block(parent, { size, at, material, radius: 0.006 });
}

/** Paint a readable physical screen without remote images. */
export function textScreen(
  value: string,
  { badge = false }: { badge?: boolean } = {},
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot draw appliance display");
  if (!badge) {
    context.fillStyle = "#0a1921";
    context.fillRect(0, 0, 512, 256);
  }
  context.fillStyle = badge ? "#3d4752" : "#b8e4de";
  context.font = `${badge ? "500" : "300"} 94px sans-serif`;
  context.textAlign = "center";
  context.fillText(value, 256, 150);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Merge only authored static meshes; dynamic devices stay outside these batches. */
export function batchStatic(scene: THREE.Object3D): void {
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (
      !(node instanceof THREE.Mesh) ||
      Array.isArray(node.material) ||
      node.material.transparent
    )
      return;
    const meshes = groups.get(node.material) ?? [];
    meshes.push(node);
    groups.set(node.material, meshes);
  });
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      const geometry = mesh.geometry.index
        ? mesh.geometry.toNonIndexed()
        : mesh.geometry.clone();
      return geometry.applyMatrix4(mesh.matrixWorld);
    });
    const merged = mergeGeometries(geometries);
    if (!merged) throw new Error("Cannot merge static architectural geometry");
    const batch = new THREE.Mesh(merged, material);
    batch.castShadow = true;
    batch.receiveShadow = true;
    scene.add(batch);
    for (const mesh of meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
  }
}
