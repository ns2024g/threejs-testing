// Player characters: a rigged cartoon model whose skeleton copies the procedural
// walk/jog from rig.js every frame.
//
// Models: "Rogue" and "Rogue (Hooded)" from the KayKit Adventurers Character Pack by
// Kay Lousberg (www.kaylousberg.com) — CC0 / public domain. Trimmed for the web (built-in
// animations and weapons removed).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const VERSION = new URL(import.meta.url).search;
const { createRig } = await import(`./rig.js${VERSION}`);

const MODEL_FILES = ['models/rogue.glb', 'models/rogue_hooded.glb'];
const SCALE = 0.85;         // model units -> metres (about 1.85 m tall, big cartoon head)
const ARM_OUT = 0.24;       // arms hang a bit away from the chunky body

let templates = null;
let dims = null;

/** Loads the character models once. Call (and await) before createCharacter. */
export async function loadCharacters() {
  const loader = new GLTFLoader();
  templates = await Promise.all(MODEL_FILES.map((f) => loader.loadAsync(new URL(f + VERSION, import.meta.url).href)));
  dims = measure(templates[0].scene);
}

// Read the model's proportions from its skeleton so the walk fits its body exactly
function measure(scene) {
  scene.updateMatrixWorld(true);
  const pos = (name) => scene.getObjectByName(name).getWorldPosition(new THREE.Vector3()).multiplyScalar(SCALE);
  const hips = pos('hips'), spine = pos('spine'), head = pos('head');
  const upperLeg = pos('upperlegl'), lowerLeg = pos('lowerlegl'), foot = pos('footl'), toes = pos('toesl');
  const upperArm = pos('upperarml'), lowerArm = pos('lowerarml'), wrist = pos('wristl');
  return {
    thigh: upperLeg.distanceTo(lowerLeg),
    shin: lowerLeg.distanceTo(foot),
    ankleH: foot.y,
    toeZ: toes.z - foot.z + 0.07 * SCALE,     // toe tip is a little past the toe joint
    heelZ: -0.075 * SCALE,
    hipW: Math.abs(upperLeg.x),
    hipY: upperLeg.y - hips.y,
    standHeight: hips.y - 0.006,
    spineY: spine.y - hips.y,
    neckY: head.y - spine.y,
    shoulderX: Math.abs(upperArm.x),
    shoulderY: upperArm.y - spine.y,
    upperArm: upperArm.distanceTo(lowerArm),
    forearm: lowerArm.distanceTo(wrist),
    armOut: ARM_OUT,
  };
}

function pickModel(seedText) {
  let h = 2166136261;
  for (const ch of String(seedText)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % templates.length;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param color    player colour (CSS) — tints the cape and picks the outfit
 * @param groundAt (x, z) => ground height
 */
export function createCharacter(color, groundAt) {
  const rig = createRig(dims, groundAt);
  const model = SkeletonUtils.clone(templates[pickModel(color)].scene);
  model.scale.setScalar(SCALE);
  rig.root.add(model);

  const materials = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // skinned meshes move away from their original bounds
  });
  // Edit: each player's cape is dyed their own colour
  const cape = model.getObjectByName('Rogue_Cape');
  cape?.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.color = new THREE.Color(color).multiplyScalar(1.6);
    materials.push(o.material);
  });

  // ---------- Bone mapping ----------
  const B = (n) => model.getObjectByName(n);
  const bones = {
    hips: B('hips'), spine: B('spine'), chest: B('chest'), head: B('head'),
    legs: { '-1': [B('upperlegr'), B('lowerlegr'), B('footr')], 1: [B('upperlegl'), B('lowerlegl'), B('footl')] },
    arms: { '-1': [B('upperarmr'), B('lowerarmr')], 1: [B('upperarml'), B('lowerarml')] },
  };

  // Rest orientation of every driven bone in character space, and the local direction each
  // limb bone points along (towards its child joint)
  rig.root.updateMatrixWorld(true);
  const rest = new Map();
  const restOf = (bone) => rest.set(bone, bone.getWorldQuaternion(new THREE.Quaternion()));
  [bones.hips, bones.spine, bones.chest, bones.head].forEach(restOf);
  for (const s of ['-1', '1']) { bones.legs[s].forEach(restOf); bones.arms[s].forEach(restOf); }
  const bindLocal = new Map();
  model.traverse((o) => { if (o.isBone) bindLocal.set(o, o.quaternion.clone()); });
  const axis = new Map();
  for (const s of ['-1', '1']) {
    const [ul, ll, ft] = bones.legs[s];
    axis.set(ul, ll.position.clone().normalize());
    axis.set(ll, ft.position.clone().normalize());
    const [ua, la] = bones.arms[s];
    axis.set(ua, la.position.clone().normalize());
    axis.set(la, B(s === '1' ? 'wristl' : 'wristr').position.clone().normalize());
  }

  const rootQ = new THREE.Quaternion();
  const world = new Map(); // bone -> new world quaternion this frame

  // Give `bone` the world rotation `q` (its parent's new world rotation must already be known)
  function setWorld(bone, q) {
    const parentQ = world.get(bone.parent) || bone.parent.getWorldQuaternion(_q2);
    bone.quaternion.copy(parentQ).invert().multiply(q);
    world.set(bone, q.clone());
  }
  // A joint of the rig: its world rotation relative to the character, times the bone's rest
  const follow = (bone, jointObj) => setWorld(bone, jointObj.getWorldQuaternion(_q).multiply(rest.get(bone)));
  // Point a limb bone at a target position, keeping the twist it would naturally have
  function aim(bone, from, to) {
    const parentQ = world.get(bone.parent);
    const base = parentQ.clone().multiply(bindLocal.get(bone));
    const current = _a.copy(axis.get(bone)).applyQuaternion(base);
    const wanted = _b.subVectors(to, from).normalize();
    setWorld(bone, _q.setFromUnitVectors(current, wanted).multiply(base));
  }

  const jp = (obj) => obj.getWorldPosition(new THREE.Vector3());

  function pose() {
    const J = rig.joints;
    rig.root.updateMatrixWorld(true);
    rig.root.getWorldQuaternion(rootQ);
    world.clear();

    // Hips: position + rotation from the rig's pelvis
    J.pelvis.getWorldPosition(_v);
    bones.hips.position.copy(bones.hips.parent.worldToLocal(_v));
    follow(bones.hips, J.pelvis);
    follow(bones.spine, J.spine);
    follow(bones.chest, J.spine);
    follow(bones.head, J.neck);

    // Legs: aim thigh at the rig's knee, shin at its ankle; the foot copies the ankle roll
    for (const leg of J.legs) {
      const [ul, ll, ft] = bones.legs[leg.side];
      const hip = jp(leg.hip), knee = jp(leg.knee), ankle = jp(leg.ankle);
      aim(ul, hip, knee);
      aim(ll, knee, ankle);
      follow(ft, leg.ankle);
    }
    // Arms: aim upper arm at the rig's elbow, forearm at its wrist
    for (const arm of J.arms) {
      const [ua, la] = bones.arms[arm.side];
      const sh = jp(arm.shoulder), el = jp(arm.elbow), wr = jp(arm.wrist);
      aim(ua, sh, el);
      aim(la, el, wr);
    }
  }

  return {
    root: rig.root,
    chest: rig.joints.neck,     // the camera follows this
    animate(dt, speed, turnRate, accel) { rig.animate(dt, speed, turnRate, accel); pose(); },
    dispose() { materials.forEach((m) => m.dispose()); },
    get runAmount() { return rig.runAmount; },
    set onFootstep(fn) { rig.onFootstep = fn; },
  };
}
