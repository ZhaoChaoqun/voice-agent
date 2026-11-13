/** Bright studio backdrop, natural reflections, and restrained living details. */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import type { Palette } from "@v2/scene/craft";
import { seeded } from "@v2/scene/math";

export interface World {
  environment: THREE.WebGLRenderTarget;
  dust: THREE.Points;
  orb: THREE.Group;
  time: { value: number };
  shafts: THREE.Group;
}

/** Keep the page bright while scene controls change only the home's practical lighting. */
export function atmosphere(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  p: Palette,
): World {
  const time = { value: 0 };
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = generator.fromScene(room, 0.04);
  room.dispose();
  generator.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.85;
  scene.background = new THREE.Color("#f5f7fa");
  scene.fog = new THREE.FogExp2("#f5f7fa", 0.018);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.ShadowMaterial({ opacity: 0.12 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.78;
  ground.receiveShadow = true;
  scene.add(ground);
  const dust = particles(scene, time);
  const orb = intelligence(scene, p);
  const shafts = windowShafts(scene);
  return { environment, dust, orb, time, shafts };
}

function windowShafts(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  scene.add(group);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader:
      "varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `varying vec2 vUv; void main(){
      float edge=pow(max(0.,sin(vUv.x*3.14159)),3.);
      float fade=sin(vUv.y*3.14159);
      gl_FragColor=vec4(1.,.92,.76,edge*fade*.025);
    }`,
  });
  for (const z of [-2.4, 0, 2.4]) {
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 7.5), material);
    beam.position.set(-3.9, 1.8, z);
    beam.rotation.z = -1;
    group.add(beam);
  }
  return group;
}

function particles(scene: THREE.Scene, time: { value: number }): THREE.Points {
  const random = seeded(82);
  const positions = new Float32Array(80 * 3); // Sparse sunlight motes, not a distracting snow effect.
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = (random() - 0.5) * 14;
    positions[index + 1] = random() * 5;
    positions[index + 2] = (random() - 0.5) * 9;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    transparent: true,
    depthWrite: false,
    vertexShader: `uniform float uTime; varying float vFade; void main(){
      vec3 p=position; p.x+=sin(uTime*.1+p.y)*.05; p.y+=sin(uTime*.15+p.z)*.035;
      vec4 view=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*view;
      gl_PointSize=clamp(30./-view.z,1.,2.8); vFade=.1+sin(position.x*8.)*.06;
    }`,
    fragmentShader:
      "varying float vFade; void main(){float a=1.-smoothstep(.1,.5,length(gl_PointCoord-.5)); gl_FragColor=vec4(1.,.97,.86,a*vFade);}",
  });
  const dust = new THREE.Points(geometry, material);
  scene.add(dust);
  return dust;
}

function intelligence(scene: THREE.Scene, p: Palette): THREE.Group {
  const orb = new THREE.Group();
  orb.position.set(2.4, 1.8, 2.5);
  scene.add(orb);
  orb.add(
    new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.13, 3),
      new THREE.MeshPhysicalMaterial({
        color: "#b2eff9",
        emissive: "#56cfef",
        emissiveIntensity: 0.7,
        metalness: 0.35,
        roughness: 0.1,
      }),
    ),
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.003, 6, 80),
    p.cool,
  );
  ring.rotation.set(0.6, 0, 0.4);
  orb.add(ring);
  return orb;
}
