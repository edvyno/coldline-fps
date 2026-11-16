// Coldline's entrypoint: the program make.fun runs to hand the game in.
// It copies game/ (the playable static files) and screenshots/ from this repository to /output
// and writes /output/dossier.json with the vendored buildDossier, the only thing the judge reads.
// Node 22, standard library only: nothing is installed before it runs, and two runs write the
// same bytes (no clock, no network, no randomness).
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps: only text_max_bytes shapes the dossier's bytes; the rest refuse an
// entry the scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993
// files in game/ or 48 MiB of them) rather than let it through here and fail there.
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(out, 'dossier.json'), dossier);

// A short receipt on stdout, so a run is readable without opening the files.
const screenshots = readdirSync(join(out, 'screenshots')).length;
const sourceBytes = readdirSync(join(out, 'game', 'src')).reduce(
  (total, name) => total + statSync(join(out, 'game', 'src', name)).size,
  0,
);
console.log(`coldline: wrote game/ (${sourceBytes} bytes of source), ${screenshots} screenshots, dossier.json ${Buffer.byteLength(dossier)} bytes`);
