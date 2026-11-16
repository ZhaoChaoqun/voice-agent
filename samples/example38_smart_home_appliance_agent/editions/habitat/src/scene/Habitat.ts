/** Fourth-edition scene ownership, real room reflections and truthful diagnostics. */
import * as THREE from "three";

import type { DeviceId, HomeState } from "@shared/protocol";
import { furnishings } from "@v2/scene/architecture";
import { batchStatic, type Palette } from "@v2/scene/craft";
import {
  animateDevices,
  devices,
  updateDevices,
  type Devices3D,
} from "@v2/scene/devices";
import { advanceTime, type Atmosphere } from "@v2/scene/math";
import { interior } from "@habitat/scene/interior";
import { habitatPalette } from "@habitat/scene/materials";
import { framing, qualityFor, ROOM_SCALE } from "@habitat/scene/math";
import { Pipeline } from "@habitat/scene/pipeline";

export interface HabitatSnapshot {
  ready: boolean;
  frames: number;
  fps: number;
  calls: number;
  triangles: number;
  time: number;
  paused: boolean;
  atmosphere: Atmosphere;
  selected: DeviceId | null;
  curtains: { scales: number[]; positions: number[]; targetScale: number };
  camera: { position: number[]; direction: number[]; fov: number };
  quality: ReturnType<typeof qualityFor>;
  pipeline: {
    toneMapping: "AgX" | "unexpected";
    passes: string[];
    ao: { width: number; height: number; samples: number; blend: number };
    shadow: { width: number; height: number; enabled: boolean };
    reflection: {
      captures: number;
      size: number;
      pmremWidth: number;
      pmremHeight: number;
      source: "room CubeCamera + PMREM";
    };
    pbr: {
      name: string;
      albedo: boolean;
      normal: boolean;
      roughness: boolean;
    }[];
    volumetricRays: false;
  };
}

const CAPTURE_POSITION = [0, 1.5, -0.5] as const; // The reflection probe sits inside this room, not in an unrelated skybox.
const SUN_TARGET = [0, 0, -0.8] as const; // Window light crosses the living-room floor and receives real occluder shadows.
const SUN_POSITION = [-12, 6, 3.5] as const; // A low window angle enters below the real ceiling instead of hitting the roof.

function createRenderer(pixelRatio: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.45;
  renderer.info.autoReset = false;
  renderer.domElement.setAttribute(
    "aria-label",
    "Smart Home Habitat interactive eye-level interior",
  );
  renderer.debug.onShaderError = () => {
    throw new Error("Habitat shader compilation failed");
  };
  return renderer;
}

function buildHousehold(scene: THREE.Scene, p: Palette): Devices3D {
  interior(scene, p);
  furnishings(scene, p);
  batchStatic(scene);
  const household = devices(scene, p);
  for (const curtain of household.curtains)
    (curtain.material as THREE.MeshStandardMaterial).color.set("#f2eadc");
  scene.scale.setScalar(ROOM_SCALE);
  for (const point of household.anchors.values())
    point.multiplyScalar(ROOM_SCALE);
  return household;
}

function disposeRoom(scene: THREE.Scene, p: Palette): void {
  const materials = new Set<THREE.Material>(Object.values(p));
  const textures = new Set<THREE.Texture>();
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh) && !(node instanceof THREE.Points))
      return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material])
      materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

/**
 * Render a fixed eye-level interior without changing the existing app or backend.
 */
