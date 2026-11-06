// A jointed mannequin (about 1.8 m tall) with a procedural, physically-based walk/run.
//
// How the walk works:
//  - A gait cycle drives each foot through STANCE (planted on the ground, moving backwards
//    under the body at exactly the body's speed, so it never slides) and SWING (lifted and
//    carried forward to the next footstep).
//  - Two-bone inverse kinematics bends hip + knee so each foot lands exactly on its target,
//    including on slopes. The ankle rolls through heel strike -> flat foot -> toe push-off.
//  - The pelvis rises over the supporting leg, drops on the swinging side, rotates with the
//    stride and shifts over the planted foot. The upper body counter-rotates and the head
//    stays stable, like a real person's.
//  - Walking blends smoothly into running (longer stride, flight phase, bent elbows, lean).
//
// The model faces +Z and its feet are at y = 0.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- Look: stylised realism ----------
// Real proportions and materials, with simplified, friendly shapes and a slightly larger head.
// Each player's look (skin, hair, clothes) is picked from their shirt colour, so every
// player sees the same character for each person.
const SKIN_TONES = ['#f3cfb1', '#e7b48f', '#d09a73', '#b07850', '#8a5636', '#5e3a24'];
const HAIR_COLORS = ['#1c1410', '#3a2416', '#5e3b1f', '#8f5e30', '#c99a5b', '#2b2b2e', '#7a3018'];
const PANTS_COLORS = ['#2a2f3a', '#34435e', '#4a4038', '#202226', '#4f5844', '#5b5f66'];
const SHOE_COLORS = ['#e9e9e9', '#2a2a2a', '#a8372c', '#2f5a86', '#c9a25a'];
const HAIR_STYLES = ['short', 'swept', 'long', 'buzz'];

function lookFor(seedText) {
  let h = 2166136261;
  for (const ch of String(seedText)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const pick = (list, salt) => list[(Math.abs(Math.imul(h ^ salt, 2654435761)) >>> 0) % list.length];
  return {
    skin: pick(SKIN_TONES, 11), hair: pick(HAIR_COLORS, 23), hairStyle: pick(HAIR_STYLES, 37),
    pants: pick(PANTS_COLORS, 41), shoes: pick(SHOE_COLORS, 53),
  };
}

// Shared shapes (built once, reused by every character)
const GEO = (() => {
  // Torso: broad shoulders tapering to a narrower waist (lathe profile, then flattened front-to-back)
  const profile = [
    [0.0, -0.06], [0.135, -0.06], [0.142, 0.04], [0.15, 0.16], [0.172, 0.27],
    [0.192, 0.36], [0.195, 0.42], [0.17, 0.48], [0.11, 0.525], [0.0, 0.54],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.LatheGeometry(profile, 28);
  torso.scale(1, 1, 0.66);

  const skull = new THREE.SphereGeometry(0.128, 28, 20);
  const hairCap = new THREE.SphereGeometry(0.136, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const buzzCap = new THREE.SphereGeometry(0.131, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.47);
  // (sphere "phi" 1.5π is the back of the head)
  const longBack = new THREE.SphereGeometry(0.136, 24, 16, Math.PI * 1.1, Math.PI * 0.8, 0, Math.PI * 0.78);
  const fringe = new THREE.CapsuleGeometry(0.035, 0.12, 4, 10).rotateZ(Math.PI / 2);

  const mouth = new THREE.TorusGeometry(0.022, 0.0042, 6, 14, Math.PI).rotateZ(Math.PI);

  // Sneaker: rounded upper + flat sole (same footprint the walk's toe/heel maths expects)
  const shoeUpper = new RoundedBoxGeometry(0.104, 0.062, 0.245, 3, 0.026);
  const shoeSole = new RoundedBoxGeometry(0.11, 0.022, 0.25, 2, 0.008);

  return {
    torso, skull, hairCap, buzzCap, longBack, fringe, mouth, shoeUpper, shoeSole,
    sphere: new THREE.SphereGeometry(1, 18, 12),
    neck: new THREE.CylinderGeometry(0.052, 0.06, 0.11, 14),
    belt: new THREE.CylinderGeometry(0.148, 0.148, 0.04, 24).scale(1, 1, 0.68),
    pelvis: new THREE.CapsuleGeometry(0.13, 0.14, 4, 12).rotateZ(Math.PI / 2).scale(1, 1, 0.74),
    thigh: new THREE.CapsuleGeometry(0.078, 0.3, 4, 12),
    shin: new THREE.CapsuleGeometry(0.062, 0.32, 4, 12),
    upperArm: new THREE.CapsuleGeometry(0.056, 0.2, 4, 12),
    sleeve: new THREE.CylinderGeometry(0.066, 0.07, 0.12, 14),
    forearm: new THREE.CapsuleGeometry(0.044, 0.2, 4, 12),
    thumb: new THREE.CapsuleGeometry(0.014, 0.035, 3, 8),
    brow: new THREE.CapsuleGeometry(0.0075, 0.032, 3, 8).rotateZ(Math.PI / 2),
  };
})();

const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.25 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1a120d, roughness: 0.15 });
const mouthMat = new THREE.MeshStandardMaterial({ color: 0x5a2a24, roughness: 0.6 });
const soleMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.75 });
const beltMat = new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: 0.5 });

