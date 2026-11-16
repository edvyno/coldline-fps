// Physics: axis-aligned boxes and a body that slides along them. Everything the map and the bots
// stand on is a box, so collision is a small, exact routine rather than a mesh query: resolve one
// axis at a time, push out along the shallower face, and let a body step up a low ledge instead of
// being stopped by it.

export const BODY_RADIUS = 0.36;
export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.15;
export const STEP_HEIGHT = 0.38;
export const GRAVITY = 18.5;

function overlaps(box, x, y, z, radius, height) {
  return (
    x + radius > box.minX &&
    x - radius < box.maxX &&
    y + height > box.minY &&
    y < box.maxY &&
    z + radius > box.minZ &&
    z - radius < box.maxZ
  );
}

function headroomClear(colliders, x, y, z, radius, height) {
  for (let i = 0; i < colliders.length; i += 1) {
    const box = colliders[i];
    if (box.noBlock) continue;
    if (overlaps(box, x, y, z, radius, height)) return false;
  }
  return true;
}

// Moves a body by its velocity for dt seconds and stops it against the map. Returns the surface
// flags the caller needs: grounded, and whether it hit a wall (for footsteps and bot noise).
export function moveBody(body, colliders, dt) {
  const radius = body.radius ?? BODY_RADIUS;
  const height = body.height ?? STAND_HEIGHT;
  let onGround = false;
  let hitWall = false;
  const pos = body.pos;
  const vel = body.vel;

  // Horizontal, one axis at a time, so a box's face decides which velocity dies.
  for (const axis of ['x', 'z']) {
    if (vel[axis] === 0) continue;
    pos[axis] += vel[axis] * dt;
    for (let i = 0; i < colliders.length; i += 1) {
      const box = colliders[i];
      if (box.noBlock) continue;
      if (!overlaps(box, pos.x, pos.y, pos.z, radius, height)) continue;
      // step up: a low ledge is climbed rather than collided with
      const ledge = box.maxY - pos.y;
      if (body.stepUp && ledge > 0 && ledge <= STEP_HEIGHT && headroomClear(colliders, pos.x, box.maxY + 0.01, pos.z, radius, height)) {
        pos.y = box.maxY + 0.01;
        continue;
      }
      if (axis === 'x') {
        pos.x = vel.x > 0 ? box.minX - radius : box.maxX + radius;
      } else {
        pos.z = vel.z > 0 ? box.minZ - radius : box.maxZ + radius;
      }
      vel[axis] = 0;
      hitWall = true;
    }
  }

  // Vertical: down onto a top face plants the body, up into a ceiling stops it.
  pos.y += vel.y * dt;
  for (let i = 0; i < colliders.length; i += 1) {
    const box = colliders[i];
    if (box.noBlock) continue;
    if (!overlaps(box, pos.x, pos.y, pos.z, radius, height)) continue;
    if (vel.y <= 0) {
      pos.y = box.maxY;
      vel.y = 0;
      onGround = true;
    } else {
      pos.y = box.minY - height;
      vel.y = 0;
    }
  }
  // the floor is a collider too, but a body that fell past it is caught here
  if (pos.y <= 0) {
    pos.y = 0;
    vel.y = 0;
    onGround = true;
  }
  body.onGround = onGround;
  body.hitWall = hitWall;
  return { onGround, hitWall };
}

// Distance along a ray to a box, or -1. The slab test, used for both line of sight and bullets.
export function rayBox(ox, oy, oz, dx, dy, dz, maxT, box) {
  let tmin = 0;
  let tmax = maxT;
  const axes = [
    [ox, dx, box.minX, box.maxX],
    [oy, dy, box.minY, box.maxY],
    [oz, dz, box.minZ, box.maxZ],
  ];
  for (let i = 0; i < 3; i += 1) {
    const [origin, dir, lo, hi] = axes[i];
    if (Math.abs(dir) < 1e-8) {
      if (origin < lo || origin > hi) return -1;
      continue;
    }
    const inv = 1 / dir;
    let t1 = (lo - origin) * inv;
    let t2 = (hi - origin) * inv;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// The nearest box a ray hits, with its distance. Boxes flagged noBlock (glass, decals) are skipped.
export function rayWorld(ox, oy, oz, dx, dy, dz, maxT, colliders) {
  let best = maxT;
  let found = false;
  for (let i = 0; i < colliders.length; i += 1) {
    const box = colliders[i];
    if (box.noBlock) continue;
    const t = rayBox(ox, oy, oz, dx, dy, dz, best, box);
    if (t >= 0 && t < best) {
      best = t;
      found = true;
    }
  }
  return found ? best : -1;
}

// Line of sight: is the straight line between two points interrupted by the map?
export function blocked(ax, ay, az, bx, by, bz, colliders) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-4) return false;
  const hit = rayWorld(ax, ay, az, dx / length, dy / length, dz / length, length, colliders);
  return hit >= 0 && hit < length - 0.05;
}

// Ray against an upright cylinder, the cheap stand-in for a body: gives both the entry distance
// and which part of the body was hit, which is what decides headshot damage.
export function rayCylinder(ox, oy, oz, dx, dy, dz, maxT, cx, cy, cz, radius, halfHeight) {
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  const b = 2 * (px * dx + pz * dz);
  const c = px * px + pz * pz - radius * radius;
  if (a < 1e-8) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const root = Math.sqrt(disc);
  let t = (-b - root) / (2 * a);
  if (t < 0) t = (-b + root) / (2 * a);
  if (t < 0 || t > maxT) return -1;
  const hitY = oy + dy * t;
  if (hitY < cy - halfHeight || hitY > cy + halfHeight) return -1;
  return t;
}
