// All the game's sound, generated live with the Web Audio API (no sound files):
// wind + drone ambience, heartbeat and static that grow as the creature gets close, your
// footsteps, the creature's footsteps (positional), tape hums (positional), whispers,
// stings and the jumpscare scream.
//
// Browsers only allow sound after the player clicks, so call start() from a click.

export function createAudio() {
  let ctx = null;
  let master, staticGain, windFilter, noiseBuffer;
  let volume = 0.6;
  let threat = 0;
  let heartTimer = 0;
  const hums = new Set();

  function start() {
    if (ctx) { ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    // Two seconds of white noise, reused by everything noisy
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Wind: filtered noise whose brightness slowly wanders
    const wind = loopNoise();
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 380;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.09;
    wind.connect(windFilter).connect(windGain).connect(master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 220;
    lfo.connect(lfoAmt).connect(windFilter.frequency);
    lfo.start();

    // Drone: two slightly out-of-tune low tones beating against each other
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 160;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    droneFilter.connect(droneGain).connect(master);
    for (const f of [41.2, 41.9, 61.7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(droneFilter);
      o.start();
    }

    // Static: high hiss, silent until the creature is near
    const hiss = loopNoise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    staticGain = ctx.createGain();
    staticGain.gain.value = 0;
    hiss.connect(hp).connect(staticGain).connect(master);

    for (const h of hums) h.build();
  }

  function loopNoise() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.start();
    return src;
  }

  // A short burst of filtered noise (footsteps, thuds, clicks)
  function burst({ freq = 800, q = 1, type = 'lowpass', gain = 0.1, decay = 0.1, at = null, delay = 0 } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.6 + Math.random() * 0.8;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g);
    if (at) {
      const p = panner(at);
      g.connect(p);
      setTimeout(() => { g.disconnect(); p.disconnect(); }, (delay + decay + 0.3) * 1000);
    } else {
      g.connect(master);
    }
    src.start(t, Math.random() * 1.5, decay + 0.05);
  }

  function panner({ x, y, z }) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2;
    p.rolloffFactor = 1.4;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    p.connect(master);
    return p;
  }

  function thump(strength) {
    if (!ctx) return;
    for (const [delay, s] of [[0, 1], [0.16, 0.7]]) {
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(32, t + 0.15);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 * strength * s, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.25);
    }
  }

  return {
    start,
    setVolume(v) { volume = v; if (master) master.gain.value = v; },

    /** 0 = safe, 1 = it's right on top of you. Drives heartbeat + static. */
    setThreat(v) { threat = v; },

    update(dt, listener) {
      if (!ctx) return;
      // Ears follow the camera
      const L = ctx.listener;
      const fwd = listener.forward, up = listener.up, p = listener.position;
      if (L.positionX) {
        L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
        L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
        L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
      } else {
        L.setPosition(p.x, p.y, p.z);
        L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
      }
      staticGain.gain.value = threat * threat * 0.16;
      // Heartbeat speeds up and gets louder as it gets closer
      if (threat > 0.08) {
        heartTimer -= dt;
        if (heartTimer <= 0) {
          thump(0.25 + threat * 0.75);
          heartTimer = 1.3 - threat * 0.85;
        }
      }
    },

    /** Your own footstep, but out there in the dark (the creature walking your path) */
    echoStep(at, speed = 1.6) { burst({ freq: 500 + speed * 80, gain: 0.5 + speed * 0.06, decay: 0.11, at }); burst({ freq: 140, q: 1.5, gain: 0.35, decay: 0.16, at }); },
    footstep(speed) { burst({ freq: 500 + speed * 80, gain: 0.04 + speed * 0.008, decay: 0.09 }); },
    creatureStep(at) { burst({ freq: 260, q: 2, gain: 0.7, decay: 0.22, at }); burst({ freq: 1800, type: 'bandpass', q: 6, gain: 0.25, decay: 0.05, at, delay: 0.02 }); },
    click() { burst({ freq: 3000, type: 'bandpass', q: 8, gain: 0.25, decay: 0.03 }); },
    staticBurst(len = 0.6) { burst({ freq: 3000, type: 'highpass', gain: 0.35, decay: len }); },

    whisper(at) {
      if (!ctx) return;
      for (let i = 0; i < 6; i++) burst({ freq: 900 + Math.random() * 2400, type: 'bandpass', q: 9, gain: 0.5, decay: 0.12 + Math.random() * 0.2, at, delay: i * 0.13 + Math.random() * 0.06 });
    },

    /** A dissonant sting: something just happened */
    sting() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      g.connect(master);
      for (const f of [311, 329.6, 466, 622]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * (0.995 + Math.random() * 0.01);
        o.connect(g);
        o.start(t);
        o.stop(t + 2.3);
      }
      burst({ freq: 4000, type: 'highpass', gain: 0.2, decay: 1.2 });
    },

    /** The jumpscare scream: a distorted screeching sweep plus noise */
    scream() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
      shaper.curve = curve;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55, t + 0.03);
      g.gain.setValueAtTime(0.55, t + 1.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      shaper.connect(g).connect(master);
      for (const [f0, f1] of [[320, 880], [333, 940], [160, 470]]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + 0.35);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.4, t + 1.6);
        o.connect(shaper);
        o.start(t);
        o.stop(t + 1.7);
      }
      burst({ freq: 2500, type: 'bandpass', q: 0.7, gain: 0.6, decay: 1.5 });
    },

    tapeClunk() { burst({ freq: 400, gain: 0.35, decay: 0.12 }); burst({ freq: 2500, type: 'bandpass', q: 5, gain: 0.2, decay: 0.04, delay: 0.08 }); },

    /** A tape's hum, positioned in the world. Returns { stop() }. */
    addHum(x, y, z) {
      const hum = {
        nodes: null,
        build() {
          if (!ctx || this.nodes) return;
          const p = panner({ x, y, z });
          p.refDistance = 4;       // audible from much further away
          p.rolloffFactor = 1.1;
          const g = ctx.createGain();
          g.gain.value = 0.22;
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = 58;
          const o2 = ctx.createOscillator();
          o2.type = 'sine';
          o2.frequency.value = 117.3;
          const wobble = ctx.createOscillator();
          wobble.frequency.value = 0.4 + Math.random() * 0.3;
          const wobbleAmt = ctx.createGain();
          wobbleAmt.gain.value = 0.08;
          wobble.connect(wobbleAmt).connect(g.gain);
          o.connect(g); o2.connect(g); g.connect(p);
          o.start(); o2.start(); wobble.start();
          this.nodes = [o, o2, wobble, g, p];
        },
        stop() {
          hums.delete(hum);
          if (this.nodes) { for (const n of this.nodes) { try { n.stop?.(); } catch {} n.disconnect(); } this.nodes = null; }
        },
      };
      hums.add(hum);
      hum.build();
      return hum;
    },
  };
}
