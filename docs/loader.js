// The loading screen: a dark screen with faint static where the loading percentage flashes up
// now and then, like a VHS on-screen display. When loading finishes there's a quick blue flash,
// then it cuts straight into the game.
//
// It's created here instead of in index.html because browsers can reuse a saved index.html for
// up to 10 minutes after an update, while this file is always the newest (see the version tag in
// index.html). No other imports, so it appears as early as possible.

const VHS_BLUE = '#1b1fbf';
const FLASH_MS = 160;          // how long the blue flash lasts

const CSS = `
  #loader {
    position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 22px; padding: 0 16px;
    background: #000; color: #f2f2ff; text-align: center;
    font-family: 'Courier New', Courier, monospace; text-shadow: 2px 0 rgba(255,60,60,0.4), -2px 0 rgba(60,200,255,0.4);
  }
  #loader-text { margin: 0; font-size: clamp(22px, 5vw, 42px); font-weight: normal; letter-spacing: 0.22em; }
  #loader-text:empty { display: none; }
  #loader-track { display: none; }
  #loader-percent { font-size: clamp(28px, 6vw, 56px); letter-spacing: 0.15em; opacity: 0; }
  #loader-percent.show { opacity: 1; }
  #loader-static { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.1; mix-blend-mode: screen; pointer-events: none; }
  #loader.flash { background: ${VHS_BLUE}; }
  #loader.flash > * { visibility: hidden; }
`;

const style = document.createElement('style');
style.textContent = CSS;
document.head.appendChild(style);

// An older saved page may already contain the loading screen; reuse it if so
let root = document.getElementById('loader');
if (!root) {
  root = document.createElement('div');
  root.id = 'loader';
  root.innerHTML = `
    <h1 id="loader-text"></h1>
    <div id="loader-track"><div id="loader-bar"></div></div>
    <div id="loader-percent">0%</div>`;
  document.body.appendChild(root);
}
document.getElementById('loader-text').textContent = ''; // no message (a saved older page may have one)
const percentEl = document.getElementById('loader-percent');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Faint static
const staticCanvas = document.createElement('canvas');
staticCanvas.id = 'loader-static';
staticCanvas.width = 200;
staticCanvas.height = 112;
root.prepend(staticCanvas);
const sctx = staticCanvas.getContext('2d');
const simg = sctx.createImageData(staticCanvas.width, staticCanvas.height);
const spx = new Uint32Array(simg.data.buffer);
function drawStatic() {
  for (let i = 0; i < spx.length; i++) {
    const v = (Math.random() * 255) | 0;
    spx[i] = 0xff000000 | (v << 16) | (v << 8) | v;
  }
  sctx.putImageData(simg, 0, 0);
}
drawStatic();
const staticTimer = reducedMotion ? 0 : setInterval(drawStatic, 50);

// The percentage flashes up for a moment every so often (always shown if motion is reduced)
let flashTimer = 0;
if (reducedMotion) {
  percentEl.classList.add('show');
} else {
  const flashPercent = () => {
    percentEl.classList.add('show');
    setTimeout(() => percentEl.classList.remove('show'), 90 + Math.random() * 140);
    flashTimer = setTimeout(flashPercent, 350 + Math.random() * 650);
  };
  flashTimer = setTimeout(flashPercent, 150);
}

/** @param fraction 0..1 */
export function setLoading(fraction) {
  percentEl.textContent = `${Math.round(fraction * 100)}%`;
}

/** A quick blue flash, then straight into the game. */
export function finishLoading() {
  setLoading(1);
  clearTimeout(flashTimer);
  const end = () => { clearInterval(staticTimer); root.remove(); };
  if (reducedMotion) { end(); return; }
  root.classList.add('flash');
  setTimeout(end, FLASH_MS);
}

/** Shows that loading failed, instead of leaving the screen sitting there forever. */
export function showLoadingError() {
  clearTimeout(flashTimer);
  document.getElementById('loader-text').textContent = 'FAILED TO LOAD';
  percentEl.textContent = 'REFRESH THE PAGE';
  percentEl.classList.add('show');
}
