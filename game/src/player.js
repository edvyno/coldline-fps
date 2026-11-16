// The player: movement with acceleration and friction, crouch, jump, and the shooting loop that
// turns a trigger pull into a ray, a recoil kick and a noise the bots can hear. Rendering is
// somebody else's job; this module only moves numbers in the store.
import { moveBody, STAND_HEIGHT, CROUCH_HEIGHT, GRAVITY } from './physics.js';
import { WEAPONS, spreadFor, recoilFor, GRENADE } from './weapons.js';
import { traceShot, damageFor, damageBot, explosionDamage, damagePlayer } from './ballistics.js';
import { BODY_RADIUS } from './physics.js';

const WALK_SPEED = 5.25;
const SLOW_SPEED = 2.1;
const CROUCH_SPEED = 2.55;
const ACCEL = 11.5;
const AIR_ACCEL = 2.2;
const FRICTION = 9.5;
const JUMP_SPEED = 6.15;
const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.02;

// Mouse look, plus the recoil the last shots left on the aim. Recoil is a target the view recovers
// towards, so a burst climbs and then settles instead of teleporting back.
export function look(state, dx, dy) {
  const p = state.player;
  const sens = LOOK_SENSITIVITY;
  p.yaw -= dx * sens;
  p.pitch -= dy * sens;
  if (p.yaw > Math.PI) p.yaw -= Math.PI * 2;
  if (p.yaw < -Math.PI) p.yaw += Math.PI * 2;
  p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch));
}

// The direction the view is looking, written into out (no allocation in the hot path).
export function viewDirection(p, out) {
  const cp = Math.cos(p.pitch);
  out.x = -Math.sin(p.yaw) * cp;
  out.y = Math.sin(p.pitch);
  out.z = -Math.cos(p.yaw) * cp;
  return out;
}

function currentWeapon(state) {
  return WEAPONS[state.player.weapon];
}

function tryShoot(state, world, hooks) {
  const p = state.player;
  const weapon = currentWeapon(state);
  const ammo = p.ammo[p.weapon];
  if (!weapon || !ammo) return;
  if (p.fireCooldown > 0 || p.reloadLeft > 0) return;

  if (ammo.mag <= 0) {
    hooks.audio.dryFire();
    p.fireCooldown = 0.35;
    startReload(state, hooks);
    return;
  }

  ammo.mag -= 1;
  p.fireCooldown = 60 / weapon.rpm;
  p.lastShotAt = state.elapsed;
  state.stats.shots += 1;

  // Spread: a cone around the aim, widened by movement; the recoil pattern then kicks the view.
  const spread = spreadFor(weapon, p);
  const direction = { x: 0, y: 0, z: 0 };
  viewDirection(p, direction);
  const right = { x: Math.cos(p.yaw), y: 0, z: Math.sin(p.yaw) };
  const up = { x: 0, y: 1, z: 0 };
  const r1 = (state.rng() * 2 - 1) * spread;
  const r2 = (state.rng() * 2 - 1) * spread;
  direction.x += right.x * r1 + up.x * r2;
  direction.y += right.y * r1 + up.y * r2;
  direction.z += right.z * r1 + up.z * r2;
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  direction.x /= length;
  direction.y /= length;
  direction.z /= length;

  const eyeY = p.pos.y + p.eye - p.crouch * 0.42;
  const hit = traceShot(state, world, p.pos.x, eyeY, p.pos.z, direction.x, direction.y, direction.z, weapon.range, true);

  let connected = false;
  let killed = false;
  let headshot = false;
  if (hit.type === 'bot') {
    const bot = state.bots[hit.botIndex];
    const amount = damageFor(weapon, hit.part, hit.distance);
    const result = damageBot(bot, amount, hit.part);
    state.stats.hits += 1;
    state.stats.damage += result.dealt;
    p.damageDealt += result.dealt;
    connected = true;
    headshot = hit.part === 'head';
    if (headshot) state.stats.headshots += 1;
    killed = result.killed;
    if (killed) hooks.onBotKilled(bot, headshot);
  }

  // The kick: the view climbs along the weapon's pattern, and the crosshair widens for a moment.
  const recoil = recoilFor(weapon, p.shotIndex);
  p.shotIndex += 1;
  p.recoilTargetPitch += recoil.pitch;
  p.recoilTargetYaw += recoil.yaw * (state.rng() > 0.5 ? 1 : -0.6);
  p.spread = Math.min(p.spread + weapon.recoilPitch * 0.22, 0.03);

  hooks.audio.shot(weapon.kind);
  hooks.onShot({
    origin: { x: p.pos.x, y: eyeY, z: p.pos.z },
    direction,
    hit,
    weapon,
    connected,
    killed,
    headshot,
    tracer: true,
  });
  hooks.onNoise(p.pos.x, p.pos.z, killed ? 1 : 0.8);
}

