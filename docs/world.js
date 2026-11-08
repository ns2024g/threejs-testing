// Builds the world: a ruined village dragged into hell. Red sky and moon, ash-covered ground,
// glowing lava cracks, dead trees, and broken buildings (see ruins.js) around a shattered church.
// Everything comes from a fixed seed, so every player sees the exact same map.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const { buildRuins } = await import(`./ruins.js${new URL(import.meta.url).search}`);

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

const baseHeight = (x, z) => (fbm(x * 0.018, z * 0.018) - 0.47) * 9;

// ---------- Map layout ----------
// The church stands in the middle with its door facing south, down a road to the spawn point.
export const SPAWN = { x: 0, z: -30 };      // where players start (looking north, up the road)
export const ALTAR = { x: 0, z: 6 };        // inside the church

const CHURCH = { x: 0, z: 0, ry: 0, w: 13, d: 21, h: 8 };
const GRAVEYARD = { x: 46, z: 16, r: 15, cryptRy: Math.atan2(46, 16) };

// Flat ground for each place: { x, z, inner (fully flat), outer (blends back into the hills), h }
const pads = [];
function addPad(x, z, inner, outer) {
  const pad = { x, z, inner, outer, h: baseHeight(x, z) * 0.6 };
  pads.push(pad);
  return pad;
}
CHURCH.y = addPad(CHURCH.x, CHURCH.z, 17, 30).h;
addPad(SPAWN.x, SPAWN.z, 9, 22);
addPad(GRAVEYARD.x, GRAVEYARD.z, 15, 26);

// Ruined houses, barns and shops in a ring around the church, each door facing it
const BUILDINGS = [];
{
  const rng = mulberry32(SEED + 11);
  const clear = (x, z, r) => pads.every((p) => Math.hypot(p.x - x, p.z - z) > p.inner + r + 2);
  for (let tries = 0; BUILDINGS.length < 24 && tries < 2000; tries++) {
    const angle = rng() * Math.PI * 2, dist = 28 + rng() * 52;
    const x = Math.sin(angle) * dist, z = Math.cos(angle) * dist;
    const roll = rng();
    const type = roll < 0.6 ? 'house' : roll < 0.8 ? 'barn' : 'shop';
    const w = type === 'barn' ? 9 + rng() * 2 : 6 + rng() * 3;
    const d = type === 'barn' ? 11 + rng() * 3 : 5.5 + rng() * 3;
    const h = type === 'barn' ? 4.6 : 3.2 + rng() * 1.2;
    const r = Math.hypot(w, d) / 2;
    if (Math.abs(x) < r + 4 && z < 0) continue;                                 // keep the road clear
    if (Math.abs(x) > HALF - r - 6 || Math.abs(z) > HALF - r - 6 || !clear(x, z, r)) continue;
    const ry = Math.atan2(x, z) + (rng() - 0.5) * 0.5;
    const pad = addPad(x, z, r + 0.8, r + 7);
    BUILDINGS.push({ type, x, z, w, d, h, ry, y: pad.h, damage: 0.55 + rng() * 0.45 });
  }
}
const insidePad = (x, z, margin = 0) => pads.some((p) => Math.hypot(p.x - x, p.z - z) < p.inner + margin);

/** Ground height at a world position. Used for the terrain, props and players. */
export function heightAt(x, z) {
  let h = baseHeight(x, z);
  for (const p of pads) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < p.outer) h = THREE.MathUtils.lerp(p.h, h, THREE.MathUtils.smoothstep(d, p.inner, p.outer));
  }
  return h;
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

/** Pushes a circle at (pos.x, pos.z) out of walls, trees and big rocks. */
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

/** Adds a solid circle that players bump into. */
export function addObstacle(x, z, r) {
  obstacles.add({ x, z, r });
}

