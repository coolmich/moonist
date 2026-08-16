import { SITES } from '../sites.js';

// All chrome: site picker, time controls, layer toggles, readouts, and the
// orientation aids (in-world compass marks and an off-screen Earth pointer).
// One design language: dark translucent panels, hairline borders, system font,
// tabular numerals, and fixed-width value slots so nothing reflows per frame.

const STYLE = /* css */ `
  .ui { position: absolute; pointer-events: auto; }
  .panel {
    background: rgba(9, 12, 18, 0.66);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 12px;
    backdrop-filter: blur(14px) saturate(1.2);
    -webkit-backdrop-filter: blur(14px) saturate(1.2);
    color: #c9cfd8;
  }
  .btn {
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: #9aa4b2;
    font: 500 12px/1 -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    padding: 7px 10px;
    cursor: pointer;
    white-space: nowrap;
    transition: color 120ms ease, background 120ms ease;
  }
  .btn:hover { color: #e9edf3; background: rgba(255, 255, 255, 0.07); }
  .btn.on { color: #a8ccf5; background: rgba(88, 140, 205, 0.20); }
  .btn:focus-visible { outline: 1px solid rgba(150, 190, 240, 0.8); outline-offset: 1px; }

  /* ---- readout, top left ---- */
  #ui-readout {
    top: 14px; left: 14px;
    padding: 11px 14px;
    font: 400 12px/1.65 -apple-system, "SF Pro Text", Arial, sans-serif;
    pointer-events: none;
    min-width: 252px;
  }
  #ui-readout .site { font-size: 13px; font-weight: 650; color: #edf1f6; letter-spacing: 0.01em; }
  #ui-readout .when { color: #8b95a3; font-variant-numeric: tabular-nums; margin-bottom: 7px; }
  #ui-readout .row { display: flex; justify-content: space-between; gap: 14px; }
  #ui-readout .k { color: #8b95a3; }
  #ui-readout .v { color: #dbe2ea; font-variant-numeric: tabular-nums; }
  #ui-readout .sep { height: 1px; background: rgba(255,255,255,0.08); margin: 7px 0; }

  /* ---- controls, bottom center ---- */
  #ui-dock {
    bottom: 16px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 4px;
    padding: 5px;
  }
  #ui-dock .divider { width: 1px; align-self: stretch; background: rgba(255,255,255,0.10); margin: 3px 3px; }
  #ui-dock .site-btn { font-weight: 600; color: #dbe2ea; }
  #ui-dock .site-btn::before {
    content: ""; display: inline-block; width: 5px; height: 5px; border-radius: 50%;
    background: #7fb2ea; margin-right: 7px; vertical-align: middle;
  }
  #ui-dock input.dt {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px;
    color: #b6bfcb;
    font: 500 12px/1 -apple-system, "SF Pro Text", Arial, sans-serif;
    padding: 6px 8px;
    color-scheme: dark;
  }

  /* ---- layers, top right ---- */
  #ui-layers { top: 14px; right: 14px; display: flex; gap: 2px; padding: 5px; }
  #ui-layers .btn kbd {
    font: inherit; opacity: 0.5; margin-left: 6px;
    border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; font-size: 10px;
  }

  /* ---- site picker ---- */
  #ui-picker {
    position: absolute; inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: none; align-items: center; justify-content: center;
    pointer-events: auto;
    animation: fade 160ms ease;
  }
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
  #ui-picker .sheet {
    width: min(600px, calc(100vw - 40px));
    max-height: min(680px, calc(100vh - 80px));
    overflow-y: auto;
    padding: 20px;
  }
  #ui-picker h2 { margin: 0 0 3px; font-size: 15px; font-weight: 650; color: #edf1f6; }
  #ui-picker .sub { margin: 0 0 16px; font-size: 12px; line-height: 1.5; color: #8b95a3; }
  .card {
    display: grid; grid-template-columns: 1fr auto; gap: 4px 14px;
    width: 100%; text-align: left;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.075);
    border-radius: 11px;
    padding: 12px 14px; margin-bottom: 8px;
    cursor: pointer; color: #b9c2ce;
    font: 400 12px/1.5 -apple-system, "SF Pro Text", Arial, sans-serif;
    transition: border-color 130ms ease, background 130ms ease;
  }
  .card:hover { border-color: rgba(127, 178, 234, 0.5); background: rgba(70, 115, 175, 0.16); }
  .card[aria-current="true"] { border-color: rgba(127, 178, 234, 0.7); background: rgba(70, 115, 175, 0.13); }
  .card .name { font-size: 13px; font-weight: 620; color: #e8edf4; }
  .card .earth { color: #8fb6e0; font-variant-numeric: tabular-nums; text-align: right; align-self: center; grid-row: 1 / span 2; }
  .card .earth small { display: block; color: #78828f; font-size: 10.5px; }
  .card .blurb { grid-column: 1; color: #97a1ae; }

  /* ---- loading veil ---- */
  #ui-veil {
    position: absolute; inset: 0; background: #05070a;
    display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px;
    color: #7d8590; font-size: 12.5px; letter-spacing: 0.02em;
    transition: opacity 500ms ease; pointer-events: none;
  }
  #ui-veil .bar { width: 130px; height: 2px; background: rgba(255,255,255,0.10); border-radius: 2px; overflow: hidden; }
  #ui-veil .bar i { display: block; width: 40%; height: 100%; background: #7fb2ea; animation: slide 1.1s ease-in-out infinite; }
  @keyframes slide { 0% { transform: translateX(-100%) } 100% { transform: translateX(325%) } }

  /* ---- off-screen Earth pointer ---- */
  #ui-earthptr {
    position: absolute; display: none; align-items: center; gap: 6px;
    padding: 6px 9px 6px 7px;
    font: 600 11.5px/1 -apple-system, "SF Pro Text", Arial, sans-serif;
    color: #cfe0f2; cursor: pointer;
    transform: translate(-50%, -50%);
    white-space: nowrap;
  }
  #ui-earthptr .globe {
    width: 11px; height: 11px; border-radius: 50%;
    background: linear-gradient(135deg, #6fa8dc 0%, #3d6f9e 60%, #1d3550 100%);
    box-shadow: 0 0 6px rgba(120, 175, 235, 0.6);
  }
  #ui-earthptr small { color: #8ea6c0; font-weight: 500; }
`;

