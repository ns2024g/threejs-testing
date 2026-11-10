// FIVE TAPES — the game itself.
//
// IT REPLAYS YOU. Everything you do is being recorded, and the thing in the woods is the
// playback: it walks exactly where you walked, at exactly the speed you walked, a number of
// seconds behind you (the timecode in the corner). Run, and later it runs. Stand still, and
// the recording catches up with the present. Turn back the way you came and you walk into it.
// Every building is a dead end: take the tape and leave by a different way than you came in.
// If it gets close enough to SEE you, it stops replaying and comes straight at you on all
// fours — sprint and break the line, and it falls back into the recording.
//
// Five VHS tapes hum in the ruins. Carry them one at a time to the altar and play them. Each
// tape played REWINDS it 15 seconds further behind you, but makes the world worse and the
// recording catch up faster. Play all five to finish the tape.
//
// Multiplayer: it replays one player at a time (the "victim"). Everyone records everyone's
// path, so whichever player runs the creature (the "host": the first active id) can take over
// seamlessly. When it catches someone it moves on to somebody else's recording.
import * as THREE from 'three';

const TAPE_COUNT = 5;
const CATCH_RANGE = 1.1;       // metres
const WAKE_AFTER = 40;         // seconds before it starts, if nobody touches a tape
const START_DELAY = 30;        // seconds behind its victim when it starts (-3 per tape played)
const REWIND = 15;             // seconds of rewind per tape played
const REWIND_TIME = 1.4;       // how long the rewind takes to watch
const CHARGE_RANGE = 6.5;      // it sees you: leaves the recording and comes straight at you
const LOSE_RANGE = 12;         // ...until you get this far away
const TRAIL_KEEP = 240;        // seconds of everyone's path kept
const SAMPLE = 0.1;            // path sample interval

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
    #h-tc { right: calc(3.5vw + 26px); bottom: calc(3.5vh + 24px); text-align: right; font-size: 12px; line-height: 20px; }
    #h-tc .big { font-size: 16px; }
    #h-black { position: fixed; inset: 0; background: #000; z-index: 7; display: none; pointer-events: none; }
    #h-blue { position: fixed; inset: 0; background: #1b1fbf; z-index: 9; display: none; pointer-events: none;
      align-items: center; justify-content: center; flex-direction: column; gap: 24px; color: #f2f2ff;
      font-family: "Press Start 2P", monospace; font-size: 16px; text-align: center; }
    #h-rw { position: fixed; inset: 0; z-index: 6; pointer-events: none; display: none;
      background: repeating-linear-gradient(0deg, rgba(255,255,255,0.0) 0 9px, rgba(230,230,255,0.18) 9px 12px, rgba(255,255,255,0) 12px 23px);
      animation: h-roll 0.18s linear infinite; }
    @keyframes h-roll { from { background-position: 0 0; } to { background-position: 0 23px; } }
  `;
  document.head.appendChild(css);
  const el = (tag, id, cls = 'h-ui') => { const e = document.createElement(tag); e.id = id; e.className = cls; document.body.appendChild(e); return e; };
  const bottom = el('div', 'h-bottom');
  bottom.innerHTML = '<div id="h-tapes"></div><div id="h-prompt"></div>';
  const tapesText = bottom.querySelector('#h-tapes');
  const promptText = bottom.querySelector('#h-prompt');
  const black = el('div', 'h-black', '');
  const rwLines = el('div', 'h-rw', '');
  const center = el('div', 'h-center');
  const rec = el('div', 'h-rec');
  const tc = el('div', 'h-tc');
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
  function makeTapeMesh(withGlow = false) {
    const g = new THREE.Group();
    g.scale.setScalar(1.8);   // a bit oversized so it reads at low resolution
    if (withGlow) {
      // A dim red pulse lighting up the room around it: look for it through doorways
      const glow = new THREE.PointLight(0xff2a1a, 3, 9, 1.6);
      glow.position.y = 0.25;
      g.add(glow);
      g.userData.glow = glow;
    }
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
    const mesh = makeTapeMesh(true);
    scene.add(mesh);
    return { id, home: { ...s }, state: 'ground', x: s.x, z: s.z, holder: null, mesh, hum: null, slot: -1 };
  });
  // The tape you're carrying sits in the corner of your view
  const heldMesh = makeTapeMesh();
  heldMesh.scale.setScalar(1);
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

  // ---------- The recording: everybody's path ----------
  let clock = 0, sampleT = 0;
  const trails = {};            // player id -> [{ t, x, z }]
  const posOf = (pid) => (pid === selfId ? mePos : players[pid]?.model.root.position);
  function recordTrails(dt) {
    clock += dt;
    sampleT -= dt;
    if (sampleT > 0) return;
    sampleT = SAMPLE;
    for (const pid of Object.keys(players)) {
      const p = posOf(pid);
      if (!p) continue;
      let tr = trails[pid];
      const last = tr && tr[tr.length - 1];
      // A jump (respawn, teleport) starts a brand-new recording
      if (!tr || (last && Math.hypot(p.x - last.x, p.z - last.z) > 6)) tr = trails[pid] = [];
      tr.push({ t: clock, x: p.x, z: p.z });
      while (tr.length > 2 && tr[0].t < clock - TRAIL_KEEP) tr.shift();
    }
    for (const pid of Object.keys(trails)) if (!players[pid]) delete trails[pid];
  }
  /** Where the player was at time `t`, or null if the recording doesn't go back that far. */
  function trailAt(pid, t) {
    const tr = trails[pid];
    if (!tr || !tr.length || t < tr[0].t) return null;
    if (t >= tr[tr.length - 1].t) return tr[tr.length - 1];
    let lo = 0, hi = tr.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr[m].t <= t) lo = m; else hi = m; }
    const a = tr[lo], b = tr[hi], f = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  }

  // ---------- Creature state ----------
  // v: whose recording it is playing · d: how many seconds behind them it is
  // mode: 'trail' (replaying) | 'charge' (it saw you) · h: hidden (not in the recording yet)
  const cs = {
    x: creature.object.position.x, z: creature.object.position.z, ry: creature.object.rotation.y,
    awake: false, v: null, d: START_DELAY, mode: 'trail', h: false, sp: 0, rw: false,
    rx: 0, rz: 0, rry: 0, rsp: 0,
  };
  cs.rx = cs.x; cs.rz = cs.z; cs.rry = cs.ry;
  const startPos = { x: cs.x, z: cs.z, ry: cs.ry };
  let hostTime = 0, sendTimer = 0, rewindT = 0, holdT = 0, wasAwake = false, wasHidden = false;

  // The host is the first player (by id) who is actually running the game right now. A player
  // whose tab is hidden or frozen stops sending updates, so they can't stall the creature.
  const isActive = (pid) => pid === selfId || (players[pid] && performance.now() - (players[pid].seesAt || 0) < 4000);
  const hostId = () => Object.keys(players).filter(isActive).sort()[0];
  const isHost = () => hostId() === selfId;

  const startDelay = () => Math.max(14, START_DELAY - 3 * placedCount());
  function pickVictim(exclude) {
    const ids = Object.keys(players).filter(isActive);
    const others = ids.filter((id) => id !== exclude);
    const pool = others.length ? others : ids;
    // Whoever is furthest from where it is now (so it doesn't just turn around)
    let best = pool[0], bestD = -1;
    for (const id of pool) {
      const p = posOf(id);
      const d = p ? Math.hypot(p.x - cs.x, p.z - cs.z) : 0;
      if (d > bestD) { bestD = d; best = id; }
    }
    return best;
  }
  function newVictim(exclude) {
    cs.v = pickVictim(exclude);
    cs.d = startDelay();
    cs.mode = 'trail';
    holdT = 4.5;                // long enough for a caught player to respawn
    sendCreature();
  }

  function sendCreature() {
    send({ t: 'c', x: cs.x, z: cs.z, ry: cs.ry, a: cs.awake ? 1 : 0, v: cs.v, d: Math.round(cs.d * 10) / 10,
      ch: cs.mode === 'charge' ? 1 : 0, h: cs.h ? 1 : 0, sp: Math.round(cs.sp * 10) / 10, rw: cs.rw ? 1 : 0 });
  }

  // Host only: move the creature for this frame
  const tmpPos = { x: 0, z: 0 };
  function hostMove(dt) {
    const px = cs.x, pz = cs.z;
    if (!cs.v || !isActive(cs.v)) newVictim();
    const vp = posOf(cs.v);
    const n = placedCount();
    holdT = Math.max(0, holdT - dt);

    if (rewindT > 0) {
      rewindT -= dt;
      cs.d += (REWIND / REWIND_TIME) * dt;
      cs.mode = 'trail';
    } else if (cs.mode === 'trail') {
      cs.d = Math.max(0, cs.d - (0.04 + 0.03 * n) * dt);      // the recording slowly catches up
    }
    cs.d = Math.min(cs.d, TRAIL_KEEP - 10);
    cs.rw = rewindT > 0;

    if (cs.mode === 'trail') {
      const p = holdT > 0 ? null : trailAt(cs.v, clock - cs.d);
      cs.h = !p;
      if (p) { cs.x = p.x; cs.z = p.z; }
      // Close enough to see you: it stops replaying and comes for you
      if (!cs.h && !cs.rw && vp && Math.hypot(vp.x - cs.x, vp.z - cs.z) < CHARGE_RANGE) cs.mode = 'charge';
    } else if (vp) {
      const dx = vp.x - cs.x, dz = vp.z - cs.z, dist = Math.hypot(dx, dz);
      if (dist > LOSE_RANGE) {
        // Lost you: it falls back into the recording, wherever your path is nearest
        const tr = trails[cs.v] || [];
        let bestT = clock - cs.d, bestD = Infinity;
        for (const s of tr) { const e = Math.hypot(s.x - cs.x, s.z - cs.z); if (e < bestD) { bestD = e; bestT = s.t; } }
        cs.d = Math.max(4, clock - bestT);
        cs.mode = 'trail';
      } else {
        const step = Math.min((4.3 + 0.25 * n) * dt, Math.max(0, dist - 0.5));
        tmpPos.x = cs.x + (dx / dist) * step; tmpPos.z = cs.z + (dz / dist) * step;
        collide(tmpPos, 0.35);
        cs.x = tmpPos.x; cs.z = tmpPos.z;
      }
    }

    // Speed and facing come from how it actually moved
    const mx = cs.x - px, mz = cs.z - pz, moved = Math.hypot(mx, mz);
    if (moved > 3) { cs.sp = 0; return; }                         // it just appeared somewhere
    const v = moved / Math.max(dt, 1e-4);
    cs.sp += ((cs.rw ? -v : v) - cs.sp) * Math.min(1, dt * 6);
    if (moved > 0.004) cs.ry = Math.atan2(mx, mz) + (cs.rw ? Math.PI : 0);
    else if (cs.mode === 'charge' && vp) cs.ry = Math.atan2(vp.x - cs.x, vp.z - cs.z);
  }

  // ---------- Death / jumpscare ----------
  let dead = false, jumpT = 0, graceT = 0;
  const scareCam = new THREE.PerspectiveCamera(50, camera.aspect, 0.05, 400);
  const scareLight = new THREE.PointLight(0xd9c9b0, 0, 4, 1.5);     // so you see its face in the dark
  scene.add(scareLight);
  const scareDir = new THREE.Vector3(), scareQ = new THREE.Quaternion(), headW = new THREE.Vector3();
  const lookM = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3();
  let screamed = false, burst2 = false;

  function startJumpscare() {
    dead = true;
    jumpT = 0;
    screamed = false; burst2 = false;
    // Which way it came from (a little in front of you if it was exactly on top of you)
    scareDir.set(cs.rx - mePos.x, 0, cs.rz - mePos.z);
    if (scareDir.lengthSq() < 0.01) scareDir.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);
    scareDir.normalize();
    audio.click();
    send({ t: 'caught' });
    if (isHost() && cs.v === selfId) newVictim(selfId);
    for (const t of tapes) if (t.state === 'carried' && t.holder === selfId) setTape(t, 'ground', mePos.x, mePos.z, null);
    creature.setGait(0);
    creature.setLunge(1);
    creature.setLoom(1);
    creature.setStopMotion(0);
  }

  const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
  function updateJumpscare(dt) {
    jumpT += dt;
    const T = jumpT;
    const eye = camera.position;
    scareCam.aspect = camera.aspect;
    scareCam.position.copy(eye);
    let dist, onGround, lungeAmt, shakeAmt, fov = 50, roll = 0, loomAmt = 0;
    if (T < 0.12) {                     // a dead black frame: the tape skips
      black.style.display = 'block';
      dist = 2.4; onGround = 1; lungeAmt = 1; shakeAmt = 0; loomAmt = 1;
    } else if (T < 0.42) {              // freeze-frame: it's standing right there, arms wide, still
      black.style.display = 'none';
      dist = 2.4; onGround = 1; lungeAmt = 1; shakeAmt = 0; loomAmt = 1;
      creature.setStopMotion(0.01);     // literally frozen
      if (!burst2) { audio.staticBurst(0.25); burst2 = true; }
    } else if (T < 1.75) {              // it SLAMS into your face and screams, shaking
      if (!screamed) { audio.scream(); screamed = true; creature.scream(); creature.setStopMotion(0); }
      const k = easeOutExpo((T - 0.42) / 0.16);
      dist = 2.4 + (0.42 - 2.4) * k + Math.sin(T * 47) * 0.025;
      loomAmt = 1 - k;
      onGround = 1 - k; lungeAmt = 1; shakeAmt = 1;
      fov = 50 - 8 * k + (Math.random() - 0.5) * 3;
      roll = (Math.random() - 0.5) * 0.12 * k;
    } else if (T < 1.95) {              // and lunges straight through you
      if (burst2) { audio.staticBurst(1.6); burst2 = false; }
      const k = (T - 1.75) / 0.2;
      dist = 0.42 - 0.95 * k * k; onGround = 0; lungeAmt = 1; shakeAmt = 1; fov = 42 + 30 * k;
      roll = (Math.random() - 0.5) * 0.25;
    } else if (T < 3.6) {
      black.style.display = 'block';
      if (center.textContent !== 'SIGNAL LOST') say('SIGNAL LOST', 1.6);
      creature.setLunge(0); creature.setShake(0); creature.setLoom(0);
      scareLight.intensity = 0;
      return;
    } else {
      black.style.display = 'none';
      dead = false;
      graceT = 5;
      creature.setStopMotion(9);
      mePos.set(SPAWN.x + (Math.random() - 0.5) * 6, heightAt(SPAWN.x, SPAWN.z), SPAWN.z + (Math.random() - 0.5) * 4);
      onRespawn();
      return;
    }
    creature.setLunge(lungeAmt);
    creature.setShake(shakeAmt);
    creature.setLoom(loomAmt);
    // Put it `dist` metres in front of you, facing you. Standing on the ground at first
    // (towering over you), then bent down so its face is level with yours.
    const obj = creature.object;
    const fx = eye.x + scareDir.x * dist, fz = eye.z + scareDir.z * dist;
    obj.position.set(fx, heightAt(fx, fz), fz);
    obj.rotation.y = Math.atan2(-scareDir.x, -scareDir.z);
    obj.updateMatrixWorld(true);
    creature.bones.head.localToWorld(headW.set(0, -0.02, 0.1));   // its eyes and teeth
    const faceY = eye.y;
    obj.position.x += (eye.x + scareDir.x * dist - headW.x);
    obj.position.z += (eye.z + scareDir.z * dist - headW.z);
    obj.position.y += (faceY - headW.y) * (1 - onGround);
    obj.visible = true;
    // The camera snaps to its face once, then holds (so it can go straight through you)
    if (T < 0.42 || jumpT - dt < 0.42) {
      obj.updateMatrixWorld(true);
      creature.bones.head.localToWorld(headW.set(0, -0.02, 0.1));
      lookM.lookAt(eye, headW, up);
      scareQ.setFromRotationMatrix(lookM);
    }
    scareCam.quaternion.copy(scareQ);
    scareCam.rotateZ(roll);
    scareCam.fov = fov;
    scareCam.updateProjectionMatrix();
    // A flickering light on its face
    tmpV.set(0.05, -0.3, -0.12).applyQuaternion(scareQ).add(eye);       // from below: shadows in its eye sockets
    scareLight.position.copy(tmpV);
    scareLight.intensity = T < 0.12 ? 0 : (Math.random() < 0.2 ? 0.3 : 1.6);
  }

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
    if (n >= TAPE_COUNT) { ending = true; endT = 0; say('', 0); return; }
    if (isHost()) {
      if (!cs.awake) { cs.awake = true; if (!cs.v) newVictim(); }
      rewindT = REWIND_TIME;
      sendCreature();
    }
    const lines = ['', 'IT FOLLOWS YOUR STEPS', 'IT LEARNS FASTER', 'IT IS CATCHING UP', 'ONE MORE'];
    say(`TAPE ${n} PLAYED · REWIND ${REWIND}S · ${lines[n] || ''}`, 4);
  }

  function wake() {
    if (cs.awake || !isHost()) return;
    cs.awake = true;
    newVictim();
  }

  function resetGame() {
    for (const t of tapes) { t.x = t.home.x; t.z = t.home.z; t.state = 'ground'; t.holder = null; t.slot = -1; applyTape(t); }
    cs.x = startPos.x; cs.z = startPos.z; cs.ry = startPos.ry; cs.awake = false; cs.v = null;
    cs.mode = 'trail'; cs.h = false; cs.sp = 0; cs.rw = false; rewindT = 0;
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
  const LIES = ['1 PLAYER ONLINE', 'IT IS BEHIND YOU', 'PLAY -00:01', 'WHY DID YOU COME BACK', 'SIGNAL WEAK', 'YOU ARE BEING RECORDED', 'YOU WALKED HERE BEFORE'];

  function insanityEvent() {
    const roll = Math.random();
    if (roll < 0.3) {
      lightOffT = 0.35 + Math.random() * 0.6;                                     // your light dies
      audio.click();
    } else if (roll < 0.55) {
      statusEl.textContent = LIES[Math.floor(Math.random() * LIES.length)];       // the HUD lies
      setTimeout(refreshStatus, 2200);
    } else if (roll < 0.8) {
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion); // a whisper behind you
      audio.whisper({ x: camera.position.x + back.x * 2, y: camera.position.y, z: camera.position.z + back.z * 2 });
    } else {
      // Your own footsteps, a few metres behind you, when you're standing still
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
      for (let i = 0; i < 4; i++) setTimeout(() => audio.echoStep({ x: mePos.x + back.x * (5 - i), y: mePos.y + 0.1, z: mePos.z + back.z * (5 - i) }, 1.6), i * 520);
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
      if (typeof d.v === 'string' || d.v === null) cs.v = d.v;
      if (Number.isFinite(d.d)) cs.d = THREE.MathUtils.clamp(d.d, 0, TRAIL_KEEP);
      if (Number.isFinite(d.sp)) cs.sp = THREE.MathUtils.clamp(d.sp, -30, 30);
      cs.mode = d.ch ? 'charge' : 'trail';
      cs.h = !!d.h;
      cs.rw = !!d.rw;
    } else if (d.t === 'tape') {
      const t = tapes[d.id];
      if (!t || !['ground', 'carried', 'placed'].includes(d.s) || !Number.isFinite(d.x) || !Number.isFinite(d.z)) return;
      setTape(t, d.s, d.x, d.z, d.s === 'carried' ? peerId : null, false);
      if (d.s === 'carried') wake();
    } else if (d.t === 'caught') {
      if (isHost() && cs.v === peerId) newVictim(peerId);
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

  // Its footsteps: yours, echoed back at you; a heavy four-limbed gallop when it runs
  let distToMe = 99;
  creature.onStep = (q4) => {
    if (dead || cs.h || !creature.object.visible || distToMe > 34) return;
    const at = { x: cs.rx, y: heightAt(cs.rx, cs.rz) + 0.1, z: cs.rz };
    if (q4 > 0.5) audio.creatureStep(at); else audio.echoStep(at, Math.abs(cs.rsp));
  };

  const fmt = (s) => { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  // ---------- Every frame ----------
  let ePrev = false;
  function update(dt, keys, time) {
    const n = placedCount();
    recordTrails(dt);

    // --- Host runs the creature ---
    if (isHost() && !ending) {
      hostTime += dt;
      if (!cs.awake && hostTime > WAKE_AFTER) wake();
      if (cs.awake) hostMove(dt);
      sendTimer -= dt;
      if (sendTimer <= 0) { sendCreature(); sendTimer = 0.1; }
    }

    // --- It starts ---
    if (cs.awake && !wasAwake && !ending) { say('IT IS IN THE RECORDING · DO NOT GO BACK THE WAY YOU CAME', 5); audio.sting(); }
    wasAwake = cs.awake;

    // --- Show the creature where it is (smoothly), unless it's in your face ---
    const hidden = cs.awake && cs.h;
    if (!hidden && wasHidden) {                       // it just appeared: no sliding in from nowhere
      cs.rx = cs.x; cs.rz = cs.z; cs.rry = cs.ry;
      if (Math.hypot(cs.x - mePos.x, cs.z - mePos.z) < 40) audio.staticBurst(0.3);
    }
    wasHidden = hidden;
    const k = 1 - Math.exp(-14 * dt);
    cs.rx += (cs.x - cs.rx) * k;
    cs.rz += (cs.z - cs.rz) * k;
    cs.rry += (((((cs.ry - cs.rry + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI) * Math.min(1, k * 0.7);
    cs.rsp += (cs.sp - cs.rsp) * k;
    if (!dead) {
      creature.object.visible = !hidden;
      creature.object.position.set(cs.rx, heightAt(cs.rx, cs.rz), cs.rz);
      creature.object.rotation.y = cs.rry;
      creature.setGait(cs.awake ? cs.rsp : 0);
      creature.setLunge(0); creature.setShake(0); creature.setLoom(0);
      creature.setStopMotion(Math.abs(cs.rsp) > 3 ? 14 : 9);   // jerky either way, but readable at a sprint
    }
    distToMe = Math.hypot(cs.rx - mePos.x, cs.rz - mePos.z);

    // --- Threat: heartbeat, static, grain ---
    const charging = cs.mode === 'charge';
    const threat = cs.awake && !dead && !hidden ? Math.max(1 - THREE.MathUtils.smoothstep(distToMe, 3, 26), charging ? 0.85 : 0) : 0;
    audio.setThreat(threat);
    hunt.grainBoost = threat * 0.14 + (povT > 0 ? 0.25 : 0) + (dead ? 0.45 : 0) + (cs.rw ? 0.3 : 0);
    rwLines.style.display = cs.rw && !dead ? 'block' : 'none';

    // --- Caught? ---
    graceT = Math.max(0, graceT - dt);
    if (cs.awake && !hidden && !dead && !ending && graceT <= 0 && distToMe < CATCH_RANGE) startJumpscare();
    if (dead) updateJumpscare(dt);

    // --- The timecode: how far behind you it is ---
    if (cs.awake && !ending && !dead) {
      if (cs.v === selfId) {
        const close = cs.d < 8 || charging;
        const blink = Math.sin(time * 9) > 0;
        tc.style.color = close ? '#ff3b2f' : '#cfd2c4';
        tc.innerHTML = cs.rw ? '<div class="big">&lt;&lt; REWIND</div>'
          : charging ? `<div class="big" style="visibility:${blink ? 'visible' : 'hidden'}">IT SEES YOU</div><div>RUN</div>`
          : `<div class="big">PLAY -${fmt(cs.d)}</div><div>${hidden ? 'NOT YET IN THE RECORDING' : 'IT IS WALKING YOUR PATH'}</div>`;
      } else {
        tc.style.color = '#cfd2c4';
        tc.innerHTML = `<div>IT IS REPLAYING</div><div>SOMEONE ELSE</div>`;
      }
    } else tc.innerHTML = '';

    // --- Tapes: LED blink, pick up, play ---
    for (const t of tapes) {
      t.mesh.userData.led.visible = Math.sin(time * 4 + t.id) > 0;
      t.mesh.userData.glow.intensity = t.state === 'ground' ? 6 + 4 * Math.sin(time * 2.2 + t.id) : 0;
    }
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
        } else prompt = 'BRING IT TO THE ALTAR · IT REWINDS IT';
      } else {
        const near = tapes.find((t) => t.state === 'ground' && Math.hypot(mePos.x - t.x, mePos.z - t.z) < 1.4);
        if (near) {
          prompt = '[E] TAKE TAPE';
          if (ePressed) { setTape(near, 'carried', near.x, near.z, selfId); audio.tapeClunk(); wake(); }
        }
      }
    }
    promptText.textContent = prompt;

    // --- Insanity ---
    if (cs.awake && !dead && !ending) {
      insanityTimer -= dt * (1 + n * 0.35);
      if (insanityTimer <= 0) { insanityEvent(); insanityTimer = 18 + Math.random() * 30; }
      povTimer -= dt * (1 + n * 0.3);
      if (povTimer <= 0 && !hidden && distToMe < 55) { povT = 0.9 + Math.random() * 0.5; povTimer = 35 + Math.random() * 45; audio.staticBurst(0.5); }
    }
    lightOffT = Math.max(0, lightOffT - dt);
    hunt.lightFactor = lightOffT > 0 ? (Math.random() < 0.15 ? 0.6 : 0) : 1;

    // Creature's-eye view: "CH 02 ● REC"
    if (dead) {
      hunt.renderCamera = scareCam;
      me.model.setHidden(true);
      rec.style.display = 'none';
    } else if (povT > 0) {
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
    renderCamera: camera,
    lightFactor: 1,
    grainBoost: 0,
    locked: false,
    /** for testing from the console */
    get state() { return { ...cs, clock, trail: trails[selfId]?.length || 0 }; },
  };
  updateTapesText();
  say('FIND THE FIVE TAPES · FOLLOW THE HUM AND THE RED GLOW', 7);
  return hunt;
}