// Body measurements (metres)
const THIGH = 0.44;
const SHIN = 0.44;
const ANKLE_H = 0.075;       // ankle height above the ground when the foot is flat
// Bottom of the shoe relative to the ankle joint (the shoe box spans z -0.075..0.175, y -0.075)
const TOE = { y: -ANKLE_H, z: 0.175 };
const HEEL = { y: -ANKLE_H, z: -0.075 };
const HIP_W = 0.09;          // hip joints are this far left/right of centre
const STAND_HEIGHT = 0.972;  // pelvis height when standing (legs almost straight, knees ~8°)

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// Cubic Hermite curve from p0 to p1 with start/end slopes m0/m1 (t in 0..1)
function hermite(t, p0, m0, p1, m1) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
}

// Smooth curve through evenly spaced keyframes (t in 0..1). Optional start/end slopes
// are in "per whole curve" units; otherwise they're picked automatically.
function spline(t, keys, startSlope, endSlope) {
  const n = keys.length - 1;
  const f = clamp(t, 0, 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const at = (k) => keys[clamp(k, 0, n)];
  const slope = (k) => {
    if (k === 0 && startSlope !== undefined) return startSlope / n;
    if (k === n && endSlope !== undefined) return endSlope / n;
    return (at(k + 1) - at(k - 1)) / (k === 0 || k === n ? 1 : 2);
  };
  return hermite(u, at(i), slope(i), at(i + 1), slope(i + 1));
}

function part(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function joint(x, y, z, parent, order = 'XYZ') {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.order = order;
  parent.add(g);
  return g;
}

/**
 * @param shirtColor any CSS colour
 * @param groundAt   (x, z) => ground height in world space, so feet plant on slopes
 */
export function createMannequin(shirtColor, groundAt = () => 0) {
  const look = lookFor(shirtColor);
  const mats = {
    shirt: new THREE.MeshStandardMaterial({ color: new THREE.Color(shirtColor), roughness: 0.82 }),
    skin: new THREE.MeshStandardMaterial({ color: new THREE.Color(look.skin), roughness: 0.5 }),
    hair: new THREE.MeshStandardMaterial({ color: new THREE.Color(look.hair), roughness: 0.55 }),
    pants: new THREE.MeshStandardMaterial({ color: new THREE.Color(look.pants), roughness: 0.88 }),
    shoes: new THREE.MeshStandardMaterial({ color: new THREE.Color(look.shoes), roughness: 0.6 }),
  };
  mats.nose = mats.skin;
  const sphere = (r, mat, x, y, z, parent, sx = 1, sy = 1, sz = 1) => {
    const m = part(GEO.sphere, mat, x, y, z, parent);
    m.scale.set(r * sx, r * sy, r * sz);
    return m;
  };

  // ---------- Skeleton + body ----------
  const root = new THREE.Group();                              // at the feet, rotate to face
  const pelvis = joint(0, STAND_HEIGHT, 0, root, 'YXZ');       // moves with the gait
  part(GEO.pelvis, mats.pants, 0, 0.02, 0, pelvis);
  part(GEO.belt, beltMat, 0, 0.085, 0, pelvis);

  const legs = [-1, 1].map((side) => {
    const hip = joint(side * HIP_W, -0.02, 0, pelvis, 'ZXY');
    part(GEO.thigh, mats.pants, 0, -THIGH / 2, 0, hip);
    const knee = joint(0, -THIGH, 0, hip);
    part(GEO.shin, mats.pants, 0, -SHIN / 2, 0, knee);
    const ankle = joint(0, -SHIN, 0, knee);
    // Sneaker: bottom at y -0.075, toe at z 0.175, heel at z -0.075 (matches TOE / HEEL)
    part(GEO.shoeUpper, mats.shoes, 0, -0.033, 0.052, ankle);
    part(GEO.shoeSole, soleMat, 0, -0.064, 0.05, ankle);
    return { side, hip, knee, ankle, phaseOffset: side < 0 ? 0 : 0.5, wasStance: true };
  });

  const spine = joint(0, 0.08, 0, pelvis, 'YXZ');
  part(GEO.torso, mats.shirt, 0, 0, 0, spine);

  // ---------- Head + face ----------
  const neck = joint(0, 0.52, 0, spine, 'YXZ');
  part(GEO.neck, mats.skin, 0, 0.0, 0, neck);
  const head = joint(0, 0.155, 0.012, neck);
  const skull = part(GEO.skull, mats.skin, 0, 0, 0, head);
  skull.scale.set(0.92, 1.04, 0.98);
  // Eyes (slightly large and friendly), with pupils looking ahead
  for (const s of [-1, 1]) {
    sphere(0.024, eyeWhiteMat, s * 0.043, 0.012, 0.107, head, 1, 1.1, 0.72);
    sphere(0.0125, pupilMat, s * 0.043, 0.011, 0.122, head, 1, 1.1, 0.6);
    const brow = part(GEO.brow, mats.hair, s * 0.044, 0.05, 0.112, head);
    brow.rotation.z = s * -0.12;
    sphere(0.03, mats.skin, s * 0.117, 0.0, -0.005, head, 0.45, 1, 0.8);   // ears
  }
  sphere(0.019, mats.nose, 0, -0.016, 0.124, head, 0.95, 1.15, 1);         // nose
  part(GEO.mouth, mouthMat, 0, -0.052, 0.116, head);                      // small smile

  // Hair
  if (look.hairStyle === 'buzz') {
    part(GEO.buzzCap, mats.hair, 0, 0.012, -0.004, head).rotation.x = -0.18;
  } else {
    const cap = part(GEO.hairCap, mats.hair, 0, 0.008, -0.006, head);
    cap.rotation.x = -0.22;
    cap.scale.set(0.96, 1.02, 1.02);
    if (look.hairStyle === 'swept' || look.hairStyle === 'short') {
      const f = part(GEO.fringe, mats.hair, look.hairStyle === 'swept' ? 0.02 : 0, 0.088, 0.085, head);
      f.rotation.set(-0.35, 0, look.hairStyle === 'swept' ? 0.25 : 0);
    }
    if (look.hairStyle === 'long') {
      const back = part(GEO.longBack, mats.hair, 0, -0.02, -0.004, head);
      back.scale.set(0.98, 1.25, 1.02);
    }
  }

  // ---------- Arms ----------
  const arms = [-1, 1].map((side) => {
    const shoulder = joint(side * 0.235, 0.4, 0, spine, 'ZXY');
    sphere(0.07, mats.shirt, 0, -0.01, 0, shoulder);                      // rounded shoulder
    part(GEO.upperArm, mats.skin, 0, -0.14, 0, shoulder);
    part(GEO.sleeve, mats.shirt, 0, -0.07, 0, shoulder);                  // T-shirt sleeve
    const elbow = joint(0, -0.29, 0, shoulder);
    part(GEO.forearm, mats.skin, 0, -0.13, 0, elbow);
    // Mitten-style hand with a thumb
    sphere(0.046, mats.skin, 0, -0.29, 0.004, elbow, 0.72, 1.12, 0.92);
    const thumb = part(GEO.thumb, mats.skin, -side * 0.026, -0.27, 0.022, elbow);
    thumb.rotation.set(0.3, 0, side * 0.5);
    return { side, shoulder, elbow };
  });

  // ---------- Animation state ----------
  let phase = 0;          // gait cycle 0..1 (left heel strike at 0, right at 0.5)
  let speed = 0;          // smoothed ground speed
  let moveW = 0;          // 0 = standing, 1 = walking/running
  let runW = 0;           // 0 = walk, 1 = run
  let lean = 0;           // forward/back lean from acceleration
  let bank = 0;           // sideways lean into turns
  let time = Math.random() * 100;
  let pelvisHeight = STAND_HEIGHT;
  let onFootstep = null;

  const local = new THREE.Vector3();
  const invPelvis = new THREE.Matrix4();

  /**
   * @param dt        seconds since last frame
   * @param v         current ground speed (m/s)
   * @param turnRate  how fast the character is turning (rad/s), for leaning into turns
   * @param accel     change in speed (m/s²), for leaning when speeding up / slowing down
   */
  function animate(dt, v, turnRate = 0, accel = 0) {
    time += dt;
    speed = damp(speed, v, 10, dt);
    moveW = damp(moveW, smoothstep(0.05, 0.6, speed), 6, dt);
    runW = damp(runW, smoothstep(2.1, 3.1, speed), 4, dt);
    lean = damp(lean, clamp(accel * 0.025, -0.12, 0.15), 5, dt);
    bank = damp(bank, clamp(-turnRate * speed * 0.03, -0.25, 0.25), 6, dt);

    // Cadence (stride cycles per second) rises with speed, like real people:
    // ~2.2 steps/s at a 1.6 m/s walk, ~2.8 steps/s at a 5.5 m/s run.
    const freq = lerp(0.88 + 0.18 * speed, 1.2 + 0.04 * speed, runW);
    phase = (phase + dt * freq) % 1;

    // Each cycle the body travels `stride` metres; the planted foot covers duty*stride of it.
    // Walkers keep each foot down ~60% of the time. Runners spend far less time on the
    // ground (about 0.18 s per step at 5.5 m/s) and fly between steps.
    const runDuty = clamp(0.415 - 0.03 * speed, 0.22, 0.38);
    const duty = lerp(0.6, runDuty, runW);
    const stride = speed / freq;
    const stanceLen = stride * duty;
    const swingTime = (1 - duty) / freq;
    // Walkers land well ahead of the hip; runners land closer underneath (less braking)
    const front = lerp(0.42, 0.22, runW);
    const lift = 0.07 * clamp(stride / 1.4, 0.3, 1);
    const runHeight = clamp((speed - 2.2) / 3.3, 0.45, 1.15);  // faster = higher heel kick + knee drive
    const stepWidth = lerp(0.075, 0.035, runW);                  // runners' feet land close to the midline
    const amp = moveW * clamp(speed / 1.3, 0, 1);               // gait intensity
    const midStance = duty / 2;

    // Idle: slow weight shifting and breathing
    const idle = 1 - moveW;
    const breathe = Math.sin(time * 1.6);
    const shift = Math.sin(time * 0.35) * 0.012 * idle;

    const ry = root.rotation.y;
    const cos = Math.cos(ry), sin = Math.sin(ry);
    const groundLocal = (x, z) =>
      groundAt(root.position.x + x * cos + z * sin, root.position.z - x * sin + z * cos) - root.position.y;

    // ---------- Where each foot should be (character space) ----------
    for (const leg of legs) {
      const p = (phase + leg.phaseOffset) % 1;
      let z, y = 0, footPitch;
      const stance = p < duty;

      const z0 = -(1 - front) * stanceLen;               // where the foot leaves the ground
      const z1 = front * stanceLen;                      // where it lands
      const groundTangent = -speed * swingTime;          // moving at ground speed (no scuffing)

      if (stance) {
        const t = p / duty;
        // Planted: moves back under the body at exactly body speed (no sliding)
        z = stanceLen * (front - t);
        // Walk: heel strike -> flat -> long heel rise and toe push-off
        let walkPitch;
        if (t < 0.18) walkPitch = lerp(-0.24, 0, smoothstep(0, 1, t / 0.18)); // soft heel roll
        else if (t < 0.62) walkPitch = 0;
        else walkPitch = lerp(0, 0.8, (t - 0.62) / 0.38);
        // Run: midfoot landing, short flat phase, then a powerful early push off the toes
        let runPitch;
        if (t < 0.12) runPitch = lerp(-0.07, 0, t / 0.12);
        else if (t < 0.4) runPitch = 0;
        else runPitch = 1.0 * smoothstep(0.4, 1, t);
        footPitch = lerp(walkPitch, runPitch, runW);
      } else {
        const t = (p - duty) / (1 - duty);

        // Walk swing: low, smooth arc forward (Hermite curve that leaves and lands at ground speed)
        const wz = hermite(t, z0, groundTangent, z1, groundTangent);
        const wy = lift * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 1.3);
        const wPitch = t < 0.45 ? lerp(0.8, 0.05, t / 0.45) : lerp(0.05, -0.24, (t - 0.45) / 0.55);

        // Run swing, keyframed from running biomechanics:
        //   toe-off -> heel kicks up behind (knee folds tight) -> knee drives forward
        //   -> lower leg reaches out -> foot paws back down to land under the body
        const h = runHeight;
        const rz = spline(t, [z0, z0 * 0.8, -0.2, 0.18, z1 + 0.14, z1], groundTangent, groundTangent);
        const rY = Math.max(0, spline(t, [0, 0.21 * h, 0.35 * h, 0.32 * h, 0.14 * h, 0]));
        const rPitch = spline(t, [1.0, 1.1, 0.65, 0.05, -0.18, -0.07]);

        z = lerp(wz, rz, runW);
        y = lerp(wy, rY, runW);
        footPitch = lerp(wPitch, rPitch, runW);
      }

      // Footstep event (heel strike)
      if (stance && !leg.wasStance && onFootstep && moveW > 0.5) onFootstep(leg.side, speed);
      leg.wasStance = stance;

      // Blend between standing pose and gait
      const restZ = leg.side < 0 ? 0.035 : -0.025;
      // Legs that are planted, or about to land, decide how low the hips must be
      // (A runner's trailing leg is peeling off the ground at the end of stance — it
      // doesn't hold the hips down, so it's left out.)
      leg.stance = (stance && !(runW > 0.3 && p / duty > 0.6)) || moveW < 0.5
        || (runW <= 0.3 && (p - duty) / (1 - duty) > 0.75);
      z = lerp(restZ, z, moveW);
      y *= moveW;
      leg.footPitch = footPitch * moveW;
      const x = leg.side * stepWidth;

      // The foot rolls over its contact point: around the heel when the toes are up (heel
      // strike), around the toe tip when the heel is up (push-off). Work out where the ankle
      // must be so that point stays exactly where it touches the ground.
      const a = leg.footPitch;
      const pv = a >= 0 ? TOE : HEEL;                  // contact point, relative to the ankle
      const pyRot = pv.y * Math.cos(a) - pv.z * Math.sin(a);
      const pzRot = pv.y * Math.sin(a) + pv.z * Math.cos(a);
      const ax = x;
      const az = z + pv.z - pzRot;
      // Match the ground's slope under the foot so it sits flat on hills
      const g = groundLocal(ax, az);
      leg.slope = Math.atan2(groundLocal(ax, az + 0.1) - groundLocal(ax, az - 0.1), 0.2);
      leg.target = leg.target || new THREE.Vector3();
      // On slopes the tilted foot's low end would dip into the hill; lift it clear
      const slopeLift = Math.abs(Math.sin(leg.slope)) * (leg.slope > 0 ? 0.09 : 0.18);
      leg.target.set(ax, g + ANKLE_H + pv.y - pyRot + y + slopeLift, az);
    }

    // ---------- Pelvis ----------
    // Height: as high as standing allows, but never higher than the planted legs can reach.
    // This is what makes a real walk dip at each step (the legs work like a compass).
    // Runners sink as the stance knee absorbs the landing (lowest at mid-stance) and are
    // highest in mid-flight
    const runCrouch = runW * 0.026 * moveW;
    const runBob = -0.036 * runW * amp * Math.cos(TAU * 2 * (phase - midStance));
    // Walkers are highest over the planted leg and lowest when both feet are down
    const walkDip = -0.032 * amp * (1 - runW) * (0.5 - 0.5 * Math.cos(TAU * 2 * (phase - midStance)));
    let pelvisY = STAND_HEIGHT - runCrouch + runBob + walkDip;
    const reach = THIGH + SHIN - 0.012;
    for (const leg of legs) {
      if (!leg.stance) continue;
      const dx = leg.target.x - leg.side * HIP_W, dz = leg.target.z;
      const maxY = leg.target.y + Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz)) + 0.02;
      pelvisY = Math.min(pelvisY, maxY);
    }
    // Drop quickly when needed (the knee gives a little to cushion each step),
    // rise smoothly (muscles push the body up)
    pelvisHeight = pelvisY < pelvisHeight ? damp(pelvisHeight, pelvisY, 45, dt) : damp(pelvisHeight, pelvisY, 12, dt);

    const sway = lerp(0.028, 0.01, runW) * moveW * -Math.cos(TAU * (phase - midStance));  // over the planted foot
    // Hips turn with the stride — more when running, peaking as each leg drives forward
    const yaw = lerp(0.07, 0.13, runW) * amp * Math.cos(TAU * (phase - runW * 0.1));
    const drop = lerp(0.06, 0.07, runW) * moveW * -Math.cos(TAU * (phase - midStance));    // swing side hip drops
    const pitch = lerp(0.03, 0.09, runW) * moveW + lean;                                   // pelvis tilts forward

    pelvis.position.set(sway + shift, pelvisHeight, 0);
    pelvis.rotation.set(pitch, yaw, drop + bank + shift * 1.5);

    // Upper body: runners lean forward from the ankles (~8° total) and the shoulders
    // counter-rotate hard against the hips; the head stays steady and looks ahead
    spine.rotation.set(runW * 0.05 * moveW + breathe * 0.012 * idle, -yaw * lerp(1.8, 2.1, runW), -drop * 0.75 - bank * 0.3);
    neck.rotation.set(-(pitch + spine.rotation.x) * 0.75, -(yaw + spine.rotation.y) * 0.9, -(pelvis.rotation.z + spine.rotation.z) * 0.85);

    pelvis.updateMatrix();
    invPelvis.copy(pelvis.matrix).invert();

    // ---------- Legs: inverse kinematics ----------
    for (const leg of legs) {
      const footPitch = leg.footPitch;
      // Into pelvis space, relative to the hip joint
      local.copy(leg.target).applyMatrix4(invPelvis).sub(leg.hip.position);

      // Two-bone IK: sideways first, then hip + knee in the leg's plane
      leg.hip.rotation.z = Math.atan2(local.x, -local.y);
      const down = Math.hypot(local.x, local.y);
      const dist = clamp(Math.hypot(down, local.z), 0.25, THIGH + SHIN - 0.002);
      const knee = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - dist * dist) / (2 * THIGH * SHIN), -1, 1));
      const alpha = Math.acos(clamp((THIGH * THIGH + dist * dist - SHIN * SHIN) / (2 * THIGH * dist), -1, 1));
      leg.hip.rotation.x = -(Math.atan2(local.z, down) + alpha);
      leg.knee.rotation.x = knee;
      // Keep the foot at the right angle to the ground regardless of leg pose
      leg.ankle.rotation.x = footPitch - leg.slope * (1 - Math.min(1, Math.abs(footPitch) * 3))
        - (leg.hip.rotation.x + leg.knee.rotation.x + pelvis.rotation.x);
    }

    // ---------- Arms ----------
    for (const arm of arms) {
      // Opposite to the same-side leg, a touch behind it
      const c = Math.cos(TAU * (phase - 0.04) + (arm.side < 0 ? 0 : Math.PI));
      const forwardness = Math.max(0, -c);              // 0..1, 1 = arm fully forward

      // Walk: relaxed pendulum swing, more forward than back, elbow bends coming forward
      const walkSwing = 0.32 * c * (c < 0 ? 1.15 : 0.7);
      const walkElbow = 0.3 + forwardness * 0.32 * 0.6;

      // Run: elbows held near 90°, arms drive from the shoulder — hand comes up to chest
      // height in front and back past the hip behind; the elbow closes slightly as it
      // comes forward and opens on the back swing
      const runSwing = (c < 0 ? 0.8 : 0.6) * c * clamp(speed / 5, 0.6, 1.1);
      const runElbow = 1.5 + forwardness * 0.25 - Math.max(0, c) * 0.25;

      const s = lerp(walkSwing, runSwing, runW) * amp;  // negative = forward
      arm.shoulder.rotation.x = s + breathe * 0.015 * idle;
      // Runners carry their arms slightly out, and the hands cross toward the midline in front
      arm.shoulder.rotation.z = arm.side * (0.07 + runW * moveW * (0.1 - 0.08 * forwardness));
      arm.shoulder.rotation.y = -arm.side * runW * moveW * 0.35;
      arm.elbow.rotation.x = -lerp(0.18, lerp(walkElbow, runElbow, runW), moveW);
    }
  }

  function dispose() {
    for (const m of new Set(Object.values(mats))) m.dispose();
  }

  return {
    root,
    chest: spine,                              // the camera follows this
    animate,
    dispose,
    get runAmount() { return runW; },
    set onFootstep(fn) { onFootstep = fn; },
  };
}