const SPEEDS = [
  [1, 'Real'],
  [60, '1 min/s'],
  [3600, '1 hr/s'],
  [86400, '1 day/s'],
  [604800, '1 wk/s'],
];

function fmtAlt(deg) {
  const s = `${Math.abs(deg).toFixed(1)}°`;
  return `${deg < 0 ? '−' : ''}${s}`;
}

function fmtClock(hours) {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function createUI({ hud, view, clock, toggles, onToggle, onSiteChange }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  hud.style.pointerEvents = 'none';

  const el = (tag, cls, parent, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    if (parent) parent.appendChild(n);
    return n;
  };

  // ---- readout -------------------------------------------------------------
  const readout = el('div', 'ui panel', hud);
  readout.id = 'ui-readout';
  readout.innerHTML = `
    <div class="site"></div>
    <div class="when"></div>
    <div class="row"><span class="k">Sun</span><span class="v" data-k="sun"></span></div>
    <div class="row"><span class="k">Earth</span><span class="v" data-k="earth"></span></div>
    <div class="sep"></div>
    <div class="row"><span class="k">Local time</span><span class="v" data-k="local"></span></div>
    <div class="row"><span class="k" data-k="nextk"></span><span class="v" data-k="next"></span></div>
    <div class="row"><span class="k">Looking</span><span class="v" data-k="look"></span></div>
    <div class="row"><span class="k">Clouds</span><span class="v" data-k="clouds"></span></div>`;
  const R = {
    site: readout.querySelector('.site'),
    when: readout.querySelector('.when'),
    sun: readout.querySelector('[data-k=sun]'),
    earth: readout.querySelector('[data-k=earth]'),
    local: readout.querySelector('[data-k=local]'),
    nextk: readout.querySelector('[data-k=nextk]'),
    next: readout.querySelector('[data-k=next]'),
    look: readout.querySelector('[data-k=look]'),
    clouds: readout.querySelector('[data-k=clouds]'),
  };

  // ---- layer toggles -------------------------------------------------------
  const layers = el('div', 'ui panel', hud);
  layers.id = 'ui-layers';
  const layerBtns = {};
  for (const [key, label, kbd] of [
    ['constellations', 'Constellations', 'C'],
    ['starNames', 'Star names', 'N'],
  ]) {
    const b = el('button', 'btn', layers, `${label}<kbd>${kbd}</kbd>`);
    b.classList.toggle('on', toggles[key]);
    b.addEventListener('click', () => b.classList.toggle('on', onToggle(key)));
    layerBtns[key] = b;
  }

  // ---- dock ----------------------------------------------------------------
  const dock = el('div', 'ui panel', hud);
  dock.id = 'ui-dock';
  const siteBtn = el('button', 'btn site-btn', dock);
  el('span', 'divider', dock);
  const speedBtns = SPEEDS.map(([s, label]) => {
    const b = el('button', 'btn', dock, label);
    b.addEventListener('click', () => {
      clock.setSpeed(s);
      syncSpeed();
    });
    return { s, b };
  });
  el('span', 'divider', dock);
  const dt = el('input', 'dt', dock);
  dt.type = 'datetime-local';
  dt.step = 60;
  dt.title = 'Jump to a date and time (UTC)';
  dt.addEventListener('change', () => {
    if (dt.value) clock.setTime(new Date(`${dt.value}:00Z`));
  });
  const nowBtn = el('button', 'btn', dock, 'Now');
  nowBtn.addEventListener('click', () => {
    clock.resetToRealTime();
    syncSpeed();
  });

  function syncSpeed() {
    for (const { s, b } of speedBtns) b.classList.toggle('on', clock.speed === s);
  }
  syncSpeed();

  // ---- Earth pointer -------------------------------------------------------
  const ptr = el('div', 'ui panel', hud);
  ptr.id = 'ui-earthptr';
  ptr.innerHTML = '<span class="globe"></span><span>Earth</span><small></small>';
  const ptrTurn = ptr.querySelector('small');
  ptr.addEventListener('click', () => {
    const s = view.state;
    if (s) view.lookAt(s.earth.az, s.earth.alt);
  });

  // ---- site picker ---------------------------------------------------------
  const picker = el('div', 'ui', hud);
  picker.id = 'ui-picker';
  const sheet = el('div', 'panel sheet', picker);
  el('h2', null, sheet, 'Where do you want to stand?');
  el('p', 'sub', sheet,
    'Every site is on the near side, so the Earth never rises or sets — it hangs at a fixed spot in the sky, swaying a few degrees a month with libration. The lower it hangs, the closer you are to the limb.');
  const cards = SITES.map((s) => {
    const c = el('button', 'card', sheet);
    c.innerHTML =
      `<span class="name">${s.name}</span>` +
      `<span class="earth">${s.earthAlt}°<small>Earth</small></span>` +
      `<span class="blurb">${s.blurb}</span>`;
    c.addEventListener('click', async () => {
      picker.style.display = 'none';
      if (s.id === view.site.id) return;
      api.setLoading(true, `Landing at ${s.name.split('—')[0].trim()}…`);
      await onSiteChange(s);
      api.setLoading(false);
      syncCards();
    });
    return { s, c };
  });
  function syncCards() {
    for (const { s, c } of cards) c.setAttribute('aria-current', String(s.id === view.site.id));
    siteBtn.textContent = view.site.name;
  }
  siteBtn.addEventListener('click', () => {
    syncCards();
    picker.style.display = 'flex';
  });
  picker.addEventListener('click', (e) => {
    if (e.target === picker) picker.style.display = 'none';
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') picker.style.display = 'none';
  });
  syncCards();

  // ---- loading veil --------------------------------------------------------
  const veil = el('div', 'ui', hud);
  veil.id = 'ui-veil';
  const veilText = el('div', null, veil, 'Getting to the Moon…');
  el('div', 'bar', veil, '<i></i>');

  let lastText = 0;
  const api = {
    setLoading(on, label) {
      if (label) veilText.textContent = label;
      veil.style.opacity = on ? '1' : '0';
      veil.style.pointerEvents = 'none';
      if (!on) setTimeout(() => { if (veil.style.opacity === '0') veil.style.display = 'none'; }, 520);
      else { veil.style.display = 'flex'; }
    },

    update(state, cloudStatus) {
      // Earth pointer: only when the Earth is off screen.
      const p = view.projectDir(state.earth.sceneDir);
      if (p.onScreen) {
        ptr.style.display = 'none';
      } else {
        const w = window.innerWidth, h = window.innerHeight;
        const cx = w / 2, cy = h / 2;
        let dx = p.x - cx, dy = p.y - cy;
        if (p.behind) { dx = -dx; dy = -dy; }
        const len = Math.hypot(dx, dy) || 1;
        const margin = 74;
        const scale = Math.min((cx - margin) / Math.abs(dx || 1e-6), (cy - margin) / Math.abs(dy || 1e-6));
        ptr.style.display = 'flex';
        ptr.style.left = `${cx + dx * scale}px`;
        ptr.style.top = `${cy + dy * scale}px`;
        let turn = state.earth.az - view.look.az;
        turn = ((turn % 360) + 540) % 360 - 180;
        ptrTurn.textContent = `${Math.abs(turn).toFixed(0)}° ${turn > 0 ? 'right' : 'left'}`;
        void len;
      }

      const now = performance.now();
      if (now - lastText < 200) return;
      lastText = now;

      const d = state.time.date;
      const speedLabel = SPEEDS.find(([s]) => s === clock.speed)?.[1] ?? `${clock.speed}×`;
      if (R.site.textContent !== view.site.name) syncCards();
      R.site.textContent = view.site.name;
      R.when.textContent = `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${speedLabel}`;
      R.sun.textContent = `${fmtAlt(state.sun.alt)} alt · ${state.sun.az.toFixed(0)}° az`;
      R.earth.textContent = `${fmtAlt(state.earth.alt)} alt · ${(state.earth.illumFraction * 100).toFixed(0)}% lit`;
      // A lunar hour is 29.53/24 Earth days, so the same clock face runs about
      // 30x slower here — worth spelling out in Earth days.
      const EARTH_DAYS_PER_LUNAR_HOUR = 29.530589 / 24;
      const lsh = state.localSolarHours;
      R.local.textContent = `${fmtClock(lsh)} · sol day ${(lsh / 24 * 29.5).toFixed(1)}/29.5`;
      const up = state.sun.alt > 0;
      const hoursTo = up ? (18 - lsh + 24) % 24 : (6 - lsh + 24) % 24;
      R.nextk.textContent = up ? 'Sunset' : 'Sunrise';
      R.next.textContent = `in ${(hoursTo * EARTH_DAYS_PER_LUNAR_HOUR).toFixed(1)} Earth days`;
      const lk = view.look;
      R.look.textContent = `${fmtAlt(lk.alt)} alt · ${((lk.az % 360) + 360) % 360 === 0 ? '0' : (((lk.az % 360) + 360) % 360).toFixed(0)}° az · ${lk.fov.toFixed(0)}° fov`;
      R.clouds.textContent = cloudStatus;

      if (document.activeElement !== dt) {
        dt.value = d.toISOString().slice(0, 16);
      }
      syncSpeed();
    },

    syncToggle(key, on) {
      layerBtns[key]?.classList.toggle('on', on);
    },
  };
  return api;
}
