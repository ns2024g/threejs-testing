// An invisible skeleton that produces a physically-based walk / jog. A visible character
// model (see character.js) copies its pose every frame.
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
//  - Walking blends smoothly into running (flight phase, heel kick, bent elbows, lean).
//
// Proportions come from `dims`. Gait scales with leg length the way real legs do
// ("dynamic similarity"): shorter legs take shorter, quicker steps at the same speed.
//
// The rig faces +Z and its feet are at y = 0.
import * as THREE from 'three';

/** Adult human proportions (metres). The gait was tuned against real data with these. */
export const HUMAN_DIMS = {
  thigh: 0.44, shin: 0.44,          // hip -> knee, knee -> ankle
  ankleH: 0.075,                    // ankle height above the ground, foot flat
  toeZ: 0.175, heelZ: -0.075,       // toe tip / heel, relative to the ankle (along the foot)
  hipW: 0.09, hipY: -0.02,          // hip joints, relative to the pelvis
  standHeight: 0.972,               // pelvis height when standing
  spineY: 0.08, neckY: 0.52,        // spine above pelvis, neck above spine
  shoulderX: 0.235, shoulderY: 0.4, // shoulders, relative to the spine
  upperArm: 0.29, forearm: 0.29,
  armOut: 0.07,                     // how far the arms hang away from the body (radians)
};
const HUMAN_LEG = HUMAN_DIMS.thigh + HUMAN_DIMS.shin;

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

function joint(x, y, z, parent, order = 'XYZ') {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.order = order;
  parent.add(g);
  return g;
}

/**
 * @param dims     body proportions (see HUMAN_DIMS)
 * @param groundAt (x, z) => ground height in world space, so feet plant on slopes
 */
