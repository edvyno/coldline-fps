// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate, with the
// effects that make a shot readable — tracer, impact, muzzle flash, hit marker — kept in pools so
// nothing is allocated in a hot frame. ?shot=cover|play|buy|end&seed=N arranges a deterministic
// frame, paints it twice and sets window.__shotReady, which is how the screenshots are taken.
import * as THREE from 'three';
import { PALETTE, LIGHT, MATERIALS, GEOMETRY, buildMaterials } from './palette.js';
import { createState, RULES, setBanner, pushFeed } from './state.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { look, stepPlayer, viewDirection, throwGrenade, stepGrenade } from './player.js';
import { stepBots, notifyNoise } from './bots.js';
import { stepBomb, stepPlant, addDefuse, inSite } from './bomb.js';
import { stepRounds, startRound, onBotKilled, onPlayerKilled, bombExploded, bombDefused, nextRound } from './rounds.js';
import { WEAPONS, BUY_LIST, GRENADE } from './weapons.js';

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 5;
const EMPTY_KEYS = new Set();
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

buildMaterials();

// An environment for the metals. Built from a 16x8 gradient in code — sky above, quay below — and
// pushed through PMREM, so polished steel has something to reflect and nothing is fetched.
function buildEnvironment(renderer) {
  const width = 32;
  const height = 16;
  const data = new Uint8Array(width * height * 4);
  const sky = new THREE.Color(LIGHT.sky);
  const ground = new THREE.Color(LIGHT.ground);
  const glow = new THREE.Color(LIGHT.sun);
  const mixed = new THREE.Color();
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1); // 0 at the top of the sphere, 1 at the bottom
    for (let x = 0; x < width; x += 1) {
      if (t < 0.5) {
        mixed.copy(sky).lerp(glow, Math.max(0, 0.55 - t * 1.1));
      } else {
        mixed.copy(ground).lerp(sky, Math.max(0, (1 - t) * 0.5 - 0.15));
      }
      const i = (y * width + x) * 4;
      data[i] = Math.round(mixed.r * 255);
      data[i + 1] = Math.round(mixed.g * 255);
      data[i + 2] = Math.round(mixed.b * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(texture);
  pmrem.dispose();
  texture.dispose();
  return target.texture;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(LIGHT.fog);
scene.fog = new THREE.FogExp2(new THREE.Color(LIGHT.fog), 0.0092);
scene.environment = buildEnvironment(renderer);
scene.environmentIntensity = 0.9;
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.04, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createWorld(scene);
const state = createState(seed);
// a handle for the screenshot harness and for anyone poking at a round from the console
window.__state = state;
window.__world = world;
window.__scene = scene;
window.__camera = camera;
window.__renderer = renderer;
const hud = createHud();
const audio = createAudio();

startRound(state, world);
hud.update(state);

// ---------------------------------------------------------------------------------------------
// Effects: fixed pools, each slot a mesh that is placed and faded, never created mid-fight.
const TRACER_COUNT = 20;
const tracers = [];
for (let i = 0; i < TRACER_COUNT; i += 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const material = new THREE.LineBasicMaterial({ color: new THREE.Color('#ffd9a0'), transparent: true, opacity: 0 });
  const line = new THREE.Line(geometry, material);
  line.visible = false;
  scene.add(line);
  tracers.push({ line, material, life: 0 });
}
let tracerCursor = 0;

const SPARK_COUNT = 26;
const sparks = [];
for (let i = 0; i < SPARK_COUNT; i += 1) {
  const mesh = new THREE.Mesh(GEOMETRY.unitBox, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb26b'), transparent: true }));
  mesh.visible = false;
  mesh.scale.setScalar(0.06);
  scene.add(mesh);
  sparks.push({ mesh, life: 0, vel: { x: 0, y: 0, z: 0 } });
}
let sparkCursor = 0;

// muzzle flash: a light and a quad at the barrel, on for a few frames per shot
const muzzle = new THREE.Mesh(
  new THREE.PlaneGeometry(0.5, 0.5),
  new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0'), transparent: true, opacity: 0, depthWrite: false }),
);
muzzle.position.set(0, 0, -1.05);
camera.add(muzzle);
const muzzleLight = new THREE.PointLight(new THREE.Color('#ffcc88'), 0, 9, 2);
muzzleLight.position.set(0, -0.05, -1.0);
camera.add(muzzleLight);
let muzzleTimer = 0;

// the charge: a small box with a blinking light, hidden until it is planted
const charge = new THREE.Group();
const chargeBody = new THREE.Mesh(GEOMETRY.unitBox, new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2018'), roughness: 0.8, metalness: 0.2 }));
chargeBody.scale.set(0.34, 0.2, 0.24);
chargeBody.castShadow = true;
charge.add(chargeBody);
const chargeLight = new THREE.Mesh(GEOMETRY.unitBox, new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }));
chargeLight.scale.set(0.07, 0.05, 0.07);
chargeLight.position.set(0.1, 0.12, 0);
charge.add(chargeLight);
charge.visible = false;
scene.add(charge);

// the thrown grenade, one body at most
const grenadeMesh = new THREE.Mesh(GEOMETRY.unitBox, new THREE.MeshStandardMaterial({ color: new THREE.Color('#3d4a3a'), roughness: 0.6, metalness: 0.4 }));
grenadeMesh.scale.set(0.14, 0.18, 0.14);
grenadeMesh.visible = false;
scene.add(grenadeMesh);

// ---------------------------------------------------------------------------------------------
// The weapon in the player's hands: boxes in camera space, one group per weapon so a switch is a
// visibility change and not a rebuild.
const viewmodel = new THREE.Group();
camera.add(viewmodel);
const viewModels = {};
function buildViewModel(weapon) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#23272c'), roughness: 0.55, metalness: 0.6 });
  const mid = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a4148'), roughness: 0.5, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a4632'), roughness: 0.8, metalness: 0.05 });
  const add = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(GEOMETRY.unitBox, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  if (weapon.kind === 'rifle') {
    add(0.075, 0.1, 0.62, 0, 0, -0.18, dark); // receiver
    add(0.045, 0.045, 0.42, 0, 0.015, -0.62, mid); // barrel
    add(0.05, 0.16, 0.13, 0, -0.12, -0.1, dark); // magazine
    add(0.06, 0.1, 0.24, 0, -0.01, 0.22, wood); // stock
    add(0.04, 0.06, 0.1, 0, 0.09, -0.05, mid); // sight
    add(0.03, 0.2, 0.05, 0, -0.1, -0.34, dark); // foregrip
  } else if (weapon.kind === 'smg') {
    add(0.07, 0.09, 0.44, 0, 0, -0.12, dark);
    add(0.035, 0.035, 0.24, 0, 0.01, -0.42, mid);
    add(0.045, 0.2, 0.08, 0, -0.13, -0.12, dark);
    add(0.05, 0.08, 0.18, 0, -0.02, 0.14, mid);
  } else {
    add(0.055, 0.075, 0.3, 0, 0, -0.1, dark);
    add(0.04, 0.06, 0.12, 0, -0.05, 0.06, dark);
    add(0.03, 0.03, 0.1, 0, 0.02, -0.26, mid);
  }
  group.traverse((node) => {
    node.castShadow = false;
    node.receiveShadow = false;
  });
  group.visible = false;
  viewmodel.add(group);
  return group;
}
for (const key of Object.keys(WEAPONS)) viewModels[key] = buildViewModel(WEAPONS[key]);