function startReload(state, hooks) {
  const p = state.player;
  const weapon = currentWeapon(state);
  const ammo = p.ammo[p.weapon];
  if (!weapon || !ammo) return;
  if (p.reloadLeft > 0 || ammo.mag >= weapon.mag || ammo.reserve <= 0) return;
  p.reloadLeft = weapon.reloadSeconds;
  hooks.audio.reload();
}

function finishReload(state) {
  const p = state.player;
  const weapon = currentWeapon(state);
  const ammo = p.ammo[p.weapon];
  if (!weapon || !ammo) return;
  const need = weapon.mag - ammo.mag;
  const taken = Math.min(need, ammo.reserve);
  ammo.mag += taken;
  ammo.reserve -= taken;
}

// A grenade leaves the hand along the view, with a little upward arc. It bounces off the map and
// fuses; the blast damages whatever is near it, with walls cutting the damage down.
export function throwGrenade(state, world, hooks) {
  const p = state.player;
  if (p.grenades <= 0 || !p.alive) return false;
  p.grenades -= 1;
  state.stats.grenades += 1;
  const direction = { x: 0, y: 0, z: 0 };
  viewDirection(p, direction);
  const eyeY = p.pos.y + p.eye - p.crouch * 0.42;
  state.grenade.live = true;
  state.grenade.owner = 'player';
  state.grenade.pos.x = p.pos.x + direction.x * 0.5;
  state.grenade.pos.y = eyeY - 0.1;
  state.grenade.pos.z = p.pos.z + direction.z * 0.5;
  state.grenade.vel.x = direction.x * GRENADE.throwSpeed + p.vel.x * 0.4;
  state.grenade.vel.y = direction.y * GRENADE.throwSpeed + 2.6;
  state.grenade.vel.z = direction.z * GRENADE.throwSpeed + p.vel.z * 0.4;
  state.grenade.fuse = GRENADE.fuse;
  hooks.audio.step();
  return true;
}

export function stepGrenade(state, world, dt, hooks) {
  const g = state.grenade;
  if (!g.live) return;
  g.fuse -= dt;
  g.vel.y -= 17 * dt;
  const body = {
    pos: g.pos,
    vel: g.vel,
    radius: 0.16,
    height: 0.16,
    onGround: false,
    stepUp: false,
  };
  moveBody(body, world.colliders, dt);
  if (body.hitWall) {
    g.vel.x *= 0.45;
    g.vel.z *= 0.45;
    if (Math.abs(g.vel.y) > 1.5) hooks.audio.grenadeBounce();
  }
  if (body.onGround) {
    g.vel.x *= 0.72;
    g.vel.z *= 0.72;
    g.vel.y = 0;
  }
  if (g.fuse <= 0) {
    g.live = false;
    hooks.audio.explosion();
    hooks.onExplosion({ x: g.pos.x, y: g.pos.y, z: g.pos.z, radius: GRENADE.radius });
    for (let i = 0; i < state.bots.length; i += 1) {
      const bot = state.bots[i];
      if (!bot.alive) continue;
      const amount = explosionDamage(world, g.pos.x, g.pos.y, g.pos.z, GRENADE.radius, GRENADE.damage, bot.pos.x, bot.pos.y, bot.pos.z);
      if (amount <= 1) continue;
      const result = damageBot(bot, amount, 'body');
      if (result.killed) hooks.onBotKilled(bot, false);
    }
    if (state.player.alive) {
      const amount = explosionDamage(world, g.pos.x, g.pos.y, g.pos.z, GRENADE.radius, GRENADE.damage, state.player.pos.x, state.player.pos.y, state.player.pos.z);
      if (amount > 1) {
        const result = damagePlayer(state, amount, 'body', g.pos.x, g.pos.z);
        hooks.audio.hurt();
        if (result.killed) hooks.onPlayerKilled();
      }
    }
  }
}

