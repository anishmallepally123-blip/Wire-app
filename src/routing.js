import { CPI } from "./parts.js";

/* Belly pan grid.
 *
 * CPI cells per inch (see parts.js). At 4/in the PDH's channels land 1.6
 * cells apart, which is enough to resolve all 20 — 2/in collides two pairs.
 * Going finer resolves nothing extra and makes a full re-route take seconds
 * on a phone, so 4 is the ceiling as well as the floor. */

export const PAN_IN = { w: 27, h: 27 };   /* typical FRC drivetrain */
export const COLS = PAN_IN.w * CPI;
export const ROWS = PAN_IN.h * CPI;

const TURN = 3 * CPI;   /* a corner costs about three quarters of an inch */
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* ------------------------------------------------------------------ */
/* A binary heap, not a linear scan. With a 112x96 grid the old scan took
   ~22s for 30 wires; this is ~0.3s. That difference is the only reason
   this resolution is usable at all. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/* ------------------------------------------------------------------ */

export function buildGrid(items) {
  const g = Array.from({ length: ROWS }, () => new Uint8Array(COLS));
  const fill = (it, v) => {
    for (let y = Math.round(it.y); y < Math.round(it.y + it.h); y++) {
      for (let x = Math.round(it.x); x < Math.round(it.x + it.w); x++) {
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) g[y][x] = v;
      }
    }
  };
  items.filter((i) => i.kind === "obstacle").forEach((i) => fill(i, 1));
  items.filter((i) => i.kind === "component").forEach((i) => fill(i, 2));
  items.filter((i) => i.kind === "grommet").forEach((i) => fill(i, 0));
  return g;
}

/* A port sits on a component edge, which is solid. Step one cell outward so
   pathfinding starts in free space; the drawing stitches the stub back. */
function anchorFor(item, port, grid) {
  const px = Math.round(item.x + port.x * CPI);
  const py = Math.round(item.y + port.y * CPI);
  const out = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[port.edge] || [0, -1];
  for (let step = 1; step <= 4; step++) {
    const x = px + out[0] * step;
    const y = py + out[1] * step;
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) break;
    if (grid[y][x] === 0) return { x, y };
  }
  /* Boxed in — fall back to any free neighbour so the wire still draws. */
  for (const [dx, dy] of DIRS) {
    const x = px + dx, y = py + dy;
    if (x >= 0 && y >= 0 && x < COLS && y < ROWS && grid[y][x] === 0) return { x, y };
  }
  return null;
}

/* A motor has no terminals worth modelling, so aim at the edge of its body
   facing the other end — the old box behaviour, kept just for those. */
function edgeAnchor(item, toward, grid) {
  const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
  const tx = toward.x + toward.w / 2, ty = toward.y + toward.h / 2;
  const horiz = Math.abs(tx - cx) > Math.abs(ty - cy);
  const px = horiz ? (tx > cx ? item.x + item.w : item.x - 1) : Math.round(cx);
  const py = horiz ? Math.round(cy) : (ty > cy ? item.y + item.h : item.y - 1);
  const fake = { x: px - item.x, y: py - item.y, edge:
    horiz ? (tx > cx ? "right" : "left") : (ty > cy ? "bottom" : "top") };
  return { pos: { x: px, y: py }, port: { x: fake.x / 4, y: fake.y / 4, edge: fake.edge } };
}

export function routePorts(from, to, grid) {
  const s = from.port
    ? anchorFor(from.item, from.port, grid)
    : nearestFree(edgeAnchor(from.item, to.item, grid).pos, grid);
  const e = to.port
    ? anchorFor(to.item, to.port, grid)
    : nearestFree(edgeAnchor(to.item, from.item, grid).pos, grid);
  if (!s || !e) return null;
  const cells = astar(s, e, grid);
  if (!cells) return null;
  const at = (side, anchor) => side.port
    ? { x: side.item.x + side.port.x * CPI, y: side.item.y + side.port.y * CPI }
    : { x: anchor.x + 0.5, y: anchor.y + 0.5 };
  return { cells, start: at(from, s), end: at(to, e) };
}

function nearestFree(p, grid) {
  for (let r = 0; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = p.x + dx, y = p.y + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        if (grid[y][x] === 0) return { x, y };
      }
    }
  }
  return null;
}

function astar(s, e, grid) {
  const best = new Float32Array(COLS * ROWS * 4).fill(Infinity);
  const parent = new Int32Array(COLS * ROWS * 4).fill(-1);
  const h = (x, y) => Math.abs(x - e.x) + Math.abs(y - e.y);
  const open = new Heap();
  const key = (x, y, d) => (y * COLS + x) * 4 + d;

  for (let d = 0; d < 4; d++) {
    open.push({ x: s.x, y: s.y, d, g: 0, f: h(s.x, s.y), k: key(s.x, s.y, d) });
    best[key(s.x, s.y, d)] = 0;
  }

  let guard = 0;
  const LIMIT = COLS * ROWS * 6;

  while (open.size && guard++ < LIMIT) {
    const cur = open.pop();
    if (best[cur.k] < cur.g) continue;

    if (cur.x === e.x && cur.y === e.y) {
      const path = [];
      let k = cur.k;
      while (k !== -1) {
        const cell = Math.floor(k / 4);
        path.push([cell % COLS, Math.floor(cell / COLS)]);
        k = parent[k];
      }
      return dedupe(path.reverse());
    }

    for (let di = 0; di < 4; di++) {
      const nx = cur.x + DIRS[di][0];
      const ny = cur.y + DIRS[di][1];
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const v = grid[ny][nx];
      if (v === 1 || v === 2) continue;         /* obstacles and component bodies */
      const g2 = cur.g + 1 + (cur.d !== di ? TURN : 0);
      const nk = key(nx, ny, di);
      if (best[nk] <= g2) continue;
      best[nk] = g2;
      parent[nk] = cur.k;
      open.push({ x: nx, y: ny, d: di, g: g2, f: g2 + h(nx, ny), k: nk });
    }
  }
  return null;
}

function dedupe(path) {
  const out = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

/* Draw port -> first routed cell -> ... -> last cell -> port, so the line
   visibly touches the terminal. */
export function toSvgPath(route, cell, offset) {
  const pts = [
    [route.start.x, route.start.y],
    ...route.cells.map(([x, y]) => [x + 0.5, y + 0.5]),
    [route.end.x, route.end.y],
  ];
  return pts
    .map((p, i) => `${i ? "L" : "M"}${p[0] * cell + offset} ${p[1] * cell + offset}`)
    .join(" ");
}