export class Habitat {
  private readonly scene = new THREE.Scene();
  private readonly quality = qualityFor(innerWidth, devicePixelRatio);
  private readonly renderer = createRenderer(this.quality.pixelRatio);
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 40);
  private readonly p = habitatPalette(this.quality.textureSize);
  private readonly household: Devices3D;
  private readonly pipeline: Pipeline;
  private readonly sun = new THREE.DirectionalLight("#fff1da", 3.2);
  private readonly fill = new THREE.HemisphereLight("#f4f6ff", "#d0bfa5", 1.7);
  private readonly cube = new THREE.WebGLCubeRenderTarget(
    this.quality.cubeSize,
    { type: THREE.HalfFloatType },
  );
  private readonly probe = new THREE.CubeCamera(0.1, 40, this.cube);
  private readonly pmrem = new THREE.PMREMGenerator(this.renderer);
  private readonly observer: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private environment: THREE.WebGLRenderTarget | null = null;
  private mode: Atmosphere = "day";
  private selected: DeviceId | null = null;
  private frame = 0;
  private frames = 0;
  private fps = 0;
  private samples = 0;
  private sampleStart = performance.now();
  private previous = performance.now();
  private renderTime = 0;
  private time = 0;
  private captures = 0;
  private roomRevision = -1;
  private dirty = true;
  private disposed = false;
  private failed = false;
  private down = { x: 0, y: 0 };
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    private readonly host: HTMLDivElement,
    private readonly markers: Map<DeviceId, HTMLButtonElement>,
    private readonly onSelect: (device: DeviceId) => void,
    private readonly onFailure: (message: string) => void,
  ) {
    this.host.prepend(this.renderer.domElement);
    this.scene.background = new THREE.Color("#f1eee5");
    this.household = buildHousehold(this.scene, this.p);
    this.lighting();
    this.pipeline = new Pipeline(
      this.renderer,
      this.scene,
      this.camera,
      this.quality,
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.pick);
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    this.resize();
    this.setAtmosphere("day");
    this.frame = requestAnimationFrame(this.animate);
    console.info("Habitat renderer initialized", this.quality.name);
  }

  private lighting(): void {
    this.sun.position.set(...SUN_POSITION);
    this.sun.target.position.set(...SUN_TARGET);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(this.quality.shadowSize);
    Object.assign(this.sun.shadow.camera, {
      left: -9,
      right: 9,
      top: 8,
      bottom: -8,
      near: 0.5,
      far: 25,
    });
    this.sun.shadow.normalBias = 0.018;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target, this.fill);
    this.probe.position.set(...CAPTURE_POSITION);
  }

  private resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height || this.disposed) return;
    const view = framing(width / height);
    this.camera.aspect = width / height;
    this.camera.fov = view.fov;
    this.camera.position.set(...view.position);
    this.camera.lookAt(...view.target);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.pipeline.resize(width, height);
    this.dirty = true;
  }

  private captureRoom(): void {
    this.scene.environment = null;
    this.probe.update(this.renderer, this.scene);
    const next = this.pmrem.fromCubemap(this.cube.texture);
    this.scene.environment = next.texture;
    this.environment?.dispose();
    this.environment = next;
    this.captures += 1;
    console.debug("Habitat room reflection captured", this.captures);
  }

  private invalidateReflection(): void {
    this.scene.environment = null;
    this.environment?.dispose();
    this.environment = null;
    this.dirty = true;
  }

  private animate = (now: number): void => {
    if (this.disposed || this.failed) return;
    this.frame = requestAnimationFrame(this.animate);
    const delta = (now - this.previous) / 1000;
    this.previous = now;
    if (document.hidden) return;
    this.time = advanceTime(this.time, delta, this.paused);
    if (animateDevices(this.household, delta)) this.dirty = true;
    if (
      !this.dirty &&
      (this.paused || now - this.renderTime < 1000 / this.quality.fpsLimit)
    )
      return;
    try {
      if (!this.environment) this.captureRoom();
      this.render(now);
    } catch (error) {
      this.fail(
        error instanceof Error ? error.message : "Habitat rendering failed",
      );
    }
  };

  private render(now: number): void {
    this.household.time.value = this.time;
    this.renderer.info.reset();
    this.pipeline.composer.render();
    this.project();
    this.frames += 1;
    this.samples += 1;
    if (now - this.sampleStart >= 1000) {
      this.fps = (this.samples * 1000) / (now - this.sampleStart);
      this.samples = 0;
      this.sampleStart = now;
    }
    this.renderTime = now;
    this.dirty = false;
  }

  private project(): void {
    for (const [id, point] of this.household.anchors) {
      const marker = this.markers.get(id);
      if (!marker) continue;
      const projected = point.clone().project(this.camera);
      marker.style.left = `${(projected.x * 0.5 + 0.5) * this.host.clientWidth}px`;
      marker.style.top = `${(-projected.y * 0.5 + 0.5) * this.host.clientHeight}px`;
      marker.hidden =
        projected.z < -1 ||
        projected.z > 1 ||
        Math.abs(projected.x) > 0.9 ||
        Math.abs(projected.y) > 0.9;
    }
  }

  private pointerDown = (event: PointerEvent): void => {
    this.down = { x: event.clientX, y: event.clientY };
  };

  private pick = (event: PointerEvent): void => {
    if (
      Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5
    )
      return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const hits = this.raycaster.intersectObjects(
      [...this.household.groups.values()],
      true,
    );
    let node: THREE.Object3D | null = hits[0]?.object ?? null;
    while (node && !node.userData.deviceId) node = node.parent;
    if (node) this.onSelect(node.userData.deviceId as DeviceId);
  };

  private contextLost = (event: Event): void => {
    event.preventDefault();
    this.fail(
      "WebGL context lost. Reload after enabling hardware acceleration.",
    );
  };

  private fail(message: string): void {
    this.failed = true;
    cancelAnimationFrame(this.frame);
    console.error("Habitat rendering stopped:", message);
    this.onFailure(message);
  }

  /**
   * Apply authoritative shared tool/manual state to the reused appliance meshes.
   *
   * Parameters
   * ----------
   * home : HomeState
   *     Server household revision.
   *
   * Returns
   * -------
   * void
   *     Displays, curtains, lights and mist reflect the server state.
   */
  update(home: HomeState): void {
    updateDevices(this.household, home);
    if (home.revision !== this.roomRevision) {
      this.roomRevision = home.revision;
      this.invalidateReflection();
      console.debug("Habitat household revision applied", home.revision);
    }
    this.dirty = true;
  }

  /**
   * Change real light/exposure settings and recapture this room's reflections.
   *
   * Parameters
   * ----------
   * mode : Atmosphere
   *     Requested daylight, dusk or cinema look.
   *
   * Returns
   * -------
   * void
   *     The next frame recaptures the room probe.
   */
  setAtmosphere(mode: Atmosphere): void {
    this.mode = mode;
    const looks = {
      day: {
        sun: 3.4,
        fill: 0.85,
        color: "#fff4e3",
        exposure: 1.25,
        environment: 0.5,
      },
      dusk: {
        sun: 1.6,
        fill: 0.65,
        color: "#ffd3aa",
        exposure: 1.2,
        environment: 0.4,
      },
      cinema: {
        sun: 0.2,
        fill: 0.4,
        color: "#c5d8ff",
        exposure: 1,
        environment: 0.3,
      },
    };
    const look = looks[mode];
    this.sun.intensity = look.sun;
    this.sun.color.set(look.color);
    this.fill.intensity = look.fill;
    this.renderer.toneMappingExposure = look.exposure;
    this.scene.environmentIntensity = look.environment;
    this.invalidateReflection();
    console.debug("Habitat atmosphere changed", mode);
  }

  /**
   * Select a device without moving the fixed camera.
   *
   * Parameters
   * ----------
   * id : DeviceId | null
   *     Device highlighted by the shared control panel.
   *
   * Returns
   * -------
   * void
   *     Selection is visible in the read-only diagnostics.
   */
  select(id: DeviceId | null): void {
    this.selected = id;
    this.dirty = true;
  }

  /**
   * Expose actual rendered resources, not cosmetic feature flags.
   *
   * Returns
   * -------
   * HabitatSnapshot
   *     Camera, performance, actual AO allocations and reflection capture counts.
   */
  snapshot(): HabitatSnapshot {
    return {
      ready: this.frames > 0 && !this.failed,
      frames: this.frames,
      fps: Math.round(this.fps),
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      time: this.time,
      paused: this.paused,
      atmosphere: this.mode,
      selected: this.selected,
      curtains: {
        scales: this.household.curtains.map((curtain) => curtain.scale.x),
        positions: this.household.curtains.map((curtain) => curtain.position.z),
        targetScale: this.household.curtainTargets.scale,
      },
      camera: {
        position: this.camera.position.toArray(),
        direction: this.camera.getWorldDirection(new THREE.Vector3()).toArray(),
        fov: this.camera.fov,
      },
      quality: this.quality,
      pipeline: this.pipelineSnapshot(),
    };
  }

  private pipelineSnapshot(): HabitatSnapshot["pipeline"] {
    return {
      toneMapping:
        this.renderer.toneMapping === THREE.AgXToneMapping
          ? "AgX"
          : "unexpected",
      passes: this.pipeline.describe(),
      ao: {
        width: this.pipeline.ao.width,
        height: this.pipeline.ao.height,
        samples: this.quality.aoSamples,
        blend: this.pipeline.ao.blendIntensity,
      },
      shadow: {
        width: this.sun.shadow.map?.width ?? 0,
        height: this.sun.shadow.map?.height ?? 0,
        enabled: this.renderer.shadowMap.enabled,
      },
      reflection: {
        captures: this.captures,
        size: this.cube.width,
        pmremWidth: this.environment?.width ?? 0,
        pmremHeight: this.environment?.height ?? 0,
        source: "room CubeCamera + PMREM",
      },
      pbr: this.materialSnapshot(),
      volumetricRays: false,
    };
  }

  private materialSnapshot(): HabitatSnapshot["pipeline"]["pbr"] {
    return ["wood", "fabric", "stone", "darkWood"].map((name) => {
      const material = this.p[name as keyof Palette];
      return {
        name,
        albedo: Boolean(material.map),
        normal: Boolean(material.normalMap),
        roughness: Boolean(material.roughnessMap),
      };
    });
  }

  /**
   * Release GPU allocations, observers and event handlers.
   *
   * Returns
   * -------
   * void
   *     This scene no longer schedules frames or retains a canvas.
   */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.pointerDown,
    );
    this.renderer.domElement.removeEventListener("pointerup", this.pick);
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    disposeRoom(this.scene, this.p);
    this.environment?.dispose();
    this.cube.dispose();
    this.pmrem.dispose();
    this.sun.shadow.dispose();
    this.pipeline.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