// ---------------------------------------------------------------------------------------------
// The defenders, drawn from their state: a body group each, moved and turned every frame. A dead
// bot falls over rather than vanishing, which reads as a won fight.
const botMeshes = [];
function buildBotMesh(bot) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(GEOMETRY.unitBox, MATERIALS.botBody);
  body.scale.set(0.52, 0.72, 0.32);
  body.position.y = 1.08;
  body.castShadow = true;
  group.add(body);
  const vest = new THREE.Mesh(GEOMETRY.unitBox, MATERIALS.botVest);
  vest.scale.set(0.56, 0.42, 0.36);
  vest.position.y = 1.18;
  vest.castShadow = true;
  group.add(vest);
  const head = new THREE.Mesh(GEOMETRY.unitBox, MATERIALS.botHead);
  head.scale.set(0.23, 0.25, 0.23);
  head.position.y = 1.63;
  head.castShadow = true;
  group.add(head);
  const helmet = new THREE.Mesh(GEOMETRY.unitBox, MATERIALS.botVest);
  helmet.scale.set(0.26, 0.1, 0.26);
  helmet.position.y = 1.75;
  group.add(helmet);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(GEOMETRY.unitBox, MATERIALS.botBody);
    leg.scale.set(0.17, 0.7, 0.19);
    leg.position.set(side * 0.14, 0.36, 0);
    leg.castShadow = true;
    group.add(leg);
    const arm = new THREE.Mesh(GEOMETRY.unitBox, MATERIALS.botBody);
    arm.scale.set(0.14, 0.52, 0.16);
    arm.position.set(side * 0.34, 1.12, -0.06);
    arm.rotation.z = side * 0.16;
    arm.castShadow = true;
    group.add(arm);
  }
  const gun = new THREE.Mesh(GEOMETRY.unitBox, MATERIALS.botGun);
  gun.scale.set(0.08, 0.1, 0.62);
  gun.position.set(0.2, 1.16, -0.36);
  group.add(gun);
  scene.add(group);
  botMeshes.push({ bot, group, lean: 0 });
}
for (const bot of state.bots) buildBotMesh(bot);
let botMeshesVersion = state.botsVersion;
// Rebuilt when a round starts, because startRound makes fresh bot objects.
function rebindBotMeshes() {
  for (const entry of botMeshes) scene.remove(entry.group);
  botMeshes.length = 0;
  for (const bot of state.bots) buildBotMesh(bot);
  botMeshesVersion = state.botsVersion;
}

