// Pause menu, shown on the TV screen when you press Esc (which also frees the mouse).
// Main page: Resume, Settings, Copy invite link. Settings are adjusted with < > arrows
// (or by clicking a bar), apply straight away and are remembered in this browser.

const STORAGE_KEY = 'threejs-testing-settings';

const CSS = `
  #pause {
    position: fixed; z-index: 8; display: none; flex-direction: column; align-items: center; justify-content: center;
    left: calc(3.5vw + 6px); right: calc(3.5vw + 6px); top: calc(3.5vh + 6px); bottom: calc(3.5vh + 6px);
    border-radius: 4.5vmin; background: rgba(3, 5, 3, 0.74);
    font-family: "Press Start 2P", "Courier New", monospace; text-transform: uppercase; color: #cfd2c4;
    text-shadow: 2px 2px 0 #000, 1px 0 rgba(255, 60, 60, 0.35), -1px 0 rgba(60, 200, 255, 0.35);
    letter-spacing: 0; user-select: none;
  }
  #pause.open { display: flex; }
  #pause h2 { margin: 0 0 4vh; font-size: 24px; font-weight: normal; }
  #pause .page { display: none; flex-direction: column; align-items: stretch; gap: 1.6vh; min-width: min(520px, 82vw); }
  #pause .page.show { display: flex; }
  #pause button {
    all: unset; cursor: pointer; padding: 0.6vh 0 0.6vh 2em; position: relative;
    font-size: 16px; line-height: 1.4; color: #9fa392;
  }
  #pause button:hover, #pause button:focus-visible { color: #f0f2e4; }
  #pause button:hover::before, #pause button:focus-visible::before { content: '▶'; position: absolute; left: 0; }
  #pause .row { display: flex; align-items: center; justify-content: space-between; gap: 1em; font-size: 8px; line-height: 1.6; }
  #pause .row .ctrl { display: flex; align-items: center; gap: 0.5em; }
  #pause .row button { padding: 0 0.4em; font-size: 8px; }
  #pause .row button::before { content: none !important; }
  #pause .bar { cursor: pointer; letter-spacing: 0; color: #cfd2c4; }
  #pause .value { min-width: 3.5em; text-align: right; color: #f0f2e4; }
  #pause .note { margin-top: 3vh; min-height: 1.2em; font-size: 8px; color: #8e9282; text-align: center; }
`;

/**
 * @param defs       [{ key, label, min, max, step, format? }] the adjustable settings
 * @param defaults   { key: value }
 * @param onChange   (settings) => void, called whenever a setting changes (and once at start)
 * @param onResume   () => void, called when Resume is clicked (should re-grab the mouse)
 */
export function createPauseMenu({ defs, defaults, onChange, onResume }) {
  // Load saved settings (browser storage can be unavailable, e.g. in private windows)
  const settings = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const d of defs) if (typeof saved[d.key] === 'number') settings[d.key] = clamp(saved[d.key], d.min, d.max);
  } catch {}
  const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {} };

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'pause';
  root.innerHTML = `
    <h2>Paused</h2>
    <div class="page show" data-page="main">
      <button data-act="resume">Resume</button>
      <button data-act="settings">Settings</button>
      <button data-act="invite">Copy invite link</button>
    </div>
    <div class="page" data-page="settings"></div>
    <div class="note"></div>`;
  document.body.appendChild(root);
  const note = root.querySelector('.note');
  const settingsPage = root.querySelector('[data-page=settings]');

  // One row per setting: LABEL   < ▮▮▮▮▯▯ >  VALUE
  const SEGMENTS = 10;
  const rows = defs.map((d) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${d.label}</span><span class="ctrl"><button aria-label="Lower ${d.label}">&lt;</button>`
      + `<span class="bar"></span><button aria-label="Raise ${d.label}">&gt;</button><span class="value"></span></span>`;
    const [down, up] = row.querySelectorAll('button');
    const bar = row.querySelector('.bar'), value = row.querySelector('.value');
    const set = (v) => {
      settings[d.key] = clamp(Math.round(v / d.step) * d.step, d.min, d.max);
      render();
      save();
      onChange(settings);
    };
    const render = () => {
      const v = settings[d.key];
      const filled = Math.round(((v - d.min) / (d.max - d.min)) * SEGMENTS);
      bar.textContent = '▮'.repeat(filled) + '▯'.repeat(SEGMENTS - filled);
      value.textContent = d.format ? d.format(v) : String(v);
    };
    down.onclick = () => set(settings[d.key] - d.step);
    up.onclick = () => set(settings[d.key] + d.step);
    bar.onclick = (e) => {
      const r = bar.getBoundingClientRect();
      set(d.min + ((e.clientX - r.left) / r.width) * (d.max - d.min));
    };
    render();
    settingsPage.appendChild(row);
    return { render };
  });
  const back = document.createElement('button');
  back.textContent = 'Back';
  back.dataset.act = 'back';
  back.style.marginTop = '1.5vh';
  settingsPage.appendChild(back);

  const show = (page) => {
    for (const p of root.querySelectorAll('.page')) p.classList.toggle('show', p.dataset.page === page);
    note.textContent = '';
  };

  root.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act;
    if (act === 'resume') onResume();
    else if (act === 'settings') show('settings');
    else if (act === 'back') show('main');
    else if (act === 'invite') {
      const link = location.origin + location.pathname;
      try { await navigator.clipboard.writeText(link); note.textContent = 'Link copied — send it to a friend'; }
      catch { note.textContent = link; }
    }
  });

  onChange(settings);

  return {
    settings,
    get isOpen() { return root.classList.contains('open'); },
    open() { show('main'); root.classList.add('open'); },
    close() { root.classList.remove('open'); },
    /** Esc inside the menu: settings -> main page */
    back() { show('main'); },
    message(text) { note.textContent = text; },
  };
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
