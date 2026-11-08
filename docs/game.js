import * as THREE from 'three';
import { joinRoom, selfId } from 'trystero';

// Load our other files with the same version tag this file was loaded with (see index.html),
// so an update never mixes new and old cached files.
const VERSION = new URL(import.meta.url).search;
const { createWorld, heightAt, collide, isBlocked, addObstacle, HALF } = await import(`./world.js${VERSION}`);
const { createCreature1 } = await import(`./creature1.js${VERSION}`);
const { loadCharacters, createCharacter } = await import(`./character.js${VERSION}`);

// ---------- Movement settings (real-world values) ----------
const WALK_SPEED = 1.6;        // m/s — a normal human walk
const RUN_SPEED = 3.4;         // m/s — an easy jog (hold Shift)
const ACCELERATION = 6;        // how quickly you reach full speed (higher = snappier)
const DECELERATION = 8;        // how quickly you come to a stop
const TURN_SPEED = 9;          // how quickly the body turns to face the movement direction
const PLAYER_RADIUS = 0.35;
const LIMIT = HALF - 1;        // edge of the walkable area

// ---------- Camera settings ----------
const CAM_DISTANCE = 2.5;      // how far behind the player the camera sits
const CAM_RUN_EXTRA = 0.45;    // camera pulls back this much more when running
const CAM_HEIGHT = 0.3;        // camera aims this far above the chest
const CAM_SIDE = -0.6;         // sideways shift: positive = left, negative = right shoulder
const CAM_FOV = 62;
const CAM_RUN_FOV = 70;        // field of view widens a little at a run
const CAM_FOLLOW = 14;         // how tightly the camera follows horizontally (lower = more lag)
const CAM_FOLLOW_Y = 7;        // vertical follow — softer, so it absorbs the body's bounce
const CAM_STEP_KICK = 0.012;   // how hard each footstep jolts the camera
const CAM_STRAFE_TILT = 0.02;  // tilt when moving left/right (radians)
const CAM_SHAKE = 0.0012;      // subtle handheld drift
const MOUSE_SENSITIVITY = 0.0022;
const MOUSE_SMOOTHING = 22;    // higher = more direct mouse

// ---------- Network settings ----------
const SEND_INTERVAL = 1 / 20;  // send our position 20x per second while moving
const HEARTBEAT = 2;           // ...and every 2 seconds even when standing still
const APP_ID = 'ns2024g-threejs-testing'; // everyone with the same APP_ID + ROOM_ID
const ROOM_ID = 'forest';                 // ends up in the same world

// ---------- Renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAM_FOV, window.innerWidth / window.innerHeight, 0.05, 400);
const world = createWorld(scene, renderer);
document.getElementById('status').textContent = 'Loading characters…';
await loadCharacters();
window.game = { renderer, scene, camera }; // handy for debugging in the browser console

