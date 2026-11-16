// The palette: six values, one place. Every colour in the game and in the HUD comes from here,
// so the render and the page cannot drift apart. Materials are built once and shared: the map
// reuses a handful of them instead of making one per box.
import * as THREE from 'three';

export const PALETTE = {
  canvas: '#12161a',
  surface: '#1b2128',
  hairline: '#2b333d',
  ink: '#e8e4da',
  muted: '#8f9aa4',
  accent: '#d9762f',
  cyan: '#43c6d8',
  // map tones, all within the same family
  concrete: '#6f7276',
  concreteDark: '#4a4d51',
  slate: '#3c444c',
  sand: '#b9a98c',
  rust: '#8f4f2c',
  steel: '#5d6771',
  glass: '#7fb4bf',
};

export const LIGHT = {
  sun: '#ffd8a8',
  sky: '#5b7185',
  ground: '#2a2622',
  lamp: '#ffb26b',
  panel: '#6fe0ee',
  fog: '#1a2129',
};

// Shared materials and geometries. Built lazily once, in buildMaterials().
export const MATERIALS = {};
export const GEOMETRY = {};

function standard(color, roughness, metalness) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness,
  });
}

export function buildMaterials() {
  MATERIALS.floor = standard(PALETTE.concreteDark, 0.94, 0.04);
  MATERIALS.floorAlt = standard('#55585c', 0.92, 0.05);
  MATERIALS.wall = standard(PALETTE.concrete, 0.88, 0.06);
  MATERIALS.wallDark = standard(PALETTE.slate, 0.86, 0.08);
  MATERIALS.container = standard(PALETTE.rust, 0.72, 0.28);
  MATERIALS.containerTeal = standard('#2f5a5f', 0.7, 0.3);
  MATERIALS.containerSteel = standard(PALETTE.steel, 0.62, 0.42);
  MATERIALS.crate = standard(PALETTE.sand, 0.85, 0.04);
  MATERIALS.barrel = standard('#6a4a2e', 0.7, 0.2);
  MATERIALS.pipe = standard('#7d858c', 0.55, 0.5);
  MATERIALS.steel = standard(PALETTE.steel, 0.5, 0.6);
  MATERIALS.railing = standard('#8a9299', 0.45, 0.62);
  MATERIALS.dark = standard('#23282d', 0.9, 0.1);
  MATERIALS.panel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.cyan),
    emissive: new THREE.Color(LIGHT.panel),
    emissiveIntensity: 1.35,
    roughness: 0.35,
    metalness: 0.1,
  });
  MATERIALS.lamp = new THREE.MeshStandardMaterial({
    color: new THREE.Color(LIGHT.lamp),
    emissive: new THREE.Color(LIGHT.lamp),
    emissiveIntensity: 1.9,
    roughness: 0.4,
  });
  MATERIALS.glass = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.glass),
    transparent: true,
    opacity: 0.22,
    roughness: 0.12,
    metalness: 0.4,
  });
  MATERIALS.hazard = standard('#d9a12f', 0.8, 0.05);

  // Bot bodies: three tones so they read apart at a distance.
  MATERIALS.botBody = standard('#5a4a3c', 0.85, 0.06);
  MATERIALS.botVest = standard('#8a3f2a', 0.78, 0.1);
  MATERIALS.botHead = standard('#c9b295', 0.75, 0.02);
  MATERIALS.botGun = standard('#2c3136', 0.5, 0.55);

  GEOMETRY.unitBox = new THREE.BoxGeometry(1, 1, 1);
  GEOMETRY.plane = new THREE.PlaneGeometry(1, 1);
  GEOMETRY.cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
}

export function color(hex) {
  return new THREE.Color(hex);
}
