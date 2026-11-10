// Analog TV overlay: snowy static, bright bands rolling down the screen, broken VHS tracking
// lines that jump around, a dark roll bar sweeping over the picture, and crawling scanlines.
// It's a small noise image stretched over the screen, so it costs almost nothing to draw.

const STATIC_STRENGTH = 0.16;   // how visible the static is (0..1)
const SCANLINES = 0.22;         // how dark the scanlines are (0..1)
const NOISE_FPS = 30;           // how often the static changes
const ROLL_BARS = 3;            // bright bands drifting down the screen
const TRACKING_LINES = 5;       // thin broken lines that jump around
const NOISE_W = 400, NOISE_H = 225;

export function startAnalogOverlay() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = document.createElement('style');
  css.textContent = `
    @keyframes analog-crawl { from { background-position: 0 0; } to { background-position: 0 4px; } }
    @keyframes analog-roll { from { transform: translateY(-40vh); } to { transform: translateY(140vh); } }
  `;
  document.head.appendChild(css);

  // Static + rolling bands + tracking lines, all drawn into one small noise image
  const noise = document.createElement('canvas');
  noise.width = NOISE_W;
  noise.height = NOISE_H;
  noise.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;'
    + `opacity:${STATIC_STRENGTH};mix-blend-mode:screen;image-rendering:pixelated;`;
  document.body.appendChild(noise);

  // Crawling scanlines + slightly darker corners, like an old screen
  const lines = document.createElement('div');
  lines.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;'
    + `background:repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,${SCANLINES}) 3px, rgba(0,0,0,0) 4px);`
    + (reducedMotion ? '' : 'animation:analog-crawl 0.35s linear infinite;');
  document.body.appendChild(lines);
  const corners = document.createElement('div');
  corners.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;'
    + 'background:radial-gradient(ellipse at center, rgba(0,0,0,0) 60%, rgba(0,0,0,0.4) 100%);';
  document.body.appendChild(corners);

  // A wide dark bar that slowly sweeps down the whole picture, like a TV losing sync
  if (!reducedMotion) {
    const roll = document.createElement('div');
    roll.style.cssText = 'position:fixed;left:0;right:0;top:0;height:28vh;pointer-events:none;z-index:5;'
      + 'background:linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.22) 45%, rgba(255,255,255,0.05) 52%, rgba(0,0,0,0));'
      + 'animation:analog-roll 7s linear infinite;';
    document.body.appendChild(roll);
  }

  const ctx = noise.getContext('2d');
  const img = ctx.createImageData(NOISE_W, NOISE_H);
  const px = new Uint32Array(img.data.buffer);
  const rowGain = new Float32Array(NOISE_H);

  const bars = Array.from({ length: ROLL_BARS }, () => ({
    y: Math.random() * NOISE_H, speed: 6 + Math.random() * 22, size: 6 + Math.random() * 18, strength: 0.5 + Math.random() * 0.9,
  }));
  const tracking = Array.from({ length: TRACKING_LINES }, () => ({ y: Math.random() * NOISE_H, speed: 20 + Math.random() * 60 }));

  let lastTime = performance.now();
  function draw(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    // Bright bands drifting down the screen (soft-edged), wrapping back to the top
    rowGain.fill(1);
    for (const b of bars) {
      b.y = (b.y + b.speed * dt) % (NOISE_H + b.size * 2);
      for (let y = 0; y < NOISE_H; y++) {
        const d = (y - (b.y - b.size)) / b.size;
        if (d > -1 && d < 1) rowGain[y] += b.strength * (1 - d * d);
      }
    }

    // Snow: random grey pixels, brighter inside the bands. Pixels are slightly stretched
    // sideways (each value covers 1-3 pixels), which gives the streaky look of real TV static.
    let i = 0;
    for (let y = 0; y < NOISE_H; y++) {
      const g = rowGain[y];
      for (let x = 0; x < NOISE_W;) {
        const v = Math.min(255, Math.random() * 200 * g) | 0;
        const color = 0xff000000 | (v << 16) | (v << 8) | v;
        const run = 1 + ((Math.random() * 3) | 0);
        for (let r = 0; r < run && x < NOISE_W; r++, x++) px[i++] = color;
      }
    }

    // Tracking lines: thin broken white streaks that crawl down and sometimes jump
    for (const t of tracking) {
      t.y += t.speed * dt;
      if (t.y >= NOISE_H || Math.random() < 0.02) t.y = Math.random() * NOISE_H;
      const y = t.y | 0;
      let x = (Math.random() * 40) | 0;
      while (x < NOISE_W) {
        const len = 8 + ((Math.random() * 70) | 0);                // a dash...
        for (let k = 0; k < len && x < NOISE_W; k++, x++) {
          const v = 180 + ((Math.random() * 75) | 0);
          px[y * NOISE_W + x] = 0xff000000 | (v << 16) | (v << 8) | v;
        }
        x += 4 + ((Math.random() * 50) | 0);                          // ...then a gap
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  draw(performance.now());
  if (reducedMotion) return; // keep a still picture, no flicker or movement

  let last = 0;
  function tick(now) {
    if (now - last >= 1000 / NOISE_FPS) {
      last = now;
      draw(now);
      // Now and then the static briefly flares up, like the signal dropping out
      noise.style.opacity = (Math.random() < 0.025 ? STATIC_STRENGTH * 2.4 : STATIC_STRENGTH * (0.85 + Math.random() * 0.3)).toFixed(3);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
