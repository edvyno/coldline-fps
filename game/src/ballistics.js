// Ballistics: every bullet is a ray. The ray is tested against the map's boxes and against the
// bodies in it, nearest first, and what it hits decides the damage: a head takes a multiple, a leg
// less, and armour eats part of the rest. Nothing here draws anything: it returns where the shot
// ended, and main.js puts a tracer on it.
import { rayWorld, rayCylinder, blocked } from './physics.js';
import { damageAtRange } from './weapons.js';

// Body volumes, in the bot's own frame: feet at pos.y. Head is a small sphere tested as a short
// cylinder (cheap and close enough at rifle ranges), torso and legs as wider ones.
const HEAD_Y = 1.62;
const HEAD_RADIUS = 0.19;
const HEAD_HALF = 0.14;
const TORSO_Y = 1.02;
const TORSO_RADIUS = 0.34;
const TORSO_HALF = 0.46;
const LEG_Y = 0.44;
const LEG_RADIUS = 0.3;
const LEG_HALF = 0.44;

// The nearest thing a ray meets: a bot, the player, or the map. `part` is 'head', 'body' or 'legs'.
export function traceShot(state, world, ox, oy, oz, dx, dy, dz, maxRange, ignorePlayer) {
  const wallT = rayWorld(ox, oy, oz, dx, dy, dz, maxRange, world.colliders);
  let bestT = wallT >= 0 ? wallT : maxRange;
  let hit = wallT >= 0 ? { type: 'world', t: bestT } : { type: 'none', t: maxRange };

  for (let i = 0; i < state.bots.length; i += 1) {
    const bot = state.bots[i];
    if (!bot.alive) continue;
    const headT = rayCylinder(ox, oy, oz, dx, dy, dz, bestT, bot.pos.x, bot.pos.y + HEAD_Y, bot.pos.z, HEAD_RADIUS, HEAD_HALF);
    const torsoT = rayCylinder(ox, oy, oz, dx, dy, dz, bestT, bot.pos.x, bot.pos.y + TORSO_Y, bot.pos.z, TORSO_RADIUS, TORSO_HALF);
    const legT = rayCylinder(ox, oy, oz, dx, dy, dz, bestT, bot.pos.x, bot.pos.y + LEG_Y, bot.pos.z, LEG_RADIUS, LEG_HALF);
    let part = null;
    let partT = Infinity;
    if (headT >= 0 && headT < partT) {
      part = 'head';
      partT = headT;
    }
    if (torsoT >= 0 && torsoT < partT) {
      part = 'body';
      partT = torsoT;
    }
    if (legT >= 0 && legT < partT) {
      part = 'legs';
      partT = legT;
    }
    if (part && partT < bestT) {
      bestT = partT;
      hit = { type: 'bot', t: partT, botIndex: i, part };
    }
  }

  if (!ignorePlayer && state.player.alive) {
    const p = state.player;
    const crouchDrop = p.crouch * 0.42;
    const headY = p.pos.y + HEAD_Y - crouchDrop;
    const headT = rayCylinder(ox, oy, oz, dx, dy, dz, bestT, p.pos.x, headY, p.pos.z, 0.2, 0.16);
    const bodyT = rayCylinder(ox, oy, oz, dx, dy, dz, bestT, p.pos.x, p.pos.y + TORSO_Y - crouchDrop, p.pos.z, 0.34, 0.5);
    let part = null;
    let partT = Infinity;
    if (headT >= 0 && headT < partT) {
      part = 'head';
      partT = headT;
    }
    if (bodyT >= 0 && bodyT < partT) {
      part = 'body';
      partT = bodyT;
    }
    if (part && partT < bestT) {
      bestT = partT;
      hit = { type: 'player', t: partT, part };
    }
  }

  hit.point = { x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT };
  hit.distance = bestT;
  return hit;
}

// A body's damage: the weapon's falloff, the part's multiplier, and armour that absorbs a share of
// what is left. Armour never blocks more than half, so a headshot still decides a fight.
export function damageFor(weapon, part, distance) {
  const base = damageAtRange(weapon, distance);
  if (part === 'head') return base * weapon.headMultiplier;
  if (part === 'legs') return base * weapon.legMultiplier;
  return base;
}

// Applies damage to a bot and reports whether it died. The caller adds money and feed lines, so
// the rules of the round stay in one place (rounds.js) rather than hiding in here.
export function damageBot(bot, amount, part) {
  if (!bot.alive) return { killed: false, dealt: 0 };
  let remaining = amount;
  if (bot.armour > 0) {
    const absorbed = Math.min(bot.armour, remaining * 0.5);
    bot.armour -= absorbed;
    remaining -= absorbed;
  }
  const dealt = Math.min(bot.health, remaining);
  bot.health -= remaining;
  bot.hurtTimer = 0.28;
  if (bot.health <= 0) {
    bot.health = 0;
    bot.alive = false;
    return { killed: true, dealt, part };
  }
  return { killed: false, dealt, part };
}

export function damagePlayer(state, amount, part, fromX, fromZ) {
  const p = state.player;
  if (!p.alive) return { killed: false, dealt: 0 };
  let remaining = amount;
  if (p.armour > 0) {
    const absorbed = Math.min(p.armour, remaining * 0.5);
    p.armour -= absorbed;
    remaining -= absorbed;
  }
  const dealt = Math.min(p.health, remaining);
  p.health -= remaining;
  p.hurtTimer = 0.6;
  p.flash = 1;
  p.lastHitFrom = { x: fromX, z: fromZ };
  if (p.health <= 0) {
    p.health = 0;
    p.alive = false;
    return { killed: true, dealt, part };
  }
  return { killed: false, dealt, part };
}

// Falloff for an explosion: full damage at the middle, nothing at the edge, halved without a line
// of sight. Walls stop frags, which is the point of taking cover from one.
export function explosionDamage(world, x, y, z, radius, maxDamage, targetX, targetY, targetZ) {
  const distance = Math.hypot(targetX - x, targetY - y, targetZ - z);
  if (distance > radius) return 0;
  const falloff = 1 - distance / radius;
  const clear = !blocked(x, y + 0.2, z, targetX, targetY + 1.0, targetZ, world.colliders);
  return maxDamage * falloff * falloff * (clear ? 1 : 0.35);
}
