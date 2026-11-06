// A simple jointed mannequin (about 1.8 m tall) built from three.js shapes, with a walk cycle.
// The model faces +Z. Its feet are at y = 0.
import * as THREE from 'three';

const skinMat = new THREE.MeshStandardMaterial({ color: 0xcdb497, roughness: 0.55 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.85 });
const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.7 });

const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

function part(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function joint(x, y, z, parent) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export function createMannequin(shirtColor) {
  const shirtMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(shirtColor), roughness: 0.85 });

  const root = new THREE.Group();   // placed at the feet; rotate this to face a direction
  const body = joint(0, 0, 0, root); // bobs up and down while walking

  // Hips + torso
  const pelvis = part(capsule(0.13, 0.14), pantsMat, 0, 0.96, 0, body);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1, 0.8);
  const torso = part(capsule(0.17, 0.26), shirtMat, 0, 1.26, 0, body);
  torso.scale.set(1.15, 1, 0.72);
  part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skinMat, 0, 1.53, 0, body);
  const head = part(new THREE.SphereGeometry(0.115, 20, 14), skinMat, 0, 1.67, 0.01, body);
  head.scale.set(0.9, 1.12, 0.98);

  // Legs: hip -> knee -> foot
  const legs = [-1, 1].map((side) => {
    const hip = joint(side * 0.1, 0.92, 0, body);
    part(capsule(0.075, 0.3), pantsMat, 0, -0.22, 0, hip);
    const knee = joint(0, -0.44, 0, hip);
    part(capsule(0.062, 0.32), pantsMat, 0, -0.22, 0, knee);
    part(new THREE.BoxGeometry(0.1, 0.07, 0.24), shoeMat, 0, -0.445, 0.045, knee);
    return { hip, knee };
  });

  // Arms: shoulder -> elbow -> hand
  const arms = [-1, 1].map((side) => {
    const shoulder = joint(side * 0.235, 1.41, 0, body);
    shoulder.rotation.z = side * 0.08; // hang slightly away from the body
    part(capsule(0.055, 0.2), shirtMat, 0, -0.14, 0, shoulder);
    const elbow = joint(0, -0.29, 0, shoulder);
    part(capsule(0.046, 0.2), skinMat, 0, -0.13, 0, elbow);
    part(new THREE.SphereGeometry(0.05, 12, 8), skinMat, 0, -0.29, 0, elbow);
    return { shoulder, elbow };
  });

  let phase = 0;
  let amount = 0; // 0 = standing, 1 = full walk swing
  let time = Math.random() * 10;

  /** speed = how fast this character is moving (units/second) */
  function animate(dt, speed) {
    time += dt;
    const target = Math.min(speed / 4.5, 1.4);
    amount += (target - amount) * Math.min(1, dt * 8);
    phase += dt * (3 + speed * 1.6);

    const s = Math.sin(phase);
    const swing = 0.55 * amount;

    legs[0].hip.rotation.x = -s * swing;
    legs[1].hip.rotation.x = s * swing;
    legs[0].knee.rotation.x = Math.max(0, Math.cos(phase)) * 0.9 * amount;
    legs[1].knee.rotation.x = Math.max(0, -Math.cos(phase)) * 0.9 * amount;

    const breathe = Math.sin(time * 1.8) * 0.03 * (1 - Math.min(amount, 1));
    arms[0].shoulder.rotation.x = s * swing * 0.9 + breathe;
    arms[1].shoulder.rotation.x = -s * swing * 0.9 + breathe;
    arms[0].elbow.rotation.x = -0.15 - 0.35 * amount;
    arms[1].elbow.rotation.x = -0.15 - 0.35 * amount;

    // Natural body sway while walking:
    //  - dips smoothly at each footstep (lowest when the legs are spread, highest mid-step)
    //  - shifts sideways over whichever foot is on the ground
    //  - leans slightly toward that foot
    const a = Math.min(amount, 1.3);
    body.position.y = -(0.5 - 0.5 * Math.cos(phase * 2)) * 0.045 * a;
    body.position.x = Math.cos(phase) * 0.035 * a;
    body.rotation.z = -Math.cos(phase) * 0.035 * a;
    body.rotation.x = 0.05 * a; // lean into the walk
  }

  function dispose() {
    shirtMat.dispose();
  }

  // `body` is exposed so the camera can follow its sway
  return { root, body, animate, dispose };
}
