/** Detailed original appliance meshes, live displays, and visible actuators. */
import * as THREE from "three";

import type { DeviceId, HomeState } from "@shared/protocol";
import { APPLIANCE_CATALOG } from "@shared/appliances";
import { block, round, strip, textScreen, type Palette } from "@v2/scene/craft";

type Screen = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
const MILLIMETERS_TO_SCENE = 0.0015; // Match all three official appliance proportions to the room's authored units.
const CURTAIN_MOTION_RATE = 4; // Exponential response reaches the requested position smoothly in about one second.

function _fitReference(
  group: THREE.Group,
  id: keyof typeof APPLIANCE_CATALOG,
  authored: [number, number, number],
): void {
  const { model, sizeMm } = APPLIANCE_CATALOG[id];
  group.scale.set(
    (sizeMm.width * MILLIMETERS_TO_SCENE) / authored[0],
    (sizeMm.height * MILLIMETERS_TO_SCENE) / authored[1],
    (sizeMm.depth * MILLIMETERS_TO_SCENE) / authored[2],
  );
  group.userData.referenceModel = model;
}

export interface Devices3D {
  groups: Map<DeviceId, THREE.Group>;
  anchors: Map<DeviceId, THREE.Vector3>;
  tv: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  ac: Screen;
  fridge: Screen;
  curtains: THREE.Mesh[];
  curtainTargets: { scale: number; offset: number };
  mist: THREE.Points;
  light: THREE.PointLight;
  bulb: THREE.Mesh;
  time: { value: number };
  values: Map<string, string>;
}

/** Build the simulated household's six devices with consistent real-world scale. */
export function devices(scene: THREE.Scene, p: Palette): Devices3D {
  const groups = new Map<DeviceId, THREE.Group>();
  const locations: [DeviceId, [number, number, number]][] = [
    ["tv", [-2.7, 0, -4.5]],
    ["fridge", [2.3, 0, -3.95]],
    ["ac", [0.6, 3.65, -4.6]],
    ["humidifier", [1.4, 0, -3.5]],
    ["lights", [-4.8, 0, -3.6]],
    ["curtains", [-6.48, 0, -0.15]],
  ];
  for (const [id, at] of locations) {
    const group = new THREE.Group();
    group.position.set(...at);
    group.userData.deviceId = id;
    groups.set(id, group);
    scene.add(group);
  }
  const time = { value: 0 };
  const tv = television(groups.get("tv")!, p, time);
  const fridge = refrigerator(groups.get("fridge")!, p);
  const ac = airConditioner(groups.get("ac")!, p);
  const mist = humidifier(groups.get("humidifier")!, p, time);
  const { light, bulb } = lamp(groups.get("lights")!, p);
  const curtains = curtain(groups.get("curtains")!, p);
  const heights: Record<DeviceId, number> = {
    tv: 2.45,
    fridge: 3.15,
    ac: 0.4,
    humidifier: 1.35,
    lights: 2.75,
    curtains: 3.1,
  };
  const anchors = new Map<DeviceId, THREE.Vector3>();
  for (const [id, group] of groups)
    anchors.set(
      id,
      group.position.clone().add(new THREE.Vector3(0, heights[id], 0.5)),
    );
  return {
    groups,
    anchors,
    tv,
    fridge,
    ac,
    mist,
    curtains,
    curtainTargets: { scale: 0.65, offset: 3.65 },
    light,
    bulb,
    time,
    values: new Map(),
  };
}

