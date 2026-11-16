# Coldline — a round-based tactical FPS on three.js

Coldline is a small, complete, round-based tactical first-person shooter that runs in a desktop
browser straight from static files: no build step, no network request, no external asset. You hold
one site of a harbour freight terminal against three defending bots, with money between rounds, a
buy menu, a charge to plant, and gunfire where stopping to aim pays.

## Run it

```sh
node serve.ts          # serves game/ and opens http://localhost:8080
```

Screenshots and the judge's dossier:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## What is in here

| path | what it does |
|---|---|
| `main.ts` | the entry point: copies `game/` and `screenshots/` to `/output`, writes `dossier.json` |
| `game/index.html` | the page: one import map, the HUD's DOM, and the stylesheet |
| `game/src/main.js` | boot, the fixed 60 Hz step, rendering, effects, deterministic shot mode |
| `game/src/state.js` | the single store every module reads and writes |
| `game/src/world.js` | the map: geometry, colliders, spawns, site, lighting |
| `game/src/nav.js` | the bot waypoint graph and its routes |
| `game/src/physics.js` | AABB collision, slide, step-up, ground tracing |
| `game/src/input.js` | pointer lock, keys, mouse look |
| `game/src/weapons.js` | the armoury: damage, cadence, recoil, spread, prices |
| `game/src/ballistics.js` | hitscan against head and body volumes, damage falloff |
| `game/src/player.js` | movement, jump, crouch, firing, reloading, planting, buying |
| `game/src/bots.js` | bot vision, hearing, roles, bursts, defusing |
| `game/src/bomb.js` | the charge: plant, fuse, defuse, detonation |
| `game/src/rounds.js` | buy phase, round flow, win conditions, economy |
| `game/src/hud.js` | every readout: health, armour, ammo, timer, score, money, buy menu, feed |
| `game/src/audio.js` | all sound, synthesised with WebAudio |

## Controls

`WASD` move · mouse look · `Left click` fire · `R` reload · `Ctrl` crouch · `Space` jump ·
`1`/`2`/`3` weapon · `G` grenade · `B` buy menu · `E` plant/defuse · `Tab` scoreboard.

## Licence

MIT. three.js 0.187.0 is vendored under `game/vendor/three/` byte for byte, under its own MIT
licence.