export function createRig(dims = HUMAN_DIMS, groundAt = () => 0) {
  const D = { ...HUMAN_DIMS, ...dims };
  const THIGH = D.thigh, SHIN = D.shin, ANKLE_H = D.ankleH, HIP_W = D.hipW, STAND_HEIGHT = D.standHeight;
  const TOE = { y: -ANKLE_H, z: D.toeZ };
  const HEEL = { y: -ANKLE_H, z: D.heelZ };
  const k = (THIGH + SHIN) / HUMAN_LEG;   // leg length relative to an adult human
  const sk = Math.sqrt(k);

  // ---------- Skeleton ----------
  const root = new THREE.Group();                                   // at the feet, rotate to face
  const pelvis = joint(0, STAND_HEIGHT, 0, root, 'YXZ');            // moves with the gait
  const legs = [-1, 1].map((side) => {
    const hip = joint(side * HIP_W, D.hipY, 0, pelvis, 'ZXY');
    const knee = joint(0, -THIGH, 0, hip);
    const ankle = joint(0, -SHIN, 0, knee);
    return { side, hip, knee, ankle, phaseOffset: side < 0 ? 0 : 0.5, wasStance: true };
  });
  const spine = joint(0, D.spineY, 0, pelvis, 'YXZ');
  const neck = joint(0, D.neckY, 0, spine, 'YXZ');
  const arms = [-1, 1].map((side) => {
    const shoulder = joint(side * D.shoulderX, D.shoulderY, 0, spine, 'ZXY');
    const elbow = joint(0, -D.upperArm, 0, shoulder);
    const wrist = joint(0, -D.forearm, 0, elbow);
    return { side, shoulder, elbow, wrist };
  });

  // ---------- Animation state ----------
  let phase = 0;          // gait cycle 0..1
  let speed = 0;          // smoothed ground speed (m/s)
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
    // Speed as it would feel to an adult human with this character's gait
    const vh = speed / sk;
    moveW = damp(moveW, smoothstep(0.05, 0.6, vh), 6, dt);
    runW = damp(runW, smoothstep(2.1, 3.1, vh), 4, dt);
    lean = damp(lean, clamp(accel * 0.025, -0.12, 0.15), 5, dt);
    bank = damp(bank, clamp(-turnRate * vh * 0.03, -0.25, 0.25), 6, dt);

    // Cadence (stride cycles per second) rises with speed, like real people:
    // ~2.2 steps/s at a 1.6 m/s adult walk, ~2.8 steps/s at a run. Shorter legs step faster.
    const freq = lerp(0.88 + 0.18 * vh, 1.2 + 0.04 * vh, runW) / sk;
    phase = (phase + dt * freq) % 1;

    // Each cycle the body travels `stride` metres; the planted foot covers duty*stride of it.
    // Walkers keep each foot down ~60% of the time; runners much less, flying between steps.
    const runDuty = clamp(0.415 - 0.03 * vh, 0.22, 0.38);
    const duty = lerp(0.6, runDuty, runW);
    const stride = speed / freq;
    const stanceLen = stride * duty;
    const swingTime = (1 - duty) / freq;
    const front = lerp(0.42, 0.22, runW);                     // where the foot lands, ahead of the hip
    const lift = 0.07 * k * clamp(stride / (1.4 * k), 0.3, 1);
    const runHeight = clamp((vh - 2.2) / 3.3, 0.45, 1.15);   // faster = higher heel kick + knee drive
    const stepWidth = lerp(0.075, 0.035, runW) * k;           // runners' feet land near the midline
    const amp = moveW * clamp(vh / 1.3, 0, 1);               // gait intensity
    const midStance = duty / 2;

    // Idle: slow weight shifting and breathing
    const idle = 1 - moveW;
    const breathe = Math.sin(time * 1.6);
    const shift = Math.sin(time * 0.35) * 0.012 * k * idle;

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
        z = stanceLen * (front - t);                     // planted: moves back at body speed
        let walkPitch;                                   // heel strike -> flat -> heel rise, toe push-off
        if (t < 0.18) walkPitch = lerp(-0.24, 0, smoothstep(0, 1, t / 0.18));
        else if (t < 0.62) walkPitch = 0;
        else walkPitch = lerp(0, 0.8, (t - 0.62) / 0.38);
        let runPitch;                                    // midfoot landing, early strong push-off
        if (t < 0.12) runPitch = lerp(-0.07, 0, t / 0.12);
        else if (t < 0.4) runPitch = 0;
        else runPitch = 1.0 * smoothstep(0.4, 1, t);
        footPitch = lerp(walkPitch, runPitch, runW);
      } else {
        const t = (p - duty) / (1 - duty);
        // Walk swing: low smooth arc that leaves and lands at ground speed
        const wz = hermite(t, z0, groundTangent, z1, groundTangent);
        const wy = lift * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 1.3);
        const wPitch = t < 0.45 ? lerp(0.8, 0.05, t / 0.45) : lerp(0.05, -0.24, (t - 0.45) / 0.55);
        // Run swing (from running biomechanics): heel kicks up behind, knee drives forward,
        // lower leg reaches out, foot paws back down to land under the body
        const h = runHeight * k;
        const rz = spline(t, [z0, z0 * 0.8, -0.2 * k, 0.18 * k, z1 + 0.14 * k, z1], groundTangent, groundTangent);
        const rY = Math.max(0, spline(t, [0, 0.21 * h, 0.35 * h, 0.32 * h, 0.14 * h, 0]));
        const rPitch = spline(t, [1.0, 1.1, 0.65, 0.05, -0.18, -0.07]);
        z = lerp(wz, rz, runW);
        y = lerp(wy, rY, runW);
        footPitch = lerp(wPitch, rPitch, runW);
      }

      // Footstep event (heel strike)
      if (stance && !leg.wasStance && onFootstep && moveW > 0.5) onFootstep(leg.side, speed);
      leg.wasStance = stance;

      // Legs that are planted (or, when walking, about to land) decide how low the hips must
      // be. A runner's trailing leg is peeling off the ground, so it doesn't hold them down.
      leg.stance = (stance && !(runW > 0.3 && p / duty > 0.6)) || moveW < 0.5
        || (runW <= 0.3 && (p - duty) / (1 - duty) > 0.75);

      // Blend between standing pose and gait
      const restZ = (leg.side < 0 ? 0.035 : -0.025) * k;
      z = lerp(restZ, z, moveW);
      y *= moveW;
      leg.footPitch = footPitch * moveW;
      const x = leg.side * stepWidth;

      // The foot rolls over its contact point (heel at strike, toe tip at push-off): place the
      // ankle so that point stays exactly where it touches the ground
      const a = leg.footPitch;
      const pv = a >= 0 ? TOE : HEEL;
      const pyRot = pv.y * Math.cos(a) - pv.z * Math.sin(a);
      const pzRot = pv.y * Math.sin(a) + pv.z * Math.cos(a);
      const ax = x;
      const az = z + pv.z - pzRot;
      // Match the ground's slope so the foot sits flat on hills, lifting the low end clear
      const g = groundLocal(ax, az);
      leg.slope = Math.atan2(groundLocal(ax, az + 0.1) - groundLocal(ax, az - 0.1), 0.2);
      const slopeLift = Math.abs(Math.sin(leg.slope)) * (leg.slope > 0 ? 0.09 : 0.18) * k;
      leg.target = leg.target || new THREE.Vector3();
      leg.target.set(ax, g + ANKLE_H + pv.y - pyRot + y + slopeLift, az);
    }

    // ---------- Pelvis ----------
    // Height: as high as standing allows, but never higher than the planted legs can reach
    // (the legs work like a compass, so a walk dips at each step). Runners sink at
    // mid-stance as the knee absorbs the landing and are highest in mid-flight.
    const runCrouch = runW * 0.026 * k * moveW;
    const runBob = -0.036 * k * runW * amp * Math.cos(TAU * 2 * (phase - midStance));
    const walkDip = -0.032 * k * amp * (1 - runW) * (0.5 - 0.5 * Math.cos(TAU * 2 * (phase - midStance)));
    let pelvisY = STAND_HEIGHT - runCrouch + runBob + walkDip;
    const reach = THIGH + SHIN - 0.012 * k;
    for (const leg of legs) {
      if (!leg.stance) continue;
      const dx = leg.target.x - leg.side * HIP_W, dz = leg.target.z;
      const maxY = leg.target.y + Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz)) - D.hipY;
      pelvisY = Math.min(pelvisY, maxY);
    }
    // Drop quickly (the knee gives a little to cushion each step), rise smoothly
    pelvisHeight = pelvisY < pelvisHeight ? damp(pelvisHeight, pelvisY, 45, dt) : damp(pelvisHeight, pelvisY, 12, dt);

    const sway = lerp(0.028, 0.01, runW) * k * moveW * -Math.cos(TAU * (phase - midStance)); // over the planted foot
    const yaw = lerp(0.07, 0.13, runW) * amp * Math.cos(TAU * (phase - runW * 0.1));        // hips turn with the stride
    const drop = lerp(0.06, 0.07, runW) * moveW * -Math.cos(TAU * (phase - midStance));      // swing-side hip drops
    const pitch = lerp(0.03, 0.09, runW) * moveW + lean;                                     // pelvis tilts forward

    pelvis.position.set(sway + shift, pelvisHeight, 0);
    pelvis.rotation.set(pitch, yaw, drop + bank + shift / k * 1.5);

    // Upper body leans into a run and counter-rotates against the hips; the head stays steady
    spine.rotation.set(runW * 0.05 * moveW + breathe * 0.012 * idle, -yaw * lerp(1.8, 2.1, runW), -drop * 0.75 - bank * 0.3);
    neck.rotation.set(-(pitch + spine.rotation.x) * 0.75, -(yaw + spine.rotation.y) * 0.9, -(pelvis.rotation.z + spine.rotation.z) * 0.85);

    pelvis.updateMatrix();
    invPelvis.copy(pelvis.matrix).invert();

    // ---------- Legs: inverse kinematics ----------
    for (const leg of legs) {
      local.copy(leg.target).applyMatrix4(invPelvis).sub(leg.hip.position);
      leg.hip.rotation.z = Math.atan2(local.x, -local.y);            // sideways first
      const down = Math.hypot(local.x, local.y);
      const dist = clamp(Math.hypot(down, local.z), 0.25 * k, THIGH + SHIN - 0.002 * k);
      const knee = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - dist * dist) / (2 * THIGH * SHIN), -1, 1));
      const alpha = Math.acos(clamp((THIGH * THIGH + dist * dist - SHIN * SHIN) / (2 * THIGH * dist), -1, 1));
      leg.hip.rotation.x = -(Math.atan2(local.z, down) + alpha);
      leg.knee.rotation.x = knee;
      // Keep the foot at the right angle to the ground whatever the leg is doing
      leg.ankle.rotation.x = leg.footPitch - leg.slope * (1 - Math.min(1, Math.abs(leg.footPitch) * 3))
        - (leg.hip.rotation.x + leg.knee.rotation.x + pelvis.rotation.x);
    }

    // ---------- Arms ----------
    for (const arm of arms) {
      // Opposite to the same-side leg, a touch behind it
      const c = Math.cos(TAU * (phase - 0.04) + (arm.side < 0 ? 0 : Math.PI));
      const forwardness = Math.max(0, -c);              // 1 = arm fully forward
      // Walk: relaxed pendulum, more forward than back, elbow bends coming forward
      const walkSwing = 0.32 * c * (c < 0 ? 1.15 : 0.7);
      const walkElbow = 0.3 + forwardness * 0.19;
      // Run: elbows near 90°, driving from the shoulder; elbow closes coming forward
      const runSwing = (c < 0 ? 0.8 : 0.6) * c * clamp(vh / 5, 0.6, 1.1);
      const runElbow = 1.5 + forwardness * 0.25 - Math.max(0, c) * 0.25;
      const s = lerp(walkSwing, runSwing, runW) * amp;  // negative = forward
      arm.shoulder.rotation.x = s + breathe * 0.015 * idle;
      // Arms carried slightly out; runners' hands cross toward the midline in front
      arm.shoulder.rotation.z = arm.side * (D.armOut + runW * moveW * (0.1 - 0.08 * forwardness));
      arm.shoulder.rotation.y = -arm.side * runW * moveW * 0.35;
      arm.elbow.rotation.x = -lerp(0.18, lerp(walkElbow, runElbow, runW), moveW);
    }
  }

  return {
    root,
    joints: { pelvis, spine, neck, legs, arms },
    animate,
    get runAmount() { return runW; },
    set onFootstep(fn) { onFootstep = fn; },
  };
}
