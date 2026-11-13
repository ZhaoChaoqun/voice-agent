/** Native Three passes, no copied shader chunks or patched renderer internals. */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import type { Quality } from "@habitat/scene/math";

const CONTACT_RADIUS = 0.32; // Meter-scale GTAO captures seams, furniture feet and cabinetry contact.
const AO_BLEND = 0.62; // Keep ambient contact soft rather than darkening the entire white interior.
const BLOOM_THRESHOLD = 1.6; // Only genuinely bright practicals bloom; white cabinets stay crisp.

/**
 * Own the bounded render passes and their correctly scaled GPU allocations.
 */
export class Pipeline {
  readonly composer: EffectComposer;
  readonly ao: GTAOPass;
  readonly bloom: UnrealBloomPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    private readonly quality: Quality,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new GTAOPass(scene, camera, 1, 1);
    this.ao.blendIntensity = AO_BLEND;
    this.ao.updateGtaoMaterial({
      radius: CONTACT_RADIUS,
      thickness: 0.7,
      distanceExponent: 1.5,
      distanceFallOff: 0.9,
      scale: 1,
      samples: quality.aoSamples,
      screenSpaceRadius: false,
    });
    this.ao.updatePdMaterial({
      radius: 4,
      samples: 8,
      depthPhi: 3,
      normalPhi: 4,
    });
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.075,
      0.35,
      BLOOM_THRESHOLD,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass());
  }

  /**
   * Allocate full-resolution presentation and half-resolution contact AO.
   *
   * Parameters
   * ----------
   * width, height : number
   *     CSS pixel dimensions of the actual scene pane.
   *
   * Returns
   * -------
   * void
   *     Composer allocations are updated in place.
   */
  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.ao.setSize(
      Math.max(
        1,
        Math.round(width * this.quality.pixelRatio * this.quality.aoScale),
      ),
      Math.max(
        1,
        Math.round(height * this.quality.pixelRatio * this.quality.aoScale),
      ),
    );
  }

  /**
   * Identify actual enabled pass instances even after production minification.
   *
   * Returns
   * -------
   * string[]
   *     Ordered runtime pass identities, not constructor display names.
   */
  describe(): string[] {
    return this.composer.passes
      .filter((pass) => pass.enabled)
      .map((pass) => {
        if (pass instanceof RenderPass) return "RenderPass";
        if (pass instanceof GTAOPass) return "GTAOPass";
        if (pass instanceof UnrealBloomPass) return "UnrealBloomPass";
        if (pass instanceof OutputPass) return "OutputPass";
        if (pass instanceof SMAAPass) return "SMAAPass";
        throw new Error("Unregistered Habitat postprocessing pass");
      });
  }

  /**
   * Release all postprocess resources when the scene unmounts.
   *
   * Returns
   * -------
   * void
   *     No render target is retained.
   */
  dispose(): void {
    for (const pass of this.composer.passes) pass.dispose();
    this.ao.gtaoMaterial.dispose();
    this.ao.blendMaterial.dispose();
    this.composer.dispose();
  }
}
