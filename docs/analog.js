// Analog screen overlay: flickering TV static, faint scanlines and an occasional brightness
// flicker, drawn over the game. It's a small noise image stretched over the screen, so it
// costs almost nothing to draw.

const STATIC_STRENGTH = 0.09;   // how visible the static is (0..1)
const SCANLINES = 0.18;         // how dark the scanlines are (0..1)
const NOISE_FPS = 24;           // how often the static changes, like old video
const NOISE_W = 320, NOISE_H = 180;

export function startAnalogOverlay() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Static: a low-resolution noise image, redrawn a couple of dozen times a second
  const noise = document.createElement('canvas');
  noise.width = NOISE_W;
  noise.height = NOISE_H;
  noise.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;'
    + `opacity:${STATIC_STRENGTH};mix-blend-mode:screen;image-rendering:pixelated;`;
  document.body.appendChild(noise);

  // Scanlines + a slight darkening at the very edges, like an old screen
  const lines = document.createElement('div');
  lines.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;'
    + `background:repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,${SCANLINES}) 3px, rgba(0,0,0,0) 4px),`
    + 'radial-gradient(ellipse at center, rgba(0,0,0,0) 62%, rgba(0,0,0,0.35) 100%);';
  document.body.appendChild(lines);

  const ctx = noise.getContext('2d');
  const img = ctx.createImageData(NOISE_W, NOISE_H);
  const px = new Uint32Array(img.data.buffer);

  function drawNoise() {
    for (let i = 0; i < px.length; i++) {
      const v = (Math.random() * 255) | 0;
      px[i] = 0xff000000 | (v << 16) | (v << 8) | v;   // grey pixel, fully opaque
    }
    // A faint brighter band rolling down the screen, like a bad signal
    const band = Math.floor((performance.now() / 18) % (NOISE_H + 40)) - 20;
    for (let y = Math.max(0, band); y < Math.min(NOISE_H, band + 6); y++) {
      for (let x = 0; x < NOISE_W; x++) {
        const i = y * NOISE_W + x;
        const v = Math.min(255, (px[i] & 0xff) + 70);
        px[i] = 0xff000000 | (v << 16) | (v << 8) | v;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  drawNoise();
  if (reducedMotion) return; // keep a still grain and scanlines, but no flicker

  let last = 0;
  function tick(now) {
    if (now - last >= 1000 / NOISE_FPS) {
      last = now;
      drawNoise();
      // Now and then the static briefly spikes, like the signal dropping out
      noise.style.opacity = (Math.random() < 0.02 ? STATIC_STRENGTH * 2.6 : STATIC_STRENGTH * (0.85 + Math.random() * 0.3)).toFixed(3);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
