// creature1-geometry.js — sculpts Creature 1's body. Pure maths with no three.js, so it can
// run in a background thread (see creature1-worker.js) without freezing the game.

// Share of the build finished after each stage, for the loading bar
const PROGRESS = { sculpted: 0.15, meshed: 0.6 };

// ===================================================================== math helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirror = (p, s) => [p[0] * s, p[1], p[2]];

function eulerMatrix(rx, ry, rz) { // R = Rz*Ry*Rx, returned row-major 3x3
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}
// rotate point about a pivot around the X axis
function rotX(p, pivot, a) {
  const y = p[1] - pivot[1], z = p[2] - pivot[2], c = Math.cos(a), s = Math.sin(a);
  return [p[0], pivot[1] + y * c - z * s, pivot[2] + y * s + z * c];
}

export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 3D value noise
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(
    L(L(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), L(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    L(L(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), L(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w
  );
}
const fbm = (x, y, z) => vnoise(x, y, z) * 0.55 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.15;

// ===================================================================== SDF primitives
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

function sdRoundCone(px, py, pz, P) {
  const pax = px - P.a[0], pay = py - P.a[1], paz = pz - P.a[2];
  const y = pax * P.ba[0] + pay * P.ba[1] + paz * P.ba[2];
  const z = y - P.l2;
  const qx = pax * P.l2 - P.ba[0] * y, qy = pay * P.l2 - P.ba[1] * y, qz = paz * P.l2 - P.ba[2] * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * P.l2, z2 = z * z * P.l2;
  const k = Math.sign(P.rr) * P.rr * P.rr * x2;
  if (Math.sign(z) * P.a2 * z2 > k) return Math.sqrt(x2 + z2) * P.il2 - P.r2;
  if (Math.sign(y) * P.a2 * y2 < k) return Math.sqrt(x2 + y2) * P.il2 - P.r1;
  return (Math.sqrt(x2 * P.a2 * P.il2) + y * P.rr) * P.il2 - P.r1;
}
function sdEllipsoid(px, py, pz, P) {
  const dx = px - P.c[0], dy = py - P.c[1], dz = pz - P.c[2], m = P.m; // m = R^T (row-major)
  const lx = m[0] * dx + m[3] * dy + m[6] * dz, ly = m[1] * dx + m[4] * dy + m[7] * dz, lz = m[2] * dx + m[5] * dy + m[8] * dz;
  const ax = lx / P.r[0], ay = ly / P.r[1], az = lz / P.r[2];
  const bx = ax / P.r[0], by = ay / P.r[1], bz = az / P.r[2];
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az), k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(P.r[0], P.r[1], P.r[2]);
}
function sdBox(px, py, pz, P) {
  const dx = px - P.c[0], dy = py - P.c[1], dz = pz - P.c[2], u = P.u, v = P.v, w = P.w;
  const qx = Math.abs(dx * u[0] + dy * u[1] + dz * u[2]) - P.h[0];
  const qy = Math.abs(dx * v[0] + dy * v[1] + dz * v[2]) - P.h[1];
  const qz = Math.abs(dx * w[0] + dy * w[1] + dz * w[2]) - P.h[2];
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - P.round;
}

class Sculpt {
  constructor() { this.adds = []; this.subs = []; }
  _push(P, o) {
    P.k = o.k ?? 0.03; P.bone = o.bone; P.mat = o.mat ?? 'skin'; P.temp = o.temp ?? 0.02;
    (o.sub ? this.subs : this.adds).push(P);
    return P;
  }
  cone(a, b, r1, r2, o = {}) {
    const ba = sub(b, a), l2 = ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2, rr = r1 - r2;
    return this._push({ f: sdRoundCone, a, ba, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, r1, r2,
      bc: lerp3(a, b, 0.5), br: Math.sqrt(l2) / 2 + Math.max(r1, r2) }, o);
  }
  // chain of round cones through points with radii
  chain(pts, radii, o = {}) { for (let i = 0; i < pts.length - 1; i++) this.cone(pts[i], pts[i + 1], radii[i], radii[i + 1], o); }
  ell(c, r, rot = [0, 0, 0], o = {}) {
    const R = eulerMatrix(rot[0], rot[1], rot[2]);
    return this._push({ f: sdEllipsoid, c, r, m: R, bc: c, br: Math.max(r[0], r[1], r[2]) }, o);
  }
  box(c, h, u, v, round, o = {}) {
    u = norm(u); v = norm(v);
    const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return this._push({ f: sdBox, c, h, u, v, w, round, bc: c, br: len(h) + round }, o);
  }
  // bin primitives into a grid so each query only looks at nearby ones
  build(bmin, bmax, cell = 0.06, margin = 0.1) {
    this.bmin = bmin; this.cell = cell; this.margin = margin;
    this.n = [0, 1, 2].map((a) => Math.ceil((bmax[a] - bmin[a]) / cell) + 1);
    const half = cell * 0.8661 + margin;
    this.binsA = []; this.binsS = [];
    for (let j = 0; j < this.n[1]; j++) for (let k = 0; k < this.n[2]; k++) for (let i = 0; i < this.n[0]; i++) {
      const c = [bmin[0] + (i + 0.5) * cell, bmin[1] + (j + 0.5) * cell, bmin[2] + (k + 0.5) * cell];
      const near = (P) => len(sub(c, P.bc)) - P.br < half + P.k;
      this.binsA.push(this.adds.filter(near));
      this.binsS.push(this.subs.filter(near));
    }
  }
  bin(x, y, z) {
    const i = Math.floor((x - this.bmin[0]) / this.cell), j = Math.floor((y - this.bmin[1]) / this.cell), k = Math.floor((z - this.bmin[2]) / this.cell);
    if (i < 0 || j < 0 || k < 0 || i >= this.n[0] || j >= this.n[1] || k >= this.n[2]) return -1;
    return (j * this.n[2] + k) * this.n[0] + i;
  }
  dist(x, y, z) {
    const bi = this.bin(x, y, z);
    if (bi < 0 || this.binsA[bi].length === 0) return this.margin;
    let d = this.margin;
    for (const P of this.binsA[bi]) {
      const lb = Math.hypot(x - P.bc[0], y - P.bc[1], z - P.bc[2]) - P.br;
      if (lb > d + P.k) continue;
      d = smin(d, P.f(x, y, z, P), P.k);
    }
    for (const P of this.binsS[bi]) {
      const lb = Math.hypot(x - P.bc[0], y - P.bc[1], z - P.bc[2]) - P.br;
      if (lb > P.k + Math.abs(d)) continue;
      d = -smin(-d, P.f(x, y, z, P), P.k);
    }
    return d;
  }
}

// ===================================================================== skeleton (rest pose, world space)
function skeletonDef() {
  const B = [];
  const bone = (name, parent, pos) => { B.push({ name, parent, pos }); return name; };
  bone('hips', null, [0, 1.0, -0.03]);
  bone('spine', 'hips', [0, 1.24, -0.08]);
  bone('chest', 'spine', [0, 1.5, -0.04]);
  bone('neck', 'chest', [0, 1.72, 0.06]);
  bone('neck2', 'neck', [0, 1.83, 0.1]);
  bone('head', 'neck2', [0, 1.96, 0.15]);
  for (const [s, n] of [[1, 'R'], [-1, 'L']]) {
    bone('clav' + n, 'chest', [s * 0.04, 1.67, 0.1]);
    bone('arm' + n, 'clav' + n, [s * 0.235, 1.69, 0.06]);
    bone('fore' + n, 'arm' + n, [s * 0.33, 1.16, 0.12]);
    const dl = s < 0 ? -0.11 : 0; // left arm hangs longer
    bone('hand' + n, 'fore' + n, [s * 0.31, 0.6 + dl, 0.27]);
    bone('fing' + n, 'hand' + n, [s * 0.305, 0.48 + dl, 0.31]);
    bone('tip' + n, 'fing' + n, [s * 0.295, 0.39 + dl, 0.315]);
    bone('thigh' + n, 'hips', [s * 0.1, 0.95, -0.03]);
    bone('shin' + n, 'thigh' + n, [s * 0.115, 0.52, 0.06]);
    bone('foot' + n, 'shin' + n, [s * 0.115, 0.09, -0.03]);
    bone('toe' + n, 'foot' + n, [s * 0.12, 0.02, 0.12]);
  }
  return B;
}

// ===================================================================== the sculpt
function sculptBody(rng) {
  const S = new Sculpt();
  const rand = (a, b) => a + (b - a) * rng();
  const H = [0, 1.97, 0.16];             // head bone
  const h = (x, y, z) => add(H, [x, y, z]);
  const TILT = 0.38, CP = [0, 1.5, -0.02]; // chest tilt (hunch) + pivot
  const T = (p) => rotX(p, CP, TILT);

  // ---- spine: knobbly vertebrae ridge along a hunched back
  const spinePts = [[0, 0.98, -0.15], [0, 1.15, -0.2], [0, 1.35, -0.21], [0, 1.55, -0.15], [0, 1.68, -0.06], [0, 1.79, -0.025], [0, 1.9, 0.07]];
  const curve = (u) => { // simple polyline sampler
    const f = u * (spinePts.length - 1), i = Math.min(spinePts.length - 2, Math.floor(f));
    return lerp3(spinePts[i], spinePts[i + 1], f - i);
  };
  for (let i = 0; i < 22; i++) {
    const u = i / 21, p = curve(u);
    const bone = u < 0.2 ? 'hips' : u < 0.45 ? 'spine' : u < 0.72 ? 'chest' : u < 0.88 ? 'neck' : 'neck2';
    const r = 0.016 + 0.008 * Math.sin(u * Math.PI);
    S.ell(p, [r * 1.25, r * 0.8, r * 1.2], [0, 0, 0], { k: 0.012, bone, mat: 'skin', temp: 0.03 });
  }

  // ---- ribcage: narrow core + individual ribs you can count
  S.ell(T([0, 1.5, -0.03]), [0.155, 0.21, 0.13], [TILT, 0, 0], { k: 0.05, bone: 'chest' });
  for (let i = 0; i < 9; i++) {
    const y = 1.67 - i * 0.045;
    const rx = 0.11 + 0.05 * Math.sin(Math.min(1, (i + 1) / 6) * Math.PI * 0.62);
    const rz = 0.11 + 0.018 * Math.sin((i / 8) * Math.PI);
    const span = i < 7 ? 0.92 : 0.55;   // floating ribs at the bottom are short
    for (const s of [1, -1]) {
      const pts = [], radii = [];
      for (let k = 0; k <= 6; k++) {
        const phi = (k / 6) * Math.PI * span;
        pts.push(T([s * rx * Math.sin(phi), y - 0.07 * (phi / Math.PI), -0.04 - rz * Math.cos(phi) + 0.02]));
        radii.push(0.0095);
      }
      S.chain(pts, radii, { k: 0.022, bone: 'chest', temp: 0.03 });
    }
  }
  S.cone(T([0, 1.64, 0.08]), T([0, 1.38, 0.11]), 0.014, 0.011, { k: 0.04, bone: 'chest' }); // sternum
  // pectoral / intercostal skin pulled tight between ribs (thin shell)
  S.ell(T([0, 1.53, -0.02]), [0.16, 0.19, 0.13], [TILT, 0, 0], { k: 0.03, bone: 'chest' });

  // ---- sunken belly + pinched waist
  S.cone([0, 1.36, -0.05], [0, 1.06, -0.04], 0.11, 0.12, { k: 0.08, bone: 'spine' });
  for (const s of [1, -1]) S.cone([s * 0.07, 1.34, -0.02], [s * 0.1, 1.05, -0.02], 0.045, 0.05, { k: 0.06, bone: 'spine' }); // obliques
  S.ell([0, 1.18, 0.0], [0.09, 0.08, 0.06], [0, 0, 0], { k: 0.04, bone: 'spine' }); // little sagging gut
  // spinal erector muscles either side of the spine
  for (const s of [1, -1]) S.chain([[s * 0.04, 1.02, -0.13], [s * 0.045, 1.25, -0.17], [s * 0.04, 1.45, -0.16]], [0.03, 0.032, 0.022], { k: 0.03, bone: 'spine' });

  // ---- pelvis with jutting hip bones
  S.ell([0, 0.98, -0.04], [0.14, 0.1, 0.11], [0, 0, 0], { k: 0.06, bone: 'hips' });
  for (const s of [1, -1]) S.ell([s * 0.07, 0.95, -0.1], [0.075, 0.08, 0.07], [0, 0, 0], { k: 0.05, bone: 'thigh' + (s > 0 ? 'R' : 'L') }); // bony buttocks
  for (const s of [1, -1]) S.ell([s * 0.1, 1.06, -0.01], [0.03, 0.02, 0.07], [0.3, 0, s * 0.4], { k: 0.045, bone: 'hips', temp: 0.03 });

  // ---- shoulder blades sticking out of the hunched back
  for (const s of [1, -1]) {
    S.ell(T([s * 0.095, 1.6, -0.135]), [0.055, 0.075, 0.016], [TILT + 0.2, s * 0.35, s * 0.15], { k: 0.04, bone: 'chest', mat: 'skin' });
    S.cone(T([s * 0.05, 1.66, -0.14]), [s * 0.19, 1.7, -0.03], 0.009, 0.011, { k: 0.03, bone: 'chest' }); // scapular spine
    S.cone([s * 0.02, 1.665, 0.12], [s * 0.2, 1.71, 0.07], 0.012, 0.013, { k: 0.028, bone: 'clav' + (s > 0 ? 'R' : 'L') }); // collarbone
    S.ell([s * 0.215, 1.67, 0.05], [0.055, 0.075, 0.058], [0, 0, s * 0.3], { k: 0.035, bone: 'arm' + (s > 0 ? 'R' : 'L') }); // deltoid
  }
  // trapezius ridge from neck to shoulders
  for (const s of [1, -1]) S.ell([s * 0.1, 1.73, 0.03], [0.1, 0.045, 0.06], [0.2, 0, -s * 0.38], { k: 0.07, bone: 'chest' }); // trapezius slope

  // ---- neck: long and thin, the front of the throat torn open
  const nb = (u) => (u < 0.5 ? 'neck2' : 'neck');
  S.cone([0, 1.69, 0.03], h(0, -0.03, -0.06), 0.06, 0.034, { k: 0.05, bone: 'neck' });            // back of neck / spine
  S.cone([0, 1.7, 0.04], h(0, -0.075, -0.01), 0.024, 0.02, { k: 0.03, bone: 'neck', mat: 'raw', temp: 0.01 }); // exposed throat
  // cords and tendons crossing the open throat
  for (const s of [1, -1]) {
    S.cone(h(s * 0.055, -0.055, -0.02), [-s * 0.02, 1.66, 0.03], 0.0105, 0.0105, { k: 0.03, bone: 'neck2', mat: 'sinew', temp: 0.01 });
    S.cone(h(s * 0.02, -0.085, 0.01), [s * 0.05, 1.68, 0.03], 0.0098, 0.0098, { k: 0.03, bone: 'neck2', mat: 'sinew', temp: 0.01 });
    S.cone(h(s * 0.035, -0.07, -0.03), [s * 0.03, 1.72, 0.04], 0.0098, 0.0098, { k: 0.02, bone: 'neck', mat: 'sinew', temp: 0.01 });
  }
  // strips of face skin hanging from the cheeks down to the shoulders
  for (const s of [1, -1]) {
    const strips = [
      [h(s * 0.074, -0.045, 0.0), [s * 0.085, 1.82, 0.0], [s * 0.088, 1.72, 0.01]],
      [h(s * 0.058, -0.085, 0.04), [s * 0.06, 1.8, 0.07], [s * 0.058, 1.72, 0.07]],
    ];
    for (const st of strips) {
      S.cone(st[0], st[1], 0.013, 0.013, { k: 0.02, bone: 'neck2', temp: 0.015 });
      S.cone(st[1], st[2], 0.013, 0.013, { k: 0.03, bone: 'neck', temp: 0.015 });
    }
  }

  // ---- head: tall, bald, smooth, too human
  S.ell(h(0, 0.085, -0.01), [0.088, 0.125, 0.102], [-0.12, 0, 0], { k: 0.04, bone: 'head', temp: 0.006 });   // tall cranium
  S.ell(h(0, 0.13, -0.01), [0.08, 0.07, 0.095], [-0.12, 0, 0], { k: 0.05, bone: 'head', temp: 0.006 });   // rounder dome
  S.ell(h(0, 0.01, 0.045), [0.075, 0.095, 0.066], [0, 0, 0], { k: 0.04, bone: 'head', temp: 0.006 });          // face
  S.ell(h(0, 0.062, 0.085), [0.068, 0.017, 0.026], [0, 0, 0], { k: 0.02, bone: 'head', temp: 0.006 });      // brow
  for (const s of [1, -1]) {
    S.ell(h(s * 0.058, 0.0, 0.068), [0.016, 0.02, 0.032], [0, 0, 0], { k: 0.03, bone: 'head', temp: 0.006 }); // cheekbones
    S.ell(h(s * 0.034, 0.036, 0.1), [0.022, 0.014, 0.02], [0, 0, 0], { k: 0.01, bone: 'head', sub: true });     // eye sockets
    S.ell(h(s * 0.083, 0.03, -0.005), [0.012, 0.022, 0.014], [0, 0, 0], { k: 0.012, bone: 'head', temp: 0.006 }); // small flat ears
  }
  S.ell(h(0, -0.004, 0.108), [0.011, 0.028, 0.012], [0.15, 0, 0], { k: 0.014, bone: 'head', temp: 0.006 });  // thin nose
  S.ell(h(0, 0.112, 0.09), [0.009, 0.028, 0.016], [-0.35, 0, 0], { k: 0.008, bone: 'head', sub: true });        // third eye slit
  S.ell(h(0, -0.064, 0.07), [0.045, 0.024, 0.04], [0, 0, 0], { k: 0.035, bone: 'head', temp: 0.006 });    // upper jaw, no lips
  // no lower jaw. the face just stops.
  S.box(h(0, -0.135, 0.06), [0.07, 0.04, 0.06], [1, 0, 0], [0, 1, 0], 0.004, { k: 0.012, bone: 'head', sub: true });

  // ---- arms: far too long, thin, bony
  for (const s of [1, -1]) {
    const n = s > 0 ? 'R' : 'L';
    const dl = s < 0 ? -0.11 : 0, D = (p) => [p[0], p[1] + dl, p[2]];
    const sh = [s * 0.235, 1.69, 0.06], el = [s * 0.33, 1.16, 0.12], wr = [s * 0.31, 0.6 + dl, 0.27];
    S.cone(sh, el, 0.045, 0.032, { k: 0.04, bone: 'arm' + n });
    S.ell(lerp3(sh, el, 0.38), [0.042, 0.15, 0.04], [0.14, 0, s * 0.17], { k: 0.04, bone: 'arm' + n });       // wasted bicep/tricep
    S.ell(add(el, [0, 0, -0.022]), [0.028, 0.03, 0.026], [0, 0, 0], { k: 0.015, bone: 'fore' + n });       // elbow point
    S.cone(el, wr, 0.032, 0.019, { k: 0.025, bone: 'fore' + n });
    S.ell(lerp3(el, wr, 0.22), [0.032, 0.1, 0.03], [0.24, 0, s * 0.03], { k: 0.035, bone: 'fore' + n }); // forearm muscle                                         // ulna
    S.cone(add(el, [s * 0.016, -0.02, 0.012]), add(wr, [s * 0.012, 0.01, 0.006]), 0.024, 0.018, { k: 0.02, bone: 'fore' + n }); // radius
    S.ell(add(wr, [0, -0.005, 0]), [0.016, 0.022, 0.024], [0, 0, 0], { k: 0.015, bone: 'hand' + n });     // wrist knob
    // palm: thin, palm facing the body
    S.box(D([s * 0.307, 0.54, 0.29]), [0.048, 0.03, 0.006], [0, -1, 0.15], [0, 0.15, 1], 0.009, { k: 0.02, bone: 'hand' + n });
    // four long fingers + thumb
    const nf = s < 0 ? 5 : 4; // six fingers on the left hand
    for (let j = 0; j < nf; j++) {
      const z = 0.31 + (j - (nf - 1) / 2) * 0.0175;
      const L = [0.085, 0.075, 0.06].map((x) => x * (j === 0 || j === nf - 1 ? 0.88 : 1) * rand(0.95, 1.08));
      const p0 = [s * 0.305, 0.485 + dl, z];
      const p1 = add(p0, [-s * 0.006, -L[0], 0.004]);
      const p2 = add(p1, [-s * 0.016, -L[1], 0.0]);
      const p3 = add(p2, [-s * 0.024, -L[2], -0.004]);
      const bone = 'fing' + n;
      S.cone(p0, p1, 0.0125, 0.0105, { k: 0.008, bone, temp: 0.01 });
      S.cone(p1, p2, 0.0105, 0.0095, { k: 0.006, bone: 'tip' + n, temp: 0.01 });
      S.cone(p2, p3, 0.0095, 0.0075, { k: 0.005, bone: 'tip' + n, temp: 0.01 });
      S.ell(add(p3, [s * 0.002, 0.008, 0.0]), [0.006, 0.012, 0.0085], [0, 0, 0], { k: 0.003, bone: 'tip' + n, mat: 'nail', temp: 0.004 });
      for (const q of [p1, p2]) S.ell(q, [0.0125, 0.012, 0.0125], [0, 0, 0], { k: 0.006, bone: 'tip' + n, temp: 0.01 }); // knuckles
    }
    S.chain([D([s * 0.3, 0.57, 0.32]), D([s * 0.293, 0.52, 0.355]), D([s * 0.285, 0.47, 0.365])], [0.013, 0.011, 0.009], { k: 0.01, bone: 'hand' + n });
  }

  // ---- legs: long, starved human legs, knees slightly bent
  for (const s of [1, -1]) {
    const n = s > 0 ? 'R' : 'L';
    const hip = [s * 0.1, 0.95, -0.03], kn = [s * 0.115, 0.52, 0.06], an = [s * 0.115, 0.09, -0.03];
    const th = 'thigh' + n, sh = 'shin' + n, ft = 'foot' + n, to = 'toe' + n;
    S.cone(hip, kn, 0.066, 0.04, { k: 0.045, bone: th });
    S.ell(add(lerp3(hip, kn, 0.42), [s * 0.008, 0, 0.022]), [0.045, 0.16, 0.04], [-0.2, 0, 0], { k: 0.04, bone: th });   // wasted quad
    S.ell(add(lerp3(hip, kn, 0.38), [0, 0, -0.028]), [0.04, 0.13, 0.034], [-0.2, 0, 0], { k: 0.04, bone: th });          // hamstring
    // knobbly knee
    S.ell(add(kn, [0, 0.008, 0.03]), [0.028, 0.032, 0.02], [0, 0, 0], { k: 0.015, bone: sh, temp: 0.03 });
    for (const t of [1, -1]) S.ell(add(kn, [t * 0.026, 0.022, 0.0]), [0.02, 0.03, 0.03], [0, 0, 0], { k: 0.018, bone: th, temp: 0.03 });
    // shin bone with a sharp front edge, thin calf
    S.cone(kn, an, 0.036, 0.023, { k: 0.035, bone: sh });
    S.cone(add(kn, [0, -0.04, 0.03]), add(an, [0, 0.06, 0.018]), 0.011, 0.009, { k: 0.02, bone: sh });
    S.ell(add(lerp3(kn, an, 0.27), [0, 0, -0.028]), [0.033, 0.1, 0.03], [-0.15, 0, 0], { k: 0.03, bone: sh });
    S.cone(add(lerp3(kn, an, 0.5), [0, 0, -0.03]), [s * 0.115, 0.05, -0.075], 0.011, 0.01, { k: 0.02, bone: sh }); // achilles tendon
    for (const t of [1, -1]) S.ell(add(an, [t * 0.021, 0.0, 0.0]), [0.01, 0.013, 0.011], [0, 0, 0], { k: 0.035, bone: ft });  // ankle bones
    // long bony foot
    S.ell([s * 0.115, 0.036, -0.055], [0.03, 0.034, 0.04], [0, 0, 0], { k: 0.045, bone: ft });                                    // heel
    S.ell([s * 0.117, 0.03, 0.02], [0.03, 0.022, 0.075], [-0.12, 0, 0], { k: 0.045, bone: ft });                                       // arch
    S.ell([s * 0.122, 0.018, 0.08], [0.036, 0.014, 0.035], [0, 0, 0], { k: 0.02, bone: ft });                                         // ball of the foot
    for (let j = 0; j < 4; j++) S.cone([s * (0.106 + j * 0.008), 0.055, -0.01], [s * (0.094 + j * 0.017), 0.03, 0.095], 0.0075, 0.007, { k: 0.01, bone: ft }); // tendons
    // five long toes
    for (let j = 0; j < 5; j++) {
      const x0 = s * (0.092 + j * 0.0165), big = j === 0;
      const L = big ? 0.05 : 0.068 - j * 0.007;
      const p0 = [x0, 0.02, 0.098 - j * 0.007], p1 = [x0 + s * j * 0.002, 0.018, p0[2] + L * 0.55], p2 = [x0 + s * j * 0.003, 0.009, p0[2] + L];
      S.cone(p0, p1, big ? 0.014 : 0.0098, big ? 0.012 : 0.009, { k: 0.006, bone: to, temp: 0.01 });
      S.cone(p1, p2, big ? 0.012 : 0.009, big ? 0.0105 : 0.0078, { k: 0.004, bone: to, temp: 0.01 });
      S.ell(p1, [big ? 0.0135 : 0.0098, big ? 0.012 : 0.0092, 0.01], [0, 0, 0], { k: 0.004, bone: to, temp: 0.01 }); // toe knuckle
      S.ell(add(p2, [0, 0.005, -0.003]), [big ? 0.01 : 0.007, 0.004, 0.01], [0, 0, 0], { k: 0.003, bone: to, mat: 'nail', temp: 0.004 });
    }
  }
  return S;
}

// ===================================================================== meshing (surface nets, slab by slab)
function surfaceNets(S, bmin, bmax, hs, onProgress) {
  const nx = Math.ceil((bmax[0] - bmin[0]) / hs) + 1, ny = Math.ceil((bmax[1] - bmin[1]) / hs) + 1, nz = Math.ceil((bmax[2] - bmin[2]) / hs) + 1;
  const C = 4, cnx = Math.ceil(nx / C) + 1, cny = Math.ceil(ny / C) + 1, cnz = Math.ceil(nz / C) + 1;
  const coarse = new Float32Array(cnx * cny * cnz);
  for (let j = 0; j < cny; j++) for (let k = 0; k < cnz; k++) for (let i = 0; i < cnx; i++)
    coarse[(j * cnz + k) * cnx + i] = S.dist(bmin[0] + i * C * hs, bmin[1] + j * C * hs, bmin[2] + k * C * hs);
  const thresh = 6 * hs;
  const plane = (j, out) => {
    const y = bmin[1] + j * hs, cj = Math.round(j / C);
    for (let k = 0; k < nz; k++) {
      const ck = Math.round(k / C), z = bmin[2] + k * hs;
      for (let i = 0; i < nx; i++) {
        const dc = coarse[(cj * cnz + ck) * cnx + Math.round(i / C)];
        out[k * nx + i] = Math.abs(dc) > thresh ? dc : S.dist(bmin[0] + i * hs, y, z);
      }
    }
  };
  const pos = [], idx = [];
  let A = new Float32Array(nx * nz), Bp = new Float32Array(nx * nz);
  let cPrev = new Int32Array(nx * nz).fill(-1), cCur = new Int32Array(nx * nz).fill(-1);
  plane(0, A);
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float32Array(8);
  for (let j = 0; j < ny - 1; j++) {
    plane(j + 1, Bp);
    if (onProgress && j % 8 === 0) onProgress(j / (ny - 1));
    cCur.fill(-1);
    for (let k = 0; k < nz - 1; k++) for (let i = 0; i < nx - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const [ox, oy, oz] = corner[c];
        const v = (oy ? Bp : A)[(k + oz) * nx + i + ox];
        val[c] = v; if (v < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [e0, e1] of edges) {
        const a = val[e0], b = val[e1];
        if ((a < 0) === (b < 0)) continue;
        const t = a / (a - b), c0 = corner[e0], c1 = corner[e1];
        sx += c0[0] + (c1[0] - c0[0]) * t; sy += c0[1] + (c1[1] - c0[1]) * t; sz += c0[2] + (c1[2] - c0[2]) * t; n++;
      }
      cCur[k * nx + i] = pos.length / 3;
      pos.push(bmin[0] + (i + sx / n) * hs, bmin[1] + (j + sy / n) * hs, bmin[2] + (k + sz / n) * hs);
    }
    // y-edges from plane j to j+1 (cells all in this layer)
    for (let k = 1; k < nz - 1; k++) for (let i = 1; i < nx - 1; i++) {
      const a = A[k * nx + i], b = Bp[k * nx + i];
      if ((a < 0) === (b < 0)) continue;
      quad(cCur[(k - 1) * nx + i - 1], cCur[(k - 1) * nx + i], cCur[k * nx + i], cCur[k * nx + i - 1], a < 0);
    }
    if (j > 0) {
      // x-edges and z-edges lying on plane j (cells in layers j-1 and j)
      for (let k = 1; k < nz - 1; k++) for (let i = 0; i < nx - 1; i++) {
        const a = A[k * nx + i], b = A[k * nx + i + 1];
        if ((a < 0) === (b < 0)) continue;
        quad(cPrev[(k - 1) * nx + i], cPrev[k * nx + i], cCur[k * nx + i], cCur[(k - 1) * nx + i], a < 0);
      }
      for (let k = 0; k < nz - 1; k++) for (let i = 1; i < nx - 1; i++) {
        const a = A[k * nx + i], b = A[(k + 1) * nx + i];
        if ((a < 0) === (b < 0)) continue;
        quad(cPrev[k * nx + i - 1], cCur[k * nx + i - 1], cCur[k * nx + i], cPrev[k * nx + i], a < 0);
      }
    }
    [A, Bp] = [Bp, A];
    [cPrev, cCur] = [cCur, cPrev];
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

// ===================================================================== full build (pure, no three.js)
export function buildCreature1Geometry(opts = {}) {
  const { seed = 1996, resolution = 0.0075, onProgress = null } = opts;
  const report = (f) => { if (onProgress) onProgress(f); };
  const rng = makeRng(seed);
  const S = sculptBody(rng);
  const bones = skeletonDef();
  const boneIndex = Object.fromEntries(bones.map((b, i) => [b.name, i]));

  const BMIN = [-0.6, -0.02, -0.34], BMAX = [0.6, 2.24, 0.62];
  S.build(BMIN, BMAX);
  report(PROGRESS.sculpted);
  const { pos, idx } = surfaceNets(S, BMIN, BMAX, resolution,
    (f) => report(PROGRESS.sculpted + f * (PROGRESS.meshed - PROGRESS.sculpted)));
  const nv = pos.length / 3;
  const e = 0.0015;
  const grad = (x, y, z) => {
    const g = [
      S.dist(x + e, y - e, z - e), S.dist(x - e, y - e, z + e), S.dist(x - e, y + e, z - e), S.dist(x + e, y + e, z + e),
    ];
    return norm([g[0] - g[1] - g[2] + g[3], -g[0] - g[1] + g[2] + g[3], -g[0] + g[1] - g[2] + g[3]]);
  };

  const MAT = {
    skin: [0.74, 0.72, 0.67], raw: [0.12, 0.05, 0.045], sinew: [0.8, 0.75, 0.68], nose: [0.16, 0.13, 0.13], nail: [0.22, 0.18, 0.14], hoof: [0.07, 0.06, 0.055],
  };
  const color = new Float32Array(nv * 3);
  const skinIndex = new Uint16Array(nv * 4);
  const skinWeight = new Float32Array(nv * 4);
  const boneW = new Float32Array(bones.length);
  const toLin = (c) => Math.pow(c, 2.2);

  for (let v = 0; v < nv; v++) {
    if (v % 2000 === 0) report(PROGRESS.meshed + (v / nv) * (1 - PROGRESS.meshed));
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    // project onto the true surface (two Newton steps)
    for (let it = 0; it < 2; it++) {
      const d = S.dist(x, y, z), g = grad(x, y, z);
      x -= g[0] * d; y -= g[1] * d; z -= g[2] * d;
    }
    const n = grad(x, y, z);

    // primitive attribution -> bone weights + material
    let dmin = 1e9;
    const bi = S.bin(x, y, z);
    const list = bi < 0 ? [] : S.binsA[bi];
    const ds = new Float32Array(list.length);
    for (let p = 0; p < list.length; p++) {
      const P = list[p];
      ds[p] = P.f(x, y, z, P);
      if (ds[p] < dmin) dmin = ds[p];
    }
    boneW.fill(0);
    const mc = [0, 0, 0];
    let mw = 0;
    for (let p = 0; p < list.length; p++) {
      if (ds[p] > dmin + 0.12) continue;
      const P = list[p];
      const w = Math.exp(-(ds[p] - dmin) / P.temp);
      boneW[boneIndex[P.bone]] += w;
      const cw = Math.exp(-(ds[p] - dmin) / 0.004);
      const c = MAT[P.mat]; mc[0] += c[0] * cw; mc[1] += c[1] * cw; mc[2] += c[2] * cw; mw += cw;
    }
    // top 4 bones
    const order = [...boneW.keys()].sort((a, b) => boneW[b] - boneW[a]).slice(0, 4);
    let tot = 0; for (const b of order) tot += boneW[b];
    if (!(tot > 0)) { tot = 1; boneW[0] = 1; }
    order.forEach((b, i) => { skinIndex[v * 4 + i] = b; skinWeight[v * 4 + i] = boneW[b] / tot; });

    // ambient occlusion from the distance field
    let occ = 0, sca = 1;
    for (let i = 0; i < 5; i++) {
      const hr = 0.006 + 0.045 * i / 4;
      const dd = S.dist(x + n[0] * hr, y + n[1] * hr, z + n[2] * hr);
      occ += (hr - dd) * sca; sca *= 0.8;
    }
    const ao = Math.min(1, Math.max(0, 1 - 6 * occ));

    if (!(mw > 0)) { mc[0] = MAT.skin[0]; mc[1] = MAT.skin[1]; mc[2] = MAT.skin[2]; mw = 1; }
    let r = mc[0] / mw, g = mc[1] / mw, b = mc[2] / mw;
    const isSkin = Math.max(0, 1 - (Math.abs(r - MAT.skin[0]) * 4));

    // mottled, blotchy, sick skin
    const mot = fbm(x * 9, y * 9, z * 9);
    const blotch = fbm(x * 3 + 5, y * 3, z * 3 + 2);
    let tone = 0.82 + 0.3 * (mot - 0.5);
    r *= tone; g *= tone * 0.98; b *= tone * 0.96;
    // greyish-yellow/grey-green blotches
    const bl = Math.max(0, (blotch - 0.5) * 2.2) * isSkin;
    r = r * (1 - bl * 0.25); g = g * (1 - bl * 0.18); b = b * (1 - bl * 0.32);
    // matted dark fur patches (mange) over the back, shoulders, thighs, crown, chin
    let furZone = 0;
    if (n[2] < 0.1 && y > 1.15 && y < 1.8) furZone = Math.max(furZone, Math.min(1, (y - 1.15) * 3) * (0.2 - n[2]) * 0.7);
    const fur = Math.min(1, Math.max(0, furZone * 1.4 * (fbm(x * 14, y * 14, z * 14) * 1.6 - 0.45))) * isSkin;
    r = r + (0.13 - r) * fur; g = g + (0.115 - g) * fur; b = b + (0.1 - b) * fur;
    // crude stitched seam over the top of the skull
    {
      const lx = x, ly = y - 1.97, lz = z - 0.16;
      if (ly > 0.13 && lx * lx + ly * ly + lz * lz < 0.05) {
        const seam = Math.abs(lx + 0.006 * Math.sin(lz * 90));
        const stitch = seam < 0.016 && ((lz * 55) % 1 + 1) % 1 < 0.3;
        if (seam < 0.0045 || stitch) { r *= 0.3; g *= 0.24; b *= 0.24; }
      }
    }
    // ink speckle, like the drawing
    const sp = vnoise(x * 55, y * 55, z * 55);
    if (sp > 0.78 && isSkin > 0.5) { const k = Math.min(1, (sp - 0.78) * 6) * (0.4 + fur * 0.6 + (1 - ao)); r *= 1 - 0.7 * k; g *= 1 - 0.7 * k; b *= 1 - 0.7 * k; }
    // bruised, raw-looking crevices
    const cav = 1 - ao;
    r = r * (0.42 + 0.58 * ao) + cav * 0.06 * isSkin;
    g = g * (0.38 + 0.62 * ao);
    b = b * (0.42 + 0.58 * ao) + cav * 0.02 * isSkin;

    // matted fur roughens the surface a little
    const disp = fur * 0.004 * (vnoise(x * 90, y * 90, z * 90) - 0.3);
    pos[v * 3] = x + n[0] * disp; pos[v * 3 + 1] = y + n[1] * disp; pos[v * 3 + 2] = z + n[2] * disp;
    color[v * 3] = toLin(Math.min(1, r)); color[v * 3 + 1] = toLin(Math.min(1, g)); color[v * 3 + 2] = toLin(Math.min(1, b));
  }

  return { position: pos, index: idx, color, skinIndex, skinWeight, bones };
}

