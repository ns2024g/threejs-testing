import * as THREE from 'three';

// ---------- Settings ----------
const PLATFORM_SIZE = 100;     // width/depth of the platform
const PLAYER_RADIUS = 0.5;
const MOVE_SPEED = 8;          // units per second
const CAM_DISTANCE = 8;        // how far the camera sits behind the player
const MOUSE_SENSITIVITY = 0.0025;
const LIMIT = PLATFORM_SIZE / 2 - PLAYER_RADIUS;

// ---------- Renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec9ff);
scene.fog = new THREE.Fog(0x9ec9ff, 60, 160);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60 });
scene.add(sun);

// ---------- White platform ----------
const platform = new THREE.Mesh(
  new THREE.BoxGeometry(PLATFORM_SIZE, 1, PLATFORM_SIZE),
  new THREE.MeshStandardMaterial({ color: 0xffffff })
);
platform.position.y = -0.5; // top surface at y = 0
platform.receiveShadow = true;
scene.add(platform);

// Faint grid so you can tell you're moving
const grid = new THREE.GridHelper(PLATFORM_SIZE, 50, 0xd0d0d0, 0xe0e0e0);
grid.position.y = 0.01;
scene.add(grid);

// ---------- Player ----------
const player = new THREE.Mesh(
  new THREE.SphereGeometry(PLAYER_RADIUS, 32, 16),
  new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
);
player.position.set(0, PLAYER_RADIUS, 0);
player.castShadow = true;
scene.add(player);

// ---------- Input ----------
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let yaw = 0;      // camera angle around the player
let pitch = 0.35; // camera angle above the ground

renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * MOUSE_SENSITIVITY;
  pitch = THREE.MathUtils.clamp(pitch + e.movementY * MOUSE_SENSITIVITY, 0.05, 1.3);
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

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);

  // WASD moves relative to the way the camera is facing
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  moveDir.set(0, 0, 0);
  if (keys.KeyW) moveDir.add(forward);
  if (keys.KeyS) moveDir.sub(forward);
  if (keys.KeyD) moveDir.add(right);
  if (keys.KeyA) moveDir.sub(right);

  if (moveDir.lengthSq() > 0) {
    moveDir.normalize().multiplyScalar(MOVE_SPEED * dt);
    player.position.x = THREE.MathUtils.clamp(player.position.x + moveDir.x, -LIMIT, LIMIT);
    player.position.z = THREE.MathUtils.clamp(player.position.z + moveDir.z, -LIMIT, LIMIT);
  }

  // Third-person camera orbiting behind the player
  const p = player.position;
  camera.position.set(
    p.x + Math.sin(yaw) * Math.cos(pitch) * CAM_DISTANCE,
    p.y + Math.sin(pitch) * CAM_DISTANCE,
    p.z + Math.cos(yaw) * Math.cos(pitch) * CAM_DISTANCE
  );
  camera.lookAt(p.x, p.y + 0.5, p.z);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
