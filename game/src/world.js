// The map: a freight terminal on a quay, built out of boxes, with one site to hold. Every solid
// thing it puts in the scene also registers a collider, so what you can see and what stops a body
// or a bullet are the same list. Nothing here is loaded from a file: geometry is generated, and
// the only textures are drawn into canvas at run time.
import * as THREE from 'three';
import { PALETTE, LIGHT, MATERIALS, GEOMETRY } from './palette.js';

// The site is the valve bay at the north end; the attacker starts at the south gate.
export const SPAWN = { x: 0, y: 0, z: 19.5, yaw: 0 };
export const SITE = { x: 0, y: 0, z: -17.2, radius: 3.1 };

// Waypoints the bots walk: nodes joined by clear straight runs, three lanes to the site.
export const WAYPOINTS = [
  { id: 0, x: 0, z: 17.5 }, // south gate
  { id: 1, x: 0, z: 9.5 }, // mid, south of the stack
  { id: 2, x: 0, z: 3.2 }, // mid, at the stack
  { id: 3, x: 0, z: -3.4 }, // mid, north of the stack
  { id: 4, x: 0, z: -8.6 }, // the gate into the site
  { id: 5, x: 0, z: -14.2 }, // site, in front of the valve
  { id: 6, x: 6.4, z: -18.4 }, // site, east corner
  { id: 7, x: -6.4, z: -18.4 }, // site, west corner
  { id: 8, x: -16, z: 12.5 }, // quay lane, south
  { id: 9, x: -16, z: 2.5 }, // quay lane, mid
  { id: 10, x: -16, z: -6 }, // quay lane, north
  { id: 11, x: -13.6, z: -11.4 }, // west entrance to the site
  { id: 12, x: 16, z: 12.5 }, // crane lane, south
  { id: 13, x: 16.5, z: 3 }, // crane lane, mid
  { id: 14, x: 16.5, z: -5.5 }, // crane lane, north
  { id: 15, x: 13.6, z: -11.4 }, // east entrance to the site
  { id: 16, x: 5.6, z: 6.4 }, // mid, east cover
  { id: 17, x: -5.6, z: 6.4 }, // mid, west cover
  { id: 18, x: 9.2, z: -7.4 }, // outside the site's east wall
  { id: 19, x: -9.2, z: -7.4 }, // outside the site's west wall
  { id: 20, x: 0, z: -20.6 }, // behind the valve
  { id: 21, x: 17.5, z: -16 }, // crane lane, deep north
];

export const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [5, 7], [5, 20], [6, 20], [7, 20],
  [0, 8], [8, 9], [9, 10], [10, 11], [11, 7], [11, 5], [11, 19], [19, 4],
  [0, 12], [12, 13], [13, 14], [14, 15], [15, 6], [15, 5], [15, 18], [18, 4],
  [1, 16], [16, 18], [1, 17], [17, 19], [14, 21], [21, 15],
];