// ---------------------------------------------------------------------------------------------
// Effects helpers
function spawnTracer(from, to) {
  const slot = tracers[tracerCursor % TRACER_COUNT];
  tracerCursor += 1;
  const position = slot.line.geometry.getAttribute('position');
  position.setXYZ(0, from.x, from.y, from.z);
  position.setXYZ(1, to.x, to.y, to.z);
  position.needsUpdate = true;
  slot.line.visible = true;
  slot.material.opacity = 0.85;
  slot.life = 0.07;
}

function spawnSparks(point, normal) {
  for (let i = 0; i < 3; i += 1) {
    const slot = sparks[sparkCursor % SPARK_COUNT];
    sparkCursor += 1;
    slot.mesh.position.set(point.x, point.y, point.z);
    slot.mesh.visible = true;
    slot.mesh.material.opacity = 0.95;
    slot.vel.x = (state.rng() * 2 - 1) * 2.6 + (normal?.x ?? 0) * 1.4;
    slot.vel.y = state.rng() * 2.4 + 0.6;
    slot.vel.z = (state.rng() * 2 - 1) * 2.6 + (normal?.z ?? 0) * 1.4;
    slot.life = 0.3 + state.rng() * 0.2;
  }
}

function stepEffects(dt) {
  for (const slot of tracers) {
    if (!slot.line.visible) continue;
    slot.life -= dt;
    slot.material.opacity = Math.max(0, slot.life / 0.07) * 0.85;
    if (slot.life <= 0) slot.line.visible = false;
  }
  for (const slot of sparks) {
    if (!slot.mesh.visible) continue;
    slot.life -= dt;
    slot.vel.y -= 9 * dt;
    slot.mesh.position.x += slot.vel.x * dt;
    slot.mesh.position.y += slot.vel.y * dt;
    slot.mesh.position.z += slot.vel.z * dt;
    slot.mesh.material.opacity = Math.max(0, slot.life * 3);
    slot.mesh.scale.setScalar(0.05 + slot.life * 0.06);
    if (slot.life <= 0) slot.mesh.visible = false;
  }
  if (muzzleTimer > 0) {
    muzzleTimer -= dt;
    const on = muzzleTimer > 0;
    muzzle.material.opacity = on ? Math.min(1, muzzleTimer * 14) : 0;
    muzzleLight.intensity = on ? 5.5 : 0;
  } else {
    muzzle.material.opacity = 0;
    muzzleLight.intensity = 0;
  }
  if (state.smoke > 0) state.smoke = Math.max(0, state.smoke - dt * 1.4);
}

