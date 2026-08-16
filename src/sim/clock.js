// Simulation clock: real time by default, with adjustable speed and offset
// (time-lapse is essential when a lunar day lasts ~29.5 Earth days).

const state = {
  baseRealMs: Date.now(),
  baseSimMs: Date.now(),
  speed: 1,
};

export const clock = {
  now() {
    return new Date(state.baseSimMs + (Date.now() - state.baseRealMs) * state.speed);
  },
  get speed() {
    return state.speed;
  },
  setSpeed(s) {
    const nowSim = this.now().getTime();
    state.baseRealMs = Date.now();
    state.baseSimMs = nowSim;
    state.speed = s;
  },
  setTime(date) {
    state.baseRealMs = Date.now();
    state.baseSimMs = date.getTime();
  },
  resetToRealTime() {
    state.baseRealMs = Date.now();
    state.baseSimMs = Date.now();
    state.speed = 1;
  },
};
