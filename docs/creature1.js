// creature1.js — "Creature 1", an analog-horror creature for three.js (r150+)
//
// The body is ONE continuous skinned mesh. It's sculpted procedurally from an anatomical
// distance field (ribs, spine, shoulder blades, pelvis, tendons, knuckles…), meshed with
// surface nets, then bound to a real skeleton so it can move.
//
// Usage:
//   import { createCreature1 } from './creature1.js';
//   const creature1 = createCreature1({ onEvent: (name) => {} });   // ~3 s to build
//   scene.add(creature1.object);
//   creature1.watch(camera);            // head + eyes follow this (Object3D or Vector3)
//   creature1.update(deltaSeconds);     // every frame
//   creature1.scream();
//
// onEvent fires 'snap' | 'glitch' | 'scream' so you can sync audio / screen glitches.
// Feet at y = 0, faces +Z, about 2.2 units tall.

import * as THREE from 'three';

const VERSION = new URL(import.meta.url).search;
const { buildCreature1Geometry, makeRng } = await import(`./creature1-geometry.js${VERSION}`);

/**
 * Sculpts the body in a background thread so the game keeps running. Pass the result to
 * createCreature1({ geometry }).
 * @param onProgress called with 0..1 as the build advances
 */
export function loadCreature1Geometry(onProgress = () => {}) {
  return new Promise((resolve) => {
    const fallback = () => resolve(buildCreature1Geometry({ resolution: 0.016, onProgress })); // no worker support
    let worker;
    try {
      worker = new Worker(new URL(`./creature1-worker.js${VERSION}`, import.meta.url), { type: 'module' });
    } catch { fallback(); return; }
    worker.onerror = () => { worker.terminate(); fallback(); };
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) { onProgress(data.progress); return; }
      worker.terminate();
      resolve(data.geometry);
    };
  });
}

