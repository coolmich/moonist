import { SITES } from '../sites.js';
import { MIN_TIME, MAX_TIME } from '../sim/clock.js';

// All chrome: readout, time controls, site picker, credits, orientation aids.
// One design language: dark translucent panels, hairline borders, system font,
// tabular numerals, fixed-width value slots so nothing reflows per frame.

const STYLE = /* css */ `
  .ui { position: absolute; pointer-events: auto; }
  .panel {
    background: rgba(9, 12, 18, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 12px;
    backdrop-filter: blur(14px) saturate(1.2);
    -webkit-backdrop-filter: blur(14px) saturate(1.2);
    color: #c9cfd8;
    box-shadow: 0 2px 18px rgba(0, 0, 0, 0.5);
  }
  .btn {
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: #98a2b0;
    font: 500 12px/1 -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    padding: 7px 10px;
    cursor: pointer;
    white-space: nowrap;
    transition: color 120ms ease, background 120ms ease;
  }
  .btn:hover { color: #eef2f7; background: rgba(255, 255, 255, 0.08); }
  .btn[aria-pressed="true"] { color: #a8ccf5; background: rgba(88, 140, 205, 0.22); }
  .btn:focus-visible, .card:focus-visible, .dt:focus-visible {
    outline: 2px solid rgba(150, 190, 240, 0.85); outline-offset: 1px;
  }

  /* ---- readout, top left ---- */
  #ui-readout {
    top: 14px; left: 14px;
    padding: 11px 14px;
    font: 400 12px/1.65 -apple-system, "SF Pro Text", Arial, sans-serif;
    pointer-events: none;
    width: 250px;
  }
  #ui-readout .site { font-size: 13px; font-weight: 650; color: #edf1f6; }
  #ui-readout .when { color: #8b95a3; font-variant-numeric: tabular-nums; margin-bottom: 7px; }
  #ui-readout .row { display: flex; justify-content: space-between; gap: 12px; }
  #ui-readout .k { color: #8b95a3; white-space: nowrap; }
  #ui-readout .v { color: #dde4ec; font-variant-numeric: tabular-nums; text-align: right; }
  #ui-readout .sep { height: 1px; background: rgba(255,255,255,0.09); margin: 7px 0; }

  /* ---- controls, bottom ---- */
  #ui-dock {
    bottom: 16px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 3px; padding: 5px;
    /* An absolutely-positioned flex box shrinks to the space to the right of
       its left edge, i.e. half the viewport, and would wrap for no reason;
       max-content sizes it to its actual contents instead. */
    width: max-content; max-width: calc(100vw - 24px);
    flex-wrap: wrap; justify-content: center; row-gap: 4px;
  }
  #ui-dock .divider { width: 1px; align-self: stretch; background: rgba(255,255,255,0.10); margin: 3px 2px; }
  #ui-dock .site-btn { font-weight: 600; color: #dde4ec; }
  #ui-dock .site-btn::before {
    content: ""; display: inline-block; width: 5px; height: 5px; border-radius: 50%;
    background: #7fb2ea; margin-right: 7px; vertical-align: middle;
  }
  .when-group { display: flex; align-items: center; gap: 5px; padding: 0 2px; }
  .when-group .zone { color: #7d8590; font-size: 10.5px; letter-spacing: 0.06em; }
  input.dt {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px; color: #b6bfcb;
    font: 500 12px/1 -apple-system, "SF Pro Text", Arial, sans-serif;
    padding: 6px 8px; color-scheme: dark;
  }
  @media (max-width: 900px) {
    #ui-dock .speed-wide { display: none; }
    #ui-readout { width: 210px; font-size: 11.5px; }
  }
  @media (max-width: 620px) {
    .when-group { display: none; }
  }

  /* ---- layers, top right ---- */
  #ui-layers { top: 14px; right: 14px; display: flex; gap: 2px; padding: 5px; }
  #ui-layers .btn kbd {
    font: inherit; opacity: 0.5; margin-left: 6px;
    border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; font-size: 10px;
  }

  /* ---- modal sheets (picker, credits) ---- */
  .backdrop {
    position: absolute; inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: none; align-items: center; justify-content: center;
    pointer-events: auto; animation: fade 160ms ease;
  }
  .backdrop.open { display: flex; }
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
  .sheet {
    position: relative;
    width: min(620px, calc(100vw - 32px));
    max-height: min(78vh, 700px);
    overflow-y: auto; padding: 20px;
  }
  .sheet h2 { margin: 0 0 3px; font-size: 15px; font-weight: 650; color: #edf1f6; }
  .sheet .sub { margin: 0 0 16px; font-size: 12px; line-height: 1.55; color: #8b95a3; max-width: 52ch; }
  .sheet .close {
    position: absolute; top: 12px; right: 12px;
    width: 26px; height: 26px; border-radius: 7px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
    color: #aeb7c4; cursor: pointer; font: 400 15px/1 inherit;
  }
  .sheet .close:hover { background: rgba(255,255,255,0.14); color: #fff; }

  .card {
    display: grid; grid-template-columns: 1fr auto; gap: 3px 16px;
    width: 100%; text-align: left;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.075);
    border-radius: 11px; padding: 12px 14px; margin-bottom: 8px;
    cursor: pointer; color: #b9c2ce;
    font: 400 12px/1.5 -apple-system, "SF Pro Text", Arial, sans-serif;
    transition: border-color 130ms ease, background 130ms ease;
  }
  .card:hover { border-color: rgba(127, 178, 234, 0.5); background: rgba(70, 115, 175, 0.16); }
  .card[aria-current="true"] { border-color: rgba(127, 178, 234, 0.7); background: rgba(70, 115, 175, 0.13); }
  .card .name { grid-column: 1; font-size: 13px; font-weight: 620; color: #e8edf4; }
  .card .earth {
    grid-column: 2; grid-row: 1 / span 2; align-self: center; text-align: right;
    color: #8fb6e0; font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 600;
  }
  .card .earth small { display: block; color: #78828f; font-size: 10.5px; font-weight: 400; }
  .card .blurb { grid-column: 1; color: #97a1ae; }

  .credits-list { margin: 0; padding: 0; list-style: none; font-size: 12px; line-height: 1.6; }
  .credits-list li { padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.07); color: #a9b3c0; }
  .credits-list li:first-child { border-top: 0; }
  .credits-list b { color: #dde4ec; font-weight: 600; }
  .credits-list span { color: #7d8590; }

  /* ---- first-run hint ---- */
  #ui-hint {
    bottom: 74px; left: 50%; transform: translateX(-50%);
    width: max-content; max-width: calc(100vw - 24px);
    padding: 9px 14px; font-size: 12px; color: #b9c2ce;
    display: flex; align-items: center; gap: 14px;
    transition: opacity 400ms ease;
  }
  #ui-hint b { color: #e6ecf3; font-weight: 600; }
  #ui-hint .dismiss { color: #7d8590; cursor: pointer; padding: 2px 4px; }
  #ui-hint .dismiss:hover { color: #e6ecf3; }

  /* ---- off-screen Earth pointer ---- */
  #ui-earthptr {
    display: none; align-items: center; gap: 7px;
    padding: 6px 10px 6px 8px;
    font: 600 11.5px/1 -apple-system, "SF Pro Text", Arial, sans-serif;
    color: #cfe0f2; cursor: pointer; white-space: nowrap;
    transform: translate(-50%, -50%);
  }
  #ui-earthptr .globe {
    width: 11px; height: 11px; border-radius: 50%;
    background: linear-gradient(135deg, #6fa8dc 0%, #3d6f9e 60%, #1d3550 100%);
    box-shadow: 0 0 6px rgba(120, 175, 235, 0.55);
  }
  #ui-earthptr small { color: #93aac2; font-weight: 500; }

  /* ---- transient message ---- */
  #ui-msg {
    top: 14px; left: 50%; transform: translateX(-50%);
    padding: 9px 14px; font-size: 12px; color: #f0d9d1;
    border-color: rgba(220, 150, 120, 0.35);
    display: none;
  }
`;

