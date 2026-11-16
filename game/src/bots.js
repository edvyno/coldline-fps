// Bots: three defenders who patrol lanes, hold posts, hear a shot and go and look, and defuse the
// charge when it is down. Each bot is a small state machine — patrol, investigate, engage, defuse —
// and its eyes are a cone plus a line-of-sight ray, so cover works against them.
import { moveBody, blocked, BODY_RADIUS, STAND_HEIGHT } from './physics.js';
import { WEAPONS } from './weapons.js';
import { traceShot, damageFor, damagePlayer } from './ballistics.js';
import { findPath, PATROLS, HOLD_POINTS, nodeById, investigateTarget, nearestNode } from './nav.js';

const VIEW_RANGE = 42;
const VIEW_CONE = Math.cos(0.72); // ~41 degrees either side of the facing
const HEAR_RANGE = 30;
const MOVE_SPEED = 3.65;
const ACCEL = 9.5;
const ENGAGE_STRAFE = 0.55;

// The bot's aim point: the player's chest, corrected by an error that shrinks when it has had a
// clear look for a while. Distance and its own reaction time make the first burst the worst one.
function aimPoint(bot, player, dt, state) {
  const crouchDrop = player.crouch * 0.42;
  const chestY = player.pos.y + 1.15 - crouchDrop;
  const dx = player.pos.x - bot.pos.x;
  const dy = chestY - (bot.pos.y + 1.55);
  const dz = player.pos.z - bot.pos.z;
  const distance = Math.hypot(dx, dy, dz) || 1;
  // error: a cone that tightens with the time on target, and never fully closes
  const settle = Math.min(1, Math.max(0, (state.elapsed - bot.targetSeenAt) / 1.35));
  const errorScale = (0.055 - settle * 0.04) * (1 + distance / 42);
  const yawError = (state.rng() * 2 - 1) * errorScale;
  const pitchError = (state.rng() * 2 - 1) * errorScale * 0.7;
  return { x: dx / distance + yawError, y: dy / distance + pitchError, z: dz / distance + yawError * 0.3, distance };
}

function canSee(state, world, bot) {
  const p = state.player;
  if (!p.alive) return false;
  const dx = p.pos.x - bot.pos.x;
  const dz = p.pos.z - bot.pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance > VIEW_RANGE) return false;
  // the cone: facing vector against the direction to the target
  const facingX = -Math.sin(bot.yaw);
  const facingZ = -Math.cos(bot.yaw);
  const dot = (dx * facingX + dz * facingZ) / (distance || 1);
  const closeEnough = distance < 3.2; // heard, not seen, but right on top of it
  if (dot < VIEW_CONE && !closeEnough) return false;
  const eyeY = bot.pos.y + 1.55;
  const targetY = p.pos.y + 1.3 - p.crouch * 0.42;
  return !blocked(bot.pos.x, eyeY, bot.pos.z, p.pos.x, targetY, p.pos.z, world.colliders);
}

// A bot walking to a point: accelerate towards it, turn to face the way it is going, and let the
// physics stop it against walls. Returns true when it has arrived.
function walkTo(state, world, bot, x, z, dt, speedScale) {
  const dx = x - bot.pos.x;
  const dz = z - bot.pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.65) {
    bot.vel.x *= 0.7;
    bot.vel.z *= 0.7;
    return true;
  }
  const nx = dx / distance;
  const nz = dz / distance;
  const speed = MOVE_SPEED * (speedScale ?? 1);
  bot.vel.x += nx * ACCEL * dt * 1.6;
  bot.vel.z += nz * ACCEL * dt * 1.6;
  const current = Math.hypot(bot.vel.x, bot.vel.z);
  if (current > speed) {
    bot.vel.x = (bot.vel.x / current) * speed;
    bot.vel.z = (bot.vel.z / current) * speed;
  }
  bot.yaw = Math.atan2(-nx, -nz);
  return false;
}

function faceTowards(bot, x, z, dt) {
  const dx = x - bot.pos.x;
  const dz = z - bot.pos.z;
  const wanted = Math.atan2(-dx, -dz);
  let delta = wanted - bot.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  bot.yaw += delta * Math.min(1, dt * 9);
}

function followPath(state, world, bot, dt, speedScale) {
  if (bot.path.length === 0 || bot.pathIndex >= bot.path.length) {
    bot.vel.x *= 0.72;
    bot.vel.z *= 0.72;
    return true;
  }
  const node = nodeById(bot.path[bot.pathIndex]);
  if (!node) {
    bot.pathIndex += 1;
    return false;
  }
  const arrived = walkTo(state, world, bot, node.x, node.z, dt, speedScale);
  if (arrived) bot.pathIndex += 1;
  return bot.pathIndex >= bot.path.length;
}

function repath(bot, state, targetId) {
  bot.path = findPath(bot.pos.x, bot.pos.z, targetId);
  bot.pathIndex = 0;
  bot.repathTimer = 1.2;
}

