// The loading screen. It's created here instead of in index.html because browsers can reuse a
// saved index.html for up to 10 minutes after an update, while this file is always the newest
// (see the version tag in index.html). No other imports, so it appears as early as possible.

const CSS = `
  #loader {
    position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 28px; padding: 0 16px;
    background: radial-gradient(circle, #140404 0%, #000 65%);
    color: #b3b0a8; font-family: Georgia, 'Times New Roman', serif; text-align: center;
    transition: opacity 0.8s ease;
  }
  #loader.done { opacity: 0; pointer-events: none; }
  #loader-text {
    margin: 0; font-size: clamp(22px, 5vw, 42px); font-weight: normal; letter-spacing: 0.22em;
    animation: flicker 3.7s infinite;
  }
  #loader-track { width: min(420px, 80vw); height: 3px; background: #1d1212; }
  #loader-bar { width: 0; height: 100%; background: #9c0f0f; box-shadow: 0 0 10px #c01212; transition: width 0.2s linear; }
  #loader-percent { font-size: 13px; letter-spacing: 0.3em; color: #6d6a64; }
  @keyframes flicker {
    0%, 7%, 9%, 46%, 49%, 52%, 83%, 100% { opacity: 0.9; }
    8%, 47%, 51%, 84% { opacity: 0.12; }
  }
  @media (prefers-reduced-motion: reduce) { #loader-text { animation: none; } }
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
    <h1 id="loader-text">IT KNOWS YOU'RE HERE</h1>
    <div id="loader-track"><div id="loader-bar"></div></div>
    <div id="loader-percent">0%</div>`;
  document.body.appendChild(root);
}
const bar = document.getElementById('loader-bar');
const percentEl = document.getElementById('loader-percent');

/** @param fraction 0..1 */
export function setLoading(fraction) {
  const percent = Math.round(fraction * 100);
  bar.style.width = `${percent}%`;
  percentEl.textContent = `${percent}%`;
}

/** Fades the loading screen out to reveal the game. */
export function finishLoading() {
  setLoading(1);
  root.classList.add('done');
  setTimeout(() => root.remove(), 900);
}

/** Shows that loading failed, instead of leaving the bar sitting there forever. */
export function showLoadingError() {
  document.getElementById('loader-text').textContent = 'FAILED TO LOAD';
  percentEl.textContent = 'REFRESH THE PAGE';
}
