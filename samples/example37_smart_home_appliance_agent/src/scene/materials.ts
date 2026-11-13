/** Original procedural surfaces; no downloaded models, textures, or proprietary assets. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export interface BoxSpec {
  size: [number, number, number];
  at: [number, number, number];
  color: THREE.ColorRepresentation;
  radius?: number;
  metalness?: number;
  roughness?: number;
}

/** Create a softly edged architectural or furniture piece. */
export function box(parent: THREE.Object3D, spec: BoxSpec): THREE.Mesh {
  const radius = spec.radius ?? 0.035;
  const geometry = new RoundedBoxGeometry(...spec.size, 3, radius);
  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness ?? 0.65,
    metalness: spec.metalness ?? 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...spec.at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Create a round furniture detail or plant pot. */
export function cylinder(
  parent: THREE.Object3D,
  spec: {
    top: number;
    bottom?: number;
    height: number;
    at: [number, number, number];
    color: THREE.ColorRepresentation;
  },
): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(
    spec.top,
    spec.bottom ?? spec.top,
    spec.height,
    40,
  );
  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.7,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...spec.at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Paint crisp small appliance displays without shipping bitmap assets. */
export function displayTexture(
  value: string,
  options: { background: string; foreground: string },
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create appliance display");
  context.fillStyle = options.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = options.foreground;
  context.font = "500 76px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(value, 256, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Create the original abstract landscape on the television. */
export function televisionTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 600;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create television display");
  const gradient = context.createLinearGradient(0, 0, 1024, 600);
  gradient.addColorStop(0, "#789caa");
  gradient.addColorStop(0.55, "#c4d2cb");
  gradient.addColorStop(1, "#e5d6b7");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1024, 600);
  context.fillStyle = "#ebdfc3";
  context.beginPath();
  context.arc(760, 155, 75, 0, Math.PI * 2);
  context.fill();
  drawHills(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawHills(context: CanvasRenderingContext2D): void {
  for (let layer = 0; layer < 3; layer += 1) {
    context.fillStyle = ["#718f85", "#496e64", "#294f48"][layer]!;
    context.beginPath();
    context.moveTo(0, 330 + layer * 70);
    context.bezierCurveTo(
      240,
      160 + layer * 90,
      490,
      570 - layer * 20,
      1024,
      280 + layer * 90,
    );
    context.lineTo(1024, 600);
    context.lineTo(0, 600);
    context.fill();
  }
}
