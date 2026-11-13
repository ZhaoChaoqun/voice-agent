/** Interactive original appliance models and state-driven display materials. */
import * as THREE from "three";

import type { DeviceId, HomeState } from "@shared/protocol";
import {
  box,
  cylinder,
  displayTexture,
  televisionTexture,
} from "@/scene/materials";

export interface Appliances {
  groups: Map<DeviceId, THREE.Group>;
  anchors: Map<DeviceId, THREE.Vector3>;
  screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  acDisplay: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  fridgeDisplay: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  mist: THREE.Group;
  curtains: THREE.Group[];
  lamp: THREE.PointLight;
  lampShade: THREE.Mesh;
  previousTemperature: string;
  previousFridgeTemperature: string;
}

/** Build appliances once; updates mutate materials rather than recreate geometry. */
export function buildAppliances(root: THREE.Group): Appliances {
  const groups = new Map<DeviceId, THREE.Group>();
  const anchors = new Map<DeviceId, THREE.Vector3>();
  for (const [id, at] of applianceLocations()) {
    const group = new THREE.Group();
    group.position.set(...at);
    group.userData.deviceId = id;
    root.add(group);
    groups.set(id, group);
  }
  const screen = buildTelevision(groups.get("tv")!);
  const fridgeDisplay = buildFridge(groups.get("fridge")!);
  const acDisplay = buildAirConditioner(groups.get("ac")!);
  const mist = buildHumidifier(groups.get("humidifier")!);
  const curtains = buildCurtains(groups.get("curtains")!);
  const { lamp, lampShade } = buildLamp(groups.get("lights")!);
  for (const [id, group] of groups) {
    anchors.set(
      id,
      group.position.clone().add(new THREE.Vector3(0, anchorHeight(id), 0.1)),
    );
  }
  return {
    groups,
    anchors,
    screen,
    acDisplay,
    fridgeDisplay,
    mist,
    curtains,
    lamp,
    lampShade,
    previousTemperature: "",
    previousFridgeTemperature: "",
  };
}

function applianceLocations(): [DeviceId, [number, number, number]][] {
  return [
    ["tv", [-0.9, 0, -3.24]],
    ["fridge", [3.8, 0, -2.55]],
    ["ac", [1.12, 2.92, -3.25]],
    ["humidifier", [2.45, 0, 0.4]],
    ["lights", [-3.9, 0, 1.0]],
    ["curtains", [-4.55, 0, -0.45]],
  ];
}

function anchorHeight(id: DeviceId): number {
  if (id === "tv") return 2.55;
  if (id === "fridge") return 2.9;
  if (id === "ac") return 0.53;
  if (id === "humidifier") return 1.13;
  if (id === "lights") return 2.5;
  return 3.1;
}

function buildTelevision(group: THREE.Group): Appliances["screen"] {
  box(group, {
    size: [3.25, 0.5, 0.65],
    at: [0, 0.38, 0.12],
    color: "#af9674",
    radius: 0.06,
  });
  box(group, {
    size: [3.35, 0.065, 0.72],
    at: [0, 0.66, 0.12],
    color: "#c2ac8b",
  });
  for (const x of [-1.05, 0, 1.05]) {
    box(group, {
      size: [0.018, 0.3, 0.015],
      at: [x, 0.39, 0.46],
      color: "#8d775b",
      radius: 0.003,
    });
  }
  box(group, {
    size: [2.92, 1.72, 0.11],
    at: [0, 1.83, 0.05],
    color: "#202d2c",
    radius: 0.06,
  });
  const material = new THREE.MeshStandardMaterial({
    map: televisionTexture(),
    emissive: "#c2e0dc",
    emissiveIntensity: 0.25,
    roughness: 0.35,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.76, 1.56), material);
  screen.position.set(0, 1.84, 0.112);
  group.add(screen);
  box(group, {
    size: [0.9, 0.065, 0.1],
    at: [0, 0.76, 0.37],
    color: "#394441",
    radius: 0.03,
  });
  cylinder(group, {
    top: 0.14,
    height: 0.24,
    at: [1.36, 0.81, 0.13],
    color: "#e0e0cb",
  });
  return screen;
}

function buildFridge(group: THREE.Group): Appliances["fridgeDisplay"] {
  box(group, {
    size: [1.4, 2.65, 1.25],
    at: [0, 1.4, 0],
    color: "#c9cecb",
    radius: 0.07,
    metalness: 0.55,
    roughness: 0.32,
  });
  for (const x of [-0.35, 0.35]) {
    box(group, {
      size: [0.68, 1.42, 0.065],
      at: [x, 1.96, 0.65],
      color: "#e1e4df",
      radius: 0.028,
      metalness: 0.45,
    });
    box(group, {
      size: [0.68, 0.98, 0.065],
      at: [x, 0.73, 0.65],
      color: "#d1d6d1",
      radius: 0.028,
      metalness: 0.45,
    });
    box(group, {
      size: [0.035, 0.55, 0.07],
      at: [x < 0 ? -0.07 : 0.07, 1.67, 0.71],
      color: "#9da8a3",
      metalness: 0.6,
    });
  }
  box(group, {
    size: [0.22, 0.3, 0.018],
    at: [0.35, 2.13, 0.69],
    color: "#3d5350",
    radius: 0.01,
  });
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.1),
    new THREE.MeshBasicMaterial({
      map: displayTexture("4°", {
        background: "#3d5350",
        foreground: "#b8e3d8",
      }),
    }),
  );
  display.position.set(0.35, 2.15, 0.705);
  group.add(display);
  return display;
}