// ===================================================================== three.js wrapper
export function createCreature1(opts = {}) {
  const {
    seed = 1996,
    resolution = 0.0075,     // smaller = more detail, slower build
    castShadow = true,
    scale = 1,
    stopMotionFps = 9,       // 0 = smooth
    onEvent = null,
  } = opts;
  let smFps = stopMotionFps;
  const rng = makeRng(seed + 1);
  const rand = (a, b) => a + (b - a) * rng();
  const emit = (n) => { if (onEvent) onEvent(n); };

  const G = opts.geometry || buildCreature1Geometry({ seed, resolution });

  // ---- skeleton
  const boneObjs = {};
  const boneList = G.bones.map((b) => {
    const o = new THREE.Bone();
    o.name = b.name;
    boneObjs[b.name] = o;
    return o;
  });
  G.bones.forEach((b, i) => {
    const o = boneList[i];
    if (b.parent) {
      const p = G.bones.find((x) => x.name === b.parent);
      o.position.set(b.pos[0] - p.pos[0], b.pos[1] - p.pos[1], b.pos[2] - p.pos[2]);
      boneObjs[b.parent].add(o);
    } else o.position.set(...b.pos);
  });
  const restWorld = Object.fromEntries(G.bones.map((b) => [b.name, new THREE.Vector3(...b.pos)]));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(G.position, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(G.color, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(G.skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(G.skinWeight, 4));
  geo.setIndex(new THREE.BufferAttribute(G.index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0 });
  const body = new THREE.SkinnedMesh(geo, skinMat);
  body.castShadow = castShadow; body.receiveShadow = true;
  body.frustumCulled = false;
  body.add(boneList[0]);
  body.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(boneList));

  const root = new THREE.Group();
  root.name = 'Creature 1';
  root.scale.setScalar(scale);
  root.add(body);

  // attach a mesh to a bone, given a rest-pose world position
  const attach = (boneName, mesh, worldPos) => {
    mesh.position.copy(worldPos).sub(restWorld[boneName]);
    boneObjs[boneName].add(mesh);
    mesh.castShadow = castShadow;
    return mesh;
  };
  const H = new THREE.Vector3(0, 1.97, 0.16);
  const hp = (x, y, z) => H.clone().add(new THREE.Vector3(x, y, z));

  // ---- materials for the bits that aren't skin
  const keratin = new THREE.MeshStandardMaterial({ color: 0x14110f, roughness: 0.45 });
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xcfc6ad, roughness: 0.6 });
  const teethMat = new THREE.MeshStandardMaterial({ color: 0xd9cfb2, roughness: 0.35 });
  const gumMat = new THREE.MeshStandardMaterial({ color: 0x5a2626, roughness: 0.4 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x0c0303, roughness: 0.8 });
  const sclera = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.12 });
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.2 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

  // a row of upper teeth, long and bare, the face ends right here
  const toothGeo = new THREE.BoxGeometry(0.0105, 0.03, 0.007);
  const gumC = hp(0, -0.082, 0.035);
  for (let k = 0; k < 14; k++) {
    const a = -1.15 + (k / 13) * 2.3;
    const m = new THREE.Mesh(toothGeo, teethMat);
    const p = gumC.clone().add(new THREE.Vector3(Math.sin(a) * 0.046, -0.012 - Math.cos(a) * 0.006 + rand(-0.003, 0.003), Math.cos(a) * 0.043));
    m.rotation.set(rand(-0.12, 0.08), a, rand(-0.1, 0.1));
    m.scale.y = 1 - Math.abs(a) * 0.25 + rand(-0.08, 0.08);
    attach('head', m, p);
  }
  const gum = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.009, 8, 24, 2.6), gumMat);
  gum.rotation.set(Math.PI / 2, 0, Math.PI / 2 - 1.3);
  gum.scale.set(1, 0.95, 1);
  attach('head', gum, gumC.clone().add(new THREE.Vector3(0, 0.004, 0)));
  // eyes: realistic, wet, lidded. they track you.
  const eyeTex = (() => {
    const W = 512, Hh = 256, c = document.createElement('canvas');
    c.width = W; c.height = Hh;
    const g = c.getContext('2d');
    // rows = angle from the front of the eye (top row = front)
    const pupilR = 0.075, irisR = 0.2, limb = 0.235;
    for (let y = 0; y < Hh; y++) {
      const th = y / Hh;
      let col;
      if (th < pupilR) col = [6, 5, 5];
      else if (th < irisR) {
        const f = (th - pupilR) / (irisR - pupilR);
        col = [74 - 30 * f, 66 - 28 * f, 52 - 22 * f];              // dull grey-brown iris, darker outward
      } else if (th < limb) col = [28, 24, 20];                    // dark limbal ring
      else {
        const f = Math.min(1, (th - limb) / 0.4);
        col = [222 - 30 * f, 212 - 52 * f, 196 - 58 * f];           // off-white sclera going pink/yellow at the edges
      }
      g.fillStyle = `rgb(${col.map(Math.round).join(',')})`;
      g.fillRect(0, y, W, 1);
    }
    // iris fibres
    for (let i = 0; i < 700; i++) {
      const x = rng() * W, y0 = Hh * (pupilR + 0.005), y1 = Hh * (irisR - rng() * 0.05);
      g.strokeStyle = rng() < 0.5 ? 'rgba(15,12,10,0.35)' : 'rgba(140,128,104,0.25)';
      g.lineWidth = 0.6 + rng();
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (rng() - 0.5) * 6, y1); g.stroke();
    }
    // bloodshot veins creeping in from the edges
    for (let i = 0; i < 40; i++) {
      let x = rng() * W, y = Hh * 0.75;
      g.strokeStyle = `rgba(${150 + rng() * 40},${30 + rng() * 20},${30 + rng() * 20},${0.35 + rng() * 0.4})`;
      g.lineWidth = 0.5 + rng() * 1.6;
      g.beginPath(); g.moveTo(x, y);
      const stop = Hh * (limb + 0.03 + rng() * 0.18);
      while (y > stop) { x += (rng() - 0.5) * 10; y -= 3 + rng() * 6; g.lineTo(x, y); }
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const eyeMat = new THREE.MeshPhysicalMaterial({ map: eyeTex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 });
  const lidMat = new THREE.MeshStandardMaterial({ color: 0x9b948a, roughness: 0.55, side: THREE.DoubleSide });
  const lidRim = new THREE.MeshStandardMaterial({ color: 0x7a5652, roughness: 0.35 });
  const eyes = [], lids = [];
  for (const s of [1, -1]) {
    const R = s > 0 ? 0.0148 : 0.0142;  // slightly mismatched
    const ePos = hp(s * 0.034, s > 0 ? 0.037 : 0.035, 0.087);
    const eg = new THREE.Group();
    const ballGeo = new THREE.SphereGeometry(R, 32, 24);
    ballGeo.rotateX(Math.PI / 2);         // texture pole -> looking direction (+Z)
    eg.add(new THREE.Mesh(ballGeo, eyeMat));
    attach('head', eg, ePos);
    eyes.push(eg);
    // eyelids: caps slightly bigger than the eyeball, leaving an almond-shaped opening
    const mkLid = (thetaLen, up) => {
      const lg = new THREE.Group();
      const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 1.1, 28, 10, 0, Math.PI * 2, 0, thetaLen), lidMat);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 1.1 * Math.sin(thetaLen), R * 0.13, 6, 28), lidRim);
      rim.rotation.x = Math.PI / 2; rim.position.y = R * 1.1 * Math.cos(thetaLen);
      cap.add(rim);
      if (!up) cap.rotation.x = Math.PI;
      lg.add(cap);
      attach('head', lg, ePos);
      return lg;
    };
    const upper = mkLid(1.2, true), lower = mkLid(1.18, false);
    upper.rotation.x = -0.12; lower.rotation.x = 0.1;     // slight droop, slightly open-staring
    upper.rotation.z = s * 0.12; lower.rotation.z = -s * 0.08;  // almond tilt
    lids.push({ upper, lower, side: s });
  }
  let blinkT = -1, blinkTimer = rand(4, 9);

  // bone spurs breaking through the skin along the spine (the thorns from the drawing)
  const spurs = [[1.7, -0.08, 'chest'], [1.66, -0.12, 'chest'], [1.62, -0.15, 'chest'], [1.58, -0.17, 'chest'], [1.54, -0.19, 'chest'], [1.5, -0.2, 'chest'], [1.45, -0.21, 'spine'], [1.4, -0.21, 'spine'], [1.34, -0.21, 'spine'], [1.27, -0.2, 'spine']];
  for (const [y, z, bn] of spurs) {
    const base = new THREE.Vector3(rand(-0.03, 0.03), y, z);
    const dir = new THREE.Vector3(rand(-0.5, 0.5), rand(0.3, 0.9), -1).normalize();
    const L = rand(0.08, 0.24) * (y > 1.45 ? 1.2 : 0.8);
    const curve = new THREE.CatmullRomCurve3([base.clone().addScaledVector(dir, -0.02), base.clone().addScaledVector(dir, L * 0.5).add(new THREE.Vector3(0, 0.01, 0)), base.clone().addScaledVector(dir, L)]);
    const g = new THREE.TubeGeometry(curve, 10, 1, 6, false);
    const P = g.attributes.position, c = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i <= 10; i++) {
      curve.getPointAt(i / 10, c);
      const r = 0.002 + 0.014 * Math.pow(1 - i / 10, 1.3);
      for (let j = 0; j <= 6; j++) { const id = i * 7 + j; q.fromBufferAttribute(P, id).sub(c).multiplyScalar(r).add(c).sub(base); P.setXYZ(id, q.x, q.y, q.z); }
    }
    g.computeVertexNormals();
    attach(bn, new THREE.Mesh(g, boneMat), base);
  }

  for (const s2 of [1, -1]) for (let k = 0; k < 3; k++) {
    const base = new THREE.Vector3(s2 * (0.12 + k * 0.035), 1.71 - k * 0.012, -0.06 + k * 0.03);
    const dir = new THREE.Vector3(s2 * 0.6, 1, -0.5).normalize();
    const L = rand(0.06, 0.13);
    const curve = new THREE.CatmullRomCurve3([base.clone().addScaledVector(dir, -0.02), base.clone().addScaledVector(dir, L * 0.5), base.clone().addScaledVector(dir, L).add(new THREE.Vector3(0, 0.0, -0.02))]);
    const g = new THREE.TubeGeometry(curve, 10, 1, 6, false);
    const P = g.attributes.position, c = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i <= 10; i++) {
      curve.getPointAt(i / 10, c);
      const r = 0.002 + 0.011 * Math.pow(1 - i / 10, 1.3);
      for (let j = 0; j <= 6; j++) { const id = i * 7 + j; q.fromBufferAttribute(P, id).sub(c).multiplyScalar(r).add(c).sub(base); P.setXYZ(id, q.x, q.y, q.z); }
    }
    g.computeVertexNormals();
    attach('chest', new THREE.Mesh(g, boneMat), base);
  }

  // third eye: pale, with a vertical pupil. shut most of the time.
  const eye3 = new THREE.Group();
  {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.014, 20, 14), new THREE.MeshStandardMaterial({ color: 0xc9c2a8, roughness: 0.08 }));
    ball.scale.set(1, 1.6, 1);
    eye3.add(ball);
    const pu = new THREE.Mesh(new THREE.CircleGeometry(1, 16), pupilMat);
    pu.scale.set(0.0025, 0.016, 1); pu.position.z = 0.0138;
    eye3.add(pu);
    attach('head', eye3, hp(0, 0.112, 0.077));
  }
  let eye3Open = 0;

  // ---- behaviour (same personality as before, now driving real bones)
  const b = boneObjs;
  let watchTarget = null;
  const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();
  let t = 0, stepAcc = 0, pt = 0;
  let snapTimer = rand(2.5, 5), snapHold = 0;
  const snap = { headRoll: 0, headYaw: 0, lurch: 0, armL: 0, armR: 0 };
  let chatter = 0, glitchT = 0;
  let screamT = -1;
  const SCREAM_LEN = 2.6;
  let yaw = 0, pitch = 0;
  const hipsRest = b.hips.position.clone();
  // locomotion / jumpscare layers (see setGait / setLunge)
  let gaitSpeed = 0, gaitBlend = 0, phase = 0, lunge = 0, shake = 0, loom = 0;
  let twitchT = 0, twitchRoll = 0, twitchYaw = 0;
  let onStep = null;
  const mixR = (o, k, v, w) => { o.rotation[k] += (v - o.rotation[k]) * w; };

  function randomSnap() {
    const kinds = [
      () => { snap.headRoll = rand(0.9, 1.4) * (rng() < 0.5 ? -1 : 1); },
      () => { snap.headYaw = rand(1.6, 2.3) * (rng() < 0.5 ? -1 : 1); },
      () => { snap.lurch = rand(0.25, 0.4); snap.headRoll = rand(-0.4, 0.4); },
      () => { if (rng() < 0.5) snap.armL = rand(-1.5, -1.0); else snap.armR = rand(-1.5, -1.0); },
      () => { snap.headRoll = rand(-0.3, 0.3); snap.lurch = rand(-0.15, -0.25); },
    ];
    kinds[Math.floor(rng() * kinds.length)]();
    if (rng() < 0.4) kinds[Math.floor(rng() * kinds.length)]();
  }
  const clearSnap = () => { for (const k in snap) snap[k] = 0; };

  function update(dt) {
    dt = Math.min(dt, 0.1);
    t += dt;
    if (smFps > 0) {
      stepAcc += dt;
      if (stepAcc < 1 / smFps) return;
      dt = stepAcc; stepAcc = 0;
    }
    pt += dt;

    if (screamT < 0) {
      if (snapHold > 0) { snapHold -= dt; if (snapHold <= 0) { clearSnap(); snapTimer = rand(2.5, 7); } }
      else { snapTimer -= dt; if (snapTimer <= 0) { randomSnap(); snapHold = rand(0.4, 2.2); emit('snap'); } }
      if (rng() < dt * 0.12) { glitchT = rand(0.1, 0.25); emit('glitch'); }
      if (rng() < dt * 0.15) chatter = rand(0.4, 1.0);
    }
    glitchT = Math.max(0, glitchT - dt);
    chatter = Math.max(0, chatter - dt);
    let s = 0;
    if (screamT >= 0) {
      screamT += dt;
      const x = screamT / SCREAM_LEN;
      s = x < 0.08 ? x / 0.08 : x < 0.8 ? 1 : Math.max(0, 1 - (x - 0.8) / 0.2);
      if (screamT > SCREAM_LEN) { screamT = -1; s = 0; }
    }

    b.hips.position.copy(hipsRest);
    if (glitchT > 0) b.hips.position.add(tmpW.set(rand(-0.05, 0.05), rand(-0.015, 0.015), rand(-0.05, 0.05)));

    const breath = Math.sin(pt * 1.1) * (0.6 + 0.4 * Math.sin(pt * 0.23));
    b.spine.rotation.x = 0.015 * breath + snap.lurch * 0.5 - 0.1 * s;
    b.chest.rotation.x = 0.02 * breath + snap.lurch * 0.5 - 0.12 * s;
    b.chest.rotation.z = 0.025 * Math.sin(pt * 0.17);

    // track the watch target
    let ty = 0, tp = 0;
    if (watchTarget) {
      root.updateMatrixWorld(true);
      if (watchTarget.isObject3D) watchTarget.getWorldPosition(tmpV); else tmpV.copy(watchTarget);
      b.neck2.worldToLocal(tmpV);
      ty = Math.max(-1.3, Math.min(1.3, Math.atan2(tmpV.x, tmpV.z)));
      tp = Math.max(-0.6, Math.min(0.5, -Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z))));
    }
    yaw += (ty - yaw) * Math.min(1, dt * 1.2);
    pitch += (tp - pitch) * Math.min(1, dt * 1.2);
    const tilt = 0.35 * Math.sin(pt * 0.11) + 0.15 * Math.sin(pt * 0.031);
    const sh = s * 0.1;
    const trem = chatter > 0 ? (Math.sin(t * 70) > 0 ? 0.025 : -0.025) : 0;
    b.neck2.rotation.set(pitch * 0.4 - 0.45 * s, yaw * 0.35, trem);
    b.head.rotation.set(
      pitch * 0.6 - 0.6 * s + rand(-1, 1) * sh + trem,
      yaw * 0.65 + snap.headYaw + rand(-1, 1) * sh * 2,
      tilt + snap.headRoll + rand(-1, 1) * sh
    );

    for (const [n, side] of [['R', 1], ['L', -1]]) {
      const sn = side < 0 ? snap.armL : snap.armR;
      b['arm' + n].rotation.x = 0.03 * Math.sin(pt * 0.7 + side) + sn - 0.9 * s;
      b['arm' + n].rotation.z = side * (0.5 * s);
      b['fore' + n].rotation.x = sn ? -0.35 : -0.2 * s;
      const curl = 0.25 * Math.max(0, Math.sin(pt * 0.6 + side * 3) - 0.5) * 2 + (s ? rand(0, 0.6) : 0) + (sn ? 0.5 : 0);
      b['fing' + n].rotation.z = -side * curl * 0.6;
      b['tip' + n].rotation.z = -side * curl;
      b['clav' + n].rotation.z = side * 0.01 * breath;
    }

    // ---- RUN: a limping, head-cocked lurch when slow; when fast it drops onto its long arms
    // and bounds at you on all fours, head locked level and staring, snapping the wrong way.
    const sp = Math.abs(gaitSpeed);
    gaitBlend += ((sp > 0.25 ? 1 : 0) - gaitBlend) * Math.min(1, dt * 7);
    const q4 = THREE.MathUtils.smoothstep(sp, 2.3, 4.0);
    const stride = 1.25 + q4 * 1.45;                 // metres per full cycle
    const prevPh = phase;
    phase += Math.sign(gaitSpeed) * dt * sp / stride * Math.PI * 2;
    if (Math.floor(prevPh / Math.PI) !== Math.floor(phase / Math.PI) && gaitBlend > 0.3) {
      if (onStep) onStep(q4);
      if (rng() < 0.18 + q4 * 0.2) {                 // a stride where its head snaps sideways
        twitchT = rand(0.1, 0.3); twitchRoll = rand(1.0, 1.9) * (rng() < 0.5 ? -1 : 1); twitchYaw = rand(-1.3, 1.3);
      }
    }
    twitchT = Math.max(0, twitchT - dt);
    const g = gaitBlend;
    let hipsY = 0;
    if (g > 0.001) {
      const W = 1 - q4, R = q4, ph = phase, S = Math.sin(ph), C = Math.cos(ph);
      const L = (a, bb) => a * W + bb * R;
      hipsY = L(-0.04 * Math.abs(C), -0.3 + 0.12 * Math.max(0, Math.sin(ph - 0.6)));
      b.hips.rotation.set(0, 0, L(0.1 * S, 0.05 * S) * g);
      mixR(b.spine, 'x', L(0.28, 0.66), g);
      mixR(b.chest, 'x', L(0.22, 0.55 + 0.14 * Math.sin(ph + 1)), g);
      mixR(b.chest, 'z', L(0.1 * S, 0.12 * S), g);
      mixR(b.neck2, 'x', L(-0.15, -0.85), g);
      mixR(b.head, 'x', L(-0.05, -0.4), g);
      mixR(b.head, 'z', L(0.55, 0.15), g);              // permanently cocked to one side
      // legs (nothing else drives them, so set them outright)
      for (const [n, off] of [['R', 0], ['L', 0.55]]) {
        const pw = ph + (n === 'L' ? Math.PI : 0) * W + off * R;
        const s = Math.sin(pw), c = Math.cos(pw);
        const drag = n === 'L' ? 1 : 0;                 // the left leg drags when it walks
        const tw = L(drag ? 0.22 * s : -0.5 * s, -0.7 + 0.85 * s);
        const sw = L(drag ? 0.15 : 0.75 * Math.max(0, c), 1.1 + 0.55 * Math.max(0, c));
        const fw = L(drag ? 0.5 : -0.2 * Math.max(0, c), -0.5 + 0.3 * s);
        b['thigh' + n].rotation.x = tw * g;
        b['shin' + n].rotation.x = sw * g;
        b['foot' + n].rotation.x = fw * g;
      }
      // arms: dangling and swinging when it walks; front legs when it runs
      const bend = b.spine.rotation.x + b.chest.rotation.x;
      for (const [n, side, off] of [['R', 1, 0], ['L', -1, 0.55]]) {
        const pa = ph + Math.PI + off * R;
        const s = Math.sin(pa), c = Math.cos(pa);
        mixR(b['arm' + n], 'x', L(side * 0.3 * Math.sin(ph) * (side < 0 ? 0.6 : 1), -bend - 0.4 + 0.85 * s), g);
        mixR(b['arm' + n], 'z', L(side * 0.08, side * 0.3), g);
        mixR(b['fore' + n], 'x', L(-0.15, -0.2 - 0.5 * Math.max(0, c)), g);
        mixR(b['fing' + n], 'z', L(-side * 0.15, -side * 0.8), g);
        mixR(b['tip' + n], 'z', L(-side * 0.25, -side * 1.2), g);
      }
    } else {
      b.hips.rotation.set(0, 0, 0);
      for (const n of ['R', 'L']) for (const k of ['thigh', 'shin', 'foot']) b[k + n].rotation.x = 0;
    }
    if (twitchT > 0) { b.head.rotation.z += twitchRoll; b.head.rotation.y += twitchYaw; b.neck2.rotation.z += twitchRoll * 0.3; }

    // ---- LUNGE (jumpscare): arms flung wide around you, fingers splayed, chin up, teeth out
    if (lunge > 0.001) {
      const w = lunge;
      mixR(b.spine, 'x', 0.32, w); mixR(b.chest, 'x', 0.28, w); mixR(b.chest, 'z', 0, w);
      mixR(b.neck2, 'x', -0.28, w); mixR(b.head, 'x', -0.42, w); mixR(b.head, 'z', 0.25, w);
      for (const [n, side] of [['R', 1], ['L', -1]]) {
        mixR(b['arm' + n], 'x', -1.45, w); mixR(b['arm' + n], 'z', side * 0.95, w);
        mixR(b['fore' + n], 'x', -0.75, w);
        mixR(b['fing' + n], 'z', side * 0.55, w); mixR(b['tip' + n], 'z', side * 0.45, w);
        mixR(b['thigh' + n], 'x', -0.4, w); mixR(b['shin' + n], 'x', 0.7, w);
      }
      hipsY += (-0.14 - hipsY) * w;
      // LOOM: standing tall, arms raised up over you, forearms hanging, head cocked flat sideways
      if (loom > 0.001) {
        const m = loom;
        mixR(b.head, 'z', 1.35, m); mixR(b.head, 'x', 0.25, m); mixR(b.neck2, 'z', 0.35, m);
        mixR(b.spine, 'x', 0.12, m); mixR(b.chest, 'x', 0.1, m);
        for (const [n, side] of [['R', 1], ['L', -1]]) {
          mixR(b['arm' + n], 'z', side * 2.35, m); mixR(b['arm' + n], 'x', -0.55, m);
          mixR(b['fore' + n], 'x', -1.2, m); mixR(b['fore' + n], 'z', side * 0.3, m);
          mixR(b['fing' + n], 'z', -side * 0.7, m); mixR(b['tip' + n], 'z', -side * 1.1, m);
          mixR(b['thigh' + n], 'x', 0, m); mixR(b['shin' + n], 'x', 0, m);
        }
        hipsY *= 1 - m;
      }
    }
    b.hips.position.y += hipsY;
    if (shake > 0) {
      const j = () => (rng() * 2 - 1) * shake;
      b.head.rotation.x += j() * 0.35; b.head.rotation.y += j() * 0.6; b.head.rotation.z += j() * 0.8;
      b.neck2.rotation.z += j() * 0.3; b.chest.rotation.y = j() * 0.15;
      for (const n of ['R', 'L']) { b['fing' + n].rotation.z += j() * 0.6; b['tip' + n].rotation.z += j() * 0.9; b['fore' + n].rotation.y = j() * 0.4; }
    } else b.chest.rotation.y = 0;

    if (watchTarget) {
      if (watchTarget.isObject3D) watchTarget.getWorldPosition(tmpV); else tmpV.copy(watchTarget);
      root.updateMatrixWorld(true);
      for (const e of eyes) e.lookAt(tmpV);
      eye3.lookAt(tmpV);
    }
    // rare, slow blink (it barely ever blinks)
    blinkTimer -= dt;
    if (blinkTimer <= 0 && blinkT < 0) { blinkT = 0; blinkTimer = rand(5, 14); }
    let bl = 0;
    if (blinkT >= 0) { blinkT += dt; bl = Math.sin(Math.min(1, blinkT / 0.45) * Math.PI); if (blinkT > 0.45) blinkT = -1; }
    if (s > 0) bl = -0.25;   // eyes go wide when it screams
    for (const l of lids) { l.upper.rotation.x = -0.12 + bl * 1.05; l.lower.rotation.x = 0.1 - Math.max(0, bl) * 0.25; }
    const want3 = snapHold > 0 || s > 0 || Math.sin(pt * 0.13) > 0.985 ? 1 : 0;
    eye3Open += (want3 - eye3Open) * Math.min(1, dt * 14);
    eye3.scale.set(Math.max(0.02, eye3Open), Math.max(0.15, eye3Open), 1);
  }

  return {
    object: root,
    update,
    watch(target) { watchTarget = target; },
    scream() { screamT = 0; clearSnap(); snapHold = 0; emit('scream'); },
    roar() { this.scream(); },
    get isScreaming() { return screamT >= 0; },
    setStopMotion(fps) { smFps = fps; },
    /** Ground speed in m/s (negative = running backwards). Slow: a limping lurch; fast: on all fours. */
    setGait(speed) { gaitSpeed = speed; },
    /** 0..1: the jumpscare pose (arms flung wide, chin up). */
    setLunge(v) { lunge = v; },
    /** 0..1: violent shaking of the head and fingers. */
    setShake(v) { shake = v; },
    /** 0..1 (on top of the lunge): standing tall with its arms raised over you. */
    setLoom(v) { loom = v; },
    /** Called with 0 (walking) .. 1 (running on all fours) every time a foot or hand lands. */
    set onStep(fn) { onStep = fn; },
    setOutline() {}, // kept for compatibility
    bones: boneObjs,
    mesh: body,
    dispose() {
      root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    },
  };
}

// old name, kept so earlier code still works
export const createDemonGoat = createCreature1;