// ---------------------------------------------------------------------------------------------
// Hooks the simulation calls: sound, effects, feed lines, round transitions.
const hooks = {
  audio,
  firing: false,
  wasFiring: false,
  canShoot: true,
  onShot(info) {
    muzzleTimer = 0.055;
    spawnTracer(info.origin, info.hit.point);
    if (info.hit.type === 'world') spawnSparks(info.hit.point, null);
    if (info.connected) {
      state.hitmarker.timer = info.killed ? 0.24 : 0.14;
      state.hitmarker.kill = info.killed;
      audio.hit(info.headshot);
      if (info.hit.type === 'bot') spawnSparks(info.hit.point, null);
    }
  },
  onBotShot(info) {
    const distance = Math.hypot(info.bot.pos.x - state.player.pos.x, info.bot.pos.z - state.player.pos.z);
    audio.distantShot(distance);
    spawnTracer(info.origin, info.hit.point);
    if (info.hit.type === 'world') spawnSparks(info.hit.point, null);
    // a visible muzzle flash on the bot
    const entry = botMeshes.find((item) => item.bot === info.bot);
    if (entry) entry.flash = 0.06;
  },
  onBotKilled(bot, headshot) {
    onBotKilled(state, hooks, bot, headshot);
    notifyNoise(state, bot.pos.x, bot.pos.z, 0.5);
  },
  onPlayerKilled(killer) {
    onPlayerKilled(state, hooks, killer);
  },
  onNoise(x, z, loudness) {
    notifyNoise(state, x, z, loudness);
  },
  onBotAlert(bot, x, z) {
    // the squad answers a contact call: the others turn towards it
    for (const other of state.bots) {
      if (other === bot || !other.alive || other.state === 'engage') continue;
      other.investigatePoint = { x, z };
      other.state = 'investigate';
      other.investigateUntil = state.elapsed + 5;
      other.path = [];
    }
  },
  onBotDefuse(bot, dt) {
    addDefuse(state, dt, hooks);
  },
  onPlanted() {
    pushFeed(state, 'Charge planted on Valve B', 'you');
    state.player.money = Math.min(RULES.maxMoney, state.player.money + RULES.plantReward);
    setBanner(state, 'Charge planted', 'Hold the site for 40 seconds', '', 2.2);
  },
  onDefused() {
    bombDefused(state, hooks);
  },
  onExploded() {
    state.smoke = 0.9;
    audio.explosion();
    bombExploded(state, hooks);
    spawnSparks({ x: state.bomb.site.x, y: 1.2, z: state.bomb.site.z }, null);
  },
  onExplosion(blast) {
    state.smoke = 0.75;
    for (let i = 0; i < 6; i += 1) spawnSparks({ x: blast.x, y: blast.y + 0.4, z: blast.z }, null);
  },
};

// ---------------------------------------------------------------------------------------------
// Camera and viewmodel follow the store, with a little sway and a kick that reads as weight.
const viewDirectionCache = { x: 0, y: 0, z: 0 };
let bobPhase = 0;

