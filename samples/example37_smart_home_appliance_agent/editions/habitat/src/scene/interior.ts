/** Original enclosed architecture: oak joinery, warm plaster and real window openings. */
import * as THREE from "three";

import { block, round, strip, type Palette } from "@v2/scene/craft";

const ROOM = { width: 14, depth: 12, height: 4.7 }; // Shared geometry coordinates become meters through ROOM_SCALE.
const PLANK = { width: 0.54, length: 3, gap: 0.012 }; // Physical seams catch contact AO rather than painted black lines.

function floor(room: THREE.Group, p: Palette): void {
  block(room, {
    size: [14.2, 0.15, 12.2],
    at: [0, -0.12, 1],
    material: p.wood,
  });
  for (let column = 0; column < 26; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      block(room, {
        size: [PLANK.width - PLANK.gap, 0.04, PLANK.length - PLANK.gap],
        at: [-6.75 + column * PLANK.width, -0.02, -3.5 + row * PLANK.length],
        material: p.wood,
        radius: 0.006,
      });
    }
  }
}

function walls(room: THREE.Group, p: Palette): void {
  block(room, {
    size: [ROOM.width, ROOM.height, 0.2],
    at: [0, 2.35, -5],
    material: p.darkWood,
  });
  block(room, {
    size: [0.2, ROOM.height, ROOM.depth],
    at: [7, 2.35, 1],
    material: p.darkWood,
  });
  block(room, {
    size: [14.1, 0.18, 12],
    at: [0, 4.8, 1],
    material: p.darkWood,
  });
  block(room, {
    size: [5.4, 4.3, 0.08],
    at: [-2.7, 2.35, -4.85],
    material: p.stone,
  });
  for (const x of [-5.65, 0.25]) {
    block(room, {
      size: [0.4, 4.5, 0.15],
      at: [x, 2.35, -4.8],
      material: p.wood,
    });
    strip(room, [0.025, 4.3, 0.035], [x + 0.23, 2.35, -4.7], p.warm);
  }
  strip(room, [13.8, 0.12, 0.07], [0, 0.09, -4.8], p.porcelain);
  strip(room, [0.07, 0.12, 11.6], [6.8, 0.09, 1], p.porcelain);
}

function windows(room: THREE.Group, p: Palette): void {
  for (const z of [-4.7, -2.35, 0, 2.35, 4.7, 6.8])
    block(room, {
      size: [0.18, 4.6, 0.065],
      at: [-6.9, 2.35, z],
      material: p.wood,
    });
  for (const y of [0.18, 4.55])
    block(room, {
      size: [0.22, 0.16, 11.6],
      at: [-6.9, y, 1],
      material: p.porcelain,
    });
  block(room, {
    size: [0.03, 4.2, 11.6],
    at: [-7, 2.35, 1],
    material: p.glass,
  });
  const daylight = new THREE.MeshBasicMaterial({
    color: "#e8ede8",
    side: THREE.DoubleSide,
  });
  block(room, {
    size: [0.05, 8, 20],
    at: [-10, 3, 0],
    material: daylight,
  }).castShadow = false;
  block(room, {
    size: [0.75, 0.1, 11.5],
    at: [-6.65, 0.2, 1],
    material: p.stone,
  });
}

function ceiling(room: THREE.Group, p: Palette): void {
  for (const x of [-6.5, 6.5]) {
    block(room, {
      size: [0.8, 0.22, 11.8],
      at: [x, 4.55, 1],
      material: p.darkWood,
    });
    strip(
      room,
      [0.04, 0.035, 11.7],
      [x + (x < 0 ? 0.44 : -0.44), 4.48, 1],
      p.warm,
    );
  }
  for (const z of [-4.5, 6.5])
    block(room, {
      size: [12.4, 0.22, 0.7],
      at: [0, 4.55, z],
      material: p.darkWood,
    });
  for (const x of [-4.5, 0, 4.5])
    round(room, {
      radius: 0.1,
      height: 0.035,
      at: [x, 4.42, -3.8],
      material: p.warm,
    });
}

function objects(room: THREE.Group, p: Palette): void {
  for (let index = 0; index < 10; index += 1)
    strip(room, [0.025, 0.94, 0.045], [3.6 + index * 0.23, 0.65, -0.9], p.wood);
  const art = new THREE.MeshStandardMaterial({
    color: "#c5b7a0",
    roughness: 0.95,
  });
  block(room, {
    size: [0.08, 1.65, 2],
    at: [6.82, 2.6, -0.7],
    material: p.wood,
  });
  block(room, {
    size: [0.025, 1.45, 1.8],
    at: [6.76, 2.6, -0.7],
    material: p.stone,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.52, 48), art);
  disc.rotation.y = -Math.PI / 2;
  disc.position.set(6.735, 2.7, -0.7);
  room.add(disc);
}

/**
 * Build original enclosing surfaces around the reused household geometry.
 *
 * Parameters
 * ----------
 * scene : THREE.Scene
 *     Authored-coordinate scene, scaled by the renderer once.
 * p : Palette
 *     Materials shared with the appliance constructors.
 *
 * Returns
 * -------
 * void
 *     Geometry is attached to scene.
 */
export function interior(scene: THREE.Scene, p: Palette): void {
  const room = new THREE.Group();
  room.name = "Habitat original enclosed interior";
  scene.add(room);
  floor(room, p);
  walls(room, p);
  windows(room, p);
  ceiling(room, p);
  objects(room, p);
}
