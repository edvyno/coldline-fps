// Navigation: the waypoint graph the defenders walk, and the path they take through it. A* over
// twenty-two nodes is enough for a map this size; the point of the graph is that bots use lanes
// and corners instead of sliding along walls, so their movement reads as intent.
import { WAYPOINTS, EDGES } from './world.js';

const nodes = WAYPOINTS;
const adjacency = new Map();

for (const node of nodes) adjacency.set(node.id, []);
for (const [a, b] of EDGES) {
  const na = nodes[a];
  const nb = nodes[b];
  if (!na || !nb) continue;
  const cost = Math.hypot(na.x - nb.x, na.z - nb.z);
  adjacency.get(a).push({ id: b, cost });
  adjacency.get(b).push({ id: a, cost });
}

export function nodeById(id) {
  return nodes[id] ?? null;
}

export function nearestNode(x, z) {
  let best = nodes[0];
  let bestCost = Infinity;
  for (const node of nodes) {
    const cost = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (cost < bestCost) {
      bestCost = cost;
      best = node;
    }
  }
  return best;
}

// A* from the node nearest (x, z) to the node nearest (tx, tz). Returns waypoint ids, excluding
// the start node and including the destination.
export function findPath(x, z, targetId) {
  const start = nearestNode(x, z);
  const goal = typeof targetId === 'number' ? targetId : nearestNode(targetId.x, targetId.z).id;
  if (start.id === goal) return [];
  const open = [{ id: start.id, g: 0, f: 0 }];
  const cameFrom = new Map();
  const gScore = new Map([[start.id, 0]]);
  const closed = new Set();
  const goalNode = nodes[goal];

  while (open.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestIndex].f) bestIndex = i;
    const current = open.splice(bestIndex, 1)[0];
    if (current.id === goal) {
      const path = [];
      let cursor = goal;
      while (cursor !== start.id) {
        path.push(cursor);
        cursor = cameFrom.get(cursor);
        if (cursor === undefined) return [];
      }
      return path.reverse();
    }
    closed.add(current.id);
    for (const edge of adjacency.get(current.id)) {
      if (closed.has(edge.id)) continue;
      const tentative = current.g + edge.cost;
      if (tentative >= (gScore.get(edge.id) ?? Infinity)) continue;
      const node = nodes[edge.id];
      const heuristic = Math.hypot(node.x - goalNode.x, node.z - goalNode.z);
      gScore.set(edge.id, tentative);
      cameFrom.set(edge.id, current.id);
      open.push({ id: edge.id, g: tentative, f: tentative + heuristic });
    }
  }
  return [];
}

// The patrol each role walks when nothing has happened yet: a loop that covers its lane and keeps
// coming back to the site. A roamer that never arrives is a roamer the player can ignore.
export const PATROLS = {
  anchor: [5, 6, 5, 7, 20, 5],
  roamer: [5, 4, 3, 2, 1, 16, 18, 4, 5],
  flanker: [5, 11, 10, 9, 8, 17, 19, 11, 5],
  crane: [5, 15, 14, 13, 12, 15, 21, 15, 5],
};

// The post a bot holds when its round starts quiet and its role says stay put.
export const HOLD_POINTS = {
  anchor: { x: 2.4, z: -14.2, lookAt: { x: 0, z: -9 } },
  roamer: { x: -1.2, z: 5.4, lookAt: { x: 0, z: -2 } },
  flanker: { x: -15.4, z: -4.6, lookAt: { x: -12, z: -10 } },
  crane: { x: 16.4, z: -2.2, lookAt: { x: 12, z: -9 } },
};

// Where a bot goes when it hears a shot: the nearest node to the noise, so it investigates a place
// it can actually reach rather than a wall.
export function investigateTarget(x, z) {
  const node = nearestNode(x, z);
  return { id: node.id, x: node.x, z: node.z };
}
