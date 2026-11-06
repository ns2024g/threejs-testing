// Builds the forest world: sky, sunlight, fog, hilly ground, trees, rocks, bushes and grass.
// Everything is generated from a fixed seed, so every player sees the exact same forest.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WORLD_SIZE = 200;              // walkable area is WORLD_SIZE x WORLD_SIZE
export const HALF = WORLD_SIZE / 2;
const FOREST_EDGE = HALF + 30;              // trees continue past the walkable edge
const SEED = 1337;

// ---------- Random + noise helpers (deterministic) ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, z) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 4; i++) { sum += amp * noise(x * freq, z * freq); freq *= 2; amp *= 0.5; }
  return sum; // roughly 0..0.94
}

/** Ground height at a world position. Used for the terrain, props and players. */
export function heightAt(x, z) {
  const hills = (fbm(x * 0.018, z * 0.018) - 0.47) * 9;
  // flatten the spawn area a little
  const d = Math.min(1, Math.hypot(x, z) / 25);
  return hills * (0.35 + 0.65 * d);
}

// Pushes vertices in/out using noise so shapes look natural instead of perfect.
function lumpy(geo, amount, seed) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + (hash(v.x * 13.1 + seed, v.y * 7.7 + v.z * 3.3) - 0.5) * amount;
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- Simple spatial grid for spacing + collisions ----------
class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  add(item) {
    const k = this.key(Math.floor(item.x / this.cell), Math.floor(item.z / this.cell));
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push(item);
  }
  near(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = this.map.get(this.key(cx + i, cz + j));
      if (list) out.push(...list);
    }
    return out;
  }
}

const obstacles = new Grid(4); // { x, z, r } solid things players bump into

/** Pushes a circle at (pos.x, pos.z) out of trees and big rocks. */
export function collide(pos, radius) {
  for (const o of obstacles.near(pos.x, pos.z)) {
    const dx = pos.x - o.x, dz = pos.z - o.z;
    const min = o.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = o.x + (dx / d) * min;
      pos.z = o.z + (dz / d) * min;
    }
  }
}