const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// Turn the short way round
function angleDiff(a, b) {
  return ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

// ---------- Players ----------
const players = {}; // peerId -> { model, target, targetRy, speed, lastRy }

function addPlayer(id, data) {
  if (players[id]) return players[id];
  const model = createCharacter(data.color, heightAt);
  model.root.position.set(data.x, heightAt(data.x, data.z), data.z);
  model.root.rotation.y = data.ry || 0;
  scene.add(model.root);
  players[id] = { model, target: model.root.position.clone(), targetRy: data.ry || 0, speed: 0 };
  return players[id];
}

function removePlayer(id) {
  const p = players[id];
  if (!p) return;
  scene.remove(p.model.root);
  p.model.dispose();
  delete players[id];
}

// Our own player: a random muted shirt colour, spawned in the clearing
const myColor = `hsl(${Math.floor(Math.random() * 360)}, 45%, 42%)`;
const me = addPlayer(selfId, { x: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8, ry: 0, color: myColor });
const mePos = me.model.root.position;
const velocity = new THREE.Vector3();

// ---------- Creature 1 ----------
// Stands at the far side of the spawn clearing, facing the players. Building its body
// freezes the page for a few seconds, so it happens here, before players connect.
const CREATURE_POS = { x: 0, z: 7 };
document.getElementById('status').textContent = 'Building the creature…';
await new Promise((resolve) => setTimeout(resolve, 50)); // let the message appear first
const creature = createCreature1();
creature.object.position.set(CREATURE_POS.x, heightAt(CREATURE_POS.x, CREATURE_POS.z), CREATURE_POS.z);
creature.object.rotation.y = Math.PI;       // the model faces +Z; turn it toward the spawn point
scene.add(creature.object);
addObstacle(CREATURE_POS.x, CREATURE_POS.z, 0.35);
creature.watch(me.model.chest);             // head and eyes follow your character
window.game.creature = creature;            // try game.creature.scream() in the browser console

// ---------- Light carried by the player ----------
// A soft warm glow all around, plus a wider, brighter wash reaching out ahead
// (like a lantern held in front). Settings are at the top of this section.
const GLOW_INTENSITY = 5;      // soft light around the player
const GLOW_RANGE = 10;
const AHEAD_INTENSITY = 70;    // extra light in front
const AHEAD_RANGE = 24;
const AHEAD_WIDTH = 0.85;      // spread of the forward light (radians)
const lightColor = 0xffd9a8;

const glow = new THREE.PointLight(lightColor, GLOW_INTENSITY, GLOW_RANGE, 2);
const ahead = new THREE.SpotLight(lightColor, AHEAD_INTENSITY, AHEAD_RANGE, AHEAD_WIDTH, 1, 2);
ahead.castShadow = true;                 // trees and grass cast shadows away from you
ahead.shadow.mapSize.set(1024, 1024);
ahead.shadow.camera.near = 0.3;
ahead.shadow.bias = -0.0005;
ahead.shadow.normalBias = 0.03;
scene.add(glow, ahead, ahead.target);
const aheadAim = new THREE.Vector3();

function updatePlayerLight(dt) {
  const ry = me.model.root.rotation.y;
  const fx = Math.sin(ry), fz = Math.cos(ry);
  glow.position.set(mePos.x + fx * 0.3, mePos.y + 1.3, mePos.z + fz * 0.3);
  ahead.position.set(mePos.x + fx * 0.35, mePos.y + 1.85, mePos.z + fz * 0.35);
  // Aim a few metres ahead on the ground, smoothed so it doesn't jitter with each step
  const tx = mePos.x + fx * 7, tz = mePos.z + fz * 7;
  if (aheadAim.lengthSq() === 0) aheadAim.set(tx, heightAt(tx, tz), tz);
  aheadAim.x = damp(aheadAim.x, tx, 8, dt);
  aheadAim.z = damp(aheadAim.z, tz, 8, dt);
  aheadAim.y = heightAt(aheadAim.x, aheadAim.z);
  ahead.target.position.copy(aheadAim);
}

// ---------- Peer-to-peer networking ----------
const statusEl = document.getElementById('status');
const updateStatus = () => {
  const count = Object.keys(players).length;
  statusEl.textContent = count > 1
    ? `${count} players online`
    : 'Waiting for other players… (send someone the link!)';
};
updateStatus();

const room = joinRoom({ appId: APP_ID }, ROOM_ID);
const stateAction = room.makeAction('state');
const myState = () => ({ x: mePos.x, z: mePos.z, ry: me.model.root.rotation.y, color: myColor });

room.onPeerJoin = (peerId) => stateAction.send(myState(), { target: peerId });
room.onPeerLeave = (peerId) => { removePlayer(peerId); updateStatus(); };

stateAction.onMessage = (data, { peerId }) => {
  if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.z) || !Number.isFinite(data.ry)) return;
  if (typeof data.color !== 'string' || data.color.length > 40) return;
  const isNew = !players[peerId];
  const p = addPlayer(peerId, data);
  const x = THREE.MathUtils.clamp(data.x, -LIMIT, LIMIT);
  const z = THREE.MathUtils.clamp(data.z, -LIMIT, LIMIT);
  p.target.set(x, heightAt(x, z), z);
  p.targetRy = data.ry;
  if (isNew) updateStatus();
};

// ---------- Input ----------
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let targetYaw = Math.PI, yaw = Math.PI;   // camera angle around the player
let targetPitch = 0.22, pitch = 0.22;     // camera angle above the ground

renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  targetYaw -= e.movementX * MOUSE_SENSITIVITY;
  targetPitch = THREE.MathUtils.clamp(targetPitch + e.movementY * MOUSE_SENSITIVITY, -0.35, 1.2);
});

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Camera rig state ----------
const camAnchor = new THREE.Vector3();   // smoothed point the camera follows (the chest)
const chestPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const desired = new THREE.Vector3();
let camDist = CAM_DISTANCE;
let camRoll = 0;
let stepKick = 0, stepKickVel = 0;       // footstep jolt (a small spring)
let anchorReady = false;

// Each heel strike gives the camera a small downward jolt, harder when running
me.model.onFootstep = (side, speed) => {
  stepKickVel -= CAM_STEP_KICK * (0.2 + Math.min(speed / RUN_SPEED, 1) * 1.1) * 60;
};

// ---------- Game loop ----------
const clock = new THREE.Clock();
const input = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const prev = new THREE.Vector3();
let sendTimer = 0;
let heartbeatTimer = 0;
let lastSent = { x: NaN, z: NaN, ry: NaN };
let lastSpeed = 0;
let time = 0;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  time += dt;

  // --- Mouse look, slightly smoothed so it has weight ---
  yaw = damp(yaw, targetYaw, MOUSE_SMOOTHING, dt);
  pitch = damp(pitch, targetPitch, MOUSE_SMOOTHING, dt);

  // --- Our movement: WASD relative to the camera, with momentum ---
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  input.set(0, 0, 0);
  if (keys.KeyW) input.add(forward);
  if (keys.KeyS) input.sub(forward);
  if (keys.KeyD) input.add(right);
  if (keys.KeyA) input.sub(right);
  const moving = input.lengthSq() > 0;
  const running = keys.ShiftLeft || keys.ShiftRight;
  if (moving) input.normalize().multiplyScalar(running ? RUN_SPEED : WALK_SPEED);

  velocity.x = damp(velocity.x, input.x, moving ? ACCELERATION : DECELERATION, dt);
  velocity.z = damp(velocity.z, input.z, moving ? ACCELERATION : DECELERATION, dt);
  if (velocity.lengthSq() < 1e-4 && !moving) velocity.set(0, 0, 0);

  prev.copy(mePos);
  mePos.x += velocity.x * dt;
  mePos.z += velocity.z * dt;
  collide(mePos, PLAYER_RADIUS);
  mePos.x = THREE.MathUtils.clamp(mePos.x, -LIMIT, LIMIT);
  mePos.z = THREE.MathUtils.clamp(mePos.z, -LIMIT, LIMIT);
  mePos.y = heightAt(mePos.x, mePos.z);

  const speed = Math.hypot(mePos.x - prev.x, mePos.z - prev.z) / Math.max(dt, 1e-4);
  const accel = (speed - lastSpeed) / Math.max(dt, 1e-4);
  lastSpeed = speed;

  // Turn the body toward where we're going
  const root = me.model.root;
  let turnRate = 0;
  if (speed > 0.15) {
    const before = root.rotation.y;
    root.rotation.y += angleDiff(before, Math.atan2(velocity.x, velocity.z)) * (1 - Math.exp(-TURN_SPEED * dt));
    turnRate = angleDiff(before, root.rotation.y) / Math.max(dt, 1e-4);
  }
  me.model.animate(dt, speed, turnRate, accel);

  // --- Tell everyone where we are ---
  sendTimer += dt;
  heartbeatTimer += dt;
  if (sendTimer >= SEND_INTERVAL) {
    sendTimer = 0;
    const ry = root.rotation.y;
    if (mePos.x !== lastSent.x || mePos.z !== lastSent.z || ry !== lastSent.ry || heartbeatTimer >= HEARTBEAT) {
      stateAction.send(myState());
      lastSent = { x: mePos.x, z: mePos.z, ry };
      heartbeatTimer = 0;
    }
  }

  // --- Other players: glide toward their latest position and animate ---
  const t = 1 - Math.exp(-10 * dt);
  for (const [pid, p] of Object.entries(players)) {
    if (pid === selfId) continue;
    const pos = p.model.root.position;
    prev.copy(pos);
    pos.lerp(p.target, t);
    pos.y = heightAt(pos.x, pos.z);
    const before = p.model.root.rotation.y;
    p.model.root.rotation.y += angleDiff(before, p.targetRy) * t;
    const s = Math.hypot(pos.x - prev.x, pos.z - prev.z) / Math.max(dt, 1e-4);
    p.speed = damp(p.speed, s, 8, dt);
    p.model.animate(dt, p.speed < 0.1 ? 0 : p.speed, angleDiff(before, p.model.root.rotation.y) / Math.max(dt, 1e-4), 0);
  }

  creature.update(dt);
  updateCamera(dt);
  updatePlayerLight(dt);
  world.update(mePos);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// ---------- Realistic third-person camera ----------
