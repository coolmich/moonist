// Simulation clock: real time by default, with adjustable speed and offset
// (time-lapse is essential when a lunar day lasts ~29.5 Earth days).
//
// Times are clamped to the range where the ephemeris is trustworthy.
// astronomy-engine's light-travel solver throws outside roughly ±200 000 yr,
// and its stated accuracy only holds over a few centuries, so the clock
// refuses to leave 1700–2200 rather than letting the renderer break.

export const MIN_TIME = Date.UTC(1700, 0, 1);
export const MAX_TIME = Date.UTC(2200, 0, 1);

function clamp(ms) {
  return Math.min(Math.max(ms, MIN_TIME), MAX_TIME);
}

const state = {
  baseRealMs: Date.now(),
  baseSimMs: Date.now(),
  speed: 1,
};

export const clock = {
  now() {
    return new Date(clamp(state.baseSimMs + (Date.now() - state.baseRealMs) * state.speed));
  },
  get speed() {
    return state.speed;
  },
  /** True while the simulated time is pinned at an end of the supported range. */
  get atLimit() {
    const raw = state.baseSimMs + (Date.now() - state.baseRealMs) * state.speed;
    return raw <= MIN_TIME || raw >= MAX_TIME;
  },
  setSpeed(s) {
    const nowSim = this.now().getTime();
    state.baseRealMs = Date.now();
    state.baseSimMs = nowSim;
    state.speed = s;
  },
  setTime(date) {
    const ms = date instanceof Date ? date.getTime() : Number(date);
    if (!Number.isFinite(ms)) return;
    state.baseRealMs = Date.now();
    state.baseSimMs = clamp(ms);
  },
  resetToRealTime() {
    state.baseRealMs = Date.now();
    state.baseSimMs = Date.now();
    state.speed = 1;
  },
};
