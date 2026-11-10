// FIVE TAPES — the game itself.
//
// Five VHS tapes are hidden in the ruins. Each one hums; follow the sound. Carry them one at a
// time to the altar in the church and play them. Every tape played makes the world worse and
// the creature faster. Play all five to finish the recording.
//
// The creature only moves while NOBODY is looking at it. Your eyes dry out over time and you
// are forced to blink (hold SPACE to close your eyes yourself, so you choose when). While your
// eyes are shut, it moves. You can't see it move — but you can hear it. If it reaches you:
// SIGNAL LOST, you drop your tape and wake up back at the start.
//
// Multiplayer: one player (the "host": whoever's id sorts first) moves the creature and tells
// everyone else; if the host leaves, the next player takes over seamlessly.
import * as THREE from 'three';

const TAPE_COUNT = 5;
const CATCH_RANGE = 1.15;      // metres
const SEE_RANGE = 38;          // it can't be "seen" beyond this (fog)
const BASE_SPEED = 2.6;        // m/s when nobody looks; +0.8 per tape played
const WAKE_AFTER = 80;         // seconds before it starts hunting, if nobody touches a tape
const EYE_DRY_TIME = 15;       // seconds until a forced blink (shorter as tapes are played)
const BLINK_TIME = 0.3;

export function createHunt(o) {
  const {
    scene, camera, creature, me, mePos, players, selfId, send, audio, heightAt, collide,
    ALTAR, TAPE_SPOTS, SPAWN, HALF, lofi, statusEl, refreshStatus, onRespawn,
  } = o;

  // ---------- On-screen UI (inside the TV) ----------
  const css = document.createElement('style');
  css.textContent = `
    .h-ui { position: fixed; z-index: 7; pointer-events: none; font-family: "Press Start 2P", "Courier New", monospace;
      font-size: 8px; line-height: 14px; text-transform: uppercase; color: #cfd2c4; text-shadow: 1px 1px 0 #000; }
    #h-bottom { left: calc(3.5vw + 26px); bottom: calc(3.5vh + 24px); }
    #h-prompt { color: #f0f2e4; }
    #h-center { left: 0; right: 0; top: 46%; text-align: center; font-size: 16px; line-height: 26px; }
    #h-rec { right: calc(3.5vw + 26px); top: calc(3.5vh + 20px); color: #ff3b2f; font-size: 16px; display: none; }
    .h-lid { position: fixed; left: 0; right: 0; height: 0; background: #000; z-index: 5; pointer-events: none; }
    #h-black { position: fixed; inset: 0; background: #000; z-index: 7; display: none; pointer-events: none; }
    #h-blue { position: fixed; inset: 0; background: #1b1fbf; z-index: 9; display: none; pointer-events: none;
      align-items: center; justify-content: center; flex-direction: column; gap: 24px; color: #f2f2ff;
      font-family: "Press Start 2P", monospace; font-size: 16px; text-align: center; }
  `;
  document.head.appendChild(css);
  const el = (tag, id, cls = 'h-ui') => { const e = document.createElement(tag); e.id = id; e.className = cls; document.body.appendChild(e); return e; };
  const bottom = el('div', 'h-bottom');
  bottom.innerHTML = '<div id="h-tapes"></div><div id="h-prompt"></div>';
  const tapesText = bottom.querySelector('#h-tapes');
  const promptText = bottom.querySelector('#h-prompt');
  const lidTop = el('div', 'h-lid-top', 'h-lid'); lidTop.style.top = '0';
  const lidBottom = el('div', 'h-lid-bottom', 'h-lid'); lidBottom.style.bottom = '0';
  const black = el('div', 'h-black', '');
  const center = el('div', 'h-center');
  const rec = el('div', 'h-rec');
  // (the pixel font has no ● character, so the recording dot is drawn as a little square)
  rec.innerHTML = 'CH 02 <span style="display:inline-block;width:12px;height:12px;background:#ff3b2f;vertical-align:1px"></span> REC';
  const blue = el('div', 'h-blue', '');

  let centerTimer = 0;
  function say(text, seconds = 2.5) { center.textContent = text; centerTimer = seconds; }

  // ---------- Tapes ----------
  const tapeGeo = new THREE.BoxGeometry(0.19, 0.03, 0.11);
  const labelGeo = new THREE.BoxGeometry(0.13, 0.032, 0.05);
  const ledGeo = new THREE.BoxGeometry(0.012, 0.012, 0.012);
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.4 });
  const labelMat = new THREE.MeshBasicMaterial({ color: 0xcfc6ad });     // unlit: glints faintly in the dark
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  function makeTapeMesh() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(tapeGeo, tapeMat));
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(-0.01, 0, 0.012);
    g.add(label);
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.set(0.08, 0.018, -0.04);
    g.add(led);
    g.userData.led = led;
    return g;
  }
  const altarTop = () => heightAt(ALTAR.x, ALTAR.z) + 1.09;
  const tapes = TAPE_SPOTS.slice(0, TAPE_COUNT).map((s, id) => {
    const mesh = makeTapeMesh();
    scene.add(mesh);
    return { id, home: { ...s }, state: 'ground', x: s.x, z: s.z, holder: null, mesh, hum: null, slot: -1 };
  });
  // The tape you're carrying sits in the corner of your view
  const heldMesh = makeTapeMesh();
  heldMesh.position.set(0.16, -0.15, -0.42);
  heldMesh.rotation.set(0.6, 0.4, 0.1);
  heldMesh.visible = false;
  camera.add(heldMesh);
  scene.add(camera);

  const placedCount = () => tapes.filter((t) => t.state === 'placed').length;

  function applyTape(t) {
    t.mesh.visible = t.state !== 'carried';
    if (t.state === 'ground') {
      t.mesh.position.set(t.x, heightAt(t.x, t.z) + 0.016, t.z);
      t.mesh.rotation.set(0, t.id * 1.7, 0);
      if (!t.hum) t.hum = audio.addHum(t.x, heightAt(t.x, t.z) + 0.3, t.z);
    } else {
      if (t.hum) { t.hum.stop(); t.hum = null; }
    }
    if (t.state === 'placed') {
      if (t.slot < 0) t.slot = placedCount() - 1;
      t.mesh.position.set(ALTAR.x - 0.8 + t.slot * 0.4, altarTop(), ALTAR.z - 0.1);
      t.mesh.rotation.set(0, 0, 0);
    }
    heldMesh.visible = tapes.some((x) => x.state === 'carried' && x.holder === selfId);
    updateTapesText();
  }
  tapes.forEach(applyTape);

  function updateTapesText() {
    const n = placedCount();
    const holding = tapes.some((t) => t.state === 'carried' && t.holder === selfId);
    tapesText.textContent = `TAPES PLAYED ${n}/${TAPE_COUNT}${holding ? ' · TAPE IN HAND' : ''}`;
  }

  function setTape(t, state, x, z, holder, broadcast = true) {
    const wasPlaced = t.state === 'placed';
    t.state = state;
    t.holder = holder;
    if (x !== undefined) { t.x = x; t.z = z; }
    if (state !== 'placed') t.slot = -1;
    applyTape(t);
    if (broadcast) send({ t: 'tape', id: t.id, s: state, x: t.x, z: t.z });
    if (state === 'placed' && !wasPlaced) onTapePlayed();
  }

  // ---------- Creature state ----------
  const cs = {
    x: creature.object.position.x, z: creature.object.position.z, ry: creature.object.rotation.y,
    awake: false, rx: 0, rz: 0, rry: 0,
  };
  cs.rx = cs.x; cs.rz = cs.z; cs.rry = cs.ry;
  const startPos = { x: cs.x, z: cs.z, ry: cs.ry };
  let hostTime = 0, sendTimer = 0, teleportTimer = 0, stepSoundTimer = 0;
  const lastCreaturePos = new THREE.Vector2(cs.x, cs.z);

  const hostId = () => Object.keys(players).sort()[0];
  const isHost = () => hostId() === selfId;

  // ---------- Seeing ----------
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), chest = new THREE.Vector3();
  let mySees = false;
  function computeSees() {
    if (eyesClosed || dead || ending) return false;
    chest.set(cs.rx, heightAt(cs.rx, cs.rz) + 1.3, cs.rz);
    camera.updateMatrixWorld();
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    return frustum.containsPoint(chest) && chest.distanceTo(camera.position) < SEE_RANGE;
  }
  function anyoneSees() {
    if (mySees) return true;
    const now = performance.now();
    for (const [pid, p] of Object.entries(players)) if (pid !== selfId && p.sees && now - (p.seesAt || 0) < 3000) return true;
    return false;
  }

  // ---------- Eyes ----------
  let dryness = 0, blinkT = 0, eyesClosed = false;

  // ---------- Death / jumpscare ----------
  let dead = false, jumpT = 0;
  let graceT = 0;              // a few safe seconds after respawning
  const jumpPos = new THREE.Vector3();

  function startJumpscare() {
    dead = true;
    jumpT = 0;
    audio.scream();
    send({ t: 'caught' });
    if (isHost()) relocateCreature();
    for (const t of tapes) if (t.state === 'carried' && t.holder === selfId) setTape(t, 'ground', mePos.x, mePos.z, null);
  }

  function relocateCreature() {
    // Somewhere far from every player and from the spawn point, out of sight
    const spots = [...Object.values(players).map((p) => p.model.root.position), SPAWN];
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() * 2 - 1) * (HALF - 15), z = (Math.random() * 2 - 1) * (HALF - 15);
      if (spots.every((p) => Math.hypot(p.x - x, p.z - z) > 40)) { cs.x = x; cs.z = z; break; }
    }
    sendCreature();
  }

  function sendCreature() { send({ t: 'c', x: cs.x, z: cs.z, ry: cs.ry, a: cs.awake ? 1 : 0 }); }

  // ---------- Getting worse ----------
  const baseFog = scene.fog.density;
  const baseTint = lofi.uniforms.tint.value.clone();
  function applyCorruption() {
    const n = placedCount();
    scene.fog.density = baseFog * (1 + 0.14 * n);
    lofi.uniforms.tint.value.copy(baseTint).lerp(new THREE.Vector3(1.08, 0.86, 0.82), n / TAPE_COUNT);
  }
  let ending = false, endT = 0;
  function onTapePlayed() {
    const n = placedCount();
    applyCorruption();
    audio.sting();
    if (!cs.awake && isHost()) { cs.awake = true; sendCreature(); }
    if (n >= TAPE_COUNT) { ending = true; endT = 0; say('', 0); return; }
    const lines = ['', 'IT IS AWAKE', 'IT KNOWS YOUR NAME', 'DO NOT LOOK AWAY', 'ONE MORE'];
    say(`TAPE ${n} PLAYED · ${lines[n] || ''}`, 3.5);
  }

  function resetGame() {
    for (const t of tapes) { t.x = t.home.x; t.z = t.home.z; t.state = 'ground'; t.holder = null; t.slot = -1; applyTape(t); }
    cs.x = startPos.x; cs.z = startPos.z; cs.ry = startPos.ry; cs.awake = false;
    cs.rx = cs.x; cs.rz = cs.z; cs.rry = cs.ry;
    hostTime = 0;
    applyCorruption();
  }

  // ---------- Insanity ----------
  let insanityTimer = 20 + Math.random() * 20;
  let povTimer = 40 + Math.random() * 30, povT = 0;
  let lightOffT = 0;
  const povCam = new THREE.PerspectiveCamera(75, camera.aspect, 0.05, 400);
  const headPos = new THREE.Vector3(), myHead = new THREE.Vector3();
  const LIES = ['1 PLAYER ONLINE', 'IT IS BEHIND YOU', 'DO NOT BLINK', 'WHY DID YOU COME BACK', 'SIGNAL WEAK', 'YOU ARE BEING RECORDED'];

  function insanityEvent() {
    const roll = Math.random();
    if (roll < 0.3) {
      lightOffT = 0.35 + Math.random() * 0.6;                                     // your light dies
      audio.click();
    } else if (roll < 0.6) {
      statusEl.textContent = LIES[Math.floor(Math.random() * LIES.length)];       // the HUD lies
      setTimeout(refreshStatus, 2200);
    } else {
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion); // a whisper behind you
      audio.whisper({ x: camera.position.x + back.x * 2, y: camera.position.y, z: camera.position.z + back.z * 2 });
    }
  }

  // ---------- Events from other players ----------
  function onEvent(d, peerId) {
    if (!d || typeof d.t !== 'string') return;
    if (d.t === 'c' && peerId === hostId()) {
      if ([d.x, d.z, d.ry].every(Number.isFinite)) {
        cs.x = THREE.MathUtils.clamp(d.x, -HALF, HALF); cs.z = THREE.MathUtils.clamp(d.z, -HALF, HALF); cs.ry = d.ry;
      }
      cs.awake = !!d.a;
    } else if (d.t === 'tape') {
      const t = tapes[d.id];
      if (!t || !['ground', 'carried', 'placed'].includes(d.s) || !Number.isFinite(d.x) || !Number.isFinite(d.z)) return;
      setTape(t, d.s, d.x, d.z, d.s === 'carried' ? peerId : null, false);
      if (d.s === 'carried' && isHost() && !cs.awake) { cs.awake = true; sendCreature(); }
    } else if (d.t === 'caught') {
      if (isHost()) relocateCreature();
    } else if (d.t === 'sync' && peerId === hostId() && Array.isArray(d.tapes)) {
      d.tapes.forEach((s, i) => {
        const t = tapes[i];
        if (t && s && ['ground', 'carried', 'placed'].includes(s.s) && Number.isFinite(s.x) && Number.isFinite(s.z)) {
          t.state = s.s; t.x = s.x; t.z = s.z; t.slot = s.s === 'placed' ? (s.slot ?? -1) : -1; applyTape(t);
        }
      });
      applyCorruption();
    }
  }
  function onPeerJoin() {
    if (!isHost()) return;
    send({ t: 'sync', tapes: tapes.map((t) => ({ s: t.state, x: t.x, z: t.z, slot: t.slot })) });
    sendCreature();
  }

  // ---------- Every frame ----------
  let ePrev = false;
  function update(dt, keys, time) {
    const n = placedCount();

    // --- Eyes: dry out, forced blink, or hold SPACE to close them ---
    let closure = 0;
    if (!dead && !ending) {
      if (keys.Space) {
        eyesClosed = true; dryness = 0; closure = 1;
      } else {
        dryness += dt / (EYE_DRY_TIME - n * 1.6);
        if (dryness >= 1 && blinkT <= 0) blinkT = BLINK_TIME;
        if (blinkT > 0) {
          blinkT -= dt;
          closure = Math.sin(Math.PI * (1 - Math.max(0, blinkT) / BLINK_TIME));
          eyesClosed = closure > 0.6;
          if (blinkT <= 0) { dryness = 0; eyesClosed = false; }
        } else {
          eyesClosed = false;
          closure = THREE.MathUtils.smoothstep(dryness, 0.55, 1) * 0.22;           // squinting
        }
      }
    }
    lidTop.style.height = lidBottom.style.height = `${(closure * 50).toFixed(1)}%`;

    // --- Who can see it ---
    mySees = computeSees();

    // --- Host moves the creature (only while unobserved) ---
    if (isHost() && !ending) {
      hostTime += dt;
      if (!cs.awake && hostTime > WAKE_AFTER) { cs.awake = true; sendCreature(); }
      if (cs.awake && !anyoneSees()) {
        let best = null, bestD = Infinity;
        for (const [pid, p] of Object.entries(players)) {
          if (pid === selfId && (dead || graceT > 0)) continue;   // it doesn't hunt you while you respawn
          const pos = p.model.root.position;
          const d = Math.hypot(pos.x - cs.x, pos.z - cs.z);
          if (d < bestD) { bestD = d; best = pos; }
        }
        if (best) {
          const dx = best.x - cs.x, dz = best.z - cs.z;
          const step = Math.min((BASE_SPEED + 0.8 * n) * dt, Math.max(0, bestD - 0.6));
          const pos = { x: cs.x + (dx / bestD) * step, z: cs.z + (dz / bestD) * step };
          collide(pos, 0.35);
          cs.x = pos.x; cs.z = pos.z;
          cs.ry = Math.atan2(dx, dz);
          // Too far away? It closes the distance while nobody's watching
          teleportTimer -= dt;
          if (bestD > 42 && teleportTimer <= 0) {
            const a = Math.random() * Math.PI * 2;
            cs.x = THREE.MathUtils.clamp(best.x + Math.sin(a) * 24, -HALF + 2, HALF - 2);
            cs.z = THREE.MathUtils.clamp(best.z + Math.cos(a) * 24, -HALF + 2, HALF - 2);
            teleportTimer = 8;
          }
        }
      }
      sendTimer -= dt;
      if (sendTimer <= 0) { sendCreature(); sendTimer = 0.1; }
    }

    // --- Show the creature where it is (smoothly), unless it's in your face ---
    const k = 1 - Math.exp(-14 * dt);
    cs.rx += (cs.x - cs.rx) * k;
    cs.rz += (cs.z - cs.rz) * k;
    cs.rry += (((((cs.ry - cs.rry + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI) * k;
    if (!dead) {
      creature.object.position.set(cs.rx, heightAt(cs.rx, cs.rz), cs.rz);
      creature.object.rotation.y = cs.rry;
    }

    // You can't see it move — but you can hear it
    const moved = Math.hypot(cs.rx - lastCreaturePos.x, cs.rz - lastCreaturePos.y);
    lastCreaturePos.set(cs.rx, cs.rz);
    stepSoundTimer -= dt;
    const distToMe = Math.hypot(cs.rx - mePos.x, cs.rz - mePos.z);
    if (moved > 0.01 && moved < 3 && stepSoundTimer <= 0 && distToMe < 28) {
      audio.creatureStep({ x: cs.rx, y: heightAt(cs.rx, cs.rz) + 0.1, z: cs.rz });
      stepSoundTimer = 0.42;
    }

    // --- Threat: heartbeat, static, grain ---
    const threat = cs.awake && !dead ? 1 - THREE.MathUtils.smoothstep(distToMe, 3, 26) : 0;
    audio.setThreat(threat);
    hunt.grainBoost = threat * 0.14 + (povT > 0 ? 0.25 : 0) + (dead ? 0.45 : 0);

    // --- Caught? ---
    graceT = Math.max(0, graceT - dt);
    if (cs.awake && !dead && !ending && graceT <= 0 && distToMe < CATCH_RANGE) startJumpscare();

    // --- Jumpscare + respawn ---
    if (dead) {
      jumpT += dt;
      if (jumpT < 1.3) {
        // It's right in your face, staring
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        jumpPos.copy(camera.position).addScaledVector(fwd, 0.62);
        // (its eyes are about 2 m up, so this puts them level with yours; it shakes violently)
        creature.object.position.set(jumpPos.x, camera.position.y - 2.0 + Math.sin(jumpT * 60) * 0.02, jumpPos.z);
        creature.object.rotation.y = Math.atan2(-fwd.x, -fwd.z);
      } else if (jumpT < 3.4) {
        black.style.display = 'block';
        if (center.textContent !== 'SIGNAL LOST') say('SIGNAL LOST', 2.2);
      } else {
        black.style.display = 'none';
        dead = false;
        dryness = 0;
        graceT = 5;
        if (isHost()) relocateCreature();   // and it's somewhere far away again
        mePos.set(SPAWN.x + (Math.random() - 0.5) * 6, heightAt(SPAWN.x, SPAWN.z), SPAWN.z + (Math.random() - 0.5) * 4);
        onRespawn();
      }
    }

    // --- Tapes: LED blink, pick up, play ---
    for (const t of tapes) t.mesh.userData.led.visible = Math.sin(time * 4 + t.id) > 0;
    heldMesh.userData.led.visible = Math.sin(time * 4) > 0;
    const ePressed = keys.KeyE && !ePrev;
    ePrev = !!keys.KeyE;
    let prompt = '';
    const holding = tapes.find((t) => t.state === 'carried' && t.holder === selfId);
    if (!dead && !ending) {
      if (holding) {
        if (Math.hypot(mePos.x - ALTAR.x, mePos.z - ALTAR.z) < 2.8) {
          prompt = '[E] PLAY TAPE';
          if (ePressed) { setTape(holding, 'placed', ALTAR.x, ALTAR.z, null); audio.tapeClunk(); }
        } else prompt = 'BRING IT TO THE ALTAR';
      } else {
        const near = tapes.find((t) => t.state === 'ground' && Math.hypot(mePos.x - t.x, mePos.z - t.z) < 1.4);
        if (near) {
          prompt = '[E] TAKE TAPE';
          if (ePressed) { setTape(near, 'carried', near.x, near.z, selfId); audio.tapeClunk(); if (isHost() && !cs.awake) { cs.awake = true; sendCreature(); } }
        }
      }
      if (!prompt && dryness > 0.72 && Math.sin(time * 8) > 0) prompt = 'BLINK [SPACE]';
    }
    promptText.textContent = prompt;

    // --- Insanity ---
    if (cs.awake && !dead && !ending) {
      insanityTimer -= dt * (1 + n * 0.35);
      if (insanityTimer <= 0) { insanityEvent(); insanityTimer = 18 + Math.random() * 30; }
      povTimer -= dt * (1 + n * 0.3);
      if (povTimer <= 0 && distToMe < 55) { povT = 0.9 + Math.random() * 0.5; povTimer = 35 + Math.random() * 45; audio.staticBurst(0.5); }
    }
    lightOffT = Math.max(0, lightOffT - dt);
    hunt.lightFactor = lightOffT > 0 ? (Math.random() < 0.15 ? 0.6 : 0) : 1;

    // Creature's-eye view: "CH 02 ● REC"
    if (povT > 0) {
      povT -= dt;
      creature.bones.head.getWorldPosition(headPos);
      me.model.head.getWorldPosition(myHead);
      povCam.aspect = camera.aspect;
      povCam.updateProjectionMatrix();
      // Just in front of its face (not inside its skull), staring at you
      povCam.position.copy(headPos).addScaledVector(myHead.clone().sub(headPos).normalize(), 0.3);
      povCam.lookAt(myHead);
      hunt.renderCamera = povCam;
      me.model.setHidden(false);
      rec.style.display = Math.sin(time * 10) > -0.4 ? 'block' : 'none';
    } else {
      hunt.renderCamera = camera;
      me.model.setHidden(true);
      rec.style.display = 'none';
    }

    // --- The end of the tape ---
    if (ending) {
      endT += dt;
      if (endT > 1.5 && endT < 9) {
        blue.style.display = 'flex';
        blue.innerHTML = endT < 5 ? '<div>END OF TAPE</div>' : '<div>THANK YOU FOR WATCHING</div><div style="font-size:8px">PLAY AGAIN SOON</div>';
      }
      if (endT >= 9) {
        blue.style.display = 'none';
        ending = false;
        resetGame();
        say('A NEW TAPE BEGINS', 3);
      }
    }

    // Messages
    if (centerTimer > 0) { centerTimer -= dt; if (centerTimer <= 0) center.textContent = ''; }
    hunt.locked = dead || ending;
  }

  const hunt = {
    update, onEvent, onPeerJoin,
    get mySees() { return mySees; },
    renderCamera: camera,
    lightFactor: 1,
    grainBoost: 0,
    locked: false,
  };
  updateTapesText();
  say('FIND THE FIVE TAPES · LISTEN FOR THE HUM', 6);
  return hunt;
}