function patrolStep(state, world, bot, dt) {
  const route = PATROLS[bot.routeName] ?? PATROLS.roamer;
  if (bot.path.length === 0) {
    const targetId = route[bot.patrolIndex % route.length];
    repath(bot, state, targetId);
    if (bot.path.length === 0) {
      bot.patrolIndex += 1;
      bot.vel.x *= 0.6;
      bot.vel.z *= 0.6;
      return;
    }
  }
  const done = followPath(state, world, bot, dt, 0.82);
  if (done) {
    bot.patrolIndex += 1;
    // pause at the end of each leg, the way a defender checks a corner
    bot.holdUntil = state.elapsed + 1.2 + state.rng() * 1.6;
  }
}

function shootAtPlayer(state, world, bot, hooks, dt) {
  const p = state.player;
  const weapon = WEAPONS[bot.weapon];
  if (!weapon) return;
  if (bot.reloadLeft > 0 || bot.fireCooldown > 0) return;
  if (bot.burstLeft <= 0) return;
  const aim = aimPoint(bot, p, dt, state);
  const length = Math.hypot(aim.x, aim.y, aim.z) || 1;
  const dx = aim.x / length;
  const dy = aim.y / length;
  const dz = aim.z / length;
  const eyeY = bot.pos.y + 1.55;
  const hit = traceShot(state, world, bot.pos.x, eyeY, bot.pos.z, dx, dy, dz, weapon.range, true);
  bot.burstLeft -= 1;
  bot.ammo -= 1;
  bot.fireCooldown = 60 / weapon.rpm + (bot.burstLeft === 0 ? 0.28 + state.rng() * 0.3 : 0);
  if (bot.burstLeft === 0) bot.burstGap = 0.2 + state.rng() * 0.25;
  hooks.onBotShot({ bot, origin: { x: bot.pos.x, y: eyeY, z: bot.pos.z }, direction: { x: dx, y: dy, z: dz }, hit, weapon });
  if (hit.type === 'player') {
    const amount = damageFor(weapon, hit.part, hit.distance);
    const result = damagePlayer(state, amount, hit.part, bot.pos.x, bot.pos.z);
    hooks.audio.hurt();
    if (result.killed) hooks.onPlayerKilled(bot);
  }
  if (bot.ammo <= 0) bot.reloadLeft = weapon.reloadSeconds;
}

