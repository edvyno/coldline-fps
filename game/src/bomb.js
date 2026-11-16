// The charge: the objective the round is actually about. It is carried at the start, planted on the
// valve by holding the plant key inside the site, then either defused by a defender's five seconds
// on it or left to blow. The beep rate is the clock you can hear.
import { RULES } from './state.js';

export function inSite(state, x, z) {
  const site = state.bomb.site;
  return Math.hypot(x - site.x, z - site.z) <= 3.1;
}

// Holding the plant key inside the site fills the bar; letting go empties it. Returns true on the
// frame it completes, so the caller plays the sound and the feed line once.
export function stepPlant(state, dt, holding, hooks) {
  const bomb = state.bomb;
  const p = state.player;
  if (bomb.state !== 'carried') return false;
  const eligible = p.alive && p.hasBomb && inSite(state, p.pos.x, p.pos.z) && p.onGround;
  if (!eligible || !holding) {
    bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 1.6);
    return false;
  }
  bomb.plantProgress += dt;
  if (Math.floor(bomb.plantProgress * 6) !== Math.floor((bomb.plantProgress - dt) * 6)) {
    hooks.audio.defuse();
  }
  if (bomb.plantProgress >= RULES.plantSeconds) {
    bomb.plantProgress = RULES.plantSeconds;
    bomb.state = 'planted';
    bomb.timer = RULES.fuseSeconds;
    bomb.beep = 0;
    p.hasBomb = false;
    hooks.audio.plant();
    hooks.onPlanted();
    return true;
  }
  return false;
}

// One step of the charge. Planted, it counts down, beeps faster as it runs out, and blows.
export function stepBomb(state, world, dt, hooks) {
  const bomb = state.bomb;
  if (bomb.state !== 'planted') return;
  bomb.timer -= dt;
  bomb.beep -= dt;
  const urgency = 1 - Math.max(0, bomb.timer) / RULES.fuseSeconds;
  const interval = 1.05 - urgency * 0.9;
  if (bomb.beep <= 0) {
    bomb.beep = Math.max(0.12, interval);
    hooks.audio.beep(bomb.timer < 10);
  }
  if (bomb.timer <= 0) {
    bomb.timer = 0;
    bomb.state = 'exploded';
    hooks.onExploded();
  }
}

// A defender's defuse: five seconds on the valve, and the bar resets if it is pushed off. A kit
// cuts the time; the defenders carry none, so it is the full five.
export function addDefuse(state, dt, hooks) {
  const bomb = state.bomb;
  if (bomb.state !== 'planted') return false;
  bomb.defuseProgress += dt;
  if (Math.floor(bomb.defuseProgress * 5) !== Math.floor((bomb.defuseProgress - dt) * 5)) {
    hooks.audio.defuse();
  }
  if (bomb.defuseProgress >= RULES.defuseSeconds) {
    bomb.state = 'defused';
    hooks.onDefused();
    return true;
  }
  return false;
}

// A defender pushed off the valve loses the progress it had made.
export function resetDefuse(state) {
  state.bomb.defuseProgress = Math.max(0, state.bomb.defuseProgress - 0.02);
}