function syncCamera(dt) {
  const p = state.player;
  const pitch = p.pitch + p.recoilPitch;
  const yaw = p.yaw + p.recoilYaw;
  const eyeY = p.pos.y + p.eye - (p.alive ? 0 : 0.2);
  camera.position.set(p.pos.x, eyeY, p.pos.z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  // a small shake when hit, and a roll while running
  const speed = Math.hypot(p.vel.x, p.vel.z);
  bobPhase += dt * speed * 1.5;
  const bob = p.onGround ? Math.sin(bobPhase * 2) * 0.012 * Math.min(1, speed / 5) : 0;
  camera.position.y += bob;
  camera.rotation.z = Math.cos(bobPhase) * 0.006 * Math.min(1, speed / 5) + 0;

  const weapon = WEAPONS[p.weapon];
  const model = viewModels[p.weapon];
  for (const key of Object.keys(viewModels)) viewModels[key].visible = key === p.weapon;
  if (model) {
    const kick = Math.min(1, p.fireCooldown > 0 ? p.fireCooldown * 12 : 0);
    model.position.set(0.26 + Math.sin(bobPhase) * 0.006, -0.235 + bob * 0.5 - p.crouch * 0.01, -0.44 - kick * 0.035);
    model.rotation.set(-0.02 + kick * 0.05, 0.03 + Math.cos(bobPhase) * 0.004, 0.01);
    model.scale.setScalar(weapon.kind === 'pistol' ? 0.62 : 0.7);
  }
  // the grenade in flight
  grenadeMesh.visible = state.grenade.live;
  if (state.grenade.live) {
    grenadeMesh.position.set(state.grenade.pos.x, state.grenade.pos.y, state.grenade.pos.z);
    grenadeMesh.rotation.x += dt * 6;
    grenadeMesh.rotation.z += dt * 4;
  }
  // the charge on the valve
  const bomb = state.bomb;
  charge.visible = bomb.state === 'planted';
  if (charge.visible) {
    charge.position.set(bomb.site.x, 1.5, bomb.site.z + 0.9);
    const blink = Math.sin(state.elapsed * (bomb.timer < 10 ? 22 : 9)) > 0 ? 1 : 0.25;
    chargeLight.material.color.setRGB(blink, blink * 0.45, blink * 0.2);
    chargeLight.scale.setScalar(0.06 + blink * 0.03);
  }
}

function syncBots(dt) {
  for (const entry of botMeshes) {
    const bot = entry.bot;
    entry.group.visible = bot.alive || entry.lean < 1.45;
    entry.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    entry.group.rotation.y = bot.yaw;
    if (!bot.alive) {
      // fall over: rotate until flat, and stop moving
      entry.lean = Math.min(1.45, entry.lean + dt * 3.2);
      entry.group.rotation.x = entry.lean;
    } else {
      entry.lean = 0;
      entry.group.rotation.x = 0;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Buying. The menu is a list of keys; the sim's money and the loadout are the only state.
function buy(key) {
  if (state.phase !== 'buy' && !(state.phase === 'live' && state.phaseLeft > RULES.roundSeconds - 20)) return;
  const item = BUY_LIST.find((entry) => entry.key === key);
  if (!item) return;
  const p = state.player;
  if (p.money < item.price) return;
  if (item.kind === 'weapon') {
    const weapon = WEAPONS[item.id];
    if (p.weapon === item.id) return;
    p.money -= item.price;
    p.weapon = item.id;
    p.ammo[item.id] = { mag: weapon.mag, reserve: weapon.reserve };
  } else if (item.kind === 'grenade') {
    if (p.grenades >= GRENADE.max) return;
    p.money -= item.price;
    p.grenades += 1;
  } else if (item.kind === 'armour') {
    if (p.armour >= 100) return;
    p.money -= item.price;
    p.armour = 100;
  }
  audio.buy();
}

// ---------------------------------------------------------------------------------------------
// The fixed step: everything that changes the world happens here, at 60 Hz, in this order.
function step(dt) {
  state.tick += 1;
  state.elapsed += dt;
  state.hitmarker.timer = Math.max(0, state.hitmarker.timer - dt);
  state.banner.timer = Math.max(0, state.banner.timer - dt);
  for (const item of state.feed) item.timer -= dt;

  const keys = input.state.keys;
  const live = state.phase === 'live' || (state.phase === 'roundover' && state.player.alive);

  hooks.canShoot = state.phase === 'live' && state.player.alive && state.elapsed > 0.5;
  hooks.firing = input.state.firing || forceFire;
  hooks.wasFiring = input.state.wasFiring;
  const emptyKeys = EMPTY_KEYS;

  stepPlayer(state, world, live ? keys : emptyKeys, dt, hooks);
  stepRounds(state, world, dt, hooks);
  stepBots(state, world, dt, hooks);
  stepBomb(state, world, dt, hooks);
  stepGrenade(state, world, dt, hooks);

  if (state.phase === 'live' && state.player.alive) {
    stepPlant(state, dt, keys.has('KeyE'), hooks);
  }

  // an armed charge keeps ticking while the round is being decided
  if (state.bomb.state === 'planted' && state.phase === 'roundover') {
    state.bomb.timer -= dt;
    if (state.bomb.timer <= 0) hooks.onExploded();
  }

  hooks.wasFiring = input.state.firing;
  input.state.wasFiring = input.state.firing;
  forceFire = false;
}

// ---------------------------------------------------------------------------------------------
// Input wiring
const input = createInput(renderer.domElement, (locked) => {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
    startGame();
  } else if (started) {
    hud.setBuyOpen(false, state);
    hud.showOverlay('Paused', 'Click to take the site back. The charge keeps its fuse.');
    running = false;
  }
});
input.setEnabled(true);

let started = false;
function startGame() {
  if (!started) {
    started = true;
    lastTime = performance.now();
    accumulator = 0;
  }
  running = true;
}

document.getElementById('play').addEventListener('click', () => {
  if (shot) return;
  audio.ensure();
  if (state.matchOver) {
    nextRound(state, world);
    rebindBotMeshes();
  }
  hud.hideOverlay();
  startGame();
  input.requestLock();
});

hud.onBuy((key) => buy(key));

// One place for the keys that are not movement: weapon slots, the buy menu, the board, the throw.
function readDiscreteKeys() {
  if (state.phase === 'buy' && hud.isBuyOpen()) {
    for (const item of BUY_LIST) {
      if (input.consume(`Digit${item.key}`)) {
        buy(item.key);
        return;
      }
    }
  }
  if (input.consume('KeyB')) {
    const canBuy = state.phase === 'buy' || (state.phase === 'live' && state.phaseLeft > RULES.roundSeconds - 20);
    if (canBuy) hud.setBuyOpen(!hud.isBuyOpen(), state);
  }
  if (input.consume('Digit1')) selectWeapon('rifle');
  if (input.consume('Digit2')) selectWeapon('smg');
  if (input.consume('Digit3')) selectWeapon('pistol');
  if (input.consume('KeyG')) throwGrenade(state, world, hooks);
  if (input.consume('KeyR')) {
    /* handled inside the step, which owns the reload clock */
  }
  if (input.state.keys.has('Tab') && !hud.isBuyOpen()) {
    hud.setBoardOpen(true, state);
    hud.renderBoard(state);
  } else {
    hud.setBoardOpen(false, state);
  }
}

function selectWeapon(id) {
  const p = state.player;
  if (!WEAPONS[id]) return;
  if (p.weapon === id) return;
  const ammo = p.ammo[id];
  if (!ammo || (ammo.mag === 0 && ammo.reserve === 0)) return;
  p.weapon = id;
  p.reloadLeft = 0;
  p.shotIndex = 0;
  audio.reload();
}

// ---------------------------------------------------------------------------------------------
// The frame: look, discrete keys, fixed steps, then one render.
let lastTime = performance.now();
let accumulator = 0;
let running = false;
let forceFire = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!running) return;

  const lookDelta = input.takeLook();
  if (lookDelta.x !== 0 || lookDelta.y !== 0) look(state, lookDelta.x, lookDelta.y);
  readDiscreteKeys();

  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < MAX_STEPS) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * MAX_STEPS) accumulator = 0;

  // a round transition rebuilds the bot list, so the meshes follow it
  if (state.botsVersion !== botMeshesVersion) rebindBotMeshes();

  syncCamera(dt);
  syncBots(dt);
  stepEffects(dt);
  hud.update(state);
  renderer.render(scene, camera);
  input.endFrame();
  forceFire = false;
}

