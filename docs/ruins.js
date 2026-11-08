// Generates the broken-down buildings. Everything is made of small boxes ("bricks") merged
// into one mesh, so walls can have jagged tops, collapsed sections and missing bricks while
// still drawing in a single call. The seeded generator means all players get the same ruins.
import * as THREE from 'three';

// Materials: each brick gets a base colour with some random variation
const STONE = [0x4f524a, 0x43473f, 0x585b50];
const BRICK = [0x4a3d30, 0x3e362c, 0x524535];
const PLASTER = [0x565645, 0x4a4b3c, 0x404236];
const WOOD = [0x2c2a1c, 0x242317, 0x332f20];
const MOSS = [0x2f4a24, 0x38552a, 0x233a1f];   // patches growing over everything
const GRIME = 0x161a14;

const UNIT = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const UP = new THREE.Vector3(0, 1, 0);

class BoxBatch {
  constructor() { this.pos = []; this.nor = []; this.col = []; }

  add(x, y, z, sx, sy, sz, q, hex) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    const n = new THREE.Vector3(), c = new THREE.Color(hex), v = new THREE.Vector3();
    const P = UNIT.attributes.position, N = UNIT.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      n.fromBufferAttribute(N, i).applyQuaternion(q);
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(c.r, c.g, c.b);
    }
  }

  toMesh() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
}

/**
 * @param layout { buildings, church, altar, graveyard }
 * @param rng seeded random function
 * @param addSolid (x, z, radius) => makes a spot solid
 * @param heightAt (x, z) => ground height
 */
