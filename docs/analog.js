// Film grain over the game: fine moving noise, nothing else. It's a small noise image stretched
// over the screen, so it costs almost nothing to draw.

const GRAIN_STRENGTH = 0.13;    // how visible the grain is (0..1)
const GRAIN_FPS = 24;           // how often the grain changes, like film
const GRAIN_W = 640, GRAIN_H = 360;

export function startAnalogOverlay() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const grain = document.createElement('canvas');
  grain.width = GRAIN_W;
  grain.height = GRAIN_H;
  grain.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;'
    + `opacity:${GRAIN_STRENGTH};mix-blend-mode:screen;`;
  document.body.appendChild(grain);

  const ctx = grain.getContext('2d');
  const img = ctx.createImageData(GRAIN_W, GRAIN_H);
  const px = new Uint32Array(img.data.buffer);
  function draw() {
    for (let i = 0; i < px.length; i++) {
      const v = (Math.random() * 255) | 0;
      px[i] = 0xff000000 | (v << 16) | (v << 8) | v;
    }
    ctx.putImageData(img, 0, 0);
  }

  draw();
  if (reducedMotion) return; // still grain, no flicker

  let last = 0;
  function tick(now) {
    if (now - last >= 1000 / GRAIN_FPS) {
      last = now;
      draw();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
