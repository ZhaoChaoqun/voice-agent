/** Three.js lifecycle, device picking, and HTML marker projection. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import type { DeviceId, HomeState } from "@shared/protocol";
import {
  buildAppliances,
  type Appliances,
  updateAppliances,
} from "@/scene/appliances";
import {
  buildArchitecture,
  buildDecor,
  buildSofa,
  buildTables,
} from "@/scene/furniture";

// Keep the full cutaway room framed while limiting GPU use on high-DPI screens.
const VIEW_HEIGHT = 8.6;
const MIN_VIEW_WIDTH = 13; // Keep the entire room visible on narrow/mobile canvases.
const MAX_PIXEL_RATIO = 1.8;
const CAMERA_POSITION = new THREE.Vector3(10, 8.7, 11);

export class RoomScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly appliances: Appliances;
  private readonly observer: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly clock = new THREE.Clock();
  private frame = 0;
  private disposed = false;
  private pointerStart = { x: 0, y: 0 };
  private readonly reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  constructor(
    private readonly container: HTMLDivElement,
    private readonly onSelect: (device: DeviceId) => void,
    private readonly markers: Map<DeviceId, HTMLButtonElement>,
  ) {
    this.renderer = this.createRenderer();
    this.container.prepend(this.renderer.domElement);
    this.camera.position.copy(CAMERA_POSITION);
    this.camera.near = 0.1;
    this.camera.far = 100;
    this.controls = this.createControls();
    const root = new THREE.Group();
    this.scene.add(root);
    buildArchitecture(root);
    buildSofa(root);
    buildTables(root);
    buildDecor(root);
    this.appliances = buildAppliances(root);
    this.addLighting();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.pick);
    this.resize();
    this.animate();
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D living room",
    );
    renderer.domElement.setAttribute("role", "img");
    return renderer;
  }

  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI / 5;
    controls.maxPolarAngle = Math.PI / 2.5;
    controls.minAzimuthAngle = 0.15;
    controls.maxAzimuthAngle = 1.35;
    controls.minZoom = 0.7;
    controls.maxZoom = 1.65;
    controls.update();
    return controls;
  }

  private addLighting(): void {
    this.scene.add(new THREE.AmbientLight("#fff5e3", 1.5));
    const sun = new THREE.DirectionalLight("#fff7e6", 4);
    sun.position.set(-2, 9, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -9;
    sun.shadow.camera.right = 9;
    sun.shadow.camera.top = 9;
    sun.shadow.camera.bottom = -9;
    sun.shadow.normalBias = 0.04;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight("#d8e9e9", 1.6);
    fill.position.set(6, 5, -2);
    this.scene.add(fill);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.09 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.38;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private resize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    const aspect = width / height;
    const viewHeight = Math.max(VIEW_HEIGHT, MIN_VIEW_WIDTH / aspect);
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    this.controls.update();
    const elapsed = this.clock.getElapsedTime();
    if (!this.reduceMotion && this.appliances.mist.visible) {
      for (const [index, particle] of this.appliances.mist.children.entries()) {
        particle.position.y = 0.94 + ((elapsed * 0.3 + index * 0.065) % 0.9);
        particle.position.x = Math.sin(elapsed + index) * 0.06;
        const material = (
          particle as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
        ).material;
        material.opacity = Math.max(
          0,
          0.35 - (particle.position.y - 0.94) * 0.4,
        );
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.projectMarkers();
  };

  private projectMarkers(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    for (const [id, point] of this.appliances.anchors) {
      const marker = this.markers.get(id);
      if (!marker) continue;
      const projected = point.clone().project(this.camera);
      marker.style.left = `${((projected.x + 1) / 2) * width}px`;
      marker.style.top = `${((-projected.y + 1) / 2) * height}px`;
      marker.hidden = projected.z < -1 || projected.z > 1;
    }
  }

  private pointerDown = (event: PointerEvent): void => {
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };

  private pick = (event: PointerEvent): void => {
    if (
      Math.hypot(
        event.clientX - this.pointerStart.x,
        event.clientY - this.pointerStart.y,
      ) > 5
    )
      return;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(
      [...this.appliances.groups.values()],
      true,
    );
    let node: THREE.Object3D | null = intersections[0]?.object ?? null;
    while (node && !node.userData.deviceId) node = node.parent;
    if (node?.userData.deviceId)
      this.onSelect(node.userData.deviceId as DeviceId);
  };

  /** Update the visual world after a successful authoritative state change. */
  update(home: HomeState): void {
    updateAppliances(this.appliances, home);
  }

  /** Zoom in or out without moving the selected device. */
  zoom(direction: number): void {
    this.camera.zoom = THREE.MathUtils.clamp(
      this.camera.zoom + direction * 0.12,
      0.7,
      1.65,
    );
    this.camera.updateProjectionMatrix();
  }

  /** Restore the authored isometric view. */
  resetView(): void {
    this.camera.position.copy(CAMERA_POSITION);
    this.camera.zoom = 1;
    this.controls.target.set(0, 1, 0);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Release observers, event handlers, geometry, textures, and GPU resources. */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.pointerDown,
    );
    this.renderer.domElement.removeEventListener("pointerup", this.pick);
    this.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
