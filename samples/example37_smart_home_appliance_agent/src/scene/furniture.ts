/** Hand-built furnishings give the demo a cohesive, asset-free living room. */
import * as THREE from "three";

import { box, cylinder } from "@/scene/materials";

/** Build the cutaway room and its warm timber floor. */
export function buildArchitecture(root: THREE.Group): void {
  box(root, {
    size: [10.1, 0.3, 7.3],
    at: [0, -0.2, 0],
    color: "#b9b29f",
    radius: 0.1,
  });
  box(root, { size: [10, 0.07, 7.2], at: [0, -0.015, 0], color: "#d8cbb1" });
  for (let index = 0; index < 19; index += 1) {
    box(root, {
      size: [0.51, 0.015, 7.14],
      at: [-4.84 + index * 0.535, 0.035, 0],
      color: index % 3 === 0 ? "#d7c6a9" : "#dfd0b6",
      radius: 0.002,
    });
  }
  box(root, { size: [10, 3.8, 0.15], at: [0, 1.9, -3.55], color: "#e5e3d8" });
  box(root, { size: [0.15, 3.8, 7.2], at: [-4.95, 1.9, 0], color: "#eeece2" });
  box(root, { size: [9.9, 0.12, 0.08], at: [0, 0.1, -3.43], color: "#c5bda9" });
  box(root, { size: [0.08, 0.12, 7.1], at: [-4.84, 0.1, 0], color: "#c5bda9" });
  box(root, {
    size: [3.8, 0.015, 2.9],
    at: [-0.8, 0.075, 0.9],
    color: "#e9e5d8",
    radius: 0.2,
  });
  buildWindow(root);
}

function buildWindow(root: THREE.Group): void {
  box(root, {
    size: [0.07, 2.55, 3.7],
    at: [-4.84, 2.05, -0.45],
    color: "#c4d8d6",
  });
  box(root, {
    size: [0.09, 0.08, 3.85],
    at: [-4.75, 0.76, -0.45],
    color: "#fdfcf4",
  });
  box(root, {
    size: [0.09, 2.7, 0.07],
    at: [-4.74, 2.05, -0.45],
    color: "#fdfcf4",
  });
  box(root, {
    size: [0.09, 0.07, 3.85],
    at: [-4.74, 2.05, -0.45],
    color: "#fdfcf4",
  });
  box(root, {
    size: [0.3, 0.07, 4.25],
    at: [-4.6, 3.43, -0.45],
    color: "#b3a68e",
  });
}

/** Build an inviting linen sectional with sage cushions. */
export function buildSofa(root: THREE.Group): void {
  const sofa = new THREE.Group();
  sofa.position.set(-1.15, 0, 2.06);
  root.add(sofa);
  box(sofa, {
    size: [3.5, 0.32, 1.15],
    at: [0, 0.4, 0],
    color: "#d2c2aa",
    radius: 0.14,
  });
  box(sofa, {
    size: [3.5, 0.84, 0.3],
    at: [0, 0.89, 0.48],
    color: "#d8c8b3",
    radius: 0.12,
  });
  for (const x of [-1.6, 1.6]) {
    box(sofa, {
      size: [0.3, 0.68, 1.15],
      at: [x, 0.65, 0],
      color: "#d8c8b3",
      radius: 0.12,
    });
  }
  for (const x of [-1, 0, 1]) {
    box(sofa, {
      size: [0.96, 0.2, 0.86],
      at: [x, 0.65, -0.06],
      color: "#e4d8c5",
      radius: 0.09,
    });
  }
  for (const x of [-1.05, 0.95]) {
    const pillow = box(sofa, {
      size: [0.55, 0.55, 0.16],
      at: [x, 0.99, 0.19],
      color: "#8a9e85",
      radius: 0.1,
    });
    pillow.rotation.x = -0.25;
    pillow.rotation.z = x * 0.15;
  }
  box(sofa, {
    size: [0.75, 0.025, 0.95],
    at: [0.2, 0.76, -0.05],
    color: "#b6baa0",
    radius: 0.03,
  });
}

/** Build a sculptural coffee table, side table, and original decorative objects. */
export function buildTables(root: THREE.Group): void {
  cylinder(root, {
    top: 0.78,
    height: 0.09,
    at: [-0.9, 0.56, 0.55],
    color: "#a58b68",
  });
  cylinder(root, {
    top: 0.37,
    bottom: 0.52,
    height: 0.46,
    at: [-0.9, 0.3, 0.55],
    color: "#bda17b",
  });
  box(root, {
    size: [0.4, 0.05, 0.3],
    at: [-1.08, 0.64, 0.45],
    color: "#dce1ce",
    radius: 0.01,
  });
  box(root, {
    size: [0.35, 0.04, 0.27],
    at: [-1.04, 0.69, 0.46],
    color: "#778c7d",
    radius: 0.01,
  });
  cylinder(root, {
    top: 0.09,
    height: 0.14,
    at: [-0.53, 0.68, 0.62],
    color: "#f3eee1",
  });
  cylinder(root, {
    top: 0.44,
    height: 0.08,
    at: [-3.6, 0.71, 2.0],
    color: "#b99b74",
  });
  cylinder(root, {
    top: 0.07,
    height: 0.65,
    at: [-3.6, 0.35, 2.0],
    color: "#8e7757",
  });
  cylinder(root, {
    top: 0.12,
    bottom: 0.09,
    height: 0.24,
    at: [-3.6, 0.87, 2.0],
    color: "#f1ebdc",
  });
}

/** Add leafy plants and understated wall art. */
export function buildDecor(root: THREE.Group): void {
  plant(root, [-3.8, 0, -2.35], 1.1);
  plant(root, [4.1, 0, 2.5], 0.8);
  box(root, {
    size: [0.7, 1.0, 0.07],
    at: [2.26, 2.03, -3.43],
    color: "#baa888",
  });
  box(root, {
    size: [0.61, 0.91, 0.04],
    at: [2.26, 2.03, -3.37],
    color: "#f7f0dc",
  });
  const art = new THREE.Mesh(
    new THREE.CircleGeometry(0.23, 48),
    new THREE.MeshStandardMaterial({ color: "#b5b79b" }),
  );
  art.position.set(2.26, 2.12, -3.335);
  root.add(art);
  box(root, {
    size: [0.12, 0.32, 0.025],
    at: [2.26, 1.79, -3.33],
    color: "#8c9a7f",
  });
}

function plant(
  root: THREE.Group,
  at: [number, number, number],
  scale: number,
): void {
  const group = new THREE.Group();
  group.position.set(...at);
  group.scale.setScalar(scale);
  root.add(group);
  cylinder(group, {
    top: 0.3,
    bottom: 0.22,
    height: 0.55,
    at: [0, 0.3, 0],
    color: "#c7b49b",
  });
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2;
    const geometry = new THREE.SphereGeometry(0.24, 12, 12);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: index % 2 ? "#668363" : "#809678",
        roughness: 0.9,
      }),
    );
    mesh.scale.set(0.6, 2.1, 0.36);
    mesh.position.set(
      Math.cos(angle) * 0.3,
      1.1 + (index % 3) * 0.16,
      Math.sin(angle) * 0.3,
    );
    mesh.rotation.set(Math.sin(angle) * 0.5, angle, Math.cos(angle) * 0.5);
    group.add(mesh);
  }
}