// One bot, one step. The order is deliberate: look, then decide, then move, then shoot.
function stepOne(state, world, bot, dt, hooks) {
  bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
  bot.hurtTimer = Math.max(0, bot.hurtTimer - dt);
  bot.strafeTimer -= dt;
  if (bot.reloadLeft > 0) {
    bot.reloadLeft -= dt;
    if (bot.reloadLeft <= 0) bot.ammo = WEAPONS[bot.weapon].mag;
  }
  if (!bot.alive) {
    bot.vel.x *= 0.85;
    bot.vel.z *= 0.85;
    return;
  }

  // ---- perception
  const seePlayer = canSee(state, world, bot);
  if (seePlayer) {
    bot.targetSeenAt = state.elapsed;
    bot.lastSeen.x = state.player.pos.x;
    bot.lastSeen.y = state.player.pos.y;
    bot.lastSeen.z = state.player.pos.z;
    if (bot.state !== 'engage') {
      // first contact: a beat of reaction before the trigger, and the rest of the squad hears it
      bot.reaction = 0.18 + state.rng() * 0.16;
      bot.state = 'engage';
      bot.engageUntil = state.elapsed + 8;
      if (bot.burstLeft <= 0) bot.burstLeft = 0;
      hooks.onBotAlert(bot, state.player.pos.x, state.player.pos.z);
    }
    bot.engageUntil = state.elapsed + 4.5;
  }

  // ---- the charge changes everything: a planted bomb pulls the nearest defender to defuse
  const bomb = state.bomb;
  if (bomb.state === 'planted' && (bot.routeName === 'anchor' || bot.defusing)) {
    bot.state = 'defuse';
  }

  if (bot.state === 'engage' && state.elapsed > bot.engageUntil) {
    bot.state = 'investigate';
    bot.investigateUntil = state.elapsed + 5;
    bot.investigatePoint = { x: bot.lastSeen.x, z: bot.lastSeen.z };
    repath(bot, state, nearestNode(bot.lastSeen.x, bot.lastSeen.z).id);
  }

  // ---- act
  if (bot.state === 'engage' && seePlayer) {
    const p = state.player;
    faceTowards(bot, p.pos.x, p.pos.z, dt);
    // strafe across the sightline so it is not a static target
    if (bot.strafeTimer <= 0) {
      bot.strafe = state.rng() > 0.5 ? 1 : -1;
      bot.strafeTimer = 0.6 + state.rng() * 0.9;
    }
    const rightX = Math.cos(bot.yaw);
    const rightZ = Math.sin(bot.yaw);
    bot.vel.x += rightX * bot.strafe * ENGAGE_STRAFE * ACCEL * dt;
    bot.vel.z += rightZ * bot.strafe * ENGAGE_STRAFE * ACCEL * dt;
    const speed = Math.hypot(bot.vel.x, bot.vel.z);
    if (speed > 2.1) {
      bot.vel.x = (bot.vel.x / speed) * 2.1;
      bot.vel.z = (bot.vel.z / speed) * 2.1;
    }
    // fire in bursts, after the reaction delay
    if (state.elapsed - bot.targetSeenAt < bot.reaction) {
      // still reacting
    } else {
      if (bot.burstLeft <= 0 && bot.burstGap <= 0) bot.burstLeft = 3 + Math.floor(state.rng() * 3);
      shootAtPlayer(state, world, bot, hooks, dt);
    }
    bot.burstGap = Math.max(0, bot.burstGap - dt);
  } else if (bot.state === 'engage' && !seePlayer) {
    // lost sight: move to where it last saw the player, ready to fire
    const target = bot.lastSeen;
    if (walkTo(state, world, bot, target.x, target.z, dt, 0.95)) {
      bot.state = 'investigate';
      bot.investigateUntil = state.elapsed + 4;
      repath(bot, state, nearestNode(bot.pos.x, bot.pos.z).id);
    }
    bot.burstLeft = 0;
  } else if (bot.state === 'defuse' && bomb.state === 'planted') {
    const site = bomb.site;
    const distance = Math.hypot(bot.pos.x - site.x, bot.pos.z - site.z);
    if (distance > 1.5) {
      if (bot.path.length === 0 || bot.repathTimer <= 0) repath(bot, state, nearestNode(site.x, site.z).id);
      followPath(state, world, bot, dt, 1.15);
    } else {
      bot.vel.x *= 0.5;
      bot.vel.z *= 0.5;
      faceTowards(bot, site.x, site.z, dt);
      bot.defusing = true;
      hooks.onBotDefuse(bot, dt);
    }
  } else if (bot.state === 'investigate') {
    const point = bot.investigatePoint;
    if (point) {
      if (bot.path.length === 0) repath(bot, state, nearestNode(point.x, point.z).id);
      const done = followPath(state, world, bot, dt, 0.9);
      if (done) {
        bot.investigatePoint = null;
        bot.holdUntil = state.elapsed + 1.5;
      }
    }
    if (state.elapsed > bot.investigateUntil) {
      bot.state = 'patrol';
      bot.path = [];
    }
  } else {
    // patrol, with pauses at each leg and on the role's hold point
    bot.defusing = false;
    if (bot.holdUntil && state.elapsed < bot.holdUntil) {
      bot.vel.x *= 0.8;
      bot.vel.z *= 0.8;
      const hold = HOLD_POINTS[bot.routeName];
      if (hold) faceTowards(bot, hold.lookAt.x, hold.lookAt.z, dt);
    } else {
      patrolStep(state, world, bot, dt);
    }
  }

  // ---- move
  bot.vel.y -= 18.5 * dt;
  const body = { pos: bot.pos, vel: bot.vel, radius: BODY_RADIUS, height: STAND_HEIGHT, onGround: bot.onGround, stepUp: true };
  moveBody(body, world.colliders, dt);
  bot.onGround = body.onGround;
  if (bot.onGround && bot.vel.y < 0) bot.vel.y = 0;
  // a bot wedged on a corner turns and tries again rather than grinding
  if (body.hitWall && Math.hypot(bot.vel.x, bot.vel.z) < 0.4) {
    bot.yaw += 0.9;
    bot.path = [];
  }

  // ---- feet
  bot.footTimer -= dt;
  const speed = Math.hypot(bot.vel.x, bot.vel.z);
  if (bot.onGround && speed > 1.2 && bot.footTimer <= 0) {
    bot.footTimer = 0.5;
    bot.stepPhase += 1;
  }
}

// Hearing: a noise wakes the nearest defenders and sends them to look, without giving them the
// shooter's exact place. This is the difference between a patrol and a firing squad.
export function notifyNoise(state, x, z, loudness) {
  for (const bot of state.bots) {
    if (!bot.alive || bot.state === 'engage') continue;
    const distance = Math.hypot(bot.pos.x - x, bot.pos.z - z);
    if (distance > HEAR_RANGE * loudness) continue;
    const point = investigateTarget(x, z);
    bot.state = 'investigate';
    bot.investigateUntil = state.elapsed + 6;
    bot.investigatePoint = { x: point.x, z: point.z };
    bot.path = findPath(bot.pos.x, bot.pos.z, point.id);
    bot.pathIndex = 0;
    bot.holdUntil = 0;
  }
}

export function stepBots(state, world, dt, hooks) {
  for (const bot of state.bots) stepOne(state, world, bot, dt, hooks);
}

// The defenders' weapons, by role: the anchor holds the bay with a rifle, the roamer carries the
// cheap SMG, the flanker a rifle, the crane lane a rifle too.
export function botLoadout(role) {
  if (role === 'roamer') return { weapon: 'smg', armour: 0 };
  if (role === 'flanker') return { weapon: 'rifle', armour: 50 };
  return { weapon: 'rifle', armour: 50 };
}