function updateCamera(dt) {
  const runAmount = me.model.runAmount;

  // Follow the chest (not the feet), with a little lag. Vertical follow is softer, so the
  // camera rides the body's motion like a real operator instead of copying every bounce.
  me.model.root.updateMatrixWorld(true);
  me.model.chest.getWorldPosition(chestPos);
  if (!anchorReady) { camAnchor.copy(chestPos); anchorReady = true; }
  camAnchor.x = damp(camAnchor.x, chestPos.x, CAM_FOLLOW, dt);
  camAnchor.z = damp(camAnchor.z, chestPos.z, CAM_FOLLOW, dt);
  camAnchor.y = damp(camAnchor.y, chestPos.y, CAM_FOLLOW_Y, dt);

  // Footstep jolt: a slightly bouncy spring kicked on every heel strike
  const k = 220, c = 2 * Math.sqrt(k) * 0.45;
  stepKickVel += (-k * stepKick - c * stepKickVel) * dt;
  stepKick += stepKickVel * dt;

  // Subtle handheld drift (layered slow sine waves), a bit stronger when running
  const shake = CAM_SHAKE * (1 + runAmount * 2.5);
  const driftX = (Math.sin(time * 0.9) + Math.sin(time * 2.3 + 1.3) * 0.5) * shake;
  const driftY = (Math.sin(time * 1.1 + 2.1) + Math.sin(time * 2.9) * 0.4) * shake;

  // Aim point: above the chest, off to the shoulder
  lookAt.set(
    camAnchor.x - right.x * CAM_SIDE,
    camAnchor.y + CAM_HEIGHT + stepKick,
    camAnchor.z - right.z * CAM_SIDE
  );

  // Pull back when running; pull in if a tree is between the player and the camera
  const wantDist = CAM_DISTANCE + CAM_RUN_EXTRA * runAmount;
  const dirX = Math.sin(yaw) * Math.cos(pitch);
  const dirY = Math.sin(pitch);
  const dirZ = Math.cos(yaw) * Math.cos(pitch);
  let freeDist = wantDist;
  const STEPS = 12;
  for (let i = 1; i <= STEPS; i++) {
    const d = (i / STEPS) * wantDist;
    if (isBlocked(lookAt.x + dirX * d, lookAt.z + dirZ * d, 0.25)) { freeDist = Math.max(0.6, d - wantDist / STEPS); break; }
  }
  camDist = freeDist < camDist ? damp(camDist, freeDist, 25, dt) : damp(camDist, freeDist, 3, dt);

  desired.set(lookAt.x + dirX * camDist, lookAt.y + dirY * camDist, lookAt.z + dirZ * camDist);
  desired.y = Math.max(desired.y, heightAt(desired.x, desired.z) + 0.35); // stay above ground
  camera.position.copy(desired);
  camera.lookAt(lookAt);

  // Roll: tilt into strafes and slightly into turns
  const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  camRoll = damp(camRoll, -strafe * CAM_STRAFE_TILT * Math.min(lastSpeed / WALK_SPEED, 1.5), 5, dt);
  camera.rotateZ(camRoll);
  camera.rotateX(driftY);
  camera.rotateY(driftX);

  // Field of view widens a touch when running
  const fov = THREE.MathUtils.lerp(CAM_FOV, CAM_RUN_FOV, runAmount);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = damp(camera.fov, fov, 4, dt);
    camera.updateProjectionMatrix();
  }
}

animate();