function television(
  group: THREE.Group,
  p: Palette,
  time: { value: number },
): Devices3D["tv"] {
  block(group, {
    size: [4.25, 0.42, 0.78],
    at: [0, 0.38, 0],
    material: p.darkWood,
    radius: 0.08,
  });
  block(group, {
    size: [4.4, 0.08, 0.83],
    at: [0, 0.64, 0],
    material: p.stone,
  });
  strip(group, [4.1, 0.02, 0.04], [0, 0.16, 0.37], p.warm);
  for (const x of [-1.4, 0, 1.4]) {
    block(group, {
      size: [1.36, 0.33, 0.025],
      at: [x, 0.39, 0.402],
      material: p.porcelain,
      radius: 0.015,
    });
  }
  const panel = new THREE.Group();
  panel.position.y = 2.17;
  _fitReference(panel, "tv", [3.8, 2.14, 0.1]);
  group.add(panel);
  block(panel, {
    size: [3.8, 2.14, 0.1],
    at: [0, 0, 0],
    material: p.metal,
    radius: 0.06,
  });
  const shader = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uPower: { value: 0 } },
    vertexShader:
      "varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uPower;
      void main(){
        vec2 uv=(vUv-.5)*vec2(1.78,1.); float radius=length(uv);
        float angle=atan(uv.y,uv.x)+uTime*.025;
        vec3 color=mix(vec3(.01,.12,.28),vec3(.02,.48,.68),vUv.y);
        for(int i=0;i<7;i++){
          float layer=float(i);
          float petal=.10+layer*.065+.045*sin(angle*(9.+layer)+layer*.7);
          float edge=exp(-abs(radius-petal)*120.);
          float shade=exp(-abs(radius-petal-.012)*35.);
          color+=mix(vec3(.12,.7,.95),vec3(.35,.8,.5),1.-radius)*edge*.55;
          color+=vec3(.015,.06,.09)*shade;
        }
        color+=vec3(.55,.65,.14)*exp(-radius*9.);
        color=mix(vec3(.008,.015,.02),color,uPower);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.74, 2.08), shader);
  screen.position.set(0, 0, 0.06);
  panel.add(screen);
  display(panel, [0, -1.056, 0.056], [0.19, 0.06], { label: "Haier" });
  block(group, {
    size: [1.7, 0.09, 0.16],
    at: [0, 0.76, 0.15],
    material: p.porcelain,
    radius: 0.04,
  });
  round(group, {
    radius: 0.1,
    height: 0.23,
    at: [1.9, 0.82, 0],
    material: p.bronze,
  });
  return screen;
}

function refrigerator(group: THREE.Group, p: Palette): Screen {
  _fitReference(group, "fridge", [1.45, 2.85, 1.3]);
  const silver = p.metal.clone();
  silver.color.set("#abb0b5");
  silver.metalness = 0.5;
  silver.roughness = 0.38;
  block(group, {
    size: [1.45, 2.85, 1.3],
    at: [0, 1.47, 0],
    material: silver,
    radius: 0.065,
  });
  block(group, {
    size: [1.42, 2.73, 0.035],
    at: [0, 1.48, 0.65],
    material: p.black,
    radius: 0.025,
  });
  for (const x of [-0.36, 0.36]) {
    block(group, {
      size: [0.7, 1.64, 0.07],
      at: [x, 2.03, 0.67],
      material: silver,
      radius: 0.025,
    });
    block(group, {
      size: [0.7, 1.07, 0.07],
      at: [x, 0.65, 0.67],
      material: silver,
      radius: 0.025,
    });
    strip(group, [0.58, 0.025, 0.035], [x, 1.19, 0.72], p.black);
    strip(group, [0.5, 0.014, 0.04], [x, 1.145, 0.725], p.black);
    for (const y of [0.2, 2.77])
      block(group, {
        size: [0.1, 0.035, 0.035],
        at: [x < 0 ? -0.64 : 0.64, y, 0.704],
        material: p.bronze,
        radius: 0.008,
      });
  }
  for (let index = 0; index < 17; index += 1)
    strip(
      group,
      [0.035, 0.025, 0.01],
      [-0.56 + index * 0.07, 0.08, 0.67],
      p.black,
    );
  display(group, [0.47, 2.7, 0.714], [0.25, 0.11], { label: "Haier" });
  const screen = display(group, [0.37, 2.23, 0.713], [0.25, 0.32]);
  screen.visible = false; // The official four-door reference has a clean exterior, not this scenario readout.
  return screen;
}

