import * as THREE from 'three';
import { joinRoom, selfId } from 'trystero';

// Load our other files with the same version tag this file was loaded with (see index.html),
// so an update never mixes new and old cached files.
const VERSION = new URL(import.meta.url).search;
const { createWorld, heightAt, collide, HALF } = await import(`./world.js${VERSION}`);
const { createMannequin } = await import(`./mannequin.js${VERSION}`);

// ---------- Settings ----------
const WALK_SPEED = 4.5;        // units per second
const RUN_SPEED = 8;           // while holding Shift
const PLAYER_RADIUS = 0.35;
const LIMIT = HALF - 1;        // edge of the walkable area
const CAM_DISTANCE = 5;
const CAM_HEIGHT = 1.5;        // camera looks at this height on the player
const MOUSE_SENSITIVITY = 0.0025;
const SEND_INTERVAL = 1 / 20;  // send our position 20x per second while moving
const HEARTBEAT = 2;           // ...and every 2 seconds even when standing still

// Everyone with the same APP_ID + ROOM_ID ends up in the same world.
const APP_ID = 'ns2024g-threejs-testing';
const ROOM_ID = 'forest';

// ---------- Renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 400);
const world = createWorld(scene, renderer);
window.game = { renderer, scene, camera }; // handy for debugging in the browser console

// ---------- Players ----------
const players = {}; // peerId -> { model, target, targetRy, speed }

function addPlayer(id, data) {
  if (players[id]) return players[id];
  const model = createMannequin(data.color);
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

// Turn smoothly the short way round
function lerpAngle(a, b, t) {
  const d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}

// Our own player: a random muted shirt colour, spawned in the clearing
const myColor = `hsl(${Math.floor(Math.random() * 360)}, 45%, 42%)`;
const meData = { x: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8, ry: 0, color: myColor };
const me = addPlayer(selfId, meData);
const mePos = me.model.root.position;

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

let yaw = Math.PI;  // camera angle around the player
let pitch = 0.3;    // camera angle above the ground

renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * MOUSE_SENSITIVITY;
  pitch = THREE.MathUtils.clamp(pitch + e.movementY * MOUSE_SENSITIVITY, -0.2, 1.2);
});

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Game loop ----------
const clock = new THREE.Clock();
const moveDir = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const prev = new THREE.Vector3();
let sendTimer = 0;
let heartbeatTimer = 0;
let lastSent = { x: NaN, z: NaN, ry: NaN };

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);

  // --- Move our player (WASD relative to the camera) ---
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  moveDir.set(0, 0, 0);
  if (keys.KeyW) moveDir.add(forward);
  if (keys.KeyS) moveDir.sub(forward);
  if (keys.KeyD) moveDir.add(right);
  if (keys.KeyA) moveDir.sub(right);

  prev.copy(mePos);
  if (moveDir.lengthSq() > 0) {
    moveDir.normalize();
    const speed = keys.ShiftLeft || keys.ShiftRight ? RUN_SPEED : WALK_SPEED;
    mePos.x += moveDir.x * speed * dt;
    mePos.z += moveDir.z * speed * dt;
    collide(mePos, PLAYER_RADIUS);
    mePos.x = THREE.MathUtils.clamp(mePos.x, -LIMIT, LIMIT);
    mePos.z = THREE.MathUtils.clamp(mePos.z, -LIMIT, LIMIT);
    me.model.root.rotation.y = lerpAngle(me.model.root.rotation.y, Math.atan2(moveDir.x, moveDir.z), Math.min(1, dt * 12));
  }
  mePos.y = heightAt(mePos.x, mePos.z);
  const mySpeed = Math.hypot(mePos.x - prev.x, mePos.z - prev.z) / Math.max(dt, 1e-4);
  me.model.animate(dt, mySpeed);

  // --- Tell everyone where we are ---
  sendTimer += dt;
  heartbeatTimer += dt;
  if (sendTimer >= SEND_INTERVAL) {
    sendTimer = 0;
    const ry = me.model.root.rotation.y;
    if (mePos.x !== lastSent.x || mePos.z !== lastSent.z || ry !== lastSent.ry || heartbeatTimer >= HEARTBEAT) {
      stateAction.send(myState());
      lastSent = { x: mePos.x, z: mePos.z, ry };
      heartbeatTimer = 0;
    }
  }

  // --- Other players: slide toward their latest position and animate ---
  const t = 1 - Math.exp(-12 * dt);
  for (const [pid, p] of Object.entries(players)) {
    if (pid === selfId) continue;
    const pos = p.model.root.position;
    prev.copy(pos);
    pos.lerp(p.target, t);
    pos.y = heightAt(pos.x, pos.z);
    p.model.root.rotation.y = lerpAngle(p.model.root.rotation.y, p.targetRy, t);
    const s = Math.hypot(pos.x - prev.x, pos.z - prev.z) / Math.max(dt, 1e-4);
    p.speed += (s - p.speed) * Math.min(1, dt * 10);
    p.model.animate(dt, p.speed < 0.2 ? 0 : p.speed);
  }

  // --- Third-person camera orbiting behind the player ---
  const lookY = mePos.y + CAM_HEIGHT;
  camera.position.set(
    mePos.x + Math.sin(yaw) * Math.cos(pitch) * CAM_DISTANCE,
    lookY + Math.sin(pitch) * CAM_DISTANCE,
    mePos.z + Math.cos(yaw) * Math.cos(pitch) * CAM_DISTANCE
  );
  // don't let the camera go underground on hills
  camera.position.y = Math.max(camera.position.y, heightAt(camera.position.x, camera.position.z) + 0.4);
  camera.lookAt(mePos.x, lookY, mePos.z);

  world.update(mePos);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
