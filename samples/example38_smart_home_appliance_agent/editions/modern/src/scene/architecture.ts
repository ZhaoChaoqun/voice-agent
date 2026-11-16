/** A new waterfront penthouse dollhouse, built from authored geometry. */
import * as THREE from "three";

import { block, round, strip, type Palette } from "@shared/ui/scene/craft";

export interface Architecture {
  windowLight: THREE.DirectionalLight;
  warmLight: THREE.PointLight;
  ceiling: THREE.Group;
}

/** Build the stone plinth, parquet, tall windows, and architectural light ribbons. */
export function architecture(scene: THREE.Scene, p: Palette): Architecture {
  const room = new THREE.Group();
  scene.add(room);
  buildFoundation(room, p);
  buildWindow(room, p);
  buildWalls(room, p);
  const ceiling = buildCanopy(room, p);
  const windowLight = new THREE.DirectionalLight("#f8c593", 3);
  windowLight.position.set(-7, 10, 4);
  windowLight.castShadow = true;
  windowLight.shadow.mapSize.set(2048, 2048);
  Object.assign(windowLight.shadow.camera, {
    left: -12,
    right: 12,
    top: 10,
    bottom: -10,
    near: 0.5,
    far: 40,
  });
  windowLight.shadow.normalBias = 0.025;
  scene.add(windowLight);
  const warmLight = new THREE.PointLight("#ffb66c", 30, 11, 2);
  warmLight.position.set(-3.2, 3.2, -1.5);
  scene.add(warmLight);
  return { windowLight, warmLight, ceiling };
}

function buildFoundation(room: THREE.Group, p: Palette): void {
  block(room, {
    size: [14.2, 0.5, 10.4],
    at: [0, -0.5, 0],
    material: p.porcelain,
    radius: 0.24,
  });
  block(room, {
    size: [14.05, 0.16, 10.25],
    at: [0, -0.19, 0],
    material: p.wood,
    radius: 0.15,
  });
  block(room, {
    size: [14, 0.16, 10.2],
    at: [0, -0.075, 0],
    material: p.stone,
    radius: 0.1,
  });
  const seam = new THREE.MeshStandardMaterial({
    color: "#d0c8b9",
    roughness: 0.6,
  });
  for (let x = -6; x <= 6; x += 2)
    strip(room, [0.008, 0.002, 10], [x, 0.014, 0], seam);
  for (let z = -4; z <= 4; z += 2)
    strip(room, [13.8, 0.002, 0.008], [0, 0.014, z], seam);
}

function buildWindow(room: THREE.Group, p: Palette): void {
  for (const z of [-4.8, 4.5])
    block(room, {
      size: [0.13, 4.7, 0.1],
      at: [-6.87, 2.35, z],
      material: p.bronze,
    });
  block(room, {
    size: [0.025, 4.4, 9.1],
    at: [-6.8, 2.35, -0.2],
    material: p.glass,
  });
  for (const z of [-4.6, -2.35, -0.1, 2.15, 4.35]) {
    block(room, {
      size: [0.15, 4.6, 0.045],
      at: [-6.65, 2.38, z],
      material: p.black,
    });
  }
  block(room, {
    size: [0.34, 0.1, 9.7],
    at: [-6.65, 0.24, -0.15],
    material: p.stone,
  });
  strip(room, [0.035, 0.035, 9.5], [-6.6, 4.66, -0.15], p.warm);
}

function buildWalls(room: THREE.Group, p: Palette): void {
  block(room, {
    size: [13.9, 4.65, 0.22],
    at: [0, 2.32, -5],
    material: p.wood,
  });
  for (let index = 0; index < 12; index += 1) {
    block(room, {
      size: [0.66, 4.4, 0.1],
      at: [-6.3 + index * 0.68, 2.34, -4.83],
      material: p.wood,
      radius: 0.009,
    });
  }
  strip(room, [13.4, 0.025, 0.05], [0, 4.51, -4.78], p.warm);
  strip(room, [13.4, 0.025, 0.05], [0, 0.17, -4.77], p.warm);
  block(room, {
    size: [0.2, 2.2, 3.3],
    at: [6.9, 1.1, -3.4],
    material: p.darkWood,
  });
  for (const x of [3.15, 6.55])
    strip(room, [0.035, 4.3, 0.05], [x, 2.3, -4.76], p.warm);
}

function buildCanopy(room: THREE.Group, p: Palette): THREE.Group {
  const canopy = new THREE.Group();
  room.add(canopy);
  block(canopy, {
    size: [13.9, 0.14, 0.65],
    at: [0, 4.7, -4.55],
    material: p.black,
  });
  block(canopy, {
    size: [0.45, 0.14, 9.1],
    at: [-6.65, 4.7, -0.1],
    material: p.black,
  });
  for (let index = 0; index < 4; index += 1) {
    round(canopy, {
      radius: 0.09,
      height: 0.07,
      at: [-4.7 + index * 3.1, 4.55, -4.35],
      material: p.warm,
    });
  }
  return canopy;
}