function airConditioner(group: THREE.Group, p: Palette): Screen {
  _fitReference(group, "ac", [2.05, 0.56, 0.42]);
  block(group, {
    size: [2.05, 0.56, 0.42],
    at: [0, 0, 0],
    material: p.porcelain,
    radius: 0.12,
  });
  block(group, {
    size: [1.98, 0.38, 0.035],
    at: [0, 0.045, 0.217],
    material: p.porcelain,
    radius: 0.085,
  });
  for (let index = 0; index < 12; index += 1)
    strip(
      group,
      [0.11, 0.007, 0.24],
      [-0.82 + index * 0.15, 0.275, -0.02],
      p.bronze,
    );
  display(group, [0, -0.1, 0.238], [0.25, 0.1], { label: "Haier" });
  block(group, {
    size: [1.78, 0.07, 0.05],
    at: [0, -0.19, 0.22],
    material: p.black,
    radius: 0.015,
  });
  for (let index = 0; index < 2; index += 1)
    strip(
      group,
      [1.7, 0.022, 0.09],
      [0, -0.17 - index * 0.04, 0.245],
      p.porcelain,
    );
  return display(group, [0.65, 0.015, 0.221], [0.28, 0.16]);
}

function display(
  group: THREE.Group,
  at: [number, number, number],
  size: [number, number],
  { label }: { label?: string } = {},
): Screen {
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(...size),
    new THREE.MeshBasicMaterial({
      map: textScreen(label ?? "—", { badge: Boolean(label) }),
      transparent: Boolean(label),
      depthWrite: !label,
    }),
  );
  screen.position.set(...at);
  group.add(screen);
  return screen;
}

function humidifier(
  group: THREE.Group,
  p: Palette,
  time: { value: number },
): THREE.Points {
  round(group, {
    radius: 0.32,
    top: 0.29,
    height: 0.95,
    at: [0, 0.5, 0],
    material: p.porcelain,
  });
  round(group, {
    radius: 0.29,
    height: 0.04,
    at: [0, 0.99, 0],
    material: p.bronze,
  });
  round(group, {
    radius: 0.1,
    height: 0.025,
    at: [0, 1.02, 0],
    material: p.black,
  });
  strip(group, [0.06, 0.43, 0.02], [0, 0.48, 0.316], p.cool);
  const positions = new Float32Array(90 * 3);
  for (let index = 0; index < 90; index += 1) {
    positions[index * 3] = Math.sin(index * 2.4) * 0.12;
    positions[index * 3 + 1] = index / 90;
    positions[index * 3 + 2] = Math.cos(index * 2.4) * 0.12;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: time },
    vertexShader: `uniform float uTime; varying float vFade; void main(){
      vec3 p=position; p.y=mod(p.y+uTime*.22,1.3); vFade=(1.-p.y/1.3)*.22;
      p.x+=sin(uTime+p.y*5.)*p.y*.12; p.y+=1.05;
      vec4 view=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*view;
      gl_PointSize=55./max(1.,-view.z);
    }`,
    fragmentShader: `varying float vFade; void main(){float a=1.-smoothstep(.05,.5,length(gl_PointCoord-.5)); gl_FragColor=vec4(.8,.95,1.,a*vFade);}`,
  });
  const mist = new THREE.Points(geometry, material);
  mist.frustumCulled = false;
  group.add(mist);
  return mist;
}

function lamp(
  group: THREE.Group,
  p: Palette,
): { light: THREE.PointLight; bulb: THREE.Mesh } {
  round(group, {
    radius: 0.3,
    height: 0.065,
    at: [0, 0.06, 0],
    material: p.black,
  });
  round(group, {
    radius: 0.025,
    height: 2.25,
    at: [0, 1.18, 0],
    material: p.bronze,
  });
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.44, 0.52, 48, 1, true),
    p.bronze,
  );
  shade.position.set(0, 2.28, 0);
  shade.castShadow = true;
  group.add(shade);
  const bulb = round(group, {
    radius: 0.25,
    height: 0.035,
    at: [0, 2.05, 0],
    material: p.warm.clone(),
  });
  const light = new THREE.PointLight("#ffc48b", 20, 7, 2);
  light.position.set(0, 2.0, 0);
  group.add(light);
  return { light, bulb };
}

