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
  .btn[aria-pressed="true"]:hover { background: rgba(88, 140, 205, 0.34); }
  /* Disclosure-open is a different kind of state than selected — lighter and
     uncoloured, so an open "Sky" cannot scan as a fourth toggled layer. */
  .btn[aria-expanded="true"] { color: #eef2f7; background: rgba(255, 255, 255, 0.12); }
  .btn[aria-expanded="true"]:hover { background: rgba(255, 255, 255, 0.17); }
  .btn:focus-visible, .card:focus-visible, .dt:focus-visible, input.mag:focus-visible,
  .sheet .close:focus-visible, #ui-earthptr:focus-visible, #ui-hint .dismiss:focus-visible,
  .status-line:focus-visible {
    outline: 2px solid rgba(150, 190, 240, 0.85); outline-offset: 1px;
  }
  .panel { box-sizing: border-box; }

  /* ---- status capsule + details drawer, top left ---- */
  /* One line by default — the sky is the product, the eight readout rows are
     details on demand. The capsule row itself never changes size; the drawer
     grows below it as an overlay, so nothing else on screen moves. */
  #ui-status {
    top: calc(10px + env(safe-area-inset-top, 0px));
    left: calc(10px + env(safe-area-inset-left, 0px));
    /* Wide enough that no site name truncates on a laptop — ellipsising the
       primary readout while the bar prints the same string in full inverts
       the hierarchy. Narrow widths switch to short names instead. */
    max-width: min(560px, calc(100vw - 20px));
  }
  #ui-status .status-line {
    display: flex; align-items: baseline; gap: 7px; width: 100%;
    background: transparent; border: 0; cursor: pointer;
    padding: 8px 12px; text-align: left; border-radius: 12px;
    font: 400 12px/1.5 -apple-system, "SF Pro Text", Arial, sans-serif;
    color: #c9cfd8; overflow: hidden;
    transition: background 120ms ease;
  }
  #ui-status .status-line:hover { background: rgba(255, 255, 255, 0.05); }
  #ui-status .site {
    font-weight: 650; color: #edf1f6;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    flex: 0 1 auto; min-width: 40px;
  }
  #ui-status .when {
    color: #8b95a3; font-variant-numeric: tabular-nums; white-space: nowrap;
    min-width: 0; overflow: hidden;
  }
  /* A displaced clock confesses even in full chrome — the time-honesty twin
     of the EARTH chip: same test, warmer ink. */
  #ui-status .when.warped { color: #d3ac74; }
  #ui-status .next {
    color: #a8bdd6; white-space: nowrap; font-variant-numeric: tabular-nums;
    min-width: 0; overflow: hidden;
  }
  #ui-status .status-line kbd {
    font: inherit; font-size: 10px; opacity: 0.45; align-self: center;
    border: 1px solid currentColor; border-radius: 3px; padding: 0 3px;
  }
  #ui-status .details {
    display: none; padding: 0 12px 9px;
    font: 400 12px/1.65 -apple-system, "SF Pro Text", Arial, sans-serif;
    min-width: 262px; box-sizing: border-box;
  }
  #ui-status.open .details { display: block; }
  #ui-status .row { display: flex; justify-content: space-between; gap: 12px; }
  #ui-status .k { color: #8b95a3; white-space: nowrap; }
  #ui-status .v { color: #dde4ec; font-variant-numeric: tabular-nums; text-align: right; }
  #ui-status .sep { height: 1px; background: rgba(255,255,255,0.09); margin: 6px 0 7px; }

  /* ---- the bar, bottom: the one control surface ---- */
  #ui-dock {
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 3px; padding: 5px;
    /* An absolutely-positioned flex box shrinks to the space to the right of
       its left edge, i.e. half the viewport, and would wrap for no reason;
       max-content sizes it to its actual contents instead. */
    width: max-content;
    /* Landscape phones with viewport-fit=cover put the bar's outer controls
       under the corner cutouts unless both side insets are subtracted. */
    max-width: calc(100vw - 16px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
    flex-wrap: wrap; justify-content: center; row-gap: 4px;
  }
  #ui-dock .divider { width: 1px; align-self: stretch; background: rgba(255,255,255,0.10); margin: 3px 2px; }
  #ui-dock .site-btn {
    font-weight: 600; color: #dde4ec;
    max-width: 190px; overflow: hidden; text-overflow: ellipsis;
  }
  #ui-dock .site-btn::before {
    content: ""; display: inline-block; width: 5px; height: 5px; border-radius: 50%;
    background: #7fb2ea; margin-right: 7px; vertical-align: middle;
  }
  /* The clock is the one bar control that reads as a readout, so it borrows
     the .dt field skin — same primitive, and now it looks pressable. */
  #ui-dock .clock-btn {
    font-variant-numeric: tabular-nums;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.10);
    padding: 6px 9px; /* the border must not make it taller than its row */
  }
  #ui-dock .clock-btn .zone { margin-left: 5px; display: inline-block; min-width: 3ch; text-align: left; }
  /* Wide and narrow labels share each element and the viewport picks one, so
     every control is present at every width — the five speeds especially:
     folding the primary verb behind a menu was the old layout's worst sin.
     The status capsule's site name uses the same pair. */
  .lab-n { display: none; }
  @media (max-width: 719px) {
    .lab-w { display: none; }
    .lab-n { display: inline; }
    #ui-dock .site-btn { max-width: 104px; }
  }
  .zone { color: #7d8590; font-size: 10.5px; letter-spacing: 0.06em; }

  /* ---- popovers over the bar (clock, sky) ---- */
  .pop {
    display: none; flex-direction: column; gap: 2px; padding: 6px;
    min-width: 216px;
    max-width: calc(100vw - 16px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
  }
  .pop.open { display: flex; }
  .pop .row { display: flex; align-items: center; gap: 7px; padding: 2px; flex-wrap: wrap; }
  .pop > .btn { text-align: left; }
  .btn kbd {
    font: inherit; opacity: 0.5; margin-left: 6px;
    border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; font-size: 10px;
  }
  /* The magnifier is a sky-display option, so it rides the sky popover as a
     full-width row under the layer toggles — ruled off from them because it
     is a dial, not a fourth toggle, and aligned to the same left edge. */
  .earth-group {
    display: flex; align-items: center;
    gap: 7px; padding: 7px 10px 5px; margin-top: 4px;
    border-top: 1px solid rgba(255,255,255,0.09);
  }
  .earth-group input.mag { margin-left: auto; }
  .earth-group .x {
    color: #b6bfcb; font: 500 12px/1 -apple-system, "SF Pro Text", Arial, sans-serif;
    font-variant-numeric: tabular-nums; width: 32px; text-align: left;
  }
  input.mag {
    appearance: none; -webkit-appearance: none;
    width: 84px; height: 22px; margin: 0; background: transparent; cursor: pointer;
  }
  input.mag::-webkit-slider-runnable-track { height: 3px; border-radius: 1.5px; background: rgba(255,255,255,0.18); }
  input.mag::-webkit-slider-thumb {
    -webkit-appearance: none; width: 13px; height: 13px; border-radius: 50%;
    background: #9fc2e8; margin-top: -5px; border: 0; transition: background 120ms ease;
  }
  input.mag:hover::-webkit-slider-thumb { background: #cfe2f6; }
  input.mag::-moz-range-track { height: 3px; border-radius: 1.5px; background: rgba(255,255,255,0.18); }
  input.mag::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: #9fc2e8; border: 0; }
  input.dt {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px; color: #b6bfcb;
    font: 500 12px/1 -apple-system, "SF Pro Text", Arial, sans-serif;
    padding: 6px 8px; color-scheme: dark;
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

  /* ---- immersive: chrome recedes, honesty stays ---- */
  .ui { transition: opacity 200ms ease; }
  #hud.immersive .ui {
    opacity: 0; pointer-events: none; visibility: hidden;
    /* Visibility flips only after the fade, and instantly on the way back. */
    transition: opacity 200ms ease, visibility 0s 200ms;
  }
  #hud.immersive #ui-chips, #hud.immersive #ui-msg {
    opacity: 1; pointer-events: auto; visibility: visible; transition: none;
  }
  /* The OSD keeps its .show gate — an unconditional override pinned every
     confirmation on screen for the whole hidden session — and stays
     click-through: a tap on the caption itself must still reveal. */
  #hud.immersive #ui-osd.show {
    opacity: 1; pointer-events: none; visibility: visible; transition: none;
  }

  /* ---- honesty chips, top right ---- */
  /* The two admissions that outrank immersion: a magnified Earth always says
     ×N, and warped time confesses whenever the chrome that would show it is
     hidden. Everything else may fade; the truth may not. */
  #ui-chips {
    top: calc(10px + env(safe-area-inset-top, 0px));
    right: calc(10px + env(safe-area-inset-right, 0px));
    display: flex; flex-direction: column; gap: 6px; align-items: flex-end;
  }
  /* On a phone the capsule can span nearly the whole viewport; the chips
     drop below its line rather than covering the time and countdown — and
     below the whole drawer when it is open (the chips are a later sibling,
     so the open state is reachable in pure CSS). */
  @media (max-width: 560px) {
    #ui-chips { top: calc(48px + env(safe-area-inset-top, 0px)); }
    #ui-status.open ~ #ui-chips { top: calc(178px + env(safe-area-inset-top, 0px)); }
  }
  .chip {
    display: none; align-items: center; gap: 6px;
    padding: 6px 10px; cursor: pointer; border-radius: 9px;
    font: 600 11px/1 -apple-system, "SF Pro Text", Arial, sans-serif;
    letter-spacing: 0.05em; color: #cfe0f2; font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .chip.on { display: flex; }
  .chip:hover { color: #ffffff; }

  /* ---- transient on-screen confirmation (hotkeys while hidden) ---- */
  #ui-osd {
    left: 50%; transform: translateX(-50%);
    bottom: calc(70px + env(safe-area-inset-bottom, 0px));
    padding: 8px 14px; font-size: 12px; color: #dbe4ee;
    width: max-content; max-width: calc(100vw - 24px);
    opacity: 0; pointer-events: none; transition: opacity 250ms ease;
  }
  #ui-osd.show { opacity: 1; }

  /* ---- first-run hint ---- */
  #ui-hint {
    bottom: 74px; left: 50%; transform: translateX(-50%);
    width: max-content; max-width: calc(100vw - 24px);
    padding: 9px 14px; font-size: 12px; color: #b9c2ce;
    display: flex; align-items: center; gap: 14px;
    transition: opacity 400ms ease;
  }
  #ui-hint { line-height: 1.6; text-align: left; }
  /* The hint is a note, not a surface: clicks pass through everywhere except
     its own dismiss, so it can never eat a popover's controls beneath it. */
  #ui-hint { pointer-events: none; }
  #ui-hint .dismiss { pointer-events: auto; }
  .pop { z-index: 1; } /* and the popovers layer above it regardless */
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

  /* ---- touch overrides ---- */
  /* A 26px-tall control is fine under a cursor and hostile under a thumb —
     and the dismissal controls (modal close, "Got it") are the ones a phone
     user hits first. This block must stay LAST in the stylesheet: every rule
     here ties its base declaration on specificity and wins only on source
     order (an @media wrapper adds no specificity). */
  @media (pointer: coarse) {
    .btn { padding: 11px 12px; }
    #ui-dock .clock-btn { padding: 10px 11px; } /* border included: 34px like .btn */
    .sheet .close { width: 34px; height: 34px; }
    #ui-hint .dismiss { padding: 8px 10px; }
    .chip { padding: 12px; }
    input.mag { height: 34px; }
  }
