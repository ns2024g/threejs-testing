// The loading screen: a VHS blue screen with faint static. When loading finishes it flashes
// lighter blue, then collapses to a thin bright line (like an old CRT switching off) to reveal
// the game.
//
// It's created here instead of in index.html because browsers can reuse a saved index.html for
// up to 10 minutes after an update, while this file is always the newest (see the version tag in
// index.html). No other imports, so it appears as early as possible.

const VHS_BLUE = '#1b1fbf';
const FLASH_BLUE = '#6c66f2';

const CSS = `
  #loader {
    position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 22px; padding: 0 16px;
    background: ${VHS_BLUE}; color: #f2f2ff; text-align: center;
    font-family: 'Courier New', Courier, monospace; text-shadow: 2px 0 rgba(255,60,60,0.35), -2px 0 rgba(60,200,255,0.35);
    animation: vhs-hum 2.4s infinite;
  }
  @keyframes vhs-hum { 0%, 100% { filter: brightness(1); } 47% { filter: brightness(1.06); } 50% { filter: brightness(0.94); } }
  #loader > * { transition: opacity 0.1s; }
  #loader-text { margin: 0; font-size: clamp(22px, 5vw, 42px); font-weight: normal; letter-spacing: 0.22em; }
  #loader-text:empty { display: none; }
  #loader-track { width: min(420px, 80vw); height: 14px; padding: 3px; border: 2px solid #f2f2ff; box-sizing: border-box; }
  #loader-bar { width: 0; height: 100%; background: #f2f2ff; transition: width 0.2s steps(6); }
  #loader-percent { font-size: 18px; letter-spacing: 0.3em; }
  #loader-static { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.13; mix-blend-mode: screen; pointer-events: none; }

  /* The ending: flash lighter blue, collapse to a line, fade */
  #loader::before {
    content: ''; position: absolute; inset: 0; background: ${FLASH_BLUE}; opacity: 0; pointer-events: none;
    transition: transform 0.24s cubic-bezier(0.6, 0, 0.9, 0.4), background 0.12s;
  }
  #loader.flash > * { opacity: 0; }
  #loader.flash::before { opacity: 1; }
  #loader.collapse { background: transparent; }
  #loader.collapse::before { transform: scaleY(0.004); background: #eeeeff; box-shadow: 0 0 18px #c8c8ff; }
  #loader.done { opacity: 0; transition: opacity 0.3s; pointer-events: none; }
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
const bar = document.getElementById('loader-bar');
const percentEl = document.getElementById('loader-percent');

// Faint static over the blue screen
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

/** @param fraction 0..1 */
export function setLoading(fraction) {
  const percent = Math.round(fraction * 100);
  bar.style.width = `${percent}%`;
  percentEl.textContent = `${percent}%`;
}

/** Flash, collapse to a line like a CRT switching off, then reveal the game. */
export function finishLoading() {
  setLoading(1);
  const end = () => { clearInterval(staticTimer); root.remove(); };
  if (reducedMotion) {
    root.classList.add('done');
    setTimeout(end, 400);
    return;
  }
  root.classList.add('flash');
  setTimeout(() => root.classList.add('collapse'), 130);
  setTimeout(() => root.classList.add('done'), 420);
  setTimeout(end, 800);
}

/** Shows that loading failed, instead of leaving the bar sitting there forever. */
export function showLoadingError() {
  document.getElementById('loader-text').textContent = 'FAILED TO LOAD';
  percentEl.textContent = 'REFRESH THE PAGE';
}
