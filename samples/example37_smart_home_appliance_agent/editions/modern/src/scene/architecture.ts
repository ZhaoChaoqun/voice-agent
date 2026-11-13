/** A new waterfront penthouse dollhouse, built from authored geometry. */
import * as THREE from "three";

import { block, round, strip, type Palette } from "@v2/scene/craft";

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

/** Sculptural seating and hand-placed objects make the room feel inhabited. */
export function furnishings(scene: THREE.Scene, p: Palette): void {
  const group = new THREE.Group();
  scene.add(group);
  buildSofa(group, p);
  buildTables(group, p);
  buildKitchen(group, p);
  plant(group, [-5.7, 0, -3.75], 1.2, p);
  plant(group, [5.9, 0, 3.7], 1, p);
  buildSculpture(group, p);
}

function buildSofa(group: THREE.Group, p: Palette): void {
  block(group, {
    size: [5.2, 0.035, 3.5],
    at: [-1.6, 0.035, 1.9],
    material: new THREE.MeshStandardMaterial({
      color: "#e8e4da",
      roughness: 1,
    }),
    radius: 0.25,
  });
  block(group, {
    size: [4.1, 0.28, 1.35],
    at: [-2.2, 0.34, 2.55],
    material: p.darkWood,
    radius: 0.12,
  });
  block(group, {
    size: [4.25, 0.75, 0.37],
    at: [-2.2, 0.91, 3.08],
    material: p.fabric,
    radius: 0.16,
  });
  for (const x of [-3.6, -2.2, -0.8]) {
    block(group, {
      size: [1.32, 0.27, 1.16],
      at: [x, 0.61, 2.51],
      material: p.fabric,
      radius: 0.13,
    });
  }
  block(group, {
    size: [0.36, 0.72, 1.38],
    at: [-4.25, 0.76, 2.55],
    material: p.fabric,
    radius: 0.15,
  });
  block(group, {
    size: [1.42, 0.33, 2.0],
    at: [-0.75, 0.57, 2.0],
    material: p.fabric,
    radius: 0.15,
  });
  const cushion = new THREE.MeshStandardMaterial({
    color: "#b8c5b9",
    roughness: 0.92,
  });
  for (const x of [-3.65, -1.15]) {
    const pillow = block(group, {
      size: [0.63, 0.62, 0.2],
      at: [x, 1.03, 2.81],
      material: cushion,
      radius: 0.12,
    });
    pillow.rotation.x = -0.18;
    pillow.rotation.z = x * 0.035;
  }
  block(group, {
    size: [0.65, 0.025, 0.97],
    at: [-2.4, 0.77, 2.25],
    material: new THREE.MeshStandardMaterial({
      color: "#b38c5c",
      roughness: 1,
    }),
    radius: 0.03,
  });
}

function buildTables(group: THREE.Group, p: Palette): void {
  round(group, {
    radius: 0.78,
    height: 0.08,
    at: [-2.15, 0.6, 0.7],
    material: p.stone,
  });
  round(group, {
    radius: 0.5,
    top: 0.34,
    height: 0.54,
    at: [-2.15, 0.29, 0.7],
    material: p.darkWood,
  });
  round(group, {
    radius: 0.49,
    height: 0.05,
    at: [-0.98, 0.43, 0.47],
    material: p.bronze,
  });
  round(group, {
    radius: 0.16,
    height: 0.4,
    at: [-0.98, 0.2, 0.47],
    material: p.black,
  });
  block(group, {
    size: [0.46, 0.055, 0.32],
    at: [-2.37, 0.68, 0.7],
    material: p.black,
  });
  block(group, {
    size: [0.41, 0.04, 0.3],
    at: [-2.33, 0.73, 0.72],
    material: p.porcelain,
  });
  for (const x of [-1.93, -1.73])
    round(group, {
      radius: 0.065,
      height: 0.11,
      at: [x, 0.71, 0.66],
      material: p.porcelain,
    });
  round(group, {
    radius: 0.35,
    height: 0.08,
    at: [-5, 0.74, 2.65],
    material: p.darkWood,
  });
  round(group, {
    radius: 0.17,
    height: 0.68,
    at: [-5, 0.36, 2.65],
    material: p.bronze,
  });
}

function buildKitchen(group: THREE.Group, p: Palette): void {
  for (const x of [3.9, 5.4]) {
    block(group, {
      size: [1.42, 1.1, 1.15],
      at: [x, 0.6, -4.23],
      material: p.darkWood,
    });
    block(group, {
      size: [1.5, 0.08, 1.23],
      at: [x, 1.19, -4.19],
      material: p.stone,
    });
    strip(group, [1.2, 0.014, 0.025], [x, 1.05, -3.62], p.bronze);
    block(group, {
      size: [1.4, 1.25, 0.52],
      at: [x, 3.5, -4.58],
      material: p.wood,
    });
    strip(group, [1.35, 0.025, 0.05], [x, 2.85, -4.26], p.warm);
  }
  block(group, {
    size: [0.6, 0.02, 0.5],
    at: [4, 1.24, -4.1],
    material: p.black,
  });
  round(group, {
    radius: 0.14,
    height: 0.25,
    at: [5.5, 1.35, -4.2],
    material: p.metal,
  });
  block(group, {
    size: [2.4, 1.12, 0.95],
    at: [4.7, 0.59, -1.4],
    material: p.wood,
    radius: 0.06,
  });
  block(group, {
    size: [2.57, 0.1, 1.1],
    at: [4.7, 1.19, -1.4],
    material: p.stone,
    radius: 0.05,
  });
  strip(group, [2.3, 0.022, 0.025], [4.7, 0.2, -0.91], p.warm);
  for (const x of [4, 5.4]) {
    round(group, {
      radius: 0.33,
      height: 0.13,
      at: [x, 0.8, -0.25],
      material: p.fabric,
    });
    round(group, {
      radius: 0.07,
      height: 0.7,
      at: [x, 0.38, -0.25],
      material: p.bronze,
    });
    round(group, {
      radius: 0.28,
      height: 0.04,
      at: [x, 0.04, -0.25],
      material: p.black,
    });
  }
}

function plant(
  parent: THREE.Group,
  at: [number, number, number],
  scale: number,
  p: Palette,
): void {
  const group = new THREE.Group();
  group.position.set(...at);
  group.scale.setScalar(scale);
  parent.add(group);
  round(group, {
    radius: 0.26,
    top: 0.33,
    height: 0.6,
    at: [0, 0.3, 0],
    material: p.stone,
  });
  const leaf = new THREE.MeshStandardMaterial({
    color: "#355c48",
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  for (let index = 0; index < 13; index += 1) {
    const angle = index * 2.4;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 10), leaf);
    mesh.scale.set(0.55, 2.3, 0.17);
    mesh.position.set(
      Math.sin(angle) * 0.36,
      1.18 + (index % 3) * 0.26,
      Math.cos(angle) * 0.36,
    );
    mesh.rotation.set(Math.sin(angle) * 0.55, angle, Math.cos(angle) * 0.55);
    group.add(mesh);
  }
}

function buildSculpture(group: THREE.Group, p: Palette): void {
  round(group, {
    radius: 0.42,
    height: 0.65,
    at: [1.5, 0.36, 3.7],
    material: p.darkWood,
  });
  const sculpture = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.24, 0.055, 80, 12, 2, 3),
    p.bronze,
  );
  sculpture.position.set(1.5, 0.98, 3.7);
  group.add(sculpture);
}