// ---------- Build everything ----------
export function createWorld(scene, renderer) {
  const rng = mulberry32(SEED);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  // --- Renderer look ---
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.7;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // --- Sky + sun ---
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 32), THREE.MathUtils.degToRad(150));
  u.sunPosition.value.copy(sunDir);

  // Use the sky as the light that reflects off everything (realistic ambient light)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky);
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.environmentIntensity = 0.55;
  scene.add(sky);

  const fogColor = new THREE.Color(0x9fb3bf);
  scene.fog = new THREE.FogExp2(fogColor, 0.014);
  scene.background = fogColor;

  const sun = new THREE.DirectionalLight(0xfff0d6, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -35; sc.right = 35; sc.top = 35; sc.bottom = -35; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  scene.add(new THREE.HemisphereLight(0xbfd4e6, 0x3b3226, 0.35));

  // --- Ground ---
  const groundSize = FOREST_EDGE * 2 + 20;
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 180, 180);
  groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  const colors = new Float32Array(gp.count * 3);
  const moss = new THREE.Color(0x34421f), grass = new THREE.Color(0x4f6328), dirt = new THREE.Color(0x4a3b29), needles = new THREE.Color(0x5b4630);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    gp.setY(i, heightAt(x, z));
    tint.copy(moss).lerp(grass, THREE.MathUtils.smoothstep(fbm(x * 0.07 + 40, z * 0.07), 0.35, 0.65));
    const dirtAmt = THREE.MathUtils.smoothstep(fbm(x * 0.04 + 200, z * 0.04 - 90), 0.5, 0.7);
    tint.lerp(dirt, dirtAmt * 0.8);
    tint.lerp(needles, THREE.MathUtils.smoothstep(noise(x * 0.3, z * 0.3), 0.6, 1.0) * 0.35);
    colors.set([tint.r, tint.g, tint.b], i * 3);
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();

  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: makeDetailTexture(renderer, groundSize / 3),
    roughness: 1,
  }));
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Trees (pines) ---
  const trees = [];
  const spacing = new Grid(4);
  for (let tries = 0; trees.length < 1100 && tries < 30000; tries++) {
    const x = (rng() * 2 - 1) * FOREST_EDGE;
    const z = (rng() * 2 - 1) * FOREST_EDGE;
    if (Math.hypot(x, z) < 12) continue;                         // spawn clearing
    if (fbm(x * 0.025 + 500, z * 0.025) < 0.36) continue;        // natural clearings
    if (spacing.near(x, z).some((t) => Math.hypot(t.x - x, t.z - z) < 2.6)) continue;
    const t = { x, z, h: 7 + rng() * 8, ry: rng() * Math.PI * 2, shade: rng() };
    spacing.add(t);
    trees.push(t);
  }

  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.2, 1, 8);
  trunkGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 }), trees.length);

  const LAYERS = 4;
  const coneGeo = lumpy(new THREE.ConeGeometry(1, 1, 10, 2), 0.25, 3);
  coneGeo.translate(0, 0.5, 0);
  const foliage = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), trees.length * LAYERS);

  trees.forEach((t, i) => {
    const y = heightAt(t.x, t.z) - 0.3;
    const k = t.h / 9;
    dummy.position.set(t.x, y, t.z);
    dummy.rotation.set(0, t.ry, 0);
    dummy.scale.set(k, t.h * 0.85, k);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    obstacles.add({ x: t.x, z: t.z, r: 0.22 * k + 0.05 });

    tint.setHSL(0.28 + t.shade * 0.06, 0.45 + t.shade * 0.15, 0.022 + t.shade * 0.018);
    for (let j = 0; j < LAYERS; j++) {
      const f = j / LAYERS;
      dummy.position.set(t.x, y + t.h * (0.22 + f * 0.6), t.z);
      dummy.rotation.set(0, t.ry + j, 0);
      const r = t.h * (0.27 - f * 0.17);
      dummy.scale.set(r, t.h * (0.42 - f * 0.12), r);
      dummy.updateMatrix();
      foliage.setMatrixAt(i * LAYERS + j, dummy.matrix);
      foliage.setColorAt(i * LAYERS + j, tint);
    }
  });
  for (const m of [trunks, foliage]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
  }

  // --- Rocks ---
  const ROCKS = 180;
  const rockGeo = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.5, 7);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), ROCKS);
  for (let i = 0; i < ROCKS; i++) {
    const x = (rng() * 2 - 1) * FOREST_EDGE, z = (rng() * 2 - 1) * FOREST_EDGE;
    const s = 0.25 + Math.pow(rng(), 3) * 1.6;
    dummy.position.set(x, heightAt(x, z) - s * 0.25, z);
    dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    dummy.scale.set(s * (1 + rng() * 0.5), s * 0.7, s);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    tint.setHSL(0.09, 0.06, 0.08 + rng() * 0.07);
    rocks.setColorAt(i, tint);
    if (s > 0.6) obstacles.add({ x, z, r: s * 0.9 });
  }
  rocks.castShadow = rocks.receiveShadow = true;
  rocks.computeBoundingSphere();
  scene.add(rocks);

  // --- Bushes ---
  const BUSHES = 350;
  const bushGeo = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.45, 11);
  const bushes = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), BUSHES);
  for (let i = 0; i < BUSHES; i++) {
    const x = (rng() * 2 - 1) * FOREST_EDGE, z = (rng() * 2 - 1) * FOREST_EDGE;
    const s = 0.4 + rng() * 0.6;
    dummy.position.set(x, heightAt(x, z) + s * 0.2, z);
    dummy.rotation.set(0, rng() * 6, 0);
    dummy.scale.set(s * 1.2, s * 0.7, s);
    dummy.updateMatrix();
    bushes.setMatrixAt(i, dummy.matrix);
    tint.setHSL(0.25 + rng() * 0.06, 0.5, 0.025 + rng() * 0.02);
    bushes.setColorAt(i, tint);
  }
  bushes.castShadow = bushes.receiveShadow = true;
  bushes.computeBoundingSphere();
  scene.add(bushes);

  // --- Grass tufts ---
  const blades = [];
  for (let b = 0; b < 6; b++) {
    const blade = new THREE.ConeGeometry(0.025, 0.4, 3, 1, true);
    blade.translate(0, 0.2, 0);
    blade.rotateX((hash(b, 1) - 0.5) * 0.7);
    blade.rotateZ((hash(b, 2) - 0.5) * 0.7);
    blade.translate((hash(b, 3) - 0.5) * 0.15, 0, (hash(b, 4) - 0.5) * 0.15);
    blades.push(blade);
  }
  const tuftGeo = mergeGeometries(blades);
  const TUFTS = 14000;
  const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), TUFTS);
  for (let i = 0; i < TUFTS; i++) {
    const x = (rng() * 2 - 1) * (HALF + 10), z = (rng() * 2 - 1) * (HALF + 10);
    const s = 0.5 + rng() * 0.7;
    dummy.position.set(x, heightAt(x, z) - 0.02, z);
    dummy.rotation.set(0, rng() * 6, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    tufts.setMatrixAt(i, dummy.matrix);
    tint.setHSL(0.22 + rng() * 0.05, 0.55, 0.035 + rng() * 0.03);
    tufts.setColorAt(i, tint);
  }
  tufts.receiveShadow = true;
  tufts.computeBoundingSphere();
  scene.add(tufts);

  // Keeps the sun's shadow area centred on the player
  function update(center) {
    sun.position.copy(center).addScaledVector(sunDir, 80);
    sun.target.position.copy(center);
  }

  return { update };
}

// Grainy grey texture that adds small-scale detail to the ground colours.
function makeDetailTexture(renderer, repeat) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rng = mulberry32(99);
  // Value noise whose lattice wraps every `period` cells, so the texture tiles seamlessly
  const tileNoise = (x, y, period) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const h = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = Math.floor(i / size);
    // soft blotches + fine grain
    const n = 0.6 * tileNoise(x / 16, y / 16, size / 16) + 0.4 * tileNoise(x / 4, y / 4, size / 4);
    const v = 170 + n * 70 + (rng() - 0.5) * 40;
    img.data.set([v, v, v, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}
