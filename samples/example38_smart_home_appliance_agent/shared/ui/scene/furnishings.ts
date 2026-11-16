/** Shared sculptural seating, tables, kitchen and plants for both edition rooms. */
import * as THREE from "three";

import { block, round, strip, type Palette } from "@shared/ui/scene/craft";

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