`;

const SPEEDS = [
  [1, 'Real', 'Real'],
  [60, '1 min/s', '1m'],
  [3600, '1 hr/s', '1h'],
  [86400, '1 day/s', '1d'],
  [604800, '1 wk/s', '1w'],
];

const CREDITS = [
  ['astronomy-engine', 'ephemeris and IAU lunar orientation', 'MIT — Don Cross'],
  ['JPL Horizons', 'the vectors every astronomy test is checked against', 'NASA/JPL-Caltech'],
  ['NASA Scientific Visualization Studio', 'lunar topography, CGI Moon Kit (LRO LOLA + LROC)', 'NASA — credit requested'],
  ['Solar System Scope', 'Earth day, night and specular maps', 'CC BY 4.0'],
  ['EUMETSAT, via Matt Eason’s Live Cloud Maps', 'the live cloud cover, refreshed every three hours', 'Contains modified EUMETSAT data — maps CC0'],
  ['d3-celestial and the XHIP catalogue', '5,044 stars and the constellation figures', 'BSD 3-Clause — Olaf Frohn'],
  ['Tycho-2 catalogue, via VizieR', '349,405 more stars to magnitude 10, revealed by zoom', 'ESA Hipparcos mission — Høg et al. 2000'],
  ['NASA SVS Deep Star Maps 2020', 'the Milky Way, rendered from 1.7 billion catalogued stars', 'NASA/Goddard SVS; Gaia DR2: ESA/Gaia/DPAC'],
];

function fmtAlt(deg) {
  return `${deg < 0 ? '−' : ''}${Math.abs(deg).toFixed(1)}°`;
}

function fmtAz(deg) {
  // Round first, then wrap — otherwise 359.7° prints as "360°".
  const a = Math.round(((deg % 360) + 360) % 360) % 360;
  return `${a}°`;
}

function fmtClock(hours) {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// The chrome speaks the viewer's own wall clock. Built from the local
// component getters rather than a shifted `toISOString`: the offset moves with
// DST and, over the 1700–2200 range the clock allows, with the zone's history.
function localMinutes(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Short zone name for the date being simulated, so a summer date reads PDT and
// a winter one PST. Zones without an abbreviation come back as "GMT+5:30".
const ZONE_FMT = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });
function zoneLabel(d) {
  return ZONE_FMT.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
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

  // ---- status capsule + details drawer -------------------------------------
  // One line: site · sim time · speed · next sun event. The countdown rides
  // the capsule because it is the readout that teaches the primary verb —
  // seeing "Sunrise in 8.3 d" is what makes a visitor reach for 1 day/s.
  const status = el('div', 'ui panel', hud);
  status.id = 'ui-status';
  const statusLine = el('button', 'status-line', status);
  statusLine.type = 'button';
  statusLine.innerHTML = '<span class="site"></span><span class="when"></span>'
    + '<span class="next"></span><kbd aria-hidden="true">D</kbd>';
  const details = el('div', 'details', status);
  details.innerHTML = `
    <div class="row"><span class="k">Sun</span><span class="v" data-k="sun"></span></div>
    <div class="row"><span class="k">Earth</span><span class="v" data-k="earth"></span></div>
    <div class="sep"></div>
    <div class="row"><span class="k">Lunar time</span><span class="v" data-k="local"></span></div>
    <div class="row"><span class="k">Looking</span><span class="v" data-k="look"></span></div>
    <div class="row"><span class="k">Cloud map</span><span class="v" data-k="clouds"></span></div>`;
  const R = Object.fromEntries(
    ['sun', 'earth', 'local', 'look', 'clouds']
      .map((k) => [k, details.querySelector(`[data-k=${k}]`)]),
  );
  R.site = statusLine.querySelector('.site');
  R.when = statusLine.querySelector('.when');
  R.next = statusLine.querySelector('.next');
  // Expanded is a preference, not a session state: the astronomer opens the
  // drawer once and keeps today's always-on readout for good.
  let detailsOpen = (() => {
    try { return localStorage.getItem('moonist.details') === '1'; } catch { return false; }
  })();
  function setDetails(open) {
    detailsOpen = open;
    status.classList.toggle('open', open);
    statusLine.title = open ? 'Hide the full readout' : 'Show the full readout';
    statusLine.setAttribute('aria-expanded', String(open));
    try { localStorage.setItem('moonist.details', open ? '1' : '0'); } catch { /* private mode */ }
  }
  setDetails(detailsOpen);
  statusLine.addEventListener('click', () => setDetails(!detailsOpen));

  // ---- popover plumbing (clock, sky) ---------------------------------------
  let openPop = null;
  let dismissHint = () => {}; // bound to the real dismiss while the hint lives
  function makePop(id, label) {
    const p = el('div', 'ui panel pop', hud);
    p.id = id;
    p.setAttribute('role', 'group');
    p.setAttribute('aria-label', label);
    return p;
  }
  function hidePop(restoreFocus = false) {
    if (!openPop) return;
    openPop.pop.classList.remove('open');
    openPop.btn.setAttribute('aria-expanded', 'false');
    // Only a deliberate close (Esc, the trigger again) sends focus back; an
    // outside click keeps focus where the user just put it.
    if (restoreFocus) openPop.btn.focus();
    openPop = null;
  }
  function togglePop(pop, btn) {
    if (openPop && openPop.pop === pop) {
      hidePop();
      return;
    }
    hidePop();
    dismissHint(); // the hint sits over the popover column; a popover outranks it
    pop.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    openPop = { pop, btn };
    // Anchor above the bar, centred over its button, clamped on-screen. The
    // bar's own rect sets the height so a wrapped two-row bar still clears.
    const br = btn.getBoundingClientRect();
    const dr = dock.getBoundingClientRect();
    pop.style.bottom = `${window.innerHeight - dr.top + 6}px`;
    const w = pop.getBoundingClientRect().width;
    pop.style.left = `${Math.max(8, Math.min(br.left + br.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
    pop.querySelector('button, input')?.focus();
  }
  // A click on anything that is not the open popover or its button closes it
  // — including the sky itself, which is on the canvas outside the hud.
  window.addEventListener('pointerdown', (e) => {
    if (!openPop) return;
    const path = e.composedPath();
    if (!path.includes(openPop.pop) && !path.includes(openPop.btn)) hidePop();
  });
  window.addEventListener('resize', hidePop); // anchored position goes stale

  // ---- sky popover: layer toggles + Earth magnifier ------------------------
  const skyPop = makePop('ui-sky-pop', 'Sky display options');
  const layerBtns = {};
  for (const [key, label, kbd] of [
    ['milkyWay', 'Milky Way', 'M'],
    ['constellations', 'Constellations', 'C'],
    ['starNames', 'Star names', 'N'],
  ]) {
    const b = el('button', 'btn', skyPop, `${label}<kbd>${kbd}</kbd>`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!toggles[key]));
    b.addEventListener('click', () => b.setAttribute('aria-pressed', String(onToggle(key))));
    layerBtns[key] = b;
  }
  // Earth magnifier: a display choice, so its ×N is printed beside the dial —
  // a giant Earth must always say it is artificial.
  // Log-mapped so the low end, where a nudge is most visible, gets the most
  // travel; the left stop is exactly ×1, the real size. Step 0.025 keeps a
  // drag pixel-smooth while every arrow-key press visibly ticks the label.
  const magGroup = el('span', 'earth-group', skyPop);
  el('span', 'zone', magGroup, 'EARTH');
  const mag = el('input', 'mag', magGroup);
  mag.type = 'range';
  mag.min = '0';
  mag.max = '1';
  mag.step = '0.025';
  mag.title = 'Magnify the Earth. Its face, phase and light stay real — only the image grows.';
  mag.setAttribute('aria-label', 'Earth image magnification');
  const magVal = el('span', 'x', magGroup);
  const fmtMag = (s) => `×${s < 9.95 ? s.toFixed(1) : s.toFixed(0)}`;
  // Screen readers must hear the ×N the sighted user sees, not the raw
  // log-mapped 0..1 slider value.
  const sayMag = (s) => mag.setAttribute('aria-valuetext', fmtMag(s));
  mag.addEventListener('input', () => {
    const s = view.setEarthScale(Math.exp(parseFloat(mag.value) * Math.log(view.earthScaleMax)));
    magVal.textContent = fmtMag(s);
    sayMag(s);
    lastMag = s; // this change came from the thumb — don't re-quantize it mid-drag
  });
  mag.value = String(Math.log(view.earthScale) / Math.log(view.earthScaleMax));
  magVal.textContent = fmtMag(view.earthScale);
  sayMag(view.earthScale);

  // ---- the bar -------------------------------------------------------------
  const dock = el('div', 'ui panel', hud);
  dock.id = 'ui-dock';
  const siteBtn = el('button', 'btn site-btn', dock);
  siteBtn.type = 'button';
  siteBtn.setAttribute('aria-haspopup', 'dialog');
  el('span', 'divider', dock);
  const speedBtns = SPEEDS.map(([s, label, short]) => {
    const b = el('button', 'btn', dock,
      `<span class="lab-w">${label}</span><span class="lab-n">${short}</span>`);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { clock.setSpeed(s); syncSpeed(); });
    return { s, b };
  });
  // The clock rides inside the speed group — one fence around "when it is",
  // not a divider splitting two halves of the same idea.
  const clockBtn = el('button', 'btn clock-btn', dock);
  clockBtn.type = 'button';
  clockBtn.setAttribute('aria-haspopup', 'true');
  clockBtn.setAttribute('aria-expanded', 'false');
  clockBtn.title = 'Jump to a date and time, in your local timezone';
  const clockFull = el('span', 'lab-w', clockBtn);
  const clockShort = el('span', 'lab-n', clockBtn);
  const clockZone = el('span', 'zone', clockBtn);
  el('span', 'divider', dock);
  const skyBtn = el('button', 'btn', dock, 'Sky');
  skyBtn.type = 'button';
  skyBtn.setAttribute('aria-haspopup', 'true');
  skyBtn.setAttribute('aria-expanded', 'false');
  skyBtn.title = 'Sky display: layers and the Earth magnifier';
  // Hide fences with Sky — both decide what you see, and an about-box does
  // not deserve equal weight with a view mode.
  const hideBtn = el('button', 'btn', dock, 'Hide<kbd>H</kbd>');
  hideBtn.type = 'button';
  hideBtn.title = 'Hide the interface for a pure sky — tap the sky, Esc or H brings it back';
  hideBtn.addEventListener('click', () => setChromeHidden(true));
  el('span', 'divider', dock);
  const creditsBtn = el('button', 'btn', dock, 'Credits');
  creditsBtn.type = 'button';
  creditsBtn.setAttribute('aria-haspopup', 'dialog');

  // ---- immersive mode ------------------------------------------------------
  // An explicit, labelled act — chrome never vanishes on its own. Tap, Esc or
  // H reveal; Esc never hides. Hotkeys keep working while hidden and confirm
  // through the transient OSD instead of dragging the panels back.
  let chromeHidden = false;
  let hideLessons = (() => {
    // No storage means every session is a first session — teach, don't skip.
    try { return parseInt(localStorage.getItem('moonist.hideHint') || '0', 10) || 0; } catch { return 0; }
  })();
  function setChromeHidden(on) {
    if (chromeHidden === on) return;
    chromeHidden = on;
    if (on) {
      hidePop();
      // Every entry names the way back — in the default state immersive mode
      // is zero pixels of chrome, and a caption is the only exit a
      // pointer-only user is ever shown. The first two are longer lessons.
      if (hideLessons < 2) {
        hideLessons += 1;
        try { localStorage.setItem('moonist.hideHint', String(hideLessons)); } catch { /* private mode */ }
        osd('Interface hidden — tap the sky or press H to bring it back', 3200);
      } else {
        osd('Tap the sky to bring the interface back', 1400);
      }
    }
    hud.classList.toggle('immersive', on);
  }

  // ---- honesty chips -------------------------------------------------------
  const chips = el('div', 'ui', hud);
  chips.id = 'ui-chips';
  const earthChip = el('button', 'panel chip', chips);
  earthChip.type = 'button';
  earthChip.title = 'The Earth is drawn magnified — its face, phase and light stay real. Click to adjust.';
  earthChip.addEventListener('click', () => {
    setChromeHidden(false);
    if (openPop?.pop !== skyPop) togglePop(skyPop, skyBtn);
  });
  const timeChip = el('button', 'panel chip', chips);
  timeChip.type = 'button';
  timeChip.title = 'Time is running away from your clock. Click for the time controls.';
  timeChip.addEventListener('click', () => {
    setChromeHidden(false);
    if (openPop?.pop !== clockPop) togglePop(clockPop, clockBtn);
  });

  // ---- transient OSD -------------------------------------------------------
  const osdEl = el('div', 'ui panel', hud);
  osdEl.id = 'ui-osd';
  osdEl.setAttribute('role', 'status');
  let osdTimer = 0;
  function osd(text, ms = 1200) {
    osdEl.textContent = text;
    osdEl.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osdEl.classList.remove('show'), ms);
  }

  // ---- clock popover: the date the bar's clock opens onto ------------------
  const clockPop = makePop('ui-clock-pop', 'Simulated date and time');
  const whenRow = el('div', 'row', clockPop);
  const dt = el('input', 'dt', whenRow);
  dt.type = 'datetime-local';
  dt.step = 60;
  dt.min = localMinutes(new Date(MIN_TIME));
  dt.max = localMinutes(new Date(MAX_TIME));
  dt.title = 'Jump to a date and time, in your local timezone';
  dt.setAttribute('aria-label', 'Simulated date and time, local timezone');
  dt.addEventListener('change', () => {
    // A datetime-local value carries no offset, so this parses as local time —
    // the same clock the field displays.
    if (dt.value) clock.setTime(new Date(dt.value));
  });
  const zoneEl = el('span', 'zone', whenRow, zoneLabel(new Date()));
  const nowBtn = el('button', 'btn', whenRow, 'Now<kbd>0</kbd>');
  nowBtn.type = 'button';
  nowBtn.addEventListener('click', () => { clock.resetToRealTime(); syncSpeed(); });
  clockBtn.addEventListener('click', () => togglePop(clockPop, clockBtn));
  skyBtn.addEventListener('click', () => togglePop(skyPop, skyBtn));
  // Tab must flow bar → popover content: the sky popover was built before the
  // bar (its buttons feed layerBtns), so move it after the bar in the DOM.
  hud.appendChild(skyPop);

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
    hidePop();
    dismissHint();
    if (openModal) openModal.back.classList.remove('open');
    m.back.classList.add('open');
    // A reopened sheet must not keep last time's scroll — a stale offset
    // slices the title and puts the close button half off the sheet.
    m.sheet.scrollTop = 0;
    m.opener = opener;
    openModal = m;
    // Land focus on the current selection, not on Close — but without
    // scrolling it into view: on a short viewport that pushed the title and
    // the close button clean off the top of the sheet. The sheet opens at
    // its head; keyboard travel brings the selection on screen naturally.
    const first = m.sheet.querySelector('.card[aria-current="true"]')
      ?? m.sheet.querySelector('.card')
      ?? m.sheet.querySelector('.close');
    if (first) first.focus({ preventScroll: true });
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
    const name = view.site.name;
    const short = name.split('—')[0].trim();
    // Narrow widths get the site's short name, not a mid-word ellipsis —
    // in the bar and in the capsule alike.
    siteBtn.innerHTML = `<span class="lab-w">${name}</span><span class="lab-n">${short}</span>`;
    R.site.innerHTML = `<span class="lab-w">${name}</span><span class="lab-n">${short}</span>`;
    R.site.dataset.name = name;
  }
  siteBtn.addEventListener('click', () => { syncCards(); showModal(picker, siteBtn); });

  // ---- credits -------------------------------------------------------------
  const credits = makeModal('ui-credits', 'Built from real data',
    'Everything you see is measured, not invented. The sky comes from an ephemeris checked against JPL Horizons; the ground is NASA laser altimetry; the clouds are this morning’s weather.');
  const list = el('ul', 'credits-list', credits.sheet);
  for (const [name, what, lic] of CREDITS) {
    el('li', null, list, `<b>${name}</b> — ${what}<br><span>${lic}</span>`);
  }
  // The one place the whole keyboard is written down — the licence-mandated
  // sheet earns double duty.
  el('h2', null, credits.sheet, 'Keyboard');
  const keysUl = el('ul', 'credits-list', credits.sheet);
  for (const [k, what] of [
    ['Drag or arrow keys', 'look around'],
    ['Scroll, + and −', 'zoom'],
    ['1 – 5', 'time speed, Real to 1 wk/s'],
    ['0', 'back to now'],
    ['E', 'find the Earth'],
    ['M, C, N', 'Milky Way, constellations, star names'],
    ['D', 'the full readout'],
    ['H', 'hide the interface'],
    ['Esc', 'close, then reveal'],
  ]) {
    el('li', null, keysUl, `<b>${k}</b> — ${what}`);
  }
  creditsBtn.addEventListener('click', () => showModal(credits, creditsBtn));

  // Esc walks back one layer at a time — and never hides anything.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (openModal) hideModal();
    else if (openPop) hidePop(true);
    else setChromeHidden(false);
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
    hint.innerHTML = '<span><b>Drag</b> to look around · <b>scroll</b> to zoom · <b>E</b> finds the Earth · <b>H</b> hides everything.<br>'
      + 'The Earth never moves here, and the Sun takes two weeks to rise — <b>speed up time</b> below.</span>'
      + '<span class="dismiss" role="button" tabindex="0">Got it</span>';
    const dismiss = () => {
      if (!hint) return;
      const node = hint;
      hint = null; // nulled first so update() stops repositioning it...
      node.style.opacity = '0';
      // ...and removed via its own reference — `hint?.remove()` after the
      // null was a no-op, leaving an invisible box with live pointer-events
      // exactly where the popovers open (found by dogfooding).
      node.style.pointerEvents = 'none';
      setTimeout(() => node.remove(), 420);
      try { localStorage.setItem('moonist.seen', '1'); } catch { /* private mode */ }
    };
    dismissHint = dismiss;
    hint.querySelector('.dismiss').addEventListener('click', dismiss);
    // Do not let the very gesture the hint teaches destroy it: the first drag
    // starts a grace period rather than dismissing outright.
    window.addEventListener('pointerdown', (e) => {
      if (e.target?.closest?.('#ui-hint')) return;
      setTimeout(dismiss, 6000);
    }, { once: true });
    setTimeout(dismiss, 25000);
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
      // Earth pointer: only when the Earth's disc is genuinely off screen —
      // the whole disc at its displayed (possibly magnified) size.
      const p = view.projectDir(state.earth.sceneDir, state.earth.angRadiusDeg * view.earthScale);
      // The chip never floats over an open sheet — it is appended after the
      // backdrops, so without this it would paint on top of the dialog.
      if (p.onScreen || openModal) {
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
        let px2 = cx + dx * scale;
        let py2 = cy + dy * scale;
        // Never sit on the status capsule: drop below it instead.
        const rr = status.getBoundingClientRect();
        if (px2 < rr.right + 60 && py2 < rr.bottom + 26) py2 = rr.bottom + 26;
        ptr.style.display = 'flex';
        ptr.style.left = `${px2}px`;
        ptr.style.top = `${py2}px`;
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

      // The hint sits above the bar wherever the bar actually is — at narrow
      // widths the bar wraps taller, and a fixed clearance slid under it.
      if (hint) hint.style.bottom = `${window.innerHeight - dock.getBoundingClientRect().top + 8}px`;

      const d = state.time.date;
      const speedLabel = SPEEDS.find(([s]) => s === clock.speed)?.[1] ?? `${clock.speed}×`;
      if (R.site.dataset.name !== view.site.name) syncCards();
      const zone = zoneLabel(d);
      const stamp = localMinutes(d);
      // The capsule stays one short line: the date appears only when the sim
      // has left today, and keeps its year once it has left this year — a
      // clock reading "08-12 10:45" in a 2100 simulation would be a lie.
      const today = localMinutes(new Date()).slice(0, 10);
      const dispDate = (stamp.slice(0, 4) === today.slice(0, 4) ? stamp.slice(5) : stamp.slice(0, 16))
        .replace('T', ' ');
      const when = stamp.slice(0, 10) === today ? stamp.slice(11) : dispDate;
      R.when.textContent = `${when} ${zone} · ${speedLabel}`;
      // Same-day displacement would otherwise pass for the real clock — the
      // one dishonest state left. Same >60s test as the hidden-mode chip.
      R.when.classList.toggle('warped', Math.abs(d.getTime() - Date.now()) > 60e3);
      // The zone abbreviation follows the simulated date across a DST boundary.
      if (zoneEl.textContent !== zone) zoneEl.textContent = zone;
      // The bar's clock button is the same moment, sized for its breakpoint.
      clockFull.textContent = stamp.replace('T', ' ');
      clockShort.textContent = stamp.slice(11);
      if (clockZone.textContent !== zone) clockZone.textContent = zone;

      // Honesty chips. The Earth chip outranks everything: it is on whenever
      // the disc is drawn bigger than the sky holds it, chrome or no chrome.
      const magnified = view.earthScale > 1.001;
      earthChip.classList.toggle('on', magnified);
      if (magnified) earthChip.textContent = `EARTH ${fmtMag(view.earthScale)}`;
      const warp = [];
      if (clock.speed !== 1) warp.push(speedLabel);
      if (Math.abs(d.getTime() - Date.now()) > 60e3) warp.push(dispDate);
      timeChip.classList.toggle('on', chromeHidden && warp.length > 0);
      if (warp.length) timeChip.textContent = `TIME ${warp.join(' · ')}`;

      // Running into the ephemeris limit must not look like a silent freeze.
      if (clock.atLimit && clock.speed !== 1 && !atLimitWarned) {
        atLimitWarned = true;
        clock.setSpeed(1);
        syncSpeed();
        api.showError('Reached the edge of the reliable ephemeris (1700–2200) — dropped back to real time.');
      } else if (!clock.atLimit) {
        atLimitWarned = false;
      }
      R.sun.textContent = `${fmtAlt(state.sun.alt)} alt · ${fmtAz(state.sun.az)} az`;
      R.earth.textContent = `${fmtAlt(state.earth.alt)} alt · ${(state.earth.illumFraction * 100).toFixed(0)}% lit`;

      // A lunar hour is 29.53/24 Earth days, so this clock needs its scale
      // spelled out to mean anything — and its label has to say "lunar", now
      // that the date above it is the viewer's own local time.
      const lsh = state.localSolarHours;
      R.local.textContent = `${fmtClock(lsh)} · day ${(lsh / 24 * 29.5).toFixed(1)} of 29.5`;
      const ev = view.nextSunEvent();
      if (ev) {
        const kind = ev.kind === 'sunrise' ? 'Sunrise' : 'Sunset';
        R.next.textContent = ev.days < 1
          ? `${kind} in ${(ev.days * 24).toFixed(1)} h`
          : `${kind} in ${ev.days.toFixed(1)} d`;
      } else {
        R.next.textContent = `no ${state.sun.alt > 0 ? 'sunset' : 'sunrise'} for a month`;
      }

      // The magnifier can also be driven through the view API; the chrome
      // must never disagree with the disc actually drawn.
      if (view.earthScale !== lastMag) {
        lastMag = view.earthScale;
        mag.value = String(Math.log(lastMag) / Math.log(view.earthScaleMax));
        magVal.textContent = fmtMag(lastMag);
        sayMag(lastMag);
      }

      const lk = view.look;
      // Below 2° whole degrees round the readout to nothing ("0° fov").
      const fov = lk.fov < 2 ? lk.fov.toFixed(1) : lk.fov.toFixed(0);
      R.look.textContent = `${fmtAlt(lk.alt)} alt · ${fmtAz(lk.az)} az · ${fov}° fov`;
      // Cloud freshness: say when the live map was fetched, and be explicit
      // that clouds are always today's weather — when the clock is far from
      // the present, the geometry time-travels but the weather cannot.
      if (typeof cloudStatus === 'object' && cloudStatus !== null) {
        const { kind, fetchedAt } = cloudStatus;
        if (kind === 'live' && fetchedAt) {
          const timeTraveling = Math.abs(d.getTime() - Date.now()) > 12 * 3600e3;
          R.clouds.textContent = timeTraveling
            ? 'live — showing today’s weather'
            : `live · fetched ${localMinutes(fetchedAt).slice(11)}`;
        } else if (kind === 'offline') {
          R.clouds.textContent = 'offline copy';
        } else {
          R.clouds.textContent = kind;
        }
      } else {
        R.clouds.textContent = String(cloudStatus);
      }

      if (document.activeElement !== dt) dt.value = localMinutes(d);
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

    /** Expand or collapse the details drawer (hotkey D). */
    toggleDetails() {
      setDetails(!detailsOpen);
    },

    /** True while the picker or credits sheet is open (blocks app hotkeys). */
    get modalOpen() {
      return openModal !== null;
    },

    /** True while the interface is hidden for a pure sky. */
    get hidden() {
      return chromeHidden;
    },
    setChromeHidden,
    toggleChrome() {
      setChromeHidden(!chromeHidden);
    },
    /** Flash a transient confirmation (hotkeys pressed while hidden). */
    osd,

    /** Screen areas the sky-label layer must keep clear. */
    panelRects() {
      const rects = [];
      // Hidden chrome frees the whole frame for sky labels; only the honesty
      // chips and a live toast still claim their ground.
      const nodes = chromeHidden
        ? [chips, osdEl.classList.contains('show') ? osdEl : null, msg.style.display === 'block' ? msg : null]
        : [status, dock, skyPop, clockPop, chips, hint, osdEl.classList.contains('show') ? osdEl : null,
          msg.style.display === 'block' ? msg : null];
      for (const node of nodes) {
        if (!node) continue;
        const r = node.getBoundingClientRect();
        if (r.width > 0) rects.push({ x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 });
      }
      return rects;
    },
  };

  let lastText = 0;
  let lastCards = 0;
  let lastMag = view.earthScale;
  let atLimitWarned = false;
  syncCards();
  return api;
}