// ---------- Build everything ----------
export function createWorld(scene, renderer) {
  const rng = mulberry32(SEED);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  // --- Renderer look ---
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // --- Hell sky ---
  // A huge red moon hangs low over the church, seen from the spawn point
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 20), THREE.MathUtils.degToRad(12));

  const fogColor = new THREE.Color(0x2c0806);        // horizon
  const skyTop = new THREE.Color(0x070102);
  scene.background = fogColor;
  scene.fog = new THREE.FogExp2(fogColor, 0.024);    // thick red haze

  // Faint red ambient light from above, almost nothing from the ground
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = clamp(vP.y * 0.5 + 0.5, 0.0, 1.0); gl_FragColor = vec4(mix(vec3(0.006, 0.002, 0.002), vec3(0.09, 0.02, 0.015), h * h), 1.0); }',
    })
  ));
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.environmentIntensity = 1;

  // Sky dome: red at the horizon (matching the fog so there's no visible edge), near black above
  const domeGeo = new THREE.SphereGeometry(360, 32, 16);
  const domeColors = new Float32Array(domeGeo.attributes.position.count * 3);
  for (let i = 0; i < domeGeo.attributes.position.count; i++) {
    const up = Math.max(0, domeGeo.attributes.position.getY(i) / 360);
    tint.copy(fogColor).lerp(skyTop, Math.pow(up, 0.55));
    domeColors.set([tint.r, tint.g, tint.b], i * 3);
  }
  domeGeo.setAttribute('color', new THREE.BufferAttribute(domeColors, 3));
  const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -2;
  dome.frustumCulled = false;
  scene.add(dome);

  // The blood moon, with a soft glow around it
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(17, 32, 20),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 0.09, 0.03), fog: false, depthWrite: false, toneMapped: false })
  );
  moon.renderOrder = -1;
  scene.add(moon);
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: 0xff2a10, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, opacity: 0.8,
  }));
  moonGlow.scale.setScalar(190);
  scene.add(moonGlow);

  // Moonlight: dim and red, throwing long shadows from the ruins toward the spawn point
  const sun = new THREE.DirectionalLight(0xff6448, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -35; sc.right = 35; sc.top = 35; sc.bottom = -35; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  scene.add(new THREE.HemisphereLight(0x9a3a2a, 0x2a0f0a, 2.2));

  // Red glow rising from the altar
  const altarLight = new THREE.PointLight(0xff3c14, 45, 22, 2);
  altarLight.position.set(ALTAR.x, CHURCH.y + 2, ALTAR.z);
  scene.add(altarLight);

  // --- Ground ---
  const groundSize = FOREST_EDGE * 2 + 20;
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 180, 180);
  groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  const colors = new Float32Array(gp.count * 3);
  const ash = new THREE.Color(0x3d3631), soot = new THREE.Color(0x1f1b1a), rust = new THREE.Color(0x4f2a1e),
    scorched = new THREE.Color(0x2b120d), road = new THREE.Color(0x4a3a2e);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    gp.setY(i, heightAt(x, z));
    tint.copy(soot).lerp(ash, THREE.MathUtils.smoothstep(fbm(x * 0.07 + 40, z * 0.07), 0.3, 0.62));
    tint.lerp(rust, THREE.MathUtils.smoothstep(fbm(x * 0.04 + 200, z * 0.04 - 90), 0.5, 0.72) * 0.8);
    // The ground gets more burnt toward the church
    tint.lerp(scorched, (1 - THREE.MathUtils.smoothstep(Math.hypot(x, z), 14, 42)) * 0.75);
    // The dirt road from the spawn point to the church door
    if (z < -8 && z > SPAWN.z - 6) tint.lerp(road, (1 - THREE.MathUtils.smoothstep(Math.abs(x + Math.sin(z * 0.25) * 0.6), 1.5, 3.2)) * 0.9);
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

  // --- Ruined buildings ---
  scene.add(buildRuins({ buildings: BUILDINGS, church: CHURCH, altar: ALTAR, graveyard: GRAVEYARD }, rng,
    (x, z, r) => obstacles.add({ x, z, r }), heightAt));

  // --- Dead trees ---
  const trees = [];
  const spacing = new Grid(4);
  for (let tries = 0; trees.length < 750 && tries < 30000; tries++) {
    const x = (rng() * 2 - 1) * FOREST_EDGE;
    const z = (rng() * 2 - 1) * FOREST_EDGE;
    if (insidePad(x, z, 1.5)) continue;
    if (Math.abs(x) < 6 && z < 0 && z > SPAWN.z) continue;                      // keep the road clear
    // Sparse in the village, thick dead forest around the outside
    const dist = Math.hypot(x, z);
    if (rng() > THREE.MathUtils.lerp(0.14, 1, THREE.MathUtils.smoothstep(dist, 55, 90))) continue;
    if (spacing.near(x, z).some((t) => Math.hypot(t.x - x, t.z - z) < 3)) continue;
    const t = { x, z, s: 0.8 + rng() * 0.9, ry: rng() * Math.PI * 2, shade: rng(), kind: rng() < 0.5 ? 0 : 1 };
    spacing.add(t);
    trees.push(t);
  }
  [makeDeadTree(21, 5), makeDeadTree(47, 8)].forEach((geo, kind) => {
    const list = trees.filter((t) => t.kind === kind);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), list.length);
    list.forEach((t, i) => {
      dummy.position.set(t.x, heightAt(t.x, t.z) - 0.15, t.z);
      dummy.rotation.set((t.shade - 0.5) * 0.14, t.ry, (t.s - 1.2) * 0.14);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tint.setRGB(0.028 + t.shade * 0.03, 0.021 + t.shade * 0.02, 0.018 + t.shade * 0.015));
      obstacles.add({ x: t.x, z: t.z, r: 0.2 * t.s });
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  });

  // --- Rocks ---
  const ROCKS = 180;
  const rockGeo = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.5, 7);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), ROCKS);
  for (let i = 0; i < ROCKS; i++) {
    let x, z;
    do {
      x = (rng() * 2 - 1) * FOREST_EDGE;
      z = (rng() * 2 - 1) * FOREST_EDGE;
    } while (insidePad(x, z, 1) || (Math.abs(x) < 5 && z < 0 && z > SPAWN.z));
    const s = 0.25 + Math.pow(rng(), 3) * 1.6;
    dummy.position.set(x, heightAt(x, z) - s * 0.25, z);
    dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    dummy.scale.set(s * (1 + rng() * 0.5), s * 0.7, s);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    tint.setHSL(0.03, 0.12, 0.05 + rng() * 0.05);
    rocks.setColorAt(i, tint);
    if (s > 0.6) obstacles.add({ x, z, r: s * 0.9 });
  }
  rocks.castShadow = rocks.receiveShadow = true;
  rocks.computeBoundingSphere();
  scene.add(rocks);

  // --- Dead grass ---
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
  const TUFTS = 6000;
  const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), TUFTS);
  for (let i = 0; i < TUFTS; i++) {
    let x, z;
    do {
      x = (rng() * 2 - 1) * (HALF + 10);
      z = (rng() * 2 - 1) * (HALF + 10);
    } while (insidePad(x, z));
    const s = 0.5 + rng() * 0.7;
    dummy.position.set(x, heightAt(x, z) - 0.02, z);
    dummy.rotation.set(0, rng() * 6, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    tufts.setMatrixAt(i, dummy.matrix);
    tint.setHSL(0.06 + rng() * 0.04, 0.4, 0.03 + rng() * 0.03);
    tufts.setColorAt(i, tint);
  }
  tufts.receiveShadow = true;
  tufts.computeBoundingSphere();
  scene.add(tufts);

  // --- Glowing lava cracks + the ritual circle around the altar ---
  const lavaPos = [];
  // A glowing strip along the ground through the given points. Tapered strips narrow to a
  // point at both ends, like a crack.
  function lavaStrip(points, width, tapered = true) {
    const widthAt = (i) => (tapered ? width * Math.sin(Math.PI * i / (points.length - 1)) + 0.012 : width);
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      const w0 = widthAt(i), w1 = widthAt(i + 1);
      const a0 = [ax + nx * w0, az + nz * w0], a1 = [ax - nx * w0, az - nz * w0];
      const b0 = [bx + nx * w1, bz + nz * w1], b1 = [bx - nx * w1, bz - nz * w1];
      for (const [x, z] of [a0, a1, b0, b0, a1, b1]) lavaPos.push(x, heightAt(x, z) + 0.06, z);
    }
  }
  const CRACKS = 110;
  for (let c = 0; c < CRACKS; c++) {
    // Most cracks spread out from the church, the rest are scattered around the village
    const near = c < 75;
    const angle = rng() * Math.PI * 2, dist = near ? 3 + Math.pow(rng(), 0.7) * 34 : 30 + rng() * 55;
    let x = Math.sin(angle) * dist, z = Math.cos(angle) * dist;
    let dir = near ? angle + (rng() - 0.5) * 1.2 : rng() * Math.PI * 2;
    const pts = [[x, z]];
    const segs = 5 + Math.floor(rng() * 8);
    for (let s = 0; s < segs; s++) {
      dir += (rng() - 0.5) * 1.3;
      const step = 0.6 + rng() * 1.1;
      x += Math.sin(dir) * step;
      z += Math.cos(dir) * step;
      pts.push([x, z]);
    }
    lavaStrip(pts, 0.025 + rng() * 0.065);
  }
  // Ritual circle: a ring and a five-pointed star on the church floor around the altar
  {
    const R = 3.1, ring = [], star = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      ring.push([ALTAR.x + Math.sin(a) * R, ALTAR.z + Math.cos(a) * R]);
    }
    lavaStrip(ring, 0.05, false);
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 / 5) * Math.PI * 2 + Math.PI;
      star.push([ALTAR.x + Math.sin(a) * R, ALTAR.z + Math.cos(a) * R]);
    }
    for (let i = 0; i < 5; i++) lavaStrip([star[i], star[(i + 1) % 5]], 0.05, false);
  }
  const lavaGeo = new THREE.BufferGeometry();
  lavaGeo.setAttribute('position', new THREE.Float32BufferAttribute(lavaPos, 3));
  const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff4a12, side: THREE.DoubleSide, toneMapped: false });
  scene.add(new THREE.Mesh(lavaGeo, lavaMat));

  // --- Embers drifting up around the player ---
  const EMBERS = 350, EMBER_BOX = 26;
  const emberPos = new Float32Array(EMBERS * 3);
  const emberSpeed = new Float32Array(EMBERS);
  for (let i = 0; i < EMBERS; i++) {
    emberPos.set([(Math.random() - 0.5) * EMBER_BOX * 2, Math.random() * 16, (Math.random() - 0.5) * EMBER_BOX * 2], i * 3);
    emberSpeed[i] = 0.35 + Math.random() * 0.9;
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({
    color: 0xff6a1e, size: 0.07, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  embers.frustumCulled = false;
  scene.add(embers);

  let time = 0;
  // Keeps the sky and moonlight centred on the player, and animates the fire effects
  function update(center, dt = 0) {
    time += dt;
    sun.position.copy(center).addScaledVector(sunDir, 80);
    sun.target.position.copy(center);
    dome.position.copy(center);
    moon.position.copy(center).addScaledVector(sunDir, 300);
    moonGlow.position.copy(moon.position);

    // Lava slowly pulses; the altar's light flickers like fire
    const pulse = 1 + 0.25 * Math.sin(time * 1.3) + 0.08 * Math.sin(time * 4.1);
    lavaMat.color.setRGB(0.95 * pulse, 0.13 * pulse, 0.015 * pulse);
    altarLight.intensity = 45 * (0.85 + 0.15 * Math.sin(time * 9) * Math.sin(time * 5.3));

    // Embers float upward with a little sideways drift, wrapping around the player
    for (let i = 0; i < EMBERS; i++) {
      const s = emberSpeed[i];
      emberPos[i * 3] += Math.sin(time * s + i) * 0.25 * dt;
      emberPos[i * 3 + 1] += s * dt;
      emberPos[i * 3 + 2] += Math.cos(time * s * 0.8 + i) * 0.25 * dt;
      if (emberPos[i * 3 + 1] > 16) emberPos[i * 3 + 1] = 0;
    }
    emberGeo.attributes.position.needsUpdate = true;
    embers.position.copy(center);
  }

  return { update };
}

// A bare, branching dead tree about 6 m tall, merged into one shape
function makeDeadTree(seed, branches) {
  const rng = mulberry32(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.05, 0.2, 6, 7);
  trunk.translate(0, 3, 0);
  parts.push(trunk);
  const Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
  const limb = (from, angle, tilt, len, r) => {
    const g = new THREE.CylinderGeometry(r * 0.25, r, len, 5);
    g.translate(0, len / 2, 0);
    g.rotateZ(tilt);
    g.rotateY(angle);
    g.translate(from.x, from.y, from.z);
    parts.push(g);
    return from.clone().add(new THREE.Vector3(0, len, 0).applyAxisAngle(Z, tilt).applyAxisAngle(Y, angle));
  };
  for (let i = 0; i < branches; i++) {
    const y = 2.2 + (i / branches) * 3.4;
    const angle = rng() * Math.PI * 2, tilt = 0.7 + rng() * 0.7, len = (1.1 + rng() * 1.4) * (1 - i / (branches * 1.6));
    const end = limb(new THREE.Vector3(0, y, 0), angle, tilt, len, 0.075);
    // A couple of crooked twigs off each branch
    for (let t = 0; t < 2; t++) limb(end, angle + (rng() - 0.5) * 2, tilt * (0.3 + rng() * 0.9), 0.4 + rng() * 0.6, 0.022);
  }
  return mergeGeometries(parts);
}

// Soft round glow used around the moon
function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
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
