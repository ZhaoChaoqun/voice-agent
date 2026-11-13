/** Cinematic scene ownership, postprocessing, picking, and state-driven focus. */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { Reflector } from "three/addons/objects/Reflector.js";

import type { DeviceId, HomeState } from "@shared/protocol";
import {
  architecture,
  furnishings,
  type Architecture,
} from "@v2/scene/architecture";
import { atmosphere, type World } from "@v2/scene/atmosphere";
import { aquarium, type Aquarium } from "@v2/scene/aquarium";
import { batchStatic, palette, type Palette } from "@v2/scene/craft";
import {
  animateDevices,
  devices,
  updateDevices,
  type Devices3D,
} from "@v2/scene/devices";
import { advanceTime, homeFraming, type Atmosphere } from "@v2/scene/math";

export interface SceneSnapshot {
  ready: boolean;
  fps: number;
  calls: number;
  triangles: number;
  time: number;
  paused: boolean;
  atmosphere: Atmosphere;
  selected: DeviceId | null;
  camera: { position: number[]; direction: number[]; fov: number };
}

const PIXEL_RATIO_LIMIT = 1.6; // Keep reflections and postprocessing bounded on retina displays.

export class Atelier {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(43, 1, 0.1, 350);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly observer: ResizeObserver;
  private readonly p: Palette;
  private readonly built: Architecture;
  private readonly world: World;
  private readonly household: Devices3D;
  private readonly tank: Aquarium;
  private readonly reflector: Reflector;
  private readonly fill: THREE.HemisphereLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly clock = new THREE.Clock();
  private selected: DeviceId | null = null;
  private mode: Atmosphere = "day";
  private time = 0;
  private frame = 0;
  private disposed = false;
  private down = { x: 0, y: 0 };
  private fps = 0;
  private sampleFrames = 0;
  private sampleTime = 0;
  paused = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    private readonly host: HTMLDivElement,
    private readonly markers: Map<DeviceId, HTMLButtonElement>,
    private readonly onSelect: (device: DeviceId) => void,
  ) {
    this.renderer = this.createRenderer();
    host.prepend(this.renderer.domElement);
    this.p = palette();
    this.built = architecture(this.scene, this.p);
    furnishings(this.scene, this.p);
    batchStatic(this.scene);
    this.household = devices(this.scene, this.p);
    this.world = atmosphere(this.scene, this.renderer, this.p);
    this.tank = aquarium(this.scene, this.p);
    this.reflector = this.floorReflection();
    this.fill = new THREE.HemisphereLight("#e7f2ff", "#c3ae90", 1.6);
    this.scene.add(this.fill);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.5, 1.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass());
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.pick);
    document.addEventListener("visibilitychange", this.visibility);
    this.resize();
    this.animate();
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, PIXEL_RATIO_LIMIT),
    );
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.info.autoReset = false;
    renderer.domElement.setAttribute(
      "aria-label",
      "Smart Home Atelier interactive three-dimensional penthouse",
    );
    return renderer;
  }

  private floorReflection(): Reflector {
    const floor = new Reflector(new THREE.PlaneGeometry(13.7, 9.95), {
      textureWidth: 512,
      textureHeight: 512,
      color: "#d6c6af",
      clipBias: 0.003,
    });
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.018;
    const material = floor.material as THREE.ShaderMaterial;
    material.fragmentShader = material.fragmentShader.replace(
      "gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );",
      `vec2 grainUv=gl_FragCoord.xy*.008;
       float grain=sin(grainUv.x*17.+sin(grainUv.y*.4))*.012;
       vec3 oak=vec3(.55,.45,.32)+grain;
       gl_FragColor=vec4(mix(oak,blendOverlay(base.rgb,color),.13),1.);`,
    );
    this.scene.add(floor);
    return floor;
  }

  private resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    if (this.camera.aspect < 0.8)
      this.camera.setViewOffset(
        width,
        height,
        0,
        -height * 0.08,
        width,
        height,
      );
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.frameCamera();
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    this.time = advanceTime(this.time, delta, this.paused);
    animateDevices(this.household, delta);
    this.world.time.value = this.time;
    this.household.time.value = this.time;
    this.world.orb.rotation.y = this.time * 0.2;
    this.world.orb.position.y = 1.8 + Math.sin(this.time * 0.8) * 0.05;
    this.tank.update(this.time);
    this.renderer.info.reset();
    this.composer.render();
    this.project();
    this.sampleFrames += 1;
    this.sampleTime += delta;
    if (this.sampleTime >= 1) {
      this.fps = this.sampleFrames / this.sampleTime;
      this.sampleFrames = 0;
      this.sampleTime = 0;
    }
  };

  private project(): void {
    for (const [id, point] of this.household.anchors) {
      const button = this.markers.get(id);
      if (!button) continue;
      const projected = point.clone().project(this.camera);
      button.style.left = `${(projected.x * 0.5 + 0.5) * this.host.clientWidth}px`;
      button.style.top = `${(-projected.y * 0.5 + 0.5) * this.host.clientHeight}px`;
      button.hidden =
        projected.z < -1 ||
        projected.z > 1 ||
        Math.abs(projected.x) > 0.97 ||
        Math.abs(projected.y) > 0.95;
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
  private visibility = (): void => {
    this.clock.getDelta();
  };

  /** Live authoritative state changes never rely on optimistic visual-only toggles. */
  update(home: HomeState): void {
    updateDevices(this.household, home);
  }

  /** Match the exterior, practical lights, reflection, and exposure as one look. */
  setAtmosphere(mode: Atmosphere): void {
    this.mode = mode;
    const day = mode === "day";
    const cinema = mode === "cinema";
    this.built.windowLight.intensity = day ? 4.2 : cinema ? 0.45 : 2.2;
    this.built.windowLight.color.set(day ? "#fff0d6" : "#f7b976");
    this.fill.intensity = day ? 2 : cinema ? 0.7 : 1.25;
    this.built.warmLight.intensity = day ? 15 : cinema ? 8 : 30;
    this.p.warm.emissiveIntensity = cinema ? 1.1 : 1.6;
    this.scene.environmentIntensity = day ? 0.85 : cinema ? 0.3 : 0.5;
    this.renderer.toneMappingExposure = day ? 1.2 : cinema ? 0.95 : 1.12;
    this.bloom.strength = day ? 0.13 : 0.26;
    this.world.shafts.visible = day;
  }

  /** Select an appliance without moving the fixed eye-level camera. */
  focus(id: DeviceId): void {
    this.selected = id;
  }

  private frameCamera(): void {
    const frame = homeFraming(this.camera.aspect);
    this.camera.fov = frame.fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(...frame.position);
    this.camera.lookAt(new THREE.Vector3(...frame.target));
  }

  /** Close device selection while preserving the living-room composition. */
  reset(): void {
    this.selected = null;
  }

  /** Read-only local diagnostics support performance and pause verification. */
  snapshot(): SceneSnapshot {
    return {
      ready: true,
      fps: Math.round(this.fps),
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      time: this.time,
      paused: this.paused,
      atmosphere: this.mode,
      selected: this.selected,
      camera: {
        position: this.camera.position.toArray(),
        direction: this.camera.getWorldDirection(new THREE.Vector3()).toArray(),
        fov: this.camera.fov,
      },
    };
  }

  /** Dispose every GPU allocation and event when the scene unmounts. */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.pointerDown,
    );
    this.renderer.domElement.removeEventListener("pointerup", this.pick);
    document.removeEventListener("visibilitychange", this.visibility);
    this.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh) && !(node instanceof THREE.Points))
        return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material]) {
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
    this.world.environment.dispose();
    this.reflector.getRenderTarget().dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