// ---------------------------------------------------------------------------------------------
// Deterministic screenshots. Each mode arranges a real state — positions, a fired shot, a planted
// charge, an open menu — and then renders it twice, so the image is the game's own output.
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function placeBot(bot, x, z, yaw, health) {
  bot.pos.x = x;
  bot.pos.z = z;
  bot.pos.y = 0;
  bot.yaw = yaw;
  bot.health = health ?? 100;
  bot.alive = true;
  bot.state = 'engage';
  bot.path = [];
  bot.targetSeenAt = state.elapsed;
  bot.engageUntil = state.elapsed + 30;
  bot.burstLeft = 0;
}

function aimAt(x, y, z) {
  const p = state.player;
  const eye = p.pos.y + p.eye - p.crouch * 0.42;
  const dx = x - p.pos.x;
  const dy = y - eye;
  const dz = z - p.pos.z;
  const horizontal = Math.hypot(dx, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, horizontal);
}

function arrangement(name) {
  state.phase = 'live';
  state.phaseLeft = name === 'end' ? 0 : 78;
  state.round = name === 'end' ? 6 : 3;
  state.score.us = name === 'end' ? 4 : 2;
  state.score.them = name === 'end' ? 2 : 1;
  const p = state.player;
  p.alive = true;
  p.health = 100;
  p.armour = 100;

  if (name === 'cover') {
    // on the site, the charge down, a defender coming round the container
    p.pos.x = 4.6;
    p.pos.y = 0;
    p.pos.z = -12.4;
    p.money = 3150;
    p.weapon = 'rifle';
    p.ammo.rifle = { mag: 17, reserve: 90 };
    p.grenades = 1;
    state.bomb.state = 'planted';
    state.bomb.timer = 27.4;
    state.bomb.site = { x: 0, y: 0.28, z: -17.2 };
    placeBot(state.bots[0], -2.6, -18.4, Math.PI * 0.94, 100);
    placeBot(state.bots[1], 6.0, -19.4, Math.PI * 1.08, 74);
    state.bots[2].alive = false;
    state.bots[2].pos.x = -9.0;
    state.bots[2].pos.z = -20.2;
    p.health = 74;
    aimAt(-2.6, 1.45, -18.4);
    state.banner.timer = 0;
    state.feed = [];
    pushFeed(state, 'You killed Sable', 'you');
    pushFeed(state, 'Charge planted on Valve B', 'you');
    state.hitmarker.timer = 0.2;
    state.hitmarker.kill = false;
  } else if (name === 'play') {
    // mid lane, trading shots across the container stack
    p.pos.x = -1.8;
    p.pos.y = 0;
    p.pos.z = 6.4;
    p.money = 4700;
    p.weapon = 'rifle';
    p.ammo.rifle = { mag: 21, reserve: 90 };
    p.grenades = 2;
    state.bomb.state = 'carried';
    placeBot(state.bots[0], 1.4, -6.2, Math.PI * 1.02, 100);
    placeBot(state.bots[1], -3.0, -1.2, Math.PI * 0.92, 62);
    state.bots[2].alive = false;
    state.bots[2].pos.x = -16;
    state.bots[2].pos.z = -5.2;
    p.health = 88;
    p.armour = 100;
    aimAt(1.4, 1.3, -6.2);
    state.feed = [];
    pushFeed(state, 'Halyard hit — 71', 'you');
    state.hitmarker.timer = 0.18;
    state.hitmarker.kill = false;
  } else if (name === 'buy') {
    p.pos.x = 0;
    p.pos.z = 19.5;
    p.money = 4200;
    p.weapon = 'pistol';
    p.ammo.pistol = { mag: 12, reserve: 48 };
    p.grenades = 0;
    p.armour = 0;
    p.health = 100;
    state.phase = 'buy';
    state.phaseLeft = 11.4;
    state.bomb.state = 'carried';
    aimAt(0, 1.5, 6);
    state.feed = [];
    hud.setBuyOpen(true, state);
    setBanner(state, 'Round 3', 'Buy 15s · plant the charge at Valve B', '', 0);
    state.banner.timer = 0;
  } else {
    // end: the round is won, the banner and the board are up
    p.pos.x = 2.2;
    p.pos.y = 0;
    p.pos.z = -14.6;
    p.weapon = 'rifle';
    p.ammo.rifle = { mag: 8, reserve: 60 };
    p.money = 6400;
    p.kills = 7;
    p.deaths = 3;
    p.armour = 100;
    p.health = 46;
    state.bomb.state = 'exploded';
    state.phase = 'roundover';
    state.phaseLeft = 2.4;
    state.score.us = 4;
    state.score.them = 2;
    state.round = 6;
    state.bots[0].alive = false;
    state.bots[1].alive = false;
    state.bots[2].alive = false;
    state.bots[0].pos.z = -18.6;
    aimAt(0, 1.4, -18.6);
    pushFeed(state, 'The charge detonated', 'you');
    pushFeed(state, 'You headshot Kerf', 'you');
    setBanner(state, 'Site held', 'Final score 4 — 2', 'win', 2.4);
    state.hitmarker.timer = 0;
  }
}

function paintTwiceThenReady() {
  // two synchronous paints: no requestAnimationFrame, so a throttled or background tab still
  // produces the same image, and the flag means "this frame is on screen"
  for (let i = 0; i < 2; i += 1) {
    syncCamera(1 / 60);
    syncBots(1 / 60);
    hud.update(state);
    renderer.render(scene, camera);
  }
  window.__shotReady = true;
  running = false;
}

function runShot(name) {
  document.body.classList.add('shotmode');
  hud.hideOverlay();
  state.elapsed = 12;
  arrangement(name);
  // one step so the bodies settle onto the slab or the site pad, then the shot itself
  settle(1);
  if (name === 'cover' || name === 'play') {
    forceFire = true;
    settle(1);
  }
  if (name === 'end') hud.setBoardOpen(false, state);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shot) {
  running = false;
  runShot(shot);
} else {
  requestAnimationFrame(frame);
}