// A texture drawn into a canvas: stencilled signage and hazard stripes, no file, no network.
function signTexture(text, background, foreground, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = foreground;
  ctx.font = `600 ${scale ?? 62}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '6px';
  ctx.fillText(text, 256, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const colliders = [];
  const root = new THREE.Group();
  scene.add(root);

  // --- helpers ------------------------------------------------------------------------------
  // One box: mesh plus the collider a body and a bullet both use. opts: solid, shadows, rotationY,
  // noBlock (visible but not something that stops anything, e.g. a rail or a lamp head).
  function box(x, y, z, w, h, d, material, opts = {}) {
    const mesh = new THREE.Mesh(GEOMETRY.unitBox, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = opts.shadows !== false;
    mesh.receiveShadow = true;
    if (opts.rotationY) mesh.rotation.y = opts.rotationY;
    root.add(mesh);
    if (opts.solid !== false) {
      colliders.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minY: y,
        maxY: y + h,
        minZ: z - d / 2,
        maxZ: z + d / 2,
        noBlock: opts.noBlock === true,
      });
    }
    return mesh;
  }

  function cylinder(x, y, z, radius, height, material, opts = {}) {
    const mesh = new THREE.Mesh(GEOMETRY.cylinder, material);
    mesh.scale.set(radius * 2, height, radius * 2);
    mesh.position.set(x, y + height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (opts.solid !== false) {
      colliders.push({
        minX: x - radius,
        maxX: x + radius,
        minY: y,
        maxY: y + height,
        minZ: z - radius,
        maxZ: z + radius,
        noBlock: false,
      });
    }
    return mesh;
  }

  function sign(x, y, z, text, rotationY, foreground, background) {
    const texture = signTexture(text, background ?? '#1b2128', foreground ?? PALETTE.ink, 62);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotationY;
    root.add(mesh);
    return mesh;
  }

  function stripe(x, y, z, w, d) {
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazard), roughness: 0.9, metalness: 0.02 });
    box(x, y, z, w, 0.02, d, material, { solid: false, shadows: false });
  }

  // --- ground ------------------------------------------------------------------------------
  box(0, -0.5, -1, 52, 0.5, 54, MATERIALS.floor); // the quay slab
  // concrete pads in two tones, laid in a grid: reads as poured sections, not one flat plane
  for (let gx = -4; gx <= 4; gx += 1) {
    for (let gz = -4; gz <= 4; gz += 1) {
      if ((gx + gz) % 2 === 0) continue;
      box(gx * 6.2, 0, gz * 6.2 - 1, 5.9, 0.02, 5.9, MATERIALS.floorAlt, { solid: false, shadows: false });
    }
  }
  // painted lane lines, hazard edges
  stripe(-11.9, 0.03, 2, 0.14, 16);
  stripe(11.9, 0.03, 2, 0.14, 16);
  stripe(0, 0.03, -9.9, 22, 0.16);

  // --- perimeter ---------------------------------------------------------------------------
  box(0, 0, 26.5, 52, 7.5, 1, MATERIALS.wallDark);
  box(0, 0, -28.5, 52, 8, 1, MATERIALS.wallDark);
  box(-25.5, 0, -1, 1, 7.5, 54, MATERIALS.wallDark);
  box(25.5, 0, -1, 1, 7.5, 54, MATERIALS.wallDark);
  // capping band, so the wall top reads against the sky
  box(0, 7.5, 26.5, 52.4, 0.3, 1.3, MATERIALS.steel, { solid: false });
  box(0, 8, -28.5, 52.4, 0.3, 1.3, MATERIALS.steel, { solid: false });

  // --- the site: a walled valve bay at the north end ----------------------------------------
  box(0, 0, -17.2, 22, 0.28, 12.4, MATERIALS.wall); // raised pad
  box(-11.2, 0.28, -18.5, 1, 5.4, 10, MATERIALS.wall); // west wall
  box(11.2, 0.28, -18.5, 1, 5.4, 10, MATERIALS.wall); // east wall
  box(0, 0.28, -23.2, 23.4, 6.6, 1, MATERIALS.wallDark); // north facade
  // the front is a low parapet either side of a wide gate
  box(-7.2, 0.28, -11.4, 8, 1.15, 0.8, MATERIALS.wall);
  box(7.2, 0.28, -11.4, 8, 1.15, 0.8, MATERIALS.wall);
  // gate posts
  box(-3.1, 0.28, -11.4, 0.7, 3.2, 0.9, MATERIALS.steel);
  box(3.1, 0.28, -11.4, 0.7, 3.2, 0.9, MATERIALS.steel);
  box(0, 3.4, -11.4, 7, 0.45, 0.9, MATERIALS.steel, { solid: false }); // lintel

  // the valve block: the objective, with its pipework and the charge cradle
  box(0, 0.28, -18.6, 2.6, 1.05, 2.6, MATERIALS.steel);
  cylinder(0, 1.33, -18.6, 0.62, 0.9, MATERIALS.hazard);
  cylinder(0, 2.23, -18.6, 0.9, 0.16, MATERIALS.pipe);
  cylinder(-1.2, 0.28, -18.6, 0.22, 2.6, MATERIALS.pipe);
  cylinder(1.2, 0.28, -18.6, 0.22, 2.6, MATERIALS.pipe);
  box(0, 2.5, -18.6, 3.4, 0.22, 0.22, MATERIALS.pipe, { solid: false });
  box(0, 2.5, -18.6, 0.22, 0.22, 3.4, MATERIALS.pipe, { solid: false });
  sign(0, 3.3, -22.6, 'VALVE B', 0, PALETTE.accent, '#141a1f');
  sign(-11.6, 4.2, -16.5, 'BAY 4', Math.PI / 2, PALETTE.cyan, '#141a1f');
  stripe(0, 0.3, -14.4, 6.4, 0.18);

  // cover inside the site: containers and crates that make the bay a fight, not a room
  box(-7.4, 0.28, -20.4, 5.2, 2.6, 2.5, MATERIALS.container);
  box(7.4, 0.28, -20.4, 5.2, 2.6, 2.5, MATERIALS.containerTeal);
  box(-8.2, 0.28, -13.6, 2.4, 1.0, 2.4, MATERIALS.crate);
  box(8.2, 0.28, -13.6, 2.4, 1.0, 2.4, MATERIALS.crate);
  box(9.8, 0.28, -19.6, 1.6, 1.5, 1.6, MATERIALS.barrel);
  cylinder(-9.7, 0.28, -19.8, 0.55, 1.15, MATERIALS.barrel);
  cylinder(-8.6, 0.28, -20.4, 0.55, 1.15, MATERIALS.barrel);

  // --- mid lane: the container stack, the forklift, the low walls --------------------------
  box(0, 0, 0, 9.4, 2.6, 2.6, MATERIALS.container);
  box(0, 2.6, 0.1, 9.4, 2.6, 2.4, MATERIALS.containerTeal, { solid: true });
  box(-6.4, 0, 0, 2.6, 2.6, 6.4, MATERIALS.containerSteel);
  box(6.4, 0, 0, 2.6, 2.6, 6.4, MATERIALS.containerSteel);
  // forklift: a body, a mast, and two forks you can duck behind
  box(4.2, 0, 5.4, 1.7, 0.9, 2.4, MATERIALS.hazard);
  box(3.6, 1.5, 5.4, 1.0, 0.9, 1.2, MATERIALS.dark); // cage
  box(5.2, 0, 4.1, 0.3, 2.4, 0.3, MATERIALS.steel);
  box(5.2, 0, 4.1, 0.24, 0.24, 2.2, MATERIALS.steel, { solid: false });
  // crates and drums around the stack
  box(-3.6, 0, 4.6, 1.6, 1.6, 1.6, MATERIALS.crate);
  box(-3.6, 1.6, 4.6, 1.4, 1.3, 1.4, MATERIALS.crate);
  box(-5.9, 0, 6.2, 1.3, 1.0, 1.3, MATERIALS.crate);
  box(3.2, 0, -2.2, 1.5, 1.1, 1.5, MATERIALS.crate);
  cylinder(-2.4, 0, -2.6, 0.5, 1.05, MATERIALS.barrel);
  cylinder(-1.3, 0, -3.1, 0.5, 1.05, MATERIALS.barrel);
  cylinder(7.8, 0, 1.4, 0.52, 1.1, MATERIALS.barrel);
  // low walls that give the mid lane its corners
  box(-8.6, 0, 8.6, 6.2, 1.05, 0.6, MATERIALS.wall);
  box(8.6, 0, 8.6, 6.2, 1.05, 0.6, MATERIALS.wall);
  box(-9.4, 0, -6.4, 0.6, 1.05, 4.4, MATERIALS.wall);
  box(9.4, 0, -6.4, 0.6, 1.05, 4.4, MATERIALS.wall);

  // --- quay lane, west: a container corridor with a gap you have to commit to ---------------
  box(-20.6, 0, 6.4, 2.6, 2.6, 8.6, MATERIALS.container);
  box(-20.6, 0, -5.2, 2.6, 2.6, 8.6, MATERIALS.containerTeal);
  box(-20.6, 2.6, 0.6, 2.6, 2.6, 2.6, MATERIALS.containerSteel, { solid: false }); // overhang, not walkable cover
  box(-12.4, 0, 10.4, 2.4, 2.6, 2.4, MATERIALS.containerSteel);
  box(-12.4, 0, -3.2, 2.4, 1.5, 2.4, MATERIALS.container);
  box(-14.8, 0, 15.6, 1.5, 1.1, 1.5, MATERIALS.crate);
  cylinder(-18.2, 0, 12.4, 0.55, 1.2, MATERIALS.barrel);
  cylinder(-17.1, 0, 12.9, 0.55, 1.2, MATERIALS.barrel);
  sign(-25, 4.6, 4, 'QUAY 4', Math.PI / 2, PALETTE.ink, '#20262c');
  // a pipe run along the west wall, for the look and a sightline break
  cylinder(-24.6, 3.2, 2, 0.24, 22, MATERIALS.pipe, { solid: false });
  cylinder(-24.6, 4.0, 2, 0.18, 22, MATERIALS.pipe, { solid: false });

  // --- crane lane, east: a raised catwalk over the containers --------------------------------
  box(16.5, 2.55, 2, 3.2, 0.3, 20, MATERIALS.steel); // the deck
  for (let z = -7; z <= 11; z += 3.6) {
    box(15.2, 0, z, 0.24, 2.55, 0.24, MATERIALS.railing, { solid: false });
    box(17.8, 0, z, 0.24, 2.55, 0.24, MATERIALS.railing, { solid: false });
    box(15.2, 2.85, z, 0.1, 1.0, 0.1, MATERIALS.railing, { solid: false });
    box(15.2, 3.85, z, 3.0, 0.08, 0.08, MATERIALS.railing, { solid: false });
  }
  // stairs up at the south end, three steps a body can walk
  box(16.5, 0, 12.6, 3.2, 0.85, 1.1, MATERIALS.steel);
  box(16.5, 0, 11.9, 3.2, 1.7, 1.0, MATERIALS.steel);
  box(16.5, 0, 11.2, 3.2, 2.55, 1.0, MATERIALS.steel);
  box(20.4, 0, 4, 2.6, 2.6, 9.0, MATERIALS.container);
  box(20.4, 0, -8, 2.6, 2.6, 8.0, MATERIALS.containerTeal);
  box(13.4, 0, -18.4, 2.6, 2.6, 7.0, MATERIALS.container);
  cylinder(19.2, 0, 12.2, 0.55, 1.2, MATERIALS.barrel);
  sign(25, 5, -3, 'CRANE 2', Math.PI / 2, PALETTE.ink, '#20262c');

  // --- gantry crane over the site: the map's silhouette -------------------------------------
  box(-10.6, 0, -24.4, 0.9, 8.4, 0.9, MATERIALS.railing);
  box(10.6, 0, -24.4, 0.9, 8.4, 0.9, MATERIALS.railing);
  box(-10.6, 0, -12.4, 0.9, 8.4, 0.9, MATERIALS.railing);
  box(10.6, 0, -12.4, 0.9, 8.4, 0.9, MATERIALS.railing);
  box(0, 8.4, -24.4, 22.4, 0.8, 1.1, MATERIALS.hazard, { solid: false });
  box(0, 8.4, -12.4, 22.4, 0.8, 1.1, MATERIALS.hazard, { solid: false });
  box(-10.6, 9.2, -18.4, 1.1, 0.7, 13.1, MATERIALS.hazard, { solid: false });
  box(10.6, 9.2, -18.4, 1.1, 0.7, 13.1, MATERIALS.hazard, { solid: false });
  box(0, 9.9, -18.4, 21.0, 0.35, 1.0, MATERIALS.steel, { solid: false });
  box(3.2, 8.4, -18.4, 2.2, 1.3, 2.2, MATERIALS.dark, { solid: false }); // the trolley
  box(3.2, 6.4, -18.4, 0.1, 2.1, 0.1, MATERIALS.railing, { solid: false });
  box(3.2, 6.2, -18.4, 1.3, 0.3, 1.3, MATERIALS.hazard, { solid: false }); // the hook block

  // --- lamp posts and their glow ------------------------------------------------------------
  const lampSpots = [
    [-10.4, 0, 12.4], [10.4, 0, 12.4], [-10.4, 0, -6], [10.4, 0, -6], [0, 0, 6.4],
  ];
  for (const [lx, ly, lz] of lampSpots) {
    cylinder(lx, ly, lz, 0.13, 5.4, MATERIALS.steel, { solid: false });
    box(lx, 5.4, lz, 0.7, 0.16, 0.7, MATERIALS.lamp, { solid: false, shadows: false });
    const light = new THREE.PointLight(new THREE.Color(LIGHT.lamp), 6.5, 16, 2);
    light.position.set(lx, 5.2, lz);
    scene.add(light);
  }
  // cyan panel strips: the palette's second voice, along the site and the catwalk
  for (let x = -9; x <= 9; x += 3) {
    box(x, 0.3, -23.0, 2.0, 0.16, 0.12, MATERIALS.panel, { solid: false, shadows: false });
  }
  box(15.0, 2.9, 2, 0.1, 0.12, 18, MATERIALS.panel, { solid: false, shadows: false });
  box(0, 5.6, 25.9, 14, 0.14, 0.1, MATERIALS.panel, { solid: false, shadows: false });

  // --- outside the walls: silhouettes so the sky is not empty -------------------------------
  const skyline = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c242c'), roughness: 1, metalness: 0 });
  box(-34, 0, -6, 10, 16, 26, skyline, { solid: false, shadows: false });
  box(34, 0, 4, 12, 22, 30, skyline, { solid: false, shadows: false });
  box(2, 0, -44, 26, 13, 10, skyline, { solid: false, shadows: false });
  box(-18, 0, 40, 16, 9, 8, skyline, { solid: false, shadows: false });
  // two crane masts in the distance
  box(-30, 0, -30, 1.2, 26, 1.2, skyline, { solid: false, shadows: false });
  box(28, 0, -26, 1.2, 30, 1.2, skyline, { solid: false, shadows: false });

  // --- lights ------------------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(new THREE.Color(LIGHT.sky), new THREE.Color(LIGHT.ground), 1.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(LIGHT.sun), 2.1);
  sun.position.set(26, 34, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(new THREE.Color(LIGHT.sky), 0.55);
  fill.position.set(-20, 14, -24);
  scene.add(fill);
  // a low ambient so the shaded side of a container still reads as a surface, not a hole
  const ambient = new THREE.AmbientLight(new THREE.Color('#6d7f92'), 0.5);
  scene.add(ambient);

  return {
    root,
    colliders,
    spawn: SPAWN,
    site: SITE,
    // the four places the defenders start a round: anchor in the bay, roamer in mid, flanker on
    // the quay, and a second body deep on the crane lane
    botSpawns: [
      { x: 0.4, y: 0.28, z: -15.0, yaw: Math.PI * 0.02 },
      { x: 1.6, y: 0, z: 3.6, yaw: Math.PI },
      { x: -16, y: 0, z: -5.2, yaw: 0 },
      { x: 16.5, y: 0, z: -3.4, yaw: 0 },
    ],
  };
}
