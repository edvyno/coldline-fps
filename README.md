# coldline-fps

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/edvyno/coldline-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/edvyno/coldline-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Coldline is a small, complete, round-based tactical first-person shooter that runs in a desktop
browser straight from static files: no build step, no network request, no external asset. You hold
one site of a harbour freight terminal against three defending bots, with money between rounds, a
buy menu, a charge to plant, and gunfire where stopping to aim pays. Original map, art, names and
synthesised sound; three.js 0.187.0 is vendored.

## Run it

```sh
python3 -m http.server 8080 -d game                     # then open http://localhost:8080
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts     # rebuild out/: game/, screenshots/, dossier.json
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

---

<sub>Entered on [make.fun](https://make.fun/?ref=j39vnp7w&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