function buildAirConditioner(group: THREE.Group): Appliances["acDisplay"] {
  box(group, {
    size: [1.9, 0.51, 0.42],
    at: [0, 0, 0],
    color: "#f4f4eb",
    radius: 0.09,
  });
  box(group, {
    size: [1.62, 0.055, 0.06],
    at: [0, -0.18, 0.2],
    color: "#aebbb2",
    radius: 0.01,
  });
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.15),
    new THREE.MeshBasicMaterial({ transparent: true }),
  );
  display.position.set(0.57, -0.02, 0.222);
  group.add(display);
  return display;
}

function buildHumidifier(group: THREE.Group): THREE.Group {
  cylinder(group, {
    top: 0.29,
    bottom: 0.33,
    height: 0.78,
    at: [0, 0.46, 0],
    color: "#e9ebe3",
  });
  cylinder(group, {
    top: 0.28,
    height: 0.045,
    at: [0, 0.87, 0],
    color: "#99bcb4",
  });
  cylinder(group, {
    top: 0.12,
    height: 0.025,
    at: [0, 0.9, 0],
    color: "#b0c9c1",
  });
  box(group, {
    size: [0.08, 0.3, 0.02],
    at: [0, 0.48, 0.31],
    color: "#b8d2cc",
    radius: 0.025,
  });
  const mist = new THREE.Group();
  group.add(mist);
  for (let index = 0; index < 12; index += 1) {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 8, 8),
      new THREE.MeshBasicMaterial({
        color: "#f1ffff",
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    particle.position.set(
      Math.sin(index * 2.3) * 0.08,
      0.95 + index * 0.06,
      Math.cos(index * 2.3) * 0.06,
    );
    mist.add(particle);
  }
  return mist;
}

function buildCurtains(group: THREE.Group): THREE.Group[] {
  const curtains: THREE.Group[] = [];
  for (const direction of [-1, 1]) {
    const curtain = new THREE.Group();
    curtain.position.set(0, 0, direction * 1.6);
    for (let index = 0; index < 8; index += 1) {
      cylinder(curtain, {
        top: 0.075,
        height: 2.85,
        at: [Math.sin(index) * 0.04, 1.95, (index / 8 - 0.5) * 0.55],
        color: index % 2 ? "#c4c6b7" : "#d4d5c7",
      });
    }
    group.add(curtain);
    curtains.push(curtain);
  }
  return curtains;
}

function buildLamp(group: THREE.Group): {
  lamp: THREE.PointLight;
  lampShade: THREE.Mesh;
} {
  cylinder(group, {
    top: 0.28,
    height: 0.06,
    at: [0, 0.09, 0],
    color: "#777b66",
  });
  cylinder(group, {
    top: 0.025,
    height: 1.9,
    at: [0, 1.02, 0],
    color: "#8d8a70",
  });
  const lampShade = cylinder(group, {
    top: 0.26,
    bottom: 0.43,
    height: 0.48,
    at: [0, 2.12, 0],
    color: "#f0e2b9",
  });
  const lamp = new THREE.PointLight("#ffe0a3", 5, 5);
  lamp.position.set(0, 1.9, 0);
  group.add(lamp);
  return { lamp, lampShade };
}

/** Reflect authoritative tool/manual changes in visible appliance state. */
export function updateAppliances(
  appliances: Appliances,
  home: HomeState,
): void {
  const devices = new Map(home.devices.map((device) => [device.id, device]));
  const television = devices.get("tv");
  appliances.screen.material.color.set(
    television?.power ? "#ffffff" : "#14231f",
  );
  appliances.screen.material.emissiveIntensity = television?.power ? 0.3 : 0;
  appliances.screen.visible = Boolean(television?.power);
  appliances.mist.visible = Boolean(devices.get("humidifier")?.power);
  const light = devices.get("lights");
  appliances.lamp.intensity = light?.power
    ? Number(light.settings.brightness ?? 65) / 13
    : 0;
  const shadeMaterial = appliances.lampShade
    .material as THREE.MeshStandardMaterial;
  shadeMaterial.emissive.set(light?.power ? "#ad8741" : "#000000");
  shadeMaterial.emissiveIntensity = light?.power ? 0.22 : 0;
  const curtain = devices.get("curtains");
  const open = curtain?.settings.position !== "closed";
  for (const [index, panel] of appliances.curtains.entries()) {
    panel.scale.z = open ? 1 : 3.4;
    panel.position.z = (index === 0 ? -1 : 1) * (open ? 1.6 : 0.85);
  }
  const ac = devices.get("ac");
  const value = ac?.power ? `${ac.settings.temperature ?? 24}°` : "—";
  appliances.previousTemperature = updateDisplay(
    appliances.acDisplay,
    value,
    appliances.previousTemperature,
    {
      background: "#f4f4eb",
      foreground: "#728f85",
    },
  );
  const fridge = devices.get("fridge");
  const fridgeValue = fridge?.power
    ? `${fridge.settings.fridgeTemp ?? 4}°`
    : "—";
  appliances.previousFridgeTemperature = updateDisplay(
    appliances.fridgeDisplay,
    fridgeValue,
    appliances.previousFridgeTemperature,
    {
      background: "#3d5350",
      foreground: "#b8e3d8",
    },
  );
}

function updateDisplay(
  mesh: Appliances["acDisplay"],
  value: string,
  previous: string,
  colors: { background: string; foreground: string },
): string {
  if (value === previous) return previous;
  mesh.material.map?.dispose();
  mesh.material.map = displayTexture(value, colors);
  mesh.material.needsUpdate = true;
  return value;
}