// The per-step player update. Keys is a Set of KeyboardEvent.code values; hooks carries the
// effects and the round rules the player must not know about.
export function stepPlayer(state, world, keys, dt, hooks) {
  const p = state.player;
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.hurtTimer = Math.max(0, p.hurtTimer - dt);
  p.flash = Math.max(0, p.flash - dt * 2.2);
  const weapon = currentWeapon(state);

  // reload
  if (p.reloadLeft > 0) {
    p.reloadLeft -= dt;
    if (p.reloadLeft <= 0) {
      p.reloadLeft = 0;
      finishReload(state);
    }
  }
  if (keys.has('KeyR')) startReload(state, hooks);

  if (!p.alive) {
    p.vel.x *= 0.9;
    p.vel.z *= 0.9;
    return;
  }

  // crouch eases between the two heights so a body cannot pop instantly
  p.wantedCrouch = keys.has('ControlLeft') || keys.has('ControlRight');
  const target = p.wantedCrouch ? 1 : 0;
  p.crouch += (target - p.crouch) * Math.min(1, dt * 11);
  p.eye = 1.62 - p.crouch * 0.3;

  // movement basis from the yaw only: pitch never tilts the walk
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  let forward = 0;
  let strafe = 0;
  if (keys.has('KeyW')) forward += 1;
  if (keys.has('KeyS')) forward -= 1;
  if (keys.has('KeyD')) strafe += 1;
  if (keys.has('KeyA')) strafe -= 1;
  const slow = keys.has('ShiftLeft') || keys.has('ShiftRight');
  let maxSpeed = p.crouch > 0.5 ? CROUCH_SPEED : slow ? SLOW_SPEED : WALK_SPEED;
  if (p.crouch > 0.9) maxSpeed = CROUCH_SPEED;

  let wishX = -sin * forward + cos * strafe;
  let wishZ = -cos * forward - sin * strafe;
  const wishLength = Math.hypot(wishX, wishZ);
  if (wishLength > 0.001) {
    wishX /= wishLength;
    wishZ /= wishLength;
  }

  if (p.onGround) {
    // friction first, then acceleration: the classic pair, and it is what makes a counter-strafe
    // stop you fast enough to shoot accurately
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (speed > 0.0001) {
      const drop = Math.max(speed, 1.6) * FRICTION * dt;
      const scale = Math.max(0, speed - drop) / speed;
      p.vel.x *= scale;
      p.vel.z *= scale;
    }
    if (wishLength > 0.001) {
      const accel = ACCEL * maxSpeed * dt;
      p.vel.x += wishX * accel;
      p.vel.z += wishZ * accel;
      const newSpeed = Math.hypot(p.vel.x, p.vel.z);
      if (newSpeed > maxSpeed) {
        p.vel.x = (p.vel.x / newSpeed) * maxSpeed;
        p.vel.z = (p.vel.z / newSpeed) * maxSpeed;
      }
    }
    if (keys.has('Space') && p.crouch < 0.5) {
      p.vel.y = JUMP_SPEED;
      p.onGround = false;
    }
  } else if (wishLength > 0.001) {
    // a little air control: enough to clear a gap, not enough to strafe-jump like a rocket
    p.vel.x += wishX * AIR_ACCEL * dt;
    p.vel.z += wishZ * AIR_ACCEL * dt;
  }

  p.vel.y -= GRAVITY * dt;
  const body = { pos: p.pos, vel: p.vel, radius: BODY_RADIUS, height: STAND_HEIGHT, onGround: p.onGround, stepUp: true };
  moveBody(body, world.colliders, dt);
  p.onGround = body.onGround;
  if (p.onGround && p.vel.y < 0) p.vel.y = 0;
  p.speed = Math.hypot(p.vel.x, p.vel.z);

  // footsteps: a timer while moving on the ground, which also feeds the bots' ears
  p.footTimer -= dt;
  if (p.onGround && p.speed > 1.4 && p.footTimer <= 0) {
    p.footTimer = p.crouch > 0.5 ? 0.62 : slow ? 0.58 : 0.42;
    p.stepPhase += 1;
    hooks.audio.step();
    hooks.onNoise(p.pos.x, p.pos.z, 0.22);
  }

  // recoil recovery: the aim comes back to where the player pointed it
  const recovery = Math.min(1, dt * 7.5);
  p.recoilPitch += (p.recoilTargetPitch - p.recoilPitch) * recovery;
  p.recoilTargetPitch *= 1 - Math.min(1, dt * 6.2);
  p.recoilTargetYaw *= 1 - Math.min(1, dt * 6.2);
  p.recoilYaw += (p.recoilTargetYaw - p.recoilYaw) * recovery;
  p.spread = Math.max(0, p.spread - dt * 0.055);

  // shooting: automatic weapons fire while held, the pistol on a fresh pull
  if (hooks.canShoot) {
    if (weapon.automatic) {
      if (hooks.firing) tryShoot(state, world, hooks);
    } else if (hooks.firing && !hooks.wasFiring) {
      tryShoot(state, world, hooks);
    }
  }
}

export function playerHeight(player) {
  return p_height(player);
}

function p_height(player) {
  return STAND_HEIGHT - player.crouch * (STAND_HEIGHT - CROUCH_HEIGHT);
}