function curtain(group: THREE.Group, p: Palette): THREE.Mesh[] {
  const panels: THREE.Mesh[] = [];
  for (const direction of [-1, 1]) {
    const geometry = new THREE.PlaneGeometry(1.7, 4.25, 28, 1);
    const position = geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      position.setZ(index, Math.sin(position.getX(index) * 36) * 0.07);
    }
    geometry.computeVertexNormals();
    const material = p.fabric.clone();
    material.color.set("#9b9f9b");
    material.side = THREE.DoubleSide;
    const panel = new THREE.Mesh(geometry, material);
    panel.rotation.y = Math.PI / 2;
    panel.position.set(0, 2.27, direction * 3.65);
    panel.castShadow = true;
    group.add(panel);
    panels.push(panel);
  }
  return panels;
}

/** Tool results visibly change the same meshes that can be manually selected. */
export function updateDevices(view: Devices3D, home: HomeState): void {
  const all = new Map(home.devices.map((device) => [device.id, device]));
  view.tv.material.uniforms.uPower!.value = all.get("tv")?.power ? 1 : 0;
  view.mist.visible = Boolean(all.get("humidifier")?.power);
  const lampState = all.get("lights");
  const brightness = lampState?.power
    ? Number(lampState.settings.brightness) / 100
    : 0;
  view.light.intensity = brightness * 26;
  (view.bulb.material as THREE.MeshStandardMaterial).emissiveIntensity =
    brightness * 3;
  const open = all.get("curtains")?.settings.position !== "closed";
  view.curtainTargets.scale = open ? 0.65 : 2.55;
  view.curtainTargets.offset = open ? 3.65 : 2.05;
  const ac = all.get("ac");
  updateScreen(
    view,
    "ac",
    view.ac,
    ac?.power ? `${ac.settings.temperature}°` : "—",
  );
  const fridge = all.get("fridge");
  updateScreen(
    view,
    "fridge",
    view.fridge,
    fridge?.power ? `${fridge.settings.fridgeTemp}°` : "—",
  );
}

/**
 * Advance the shared curtain actuator without snapping between end positions.
 *
 * Parameters
 * ----------
 * view : Devices3D
 *     Shared appliance meshes used by both modern and Habitat renderers.
 * deltaSeconds : number
 *     Elapsed frame time.
 *
 * Returns
 * -------
 * boolean
 *     Whether another rendered frame is needed to finish the transition.
 */
export function animateDevices(view: Devices3D, deltaSeconds: number): boolean {
  const blend =
    1 - Math.exp(-CURTAIN_MOTION_RATE * Math.min(deltaSeconds, 0.1));
  let moving = false;
  for (const [index, panel] of view.curtains.entries()) {
    const targetZ = (index === 0 ? -1 : 1) * view.curtainTargets.offset;
    panel.scale.x = THREE.MathUtils.lerp(
      panel.scale.x,
      view.curtainTargets.scale,
      blend,
    );
    panel.position.z = THREE.MathUtils.lerp(panel.position.z, targetZ, blend);
    if (
      Math.abs(panel.scale.x - view.curtainTargets.scale) > 0.002 ||
      Math.abs(panel.position.z - targetZ) > 0.002
    )
      moving = true;
  }
  return moving;
}

function updateScreen(
  view: Devices3D,
  id: string,
  screen: Screen,
  value: string,
): void {
  if (view.values.get(id) === value) return;
  screen.material.map?.dispose();
  screen.material.map = textScreen(value);
  screen.material.needsUpdate = true;
  view.values.set(id, value);
}