export function buildRuins(layout, rng, addSolid, heightAt) {
  const batch = new BoxBatch();
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const rand = (a, b) => a + (b - a) * rng();
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const shade = (palette) => {
    const c = new THREE.Color(pick(palette)).multiplyScalar(rand(0.8, 1.15));
    if (rng() < 0.42) c.lerp(new THREE.Color(pick(MOSS)), rand(0.5, 0.95));   // overgrown with moss
    else if (rng() < 0.12) c.lerp(new THREE.Color(GRIME), 0.6);               // damp grime
    return c.getHex();
  };
  const euler = (x, y, z) => q.setFromEuler(e.set(x, y, z));

  // Building-local coordinates -> world. Local -Z is the front of the building.
  const toWorld = (b, lx, lz) => ({
    x: b.x + lx * Math.cos(b.ry) + lz * Math.sin(b.ry),
    z: b.z - lx * Math.sin(b.ry) + lz * Math.cos(b.ry),
  });

  /** A wall from local (x0,z0) to (x1,z1), built brick by brick. Returns its height along its length. */
  function wall(b, x0, z0, x1, z1, opt) {
    const { h, palette, damage = 0.7, door = null, windows = false, cw = 0.6, rh = 0.4, thick = 0.32 } = opt;
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(L / cw));
    const step = L / n;
    const yaw = b.ry + Math.atan2(-(z1 - z0), x1 - x0);
    // Collapsed sections: one to three "breaches" where the wall has fallen away
    const breaches = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => ({ c: rng() * L, w: L * rand(0.1, 0.3), depth: damage * rand(0.7, 1.1) }));
    const heights = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * step;
      const lx = x0 + (x1 - x0) * (t / L), lz = z0 + (z1 - z0) * (t / L);
      let loss = 0.2 * damage * rng();
      for (const br of breaches) loss = Math.max(loss, br.depth * Math.exp(-(((t - br.c) / br.w) ** 2)));
      const rows = Math.floor((h * Math.max(0, 1 - loss)) / rh + rng() * 0.6);
      heights.push(rows * rh);
      const p = toWorld(b, lx, lz);
      let solid = false;
      for (let r = 0; r < rows; r++) {
        const y = (r + 0.5) * rh;
        if (door && Math.abs(t - door.at) < door.width / 2 && y < 2.4) continue;   // doorway
        if (windows && i % 6 >= 2 && i % 6 <= 3 && y > 1.1 && y < 2.3) continue;   // window hole
        if (r > 0 && rng() < 0.05) continue;                                       // missing brick
        if (y < 2) solid = true;
        const loose = 0.012 * (1 + r);                                             // upper rows sit less straight
        euler(rand(-loose, loose), yaw + rand(-loose, loose), rand(-loose, loose));
        const foot = r === 0 ? 0.5 : 0;                                            // bottom row reaches below ground
        // Odd rows shift half a brick, like real masonry
        const bond = (r % 2 ? 0.25 : -0.25) * step;
        batch.add(p.x + Math.cos(yaw) * bond + rand(-loose, loose), b.y + y - foot / 2, p.z - Math.sin(yaw) * bond + rand(-loose, loose),
          step * 0.985, rh * 0.97 + foot, thick, q, shade(palette));
      }
      if (solid) addSolid(p.x, p.z, 0.24);
    }
    return (t) => heights[Math.min(n - 1, Math.max(0, Math.floor(t / step)))];
  }

  /** A beam between two world points. */
  function beam(a, b, size, hex) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    q.setFromUnitVectors(UP, dir.normalize());
    batch.add((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, size, len, size, q, hex);
  }

  /** Loose debris scattered over an area (no collision, you walk over it). */
  function rubble(b, count, w, d, palette) {
    for (let i = 0; i < count; i++) {
      const p = toWorld(b, rand(-w / 2, w / 2), rand(-d / 2, d / 2));
      const s = rand(0.12, 0.42);
      euler(rand(0, 3), rand(0, 3), rand(0, 3));
      batch.add(p.x, b.y + s * 0.2, p.z, s * rand(1, 2), s * 0.6, s, q, shade(palette));
    }
  }

  /** Roof timbers: rafters that survive where the wall below does, fallen ones where it doesn't. */
  function rafters(b, w, d, h, front, back) {
    const vec = (lx, y, lz) => { const p = toWorld(b, lx, lz); return new THREE.Vector3(p.x, b.y + y, p.z); };
    for (let lx = -w / 2 + 0.6; lx < w / 2; lx += rand(1, 1.8)) {
      const t = lx + w / 2;
      for (const [wallH, lz] of [[front(t), -d / 2], [back(t), d / 2]]) {
        if (wallH >= h * 0.7 && rng() < 0.65) {
          beam(vec(lx, wallH, lz), vec(lx, h + d * 0.28, lz * rand(0, 0.2)), 0.13, pick(WOOD));   // still standing
        } else if (rng() < 0.45) {
          beam(vec(lx, Math.max(wallH, 0.3), lz), vec(lx + rand(-0.6, 0.6), 0.08, lz * rand(0, 0.3)), 0.13, pick(WOOD)); // fallen in
        }
      }
    }
  }

  function chimney(b, lx, lz, h) {
    const p = toWorld(b, lx, lz);
    for (let y = 0; y < h; y += 0.45) {
      euler(0, b.ry + rand(-0.03, 0.03), 0);
      batch.add(p.x, b.y + y + 0.22, p.z, 0.8, 0.43, 0.8, q, shade(BRICK));
    }
    addSolid(p.x, p.z, 0.5);
  }

  /** Any four-walled ruin. The doorway is in the front wall, facing the church. */
  function shell(b, opt) {
    const { w, d, h } = b;
    const wallOpt = { h, damage: b.damage, ...opt };
    const front = wall(b, -w / 2, -d / 2, w / 2, -d / 2, { ...wallOpt, door: { at: w / 2 + rand(-w * 0.2, w * 0.2), width: opt.doorWidth || 2 } });
    const back = wall(b, -w / 2, d / 2, w / 2, d / 2, wallOpt);
    wall(b, -w / 2, -d / 2, -w / 2, d / 2, wallOpt);
    wall(b, w / 2, -d / 2, w / 2, d / 2, wallOpt);
    return { front, back };
  }

  // ---------- Village ----------
  for (const b of layout.buildings) {
    if (b.type === 'house') {
      const palette = rng() < 0.5 ? PLASTER : BRICK;
      const { front, back } = shell(b, { palette, windows: true });
      rafters(b, b.w, b.d, b.h, front, back);
      rubble(b, 22, b.w, b.d, palette);
      if (rng() < 0.5) chimney(b, (b.w / 2 - 0.7) * (rng() < 0.5 ? 1 : -1), b.d / 2 - 0.7, b.h + rand(0, 2));
    } else if (b.type === 'barn') {
      const { front, back } = shell(b, { palette: WOOD, cw: 0.9, rh: 0.8, thick: 0.2, doorWidth: 3.2 });
      rafters(b, b.w, b.d, b.h, front, back);
      rubble(b, 16, b.w, b.d, WOOD);
    } else { // shop: a big broken shopfront
      const { front, back } = shell(b, { palette: BRICK, windows: true });
      rafters(b, b.w, b.d, b.h, front, back);
      rubble(b, 26, b.w, b.d, PLASTER);
      const counter = toWorld(b, 0, b.d * 0.15);
      euler(0, b.ry + 0.1, rand(-0.05, 0.05));
      batch.add(counter.x, b.y + 0.5, counter.z, b.w * 0.45, 1, 0.6, q, shade(WOOD));
      addSolid(counter.x, counter.z, 0.5);
    }
  }

  // ---------- Church ----------
  const c = layout.church;
  const stoneWall = { palette: STONE, h: c.h, damage: 0.6, windows: true, thick: 0.55, rh: 0.45, cw: 0.7 };
  const front = wall(c, -c.w / 2, -c.d / 2, c.w / 2, -c.d / 2, { ...stoneWall, windows: false, damage: 0.35, door: { at: c.w / 2, width: 2.8 } });
  const back = wall(c, -c.w / 2, c.d / 2, c.w / 2, c.d / 2, { ...stoneWall, windows: false });
  wall(c, -c.w / 2, -c.d / 2, -c.w / 2, c.d / 2, stoneWall);
  wall(c, c.w / 2, -c.d / 2, c.w / 2, c.d / 2, stoneWall);
  rafters(c, c.w, c.d, c.h, front, back);
  rubble(c, 70, c.w, c.d, STONE);
  // Broken pillars down the nave
  for (const sx of [-1, 1]) for (let lz = -c.d / 2 + 3.5; lz < c.d / 2 - 2; lz += 4) {
    const p = toWorld(c, sx * c.w * 0.27, lz);
    const top = rand(1.2, 6.5);
    for (let y = 0; y < top; y += 0.5) {
      euler(0, y * 0.9, 0);
      batch.add(p.x + rand(-0.02, 0.02), c.y + y + 0.25, p.z + rand(-0.02, 0.02), 0.7, 0.48, 0.7, q, shade(STONE));
    }
    addSolid(p.x, p.z, 0.5);
  }
  // Collapsed bell tower beside the front door
  const tower = { ...c, x: c.x - c.w / 2 - 2, z: c.z - c.d / 2 + 0.5, w: 4, d: 4, h: 14, damage: 0.55 };
  shell(tower, { palette: STONE, windows: true, thick: 0.5, rh: 0.45, cw: 0.7, doorWidth: 1.8 });
  // The altar
  const a = layout.altar;
  euler(0, 0, 0);
  batch.add(a.x, c.y + 0.5, a.z, 2.2, 1, 1.1, q, 0x2b2422);
  batch.add(a.x, c.y + 1.03, a.z, 2.5, 0.1, 1.35, q, 0x1a1513);
  addSolid(a.x - 0.7, a.z, 0.6); addSolid(a.x + 0.7, a.z, 0.6);

  // ---------- Graveyard ----------
  const g = layout.graveyard;
  for (let row = -3; row <= 3; row++) for (let col = -3; col <= 3; col++) {
    if (rng() < 0.2) continue;
    const x = g.x + col * 3.6 + rand(-0.5, 0.5), z = g.z + row * 3.6 + rand(-0.5, 0.5);
    if (Math.hypot(x - g.x, z - g.z) > g.r - 1) continue;
    if (Math.abs(x - g.x) < 3.5 && Math.abs(z - g.z) < 3.5) continue;   // room for the crypt
    const y = heightAt(x, z);
    euler(rand(-0.25, 0.25), rand(-0.4, 0.4), rand(-0.2, 0.2));
    const tall = rand(0.6, 1.1);
    batch.add(x, y + tall / 2 - 0.05, z, rand(0.45, 0.7), tall, 0.14, q, shade(STONE));
    addSolid(x, z, 0.28);
    if (rng() < 0.3) { // an open grave
      euler(0, 0, 0);
      batch.add(x, y + 0.02, z - 1.2, 0.85, 0.04, 1.8, q, 0x070504);
    } else { // a dirt mound
      euler(0, rand(-0.1, 0.1), 0);
      batch.add(x, y + 0.08, z - 1.2, 0.8, 0.22, 1.7, q, 0x1f2c17);
    }
  }
  const crypt = { x: g.x, z: g.z, y: heightAt(g.x, g.z), ry: g.cryptRy, w: 5, d: 6, h: 3.4, damage: 0.35 };
  shell(crypt, { palette: STONE, thick: 0.45, rh: 0.45, doorWidth: 1.8 });
  rubble(crypt, 14, crypt.w, crypt.d, STONE);

  return batch.toMesh();
}
