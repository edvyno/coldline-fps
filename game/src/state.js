// The store: one object every module reads and writes, made here and nowhere else. Modules take
// it as their first argument rather than importing a singleton, so a second match is a second
// state and not shared globals. All randomness comes from state.rng, never Math.random, so a
// seeded run of the simulation is repeatable.
import { WEAPONS } from './weapons.js';

export const RULES = {
  winsToTake: 4,
  buySeconds: 15,
  buyLockSeconds: 105, // the buy menu also works for the first 20 s of a live round
  roundSeconds: 105,
  plantSeconds: 3.1,
  fuseSeconds: 40,
  defuseSeconds: 5.0,
  defuseKitFactor: 0.55,
  plantReward: 300,
  killReward: 300,
  winReward: 3250,
  lossReward: 1400,
  lossStep: 200,
  maxLossReward: 3400,
  startingMoney: 800,
  maxMoney: 16000,
};

export function mulberry32(initial) {
  let a = initial >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePlayer(spawn) {
  const ammo = {};
  for (const key of Object.keys(WEAPONS)) ammo[key] = { mag: 0, reserve: 0 };
  return {
    pos: { x: spawn.x, y: spawn.y, z: spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw,
    pitch: 0,
    eye: 1.62,
    crouch: 0, // 0 standing .. 1 crouched, eased
    wantedCrouch: false,
    onGround: true,
    jumpBuffer: 0,
    health: 100,
    armour: 0,
    alive: true,
    money: RULES.startingMoney,
    kills: 0,
    deaths: 0,
    damageDealt: 0,
    weapon: 'pistol',
    ammo,
    grenades: 0,
    fireCooldown: 0,
    reloadLeft: 0,
    shotIndex: 0,
    lastShotAt: -99,
    recoilPitch: 0,
    recoilYaw: 0,
    recoilTargetPitch: 0,
    recoilTargetYaw: 0,
    spread: 0,
    speed: 0,
    plantProgress: 0,
    defuseProgress: 0,
    hasBomb: true,
    footTimer: 0,
    stepPhase: 0,
    flash: 0,
    hurtTimer: 0,
  };
}

// Four defenders on fixed posts; the three named ones are the live opponents, the fourth slot is
// the reserve the rounds module respawns when a bot dies mid-round is not needed. Roles give the
// group its shape: an anchor on the site, a roamer through mid, a flanker down the quay lane.
export const BOT_TEMPLATES = [
  { name: 'Halyard', role: 'anchor', route: 'site', colour: 0 },
  { name: 'Kerf', role: 'roamer', route: 'mid', colour: 1 },
  { name: 'Sable', role: 'flanker', route: 'quay', colour: 2 },
];

export function createState(seed) {
  const state = {
    seed,
    rng: mulberry32(seed),
    tick: 0,
    elapsed: 0,
    // phases: 'buy' | 'live' | 'roundover' | 'matchover'
    phase: 'buy',
    phaseLeft: RULES.buySeconds,
    round: 1,
    matchOver: false,
    score: { us: 0, them: 0 },
    lossStreak: 0,
    botLossStreak: 0,
    roundWinner: null,
    roundReason: '',
    botsVersion: 0,
    feed: [],
    feedId: 1,
    banner: { title: '', sub: '', kind: '', timer: 0 },
    hitmarker: { timer: 0, kill: false },
    buyOpen: false,
    boardOpen: false,
    stats: { shots: 0, hits: 0, headshots: 0, damage: 0, grenades: 0 },
    grenade: { live: false, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, fuse: 0, owner: '' },
    tracers: [],
    player: null,
    bots: [],
    bomb: {
      state: 'carried', // carried | planted | defused | exploded
      timer: RULES.fuseSeconds,
      plantProgress: 0,
      defuseProgress: 0,
      beep: 0,
      site: { x: 0, y: 0, z: -15.5 },
    },
    smoke: 0,
  };
  return state;
}

export function spawnPlayer(state, spawn) {
  state.player = makePlayer(spawn);
  const pistol = WEAPONS.pistol;
  state.player.ammo.pistol = { mag: pistol.mag, reserve: pistol.reserve };
  state.player.ammo.rifle = { mag: 0, reserve: 0 };
  state.player.ammo.smg = { mag: 0, reserve: 0 };
}

export function resetPlayerForRound(state, spawn) {
  const player = state.player;
  const loadout = { weapon: player.weapon, ammo: {}, grenades: player.grenades, armour: player.armour };
  for (const key of Object.keys(WEAPONS)) loadout.ammo[key] = { ...player.ammo[key] };
  const fresh = makePlayer(spawn);
  // keep what the player bought and earned, restore what a round restores
  fresh.money = player.money;
  fresh.kills = player.kills;
  fresh.deaths = player.deaths;
  fresh.damageDealt = player.damageDealt;
  fresh.weapon = loadout.weapon;
  fresh.ammo = loadout.ammo;
  fresh.grenades = loadout.grenades;
  fresh.armour = loadout.armour;
  fresh.hasBomb = true;
  state.player = fresh;
  return state.player;
}

export function makeBot(template, index, spawn) {
  return {
    id: index,
    name: template.name,
    role: template.role,
    routeName: template.route,
    colour: template.colour,
    pos: { x: spawn.x, y: spawn.y, z: spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw,
    health: 100,
    armour: 0,
    alive: true,
    state: 'patrol',
    path: [],
    pathIndex: 0,
    holdPoint: null,
    targetSeenAt: -99,
    lastSeen: { x: 0, y: 0, z: 0 },
    reaction: 0.2 + index * 0.05,
    engageUntil: 0,
    fireCooldown: 0,
    burstLeft: 0,
    burstGap: 0,
    reloadLeft: 0,
    ammo: 30,
    aimError: 0,
    strafe: 1,
    strafeTimer: 0,
    investigateUntil: 0,
    investigatePoint: null,
    repathTimer: 0,
    defusing: false,
    flash: 0,
    hurtTimer: 0,
    kills: 0,
    deaths: 0,
    footTimer: 0,
    stepPhase: 0,
  };
}

export function pushFeed(state, text, kind) {
  state.feed.push({ id: state.feedId++, text, kind, timer: 6 });
  if (state.feed.length > 5) state.feed.shift();
}

export function setBanner(state, title, sub, kind, seconds) {
  state.banner.title = title;
  state.banner.sub = sub;
  state.banner.kind = kind;
  state.banner.timer = seconds;
}
