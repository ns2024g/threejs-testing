// Player characters: simple stick figures with adult human proportions, drawn directly on
// the walk/jog skeleton from rig.js (so they move exactly like the gait system).
import * as THREE from 'three';

const VERSION = new URL(import.meta.url).search;
const { createRig, HUMAN_DIMS: D } = await import(`./rig.js${VERSION}`);

const STICK = 0.028;   // stick thickness (radius, metres)
const stickGeo = new THREE.CylinderGeometry(1, 1, 1, 4).translate(0, 0.5, 0); // square sticks, base at 0, 1 m long
const ballGeo = new THREE.SphereGeometry(1, 6, 4);   // blocky low-poly balls

/** Nothing to load for stick figures (kept so game.js doesn't need to change). */
export async function loadCharacters() {}

/**
 * @param color    player colour (CSS)
 * @param groundAt (x, z) => ground height
 */
export function createCharacter(color, groundAt) {
  const rig = createRig(D, groundAt);
  const J = rig.joints;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: 0.6,
    emissive: new THREE.Color(color), emissiveIntensity: 0.15, // faintly visible at night
  });

  // A stick from `parent`'s origin along direction (dx, dy, dz) for `len` metres
  function stick(parent, len, dx = 0, dy = -1, dz = 0, ox = 0, oy = 0, oz = 0) {
    const m = new THREE.Mesh(stickGeo, mat);
    m.position.set(ox, oy, oz);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    m.scale.set(STICK, len, STICK);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  function ball(parent, r, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(ballGeo, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(r);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  // Hips (a short bar between the hip joints) and torso up to the neck
  stick(J.pelvis, D.hipW * 2, 1, 0, 0, -D.hipW, D.hipY, 0);
  stick(J.pelvis, D.spineY - D.hipY, 0, 1, 0, 0, D.hipY, 0);
  stick(J.spine, D.neckY, 0, 1, 0);
  // Shoulders bar, neck and head
  stick(J.spine, D.shoulderX * 2, 1, 0, 0, -D.shoulderX, D.shoulderY, 0);
  stick(J.neck, 0.06, 0, 1, 0);
  ball(J.neck, 0.11, 0, 0.17, 0.01);
  // Legs and feet
  for (const leg of J.legs) {
    stick(leg.hip, D.thigh);
    stick(leg.knee, D.shin);
    stick(leg.ankle, D.toeZ - D.heelZ, 0, 0, 1, 0, -D.ankleH + STICK, D.heelZ);
    ball(leg.knee, STICK * 1.3);
  }
  // Arms and hands
  for (const arm of J.arms) {
    stick(arm.shoulder, D.upperArm);
    stick(arm.elbow, D.forearm);
    ball(arm.elbow, STICK * 1.3);
    ball(arm.wrist, 0.04);
  }

  return {
    root: rig.root,
    head: J.neck,                   // the first-person camera follows this
    animate: rig.animate,
    /** Invisible to the camera, but still casts a shadow (for your own first-person body). */
    hideFromView() { mat.colorWrite = false; mat.depthWrite = false; },
    dispose() { mat.dispose(); },
    get runAmount() { return rig.runAmount; },
    set onFootstep(fn) { rig.onFootstep = fn; },
  };
}
