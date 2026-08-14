/* Grid pathfinding for the belly pan.

   Cells: 0 free, 1 blocked (obstacle), 2 component body.
   Grommets punch a hole through an obstacle, so they're written last.

   The turn penalty is what makes routes look like wire runs instead of
   staircases — a straight cell costs 1, a corner costs 1 + TURN. */

export const COLS = 32;
export const ROWS = 24;
const TURN = 3;
const GUARD = 40000;

export function buildGrid(items) {
  const g = Array.from({ length: ROWS }, () => new Uint8Array(COLS));
  const put = (it, v) => {
    for (let y = it.y; y < it.y + it.h; y++) {
      for (let x = it.x; x < it.x + it.w; x++) {
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) g[y][x] = v;
      }
    }
  };
  items.filter((i) => i.kind === "obstacle").forEach((i) => put(i, 1));
  items.filter((i) => i.kind === "component").forEach((i) => put(i, 2));
  items.filter((i) => i.kind === "grommet").forEach((i) => put(i, 0));
  return g;
}

const inside = (it, x, y) =>
  x >= it.x && x < it.x + it.w && y >= it.y && y < it.y + it.h;

/* Enter/leave a component at the edge cell nearest the other end, so wires
   land on the side of the box that faces where they're going. */
function anchor(box, toward) {
  const cx = box.x + box.w / 2 - 0.5;
  const cy = box.y + box.h / 2 - 0.5;
  const tx = toward.x + toward.w / 2 - 0.5;
  const ty = toward.y + toward.h / 2 - 0.5;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      x: dx > 0 ? box.x + box.w : box.x - 1,
      y: Math.min(ROWS - 1, Math.max(0, Math.round(cy))),
    };
  }
  return {
    x: Math.min(COLS - 1, Math.max(0, Math.round(cx))),
    y: dy > 0 ? box.y + box.h : box.y - 1,
  };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function route(from, to, grid) {
  const s = anchor(from, to);
  const e = anchor(to, from);
  if (s.x < 0 || s.y < 0 || s.x >= COLS || s.y >= ROWS) return null;
  if (e.x < 0 || e.y < 0 || e.x >= COLS || e.y >= ROWS) return null;
  if (grid[s.y][s.x] === 1 || grid[e.y][e.x] === 1) return null;

  const h = (x, y) => Math.abs(x - e.x) + Math.abs(y - e.y);
  const seen = new Map();
  const open = [{ x: s.x, y: s.y, d: -1, g: 0, f: h(s.x, s.y), p: null }];
  let guard = 0;

  while (open.length && guard++ < GUARD) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];

    if (cur.x === e.x && cur.y === e.y) {
      const path = [];
      for (let n = cur; n; n = n.p) path.push([n.x, n.y]);
      path.reverse();
      /* stitch on the box centres so the line visibly touches each device */
      path.unshift([Math.round(from.x + from.w / 2 - 0.5), Math.round(from.y + from.h / 2 - 0.5)]);
      path.push([Math.round(to.x + to.w / 2 - 0.5), Math.round(to.y + to.h / 2 - 0.5)]);
      return path;
    }

    const key = `${cur.x},${cur.y},${cur.d}`;
    const prev = seen.get(key);
    if (prev !== undefined && prev <= cur.g) continue;
    seen.set(key, cur.g);

    for (let di = 0; di < 4; di++) {
      const nx = cur.x + DIRS[di][0];
      const ny = cur.y + DIRS[di][1];
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const v = grid[ny][nx];
      if (v === 1) continue;
      /* components are solid except the two this wire connects */
      if (v === 2 && !inside(from, nx, ny) && !inside(to, nx, ny)) continue;
      const g2 = cur.g + 1 + (cur.d !== -1 && cur.d !== di ? TURN : 0);
      open.push({ x: nx, y: ny, d: di, g: g2, f: g2 + h(nx, ny), p: cur });
    }
  }
  return null;
}

/* Turn a cell path into an SVG path, offset sideways so parallel runs
   between the same two devices don't sit exactly on top of each other. */
export function toSvgPath(cells, cell, offset) {
  return cells
    .map((c, i) => `${i ? "L" : "M"}${c[0] * cell + cell / 2 + offset} ${c[1] * cell + cell / 2 + offset}`)
    .join(" ");
}
