/** A small original kinetic aquarium is a quiet visual nod to Pelagic. */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { block, type Palette } from "@v2/scene/craft";
import { seeded } from "@v2/scene/math";

export interface Aquarium {
  fish: THREE.InstancedMesh;
  update: (time: number) => void;
}

/** Individually phased fish follow a bounded decorative loop, not a Boids simulation. */
export function aquarium(scene: THREE.Scene, p: Palette): Aquarium {
  const group = new THREE.Group();
  group.position.set(4.5, 0, 3.2);
  scene.add(group);
  block(group, {
    size: [2.4, 0.6, 0.9],
    at: [0, 0.34, 0],
    material: p.darkWood,
    radius: 0.06,
  });
  block(group, {
    size: [2.28, 1.03, 0.79],
    at: [0, 1.24, 0],
    material: new THREE.MeshPhysicalMaterial({
      color: "#126373",
      transparent: true,
      opacity: 0.19,
      roughness: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    radius: 0.008,
  });
  block(group, {
    size: [2.4, 0.04, 0.92],
    at: [0, 0.66, 0],
    material: p.bronze,
  });
  block(group, {
    size: [2.35, 1.15, 0.86],
    at: [0, 1.25, 0],
    material: p.glass,
    radius: 0.01,
  });
  const blue = new THREE.MeshStandardMaterial({
    color: "#216576",
    emissive: "#124452",
    emissiveIntensity: 0.25,
    roughness: 0.35,
  });
  block(group, {
    size: [2.3, 1.12, 0.02],
    at: [0, 1.25, -0.43],
    material: blue,
  });
  block(group, {
    size: [2.3, 0.06, 0.83],
    at: [0, 0.73, 0],
    material: p.stone,
  });
  block(group, {
    size: [2.43, 0.05, 0.95],
    at: [0, 1.84, 0],
    material: p.black,
  });
  block(group, {
    size: [2.2, 0.014, 0.06],
    at: [0, 1.8, 0.2],
    material: p.cool,
  });
  const body = new THREE.SphereGeometry(0.055, 10, 8);
  body.scale(2.1, 0.8, 0.65);
  const tail = new THREE.ConeGeometry(0.045, 0.1, 3);
  tail.rotateZ(-Math.PI / 2);
  tail.translate(-0.14, 0, 0);
  const parts = [body.toNonIndexed(), tail.toNonIndexed()];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  body.dispose();
  tail.dispose();
  if (!geometry) throw new Error("Cannot create aquarium fish geometry");
  const fish = new THREE.InstancedMesh(geometry, p.metal, 18);
  fish.frustumCulled = false;
  group.add(fish);
  const random = seeded(41);
  const phases = Array.from({ length: 18 }, () => random() * Math.PI * 2);
  const transform = new THREE.Object3D();
  const update = (time: number): void => {
    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index]! + time * (0.25 + (index % 3) * 0.025);
      transform.position.set(
        Math.sin(phase) * 0.86,
        1.15 + Math.sin(phase * 0.7 + index) * 0.27,
        Math.cos(phase) * 0.24,
      );
      transform.rotation.set(0, phase, Math.sin(phase * 3) * 0.08);
      transform.updateMatrix();
      fish.setMatrixAt(index, transform.matrix);
    }
    fish.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { fish, update };
}
