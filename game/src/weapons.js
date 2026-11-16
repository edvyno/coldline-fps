// The armoury: every number a weapon has, and the one function that turns movement into spread.
// Data only, so the shooting code in ballistics.js and the HUD in hud.js read the same source and
// neither invents a value. Recoil is a fixed climb: each shot pushes the aim up and drifts it
// sideways on a pattern, so a long spray is a shape a player can learn.

export const WEAPONS = {
  rifle: {
    id: 'rifle',
    name: 'VK-74',
    kind: 'rifle',
    price: 2700,
    slot: 1,
    damage: 33,
    headMultiplier: 3.0,
    legMultiplier: 0.72,
    armourPenetration: 0.78,
    rpm: 600,
    automatic: true,
    mag: 30,
    reserve: 90,
    reloadSeconds: 2.45,
    range: 90,
    falloffStart: 22,
    falloffEnd: 70,
    falloffFloor: 0.68,
    baseSpread: 0.0022,
    moveSpread: 0.026,
    airSpread: 0.05,
    crouchBonus: 0.55,
    recoilPitch: 0.0125,
    recoilYaw: 0.0035,
  },
  smg: {
    id: 'smg',
    name: 'Kestrel SMG',
    kind: 'smg',
    price: 1250,
    slot: 2,
    damage: 24,
    headMultiplier: 2.4,
    legMultiplier: 0.7,
    armourPenetration: 0.62,
    rpm: 800,
    automatic: true,
    mag: 30,
    reserve: 120,
    reloadSeconds: 2.0,
    range: 60,
    falloffStart: 14,
    falloffEnd: 44,
    falloffFloor: 0.55,
    baseSpread: 0.0034,
    moveSpread: 0.017,
    airSpread: 0.04,
    crouchBonus: 0.6,
    recoilPitch: 0.0072,
    recoilYaw: 0.0044,
  },
  pistol: {
    id: 'pistol',
    name: 'PW-9',
    kind: 'pistol',
    price: 500,
    slot: 3,
    damage: 27,
    headMultiplier: 2.7,
    legMultiplier: 0.75,
    armourPenetration: 0.55,
    rpm: 380,
    automatic: false,
    mag: 12,
    reserve: 48,
    reloadSeconds: 1.7,
    range: 70,
    falloffStart: 18,
    falloffEnd: 55,
    falloffFloor: 0.6,
    baseSpread: 0.0028,
    moveSpread: 0.02,
    airSpread: 0.045,
    crouchBonus: 0.62,
    recoilPitch: 0.0105,
    recoilYaw: 0.0028,
  },
};

export const GRENADE = {
  id: 'frag',
  name: 'Pulse FR-3',
  price: 300,
  max: 2,
  damage: 96,
  radius: 6.2,
  fuse: 2.4,
  throwSpeed: 15.5,
};

// The buy menu, in the order it is shown: key, what it is, what it costs.
export const BUY_LIST = [
  { key: '1', kind: 'weapon', id: 'rifle', label: 'VK-74 rifle', detail: '33 damage · 600 rpm · full auto', price: WEAPONS.rifle.price },
  { key: '2', kind: 'weapon', id: 'smg', label: 'Kestrel SMG', detail: '24 damage · 800 rpm · cheap and quick', price: WEAPONS.smg.price },
  { key: '3', kind: 'weapon', id: 'pistol', label: 'PW-9 sidearm', detail: '27 damage · 380 rpm · semi auto', price: WEAPONS.pistol.price },
  { key: '4', kind: 'grenade', id: 'frag', label: 'Pulse frag grenade', detail: '96 damage within 6 m', price: GRENADE.price },
  { key: '5', kind: 'armour', id: 'armour', label: 'Plate carrier', detail: 'absorbs 50% of body damage', price: 650 },
];

// Spread in radians for the shot about to be fired. Standing still and crouched is tight; running
// and jumping are wide, which is the whole reason stopping to aim pays. Recoil is added on top by
// the caller, not here.
export function spreadFor(weapon, player) {
  const speed = Math.hypot(player.vel.x, player.vel.z);
  const moving = Math.min(speed / 5.2, 1);
  const air = player.onGround ? 0 : 1;
  const crouched = 1 - player.crouch * (1 - weapon.crouchBonus);
  const settle = player.onGround && speed < 0.4 ? 0.55 : 1;
  const raw = (weapon.baseSpread + weapon.moveSpread * moving * moving + weapon.airSpread * air) * crouched * settle;
  return raw + player.spread;
}

// The recoil pattern: a deterministic climb that leans right then left, so a burst stays on target
// and a held trigger walks off it. Index is the shot number in the current burst.
export function recoilFor(weapon, shotIndex) {
  const n = Math.min(shotIndex, 24);
  const climb = weapon.recoilPitch * (1 + n * 0.045);
  const drift = Math.sin(n * 0.42) * weapon.recoilYaw * (0.4 + n * 0.13);
  return { pitch: climb, yaw: drift };
}

export function damageAtRange(weapon, distance) {
  if (distance <= weapon.falloffStart) return weapon.damage;
  if (distance >= weapon.falloffEnd) return weapon.damage * weapon.falloffFloor;
  const t = (distance - weapon.falloffStart) / (weapon.falloffEnd - weapon.falloffStart);
  return weapon.damage * (1 - t * (1 - weapon.falloffFloor));
}