const SPEEDS = [
  [1, 'Real', false],
  [60, '1 min/s', true],
  [3600, '1 hr/s', false],
  [86400, '1 day/s', false],
  [604800, '1 wk/s', true],
];

const CREDITS = [
  ['astronomy-engine', 'ephemeris and IAU lunar orientation', 'MIT — Don Cross'],
  ['JPL Horizons', 'the vectors every astronomy test is checked against', 'NASA/JPL-Caltech'],
  ['NASA Scientific Visualization Studio', 'lunar topography, CGI Moon Kit (LRO LOLA + LROC)', 'NASA — credit requested'],
  ['Solar System Scope', 'Earth day, night and specular maps', 'CC BY 4.0'],
  ['EUMETSAT, via Matt Eason’s Live Cloud Maps', 'the live cloud cover, refreshed every three hours', 'Contains modified EUMETSAT data — maps CC0'],
  ['d3-celestial and the XHIP catalogue', '5,044 stars and the constellation figures', 'BSD 3-Clause — Olaf Frohn'],
];

function fmtAlt(deg) {
  return `${deg < 0 ? '−' : ''}${Math.abs(deg).toFixed(1)}°`;
}

function fmtAz(deg) {
  const a = ((deg % 360) + 360) % 360;
  return `${(a >= 359.95 ? 0 : a).toFixed(0)}°`;
}

