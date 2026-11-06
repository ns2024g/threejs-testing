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

const skinMat = new THREE.MeshStandardMaterial({ color: 0xcdb497, roughness: 0.55 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.85 });
const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.7 });

// Body measurements (metres)
const THIGH = 0.44;
const SHIN = 0.44;
const ANKLE_H = 0.075;       // ankle height above the ground when the foot is flat
// Bottom of the shoe relative to the ankle joint (the shoe box spans z -0.075..0.175, y -0.075)
const TOE = { y: -ANKLE_H, z: 0.175 };
const HEEL = { y: -ANKLE_H, z: -0.075 };
const HIP_W = 0.09;          // hip joints are this far left/right of centre
const STAND_HEIGHT = 0.925;  // pelvis height when standing (knees very slightly soft)

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

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
  const shirtMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(shirtColor), roughness: 0.85 });

  // ---------- Skeleton + meshes ----------
  const root = new THREE.Group();                              // at the feet, rotate to face
  const pelvis = joint(0, STAND_HEIGHT, 0, root, 'YXZ');       // moves with the gait
  const pelvisMesh = part(capsule(0.13, 0.14), pantsMat, 0, 0.03, 0, pelvis);
  pelvisMesh.rotation.z = Math.PI / 2;
  pelvisMesh.scale.set(1, 1, 0.8);

  const legs = [-1, 1].map((side) => {
    const hip = joint(side * HIP_W, -0.02, 0, pelvis, 'ZXY');
    part(capsule(0.075, 0.3), pantsMat, 0, -THIGH / 2, 0, hip);
    const knee = joint(0, -THIGH, 0, hip);
    part(capsule(0.062, 0.32), pantsMat, 0, -SHIN / 2, 0, knee);
    const ankle = joint(0, -SHIN, 0, knee);
    part(new THREE.BoxGeometry(0.1, 0.07, 0.25), shoeMat, 0, -0.04, 0.05, ankle);
    return { side, hip, knee, ankle, phaseOffset: side < 0 ? 0 : 0.5, wasStance: true };
  });

  const spine = joint(0, 0.08, 0, pelvis, 'YXZ');
  const torso = part(capsule(0.17, 0.26), shirtMat, 0, 0.25, 0, spine);
  torso.scale.set(1.15, 1, 0.72);
  const neck = joint(0, 0.52, 0, spine, 'YXZ');
  part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skinMat, 0, 0, 0, neck);
  const head = part(new THREE.SphereGeometry(0.115, 20, 14), skinMat, 0, 0.14, 0.01, neck);
  head.scale.set(0.9, 1.12, 0.98);

  const arms = [-1, 1].map((side) => {
    const shoulder = joint(side * 0.235, 0.4, 0, spine, 'ZXY');
    part(capsule(0.055, 0.2), shirtMat, 0, -0.14, 0, shoulder);
    const elbow = joint(0, -0.29, 0, shoulder);
    part(capsule(0.046, 0.2), skinMat, 0, -0.13, 0, elbow);
    part(new THREE.SphereGeometry(0.05, 12, 8), skinMat, 0, -0.29, 0, elbow);
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
    runW = damp(runW, smoothstep(2.6, 3.8, speed), 4, dt);
    lean = damp(lean, clamp(accel * 0.025, -0.12, 0.15), 5, dt);
    bank = damp(bank, clamp(-turnRate * speed * 0.03, -0.25, 0.25), 6, dt);

    // Cadence (stride cycles per second) rises with speed, like real people:
    // ~2.2 steps/s at a 1.6 m/s walk, ~2.8 steps/s at a 5.5 m/s run.
    const freq = lerp(0.8 + 0.18 * speed, 1.2 + 0.04 * speed, runW);
    phase = (phase + dt * freq) % 1;

    // Each cycle the body travels `stride` metres; the planted foot covers duty*stride of it
    const duty = lerp(0.6, 0.3, runW);                   // fraction of the cycle each foot is down
    const stride = speed / freq;
    const stanceLen = stride * duty;
    const lift = lerp(0.07, 0.24, runW) * clamp(stride / 1.4, 0.3, 1);
    const stepWidth = lerp(0.075, 0.05, runW);
    const amp = moveW * clamp(speed / 1.3, 0, 1);         // gait intensity
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

      if (stance) {
        const t = p / duty;
        // Planted: moves back under the body at exactly body speed (no sliding).
        // Lands a bit ahead of the hip and leaves further behind it, like a real stride.
        z = stanceLen * (0.42 - t);
        if (t < 0.15) footPitch = lerp(-0.32, 0, t / 0.15);          // heel strike -> foot flat
        else if (t < 0.62) footPitch = 0;
        else footPitch = lerp(0, 0.8, (t - 0.62) / 0.38);            // heel rises, push off toes
      } else {
        const t = (p - duty) / (1 - duty);
        // Carried forward to the next step. The foot leaves the ground and lands moving at
        // exactly ground speed (Hermite curve), so it never scuffs on lift-off or touchdown.
        const z0 = -0.58 * stanceLen, z1 = 0.42 * stanceLen;
        const m = -speed * (1 - duty) / freq;           // ground speed over the swing time
        const t2 = t * t, t3 = t2 * t;
        z = (2 * t3 - 3 * t2 + 1) * z0 + (t3 - 2 * t2 + t) * m + (-2 * t3 + 3 * t2) * z1 + (t3 - t2) * m;
        y = lift * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 1.3);
        footPitch = t < 0.45 ? lerp(0.8, 0.05, t / 0.45) : lerp(0.05, -0.32, (t - 0.45) / 0.55); // toes up before landing
      }
      z += runW * 0.05 * moveW; // runners land a little ahead

      // Footstep event (heel strike)
      if (stance && !leg.wasStance && onFootstep && moveW > 0.5) onFootstep(leg.side, speed);
      leg.wasStance = stance;

      // Blend between standing pose and gait
      const restZ = leg.side < 0 ? 0.035 : -0.025;
      // Legs that are planted, or about to land, decide how low the hips must be
      leg.stance = stance || moveW < 0.5 || (runW < 0.5 && (p - duty) / (1 - duty) > 0.75);
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
    const runCrouch = runW * 0.05 * moveW;
    const runBob = -0.03 * runW * amp * Math.cos(TAU * 2 * (phase - midStance)); // runners sink at mid-stance
    // Walkers are highest over the planted leg and lowest when both feet are down
    const walkDip = -0.042 * amp * (1 - runW) * (0.5 - 0.5 * Math.cos(TAU * 2 * (phase - midStance)));
    let pelvisY = STAND_HEIGHT - runCrouch + runBob + walkDip;
    const reach = THIGH + SHIN - 0.012;
    for (const leg of legs) {
      if (!leg.stance) continue;
      const dx = leg.target.x - leg.side * HIP_W, dz = leg.target.z;
      const maxY = leg.target.y + Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz)) + 0.02;
      pelvisY = Math.min(pelvisY, maxY);
    }
    // Drop instantly when needed, rise smoothly (muscles push the body up)
    pelvisHeight = pelvisY < pelvisHeight ? pelvisY : damp(pelvisHeight, pelvisY, 14, dt);

    const sway = lerp(0.028, 0.012, runW) * moveW * -Math.cos(TAU * (phase - midStance)); // over the planted foot
    const yaw = lerp(0.07, 0.12, runW) * amp * Math.cos(TAU * phase);                     // hips turn with the stride
    const drop = lerp(0.06, 0.035, runW) * moveW * -Math.cos(TAU * (phase - midStance));   // swing side hip drops
    const pitch = lerp(0.03, 0.12, runW) * moveW + lean;

    pelvis.position.set(sway + shift, pelvisHeight, 0);
    pelvis.rotation.set(pitch, yaw, drop + bank + shift * 1.5);

    // Upper body counter-rotates; head stays steady and looks ahead
    spine.rotation.set(runW * 0.06 * moveW + breathe * 0.012 * idle, -yaw * 1.8, -drop * 0.75 - bank * 0.3);
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
      // Opposite to the same-side leg, a touch behind it, more forward than back
      const c = Math.cos(TAU * (phase - 0.04) + (arm.side < 0 ? 0 : Math.PI));
      const swing = lerp(0.32, 0.8, runW) * amp;
      const s = swing * c * (c < 0 ? 1.15 : 0.7);      // negative = forward
      arm.shoulder.rotation.x = s + breathe * 0.015 * idle;
      arm.shoulder.rotation.z = arm.side * (0.07 + runW * 0.12 * moveW);
      const elbowBase = lerp(0.18, lerp(0.3, 1.45, runW), moveW);
      arm.elbow.rotation.x = -(elbowBase + Math.max(0, -s) * 0.6);
    }
  }

  function dispose() {
    shirtMat.dispose();
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
