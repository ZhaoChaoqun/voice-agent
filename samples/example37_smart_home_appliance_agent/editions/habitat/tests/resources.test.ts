/** Real Three resource configuration tests use a renderer stub, never a network call. */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { interior } from "../src/scene/interior";
import { habitatPalette } from "../src/scene/materials";
import { qualityFor } from "../src/scene/math";
import { Pipeline } from "../src/scene/pipeline";

vi.mock("@v2/scene/craft", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@v2/scene/craft")>();
  const three = await import("three");
  return {
    ...actual,
    palette: (): ReturnType<typeof actual.palette> => ({
      stone: new three.MeshStandardMaterial(),
      wood: new three.MeshStandardMaterial(),
      darkWood: new three.MeshStandardMaterial(),
      fabric: new three.MeshStandardMaterial(),
      metal: new three.MeshStandardMaterial(),
      black: new three.MeshStandardMaterial(),
      bronze: new three.MeshStandardMaterial(),
      glass: new three.MeshPhysicalMaterial(),
      warm: new three.MeshStandardMaterial(),
      cool: new three.MeshStandardMaterial(),
      porcelain: new three.MeshStandardMaterial(),
    }),
  };
});

afterEach(() => vi.unstubAllGlobals());

describe("Habitat actual material resources", () => {
  it("uses sRGB albedo and separate linear normal/roughness maps on shared-compatible materials", () => {
    const palette = habitatPalette(32);
    for (const material of [
      palette.wood,
      palette.fabric,
      palette.stone,
      palette.darkWood,
    ]) {
      expect(material.map).toBeInstanceOf(THREE.DataTexture);
      expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(material.normalMap).toBeInstanceOf(THREE.DataTexture);
      expect(material.normalMap?.colorSpace).toBe(THREE.NoColorSpace);
      expect(material.roughnessMap).toBeInstanceOf(THREE.DataTexture);
      expect(material.roughnessMap?.colorSpace).toBe(THREE.NoColorSpace);
      expect(material.roughnessMap).not.toBe(material.map);
      expect(material.normalMap).not.toBe(material.map);
      expect(material.map?.wrapS).toBe(THREE.RepeatWrapping);
      expect(material.normalScale.x).toBeGreaterThan(0);
    }
    for (const material of Object.values(palette)) {
      material.map?.dispose();
      material.normalMap?.dispose();
      material.roughnessMap?.dispose();
      material.dispose();
    }
  });
  it("encloses the room with a real ceiling and individually modeled parquet seams", () => {
    const scene = new THREE.Scene();
    const palette = habitatPalette(32);
    interior(scene, palette);
    const room = scene.getObjectByName("Habitat original enclosed interior");
    const ceiling = room?.children.find((node) => node.position.y === 4.8);
    expect(ceiling).toBeInstanceOf(THREE.Mesh);
    const planks = room?.children.filter((node) => node.position.y === -0.02);
    expect(planks).toHaveLength(104);
    const sky = room?.children.find((node) => node.position.x === -10);
    expect(sky?.castShadow).toBe(false);
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose();
    });
    for (const material of Object.values(palette)) material.dispose();
  });
});

describe("Habitat native postprocessing", () => {
  it("allocates half-resolution native GTAO and identifies enabled instances without constructor names", () => {
    vi.stubGlobal(
      "Image",
      class ImageStub {
        src = "";
        onload: (() => void) | null = null;
      },
    );
    const quality = qualityFor(390, 3);
    const rendererStub: Pick<THREE.WebGLRenderer, "getPixelRatio" | "getSize"> =
      {
        getPixelRatio: () => quality.pixelRatio,
        getSize: (target) => target.set(390, 330),
      };
    const pipeline = new Pipeline(
      rendererStub as THREE.WebGLRenderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      quality,
    );
    pipeline.resize(358, 330);
    expect(pipeline.ao.width).toBe(224);
    expect(pipeline.ao.height).toBe(206);
    expect(pipeline.ao.gtaoMaterial.defines.SAMPLES).toBe(8);
    expect(pipeline.ao.blendIntensity).toBe(0.62);
    expect(pipeline.describe()).toEqual([
      "RenderPass",
      "GTAOPass",
      "UnrealBloomPass",
      "OutputPass",
      "SMAAPass",
    ]);
    pipeline.bloom.enabled = false;
    expect(pipeline.describe()).not.toContain("UnrealBloomPass");
    pipeline.dispose();
  });
});