function fmtClock(hours) {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isoLocalMinutes(d) {
  return d.toISOString().slice(0, 16);
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
    <div class="row"><span class="k" data-k="nextk">Sunrise</span><span class="v" data-k="next"></span></div>
    <div class="row"><span class="k">Looking</span><span class="v" data-k="look"></span></div>
    <div class="row"><span class="k">Cloud map</span><span class="v" data-k="clouds"></span></div>`;
  const R = Object.fromEntries(
    ['sun', 'earth', 'local', 'nextk', 'next', 'look', 'clouds']
      .map((k) => [k, readout.querySelector(`[data-k=${k}]`)]),
  );
  R.site = readout.querySelector('.site');
  R.when = readout.querySelector('.when');

  // ---- layer toggles -------------------------------------------------------
  const layers = el('div', 'ui panel', hud);
  layers.id = 'ui-layers';
  const layerBtns = {};
  for (const [key, label, kbd] of [
    ['constellations', 'Constellations', 'C'],
    ['starNames', 'Star names', 'N'],
  ]) {
    const b = el('button', 'btn', layers, `${label}<kbd>${kbd}</kbd>`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!toggles[key]));
    b.addEventListener('click', () => b.setAttribute('aria-pressed', String(onToggle(key))));
    layerBtns[key] = b;
  }

  // ---- dock ----------------------------------------------------------------
  const dock = el('div', 'ui panel', hud);
  dock.id = 'ui-dock';
  const siteBtn = el('button', 'btn site-btn', dock);
  siteBtn.type = 'button';
  siteBtn.setAttribute('aria-haspopup', 'dialog');
  el('span', 'divider', dock);
  const speedBtns = SPEEDS.map(([s, label, wide]) => {
    const b = el('button', `btn${wide ? ' speed-wide' : ''}`, dock, label);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { clock.setSpeed(s); syncSpeed(); });
    return { s, b };
  });
  el('span', 'divider', dock);
  const whenGroup = el('span', 'when-group', dock);
  el('span', 'zone', whenGroup, 'UTC');
  const dt = el('input', 'dt', whenGroup);
  dt.type = 'datetime-local';
  dt.step = 60;
  dt.min = isoLocalMinutes(new Date(MIN_TIME));
  dt.max = isoLocalMinutes(new Date(MAX_TIME));
  dt.title = 'Jump to a date and time, in UTC';
  dt.setAttribute('aria-label', 'Simulated date and time, UTC');
  dt.addEventListener('change', () => {
    if (dt.value) clock.setTime(new Date(`${dt.value}:00Z`));
  });
  const nowBtn = el('button', 'btn', dock, 'Now');
  nowBtn.type = 'button';
  nowBtn.addEventListener('click', () => { clock.resetToRealTime(); syncSpeed(); });
  el('span', 'divider', dock);
  const creditsBtn = el('button', 'btn', dock, 'Credits');
  creditsBtn.type = 'button';
  creditsBtn.setAttribute('aria-haspopup', 'dialog');

  function syncSpeed() {
    for (const { s, b } of speedBtns) b.setAttribute('aria-pressed', String(clock.speed === s));
  }
  syncSpeed();

  // ---- modal plumbing ------------------------------------------------------
  let openModal = null;
  function makeModal(id, title, sub) {
    const back = el('div', 'ui backdrop', hud);
    back.id = id;
    const sheet = el('div', 'panel sheet', back);
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', title);
    const close = el('button', 'close', sheet, '&times;');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => hideModal());
    el('h2', null, sheet, title);
    if (sub) el('p', 'sub', sheet, sub);
    back.addEventListener('click', (e) => { if (e.target === back) hideModal(); });
    return { back, sheet };
  }
  function showModal(m, opener) {
    if (openModal) openModal.back.classList.remove('open');
    m.back.classList.add('open');
    m.opener = opener;
    openModal = m;
    const first = m.sheet.querySelector('.card, .close');
    if (first) first.focus();
  }
  function hideModal() {
    if (!openModal) return;
    openModal.back.classList.remove('open');
    openModal.opener?.focus();
    openModal = null;
  }
  // Keep focus inside an open sheet.
  hud.addEventListener('keydown', (e) => {
    if (!openModal || e.key !== 'Tab') return;
    const items = [...openModal.sheet.querySelectorAll('button')];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ---- site picker ---------------------------------------------------------
  const picker = makeModal('ui-picker', 'Where do you want to stand?',
    'Every site is on the near side, so the Earth never rises or sets — it hangs at a fixed spot in the sky and sways a few degrees a month as the Moon rocks. How high it hangs tells you where you are: overhead near the middle of the near side, close to the horizon out by the limb.');
  const cards = SITES.map((s) => {
    const c = el('button', 'card', picker.sheet);
    c.type = 'button';
    c.innerHTML =
      `<span class="name">${s.name}</span>` +
      `<span class="earth" data-earth="${s.id}">—<small>Earth</small></span>` +
      `<span class="blurb">${s.blurb}</span>`;
    c.addEventListener('click', async () => {
      hideModal();
      if (s.id === view.site.id) return;
      setBusy(true, `Landing at ${s.name.split('—')[0].trim()}…`);
      try {
        await onSiteChange(s);
      } catch (err) {
        console.error(err);
        api.showError(`Could not land at ${s.name.split('—')[0].trim()} — staying put.`);
      } finally {
        setBusy(false);
        syncCards();
      }
    });
    return { s, c };
  });
  function syncCards() {
    for (const { s, c } of cards) c.setAttribute('aria-current', String(s.id === view.site.id));
    siteBtn.textContent = view.site.name;
  }
  siteBtn.addEventListener('click', () => { syncCards(); showModal(picker, siteBtn); });

  // ---- credits -------------------------------------------------------------
  const credits = makeModal('ui-credits', 'Built from real data',
    'Everything you see is measured, not invented. The sky comes from an ephemeris checked against JPL Horizons; the ground is NASA laser altimetry; the clouds are this morning’s weather.');
  const list = el('ul', 'credits-list', credits.sheet);
  for (const [name, what, lic] of CREDITS) {
    el('li', null, list, `<b>${name}</b> — ${what}<br><span>${lic}</span>`);
  }
  creditsBtn.addEventListener('click', () => showModal(credits, creditsBtn));

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') hideModal();
  });

  // ---- Earth pointer -------------------------------------------------------
  const ptr = el('div', 'ui panel', hud);
  ptr.id = 'ui-earthptr';
  ptr.innerHTML = '<span class="globe"></span><span>Earth</span><small></small>';
  ptr.setAttribute('role', 'button');
  ptr.tabIndex = 0;
  const ptrTurn = ptr.querySelector('small');
  const aimAtEarth = () => {
    const s = view.state;
    if (s) view.lookAt(s.earth.az, s.earth.alt, undefined, true);
  };
  ptr.addEventListener('click', aimAtEarth);
  ptr.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') aimAtEarth(); });

  // ---- transient message ---------------------------------------------------
  const msg = el('div', 'ui panel', hud);
  msg.id = 'ui-msg';
  msg.setAttribute('role', 'status');
  let msgTimer = 0;

  // ---- first-run hint ------------------------------------------------------
  const seen = (() => {
    try { return localStorage.getItem('moonist.seen') === '1'; } catch { return false; }
  })();
  let hint = null;
  if (!seen) {
    hint = el('div', 'ui panel', hud);
    hint.id = 'ui-hint';
    hint.innerHTML = '<span><b>Drag</b> to look around · <b>scroll</b> to zoom · <b>E</b> finds the Earth</span><span class="dismiss" role="button" tabindex="0">Got it</span>';
    const dismiss = () => {
      if (!hint) return;
      hint.style.opacity = '0';
      setTimeout(() => hint?.remove(), 420);
      hint = null;
      try { localStorage.setItem('moonist.seen', '1'); } catch { /* private mode */ }
    };
    hint.querySelector('.dismiss').addEventListener('click', dismiss);
    window.addEventListener('pointerdown', (e) => {
      if (e.target?.closest?.('#ui-hint')) return;
      dismiss();
    }, { once: true });
    setTimeout(dismiss, 15000);
  }

  // ---- boot veil (already in the document) ---------------------------------
  const boot = document.getElementById('boot');
  const bootStep = document.getElementById('boot-step');
  const bootRetry = document.getElementById('boot-retry');
  function setBusy(on, label) {
    if (!boot) return;
    if (label) bootStep.textContent = label;
    boot.classList.remove('failed');
    boot.style.opacity = on ? '1' : '0';
    boot.style.display = on ? 'flex' : 'flex';
    boot.style.pointerEvents = on ? 'auto' : 'none';
    if (!on) setTimeout(() => { if (boot.style.opacity === '0') boot.style.display = 'none'; }, 620);
  }

  const api = {
    setLoading: setBusy,
    setLoadingStep(text) {
      if (bootStep && boot.style.opacity !== '0') bootStep.textContent = text;
    },
    fail(message, onRetry) {
      if (!boot) return;
      boot.style.display = 'flex';
      boot.style.opacity = '1';
      boot.style.pointerEvents = 'auto';
      boot.classList.add('failed');
      bootStep.textContent = message;
      bootRetry.onclick = onRetry;
    },
    showError(text) {
      msg.textContent = text;
      msg.style.display = 'block';
      clearTimeout(msgTimer);
      msgTimer = setTimeout(() => { msg.style.display = 'none'; }, 6000);
    },

    update(state, cloudStatus) {
      // Earth pointer: only when the Earth's disc is genuinely off screen.
      const p = view.projectDir(state.earth.sceneDir);
      if (p.onScreen) {
        ptr.style.display = 'none';
      } else {
        const w = window.innerWidth, h = window.innerHeight;
        const cx = w / 2, cy = h / 2;
        let dx = p.x - cx, dy = p.y - cy;
        if (p.behind) { dx = -dx; dy = -dy; }
        // Keep clear of the readout panel in the top-left corner.
        const marginX = 96, marginTop = 128, marginBottom = 96;
        const sx = (cx - marginX) / Math.max(Math.abs(dx), 1e-6);
        const sy = (dy < 0 ? cy - marginTop : cy - marginBottom) / Math.max(Math.abs(dy), 1e-6);
        const scale = Math.min(sx, sy);
        ptr.style.display = 'flex';
        ptr.style.left = `${cx + dx * scale}px`;
        ptr.style.top = `${cy + dy * scale}px`;
        const turn = ((state.earth.az - view.look.az) % 360 + 540) % 360 - 180;
        const climb = state.earth.alt - view.look.alt;
        const parts = [];
        if (Math.abs(turn) >= 3) parts.push(`${Math.abs(turn).toFixed(0)}° ${turn > 0 ? 'right' : 'left'}`);
        if (Math.abs(climb) >= 3) parts.push(`${Math.abs(climb).toFixed(0)}° ${climb > 0 ? 'up' : 'down'}`);
        ptrTurn.textContent = parts.join(', ') || 'just off screen';
      }

      const now = performance.now();
      if (now - lastText < 200) return;
      lastText = now;

      const d = state.time.date;
      const speedLabel = SPEEDS.find(([s]) => s === clock.speed)?.[1] ?? `${clock.speed}×`;
      if (R.site.textContent !== view.site.name) syncCards();
      R.when.textContent = `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${speedLabel}`;
      R.sun.textContent = `${fmtAlt(state.sun.alt)} alt · ${fmtAz(state.sun.az)} az`;
      R.earth.textContent = `${fmtAlt(state.earth.alt)} alt · ${(state.earth.illumFraction * 100).toFixed(0)}% lit`;

      // A lunar hour is 29.53/24 Earth days, so the local clock needs its
      // scale spelled out to mean anything.
      const lsh = state.localSolarHours;
      R.local.textContent = `${fmtClock(lsh)} · sol day ${(lsh / 24 * 29.5).toFixed(1)}/29.5`;
      const ev = view.nextSunEvent();
      if (ev) {
        R.nextk.textContent = ev.kind === 'sunrise' ? 'Sunrise' : 'Sunset';
        R.next.textContent = ev.days < 1
          ? `in ${(ev.days * 24).toFixed(1)} hours`
          : `in ${ev.days.toFixed(1)} Earth days`;
      } else {
        R.nextk.textContent = state.sun.alt > 0 ? 'Sunset' : 'Sunrise';
        R.next.textContent = 'not within a month';
      }

      const lk = view.look;
      R.look.textContent = `${fmtAlt(lk.alt)} alt · ${fmtAz(lk.az)} az · ${lk.fov.toFixed(0)}° fov`;
      // Cloud freshness: say when the live map was fetched, and be explicit
      // that clouds are always today's weather — when the clock is far from
      // the present, the geometry time-travels but the weather cannot.
      if (typeof cloudStatus === 'object' && cloudStatus !== null) {
        const { kind, fetchedAt } = cloudStatus;
        if (kind === 'live' && fetchedAt) {
          const timeTraveling = Math.abs(d.getTime() - Date.now()) > 12 * 3600e3;
          R.clouds.textContent = timeTraveling
            ? 'live — showing today’s weather'
            : `live · fetched ${fetchedAt.toISOString().slice(11, 16)} UTC`;
        } else if (kind === 'offline') {
          R.clouds.textContent = 'offline copy';
        } else {
          R.clouds.textContent = kind;
        }
      } else {
        R.clouds.textContent = String(cloudStatus);
      }

      if (document.activeElement !== dt) dt.value = isoLocalMinutes(d);
      syncSpeed();

      // Live Earth altitude per site, so the picker never advertises a number
      // the sky then contradicts.
      if (openModal === picker && now - lastCards > 1000) {
        lastCards = now;
        for (const { s } of cards) {
          const cell = picker.sheet.querySelector(`[data-earth="${s.id}"]`);
          if (cell) cell.innerHTML = `${view.earthAltAt(s).toFixed(0)}°<small>Earth</small>`;
        }
      }
    },

    syncToggle(key, on) {
      layerBtns[key]?.setAttribute('aria-pressed', String(on));
    },

    /** Screen areas the sky-label layer must keep clear. */
    panelRects() {
      const rects = [];
      for (const node of [readout, layers, dock, hint, msg.style.display === 'block' ? msg : null]) {
        if (!node) continue;
        const r = node.getBoundingClientRect();
        if (r.width > 0) rects.push({ x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 });
      }
      return rects;
    },
  };

  let lastText = 0;
  let lastCards = 0;
  syncCards();
  return api;
}
