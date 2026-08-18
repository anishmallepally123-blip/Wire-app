import React, { useState, useRef, useMemo, useCallback } from "react";
import { COLS, ROWS, buildGrid, route, toSvgPath } from "./routing.js";
import { abbrev } from "./naming.js";

/* Parts the palette offers. `id` doubles as the abbreviation used in wire
   names, so a wire ending at "PDH" finds this box with no extra mapping. */
export const PARTS = [
  { id: "PDH",   label: "PDH",          w: 5, h: 4 },
  { id: "MPM",   label: "MPM",          w: 4, h: 3 },
  { id: "SYSCR", label: "Systemcore",   w: 5, h: 3 },
  { id: "RIO",   label: "roboRIO",      w: 5, h: 3 },
  { id: "BATT",  label: "Battery",      w: 6, h: 4 },
  { id: "BRKR",  label: "Main breaker", w: 3, h: 2 },
  { id: "RDIO",  label: "Radio",        w: 4, h: 2 },
  { id: "VRM",   label: "VRM",          w: 3, h: 2 },
  { id: "KRK60", label: "Kraken x60",   w: 4, h: 3 },
  { id: "KRK44", label: "Kraken x44",   w: 3, h: 3 },
];

/* Swerve corners, dropped in as a named pair so you don't rename eight boxes
   by hand. Each becomes an ordinary component once placed. */
export const CORNERS = ["FL", "FR", "BL", "BR"];

const CELL = 22;

export default function LayoutTab({
  layout, wires, T, editing, setEditing, onCommit, sheetUrl, saving,
}) {
  const [sel, setSel] = useState(null);
  const [drag, setDrag] = useState(null);
  const [tip, setTip] = useState(null);
  /* While editing, everything happens in this local draft. Nothing reaches
     the sheet until Done editing, so a drag session is one write, not fifty. */
  const [draft, setDraft] = useState(null);
  const svgRef = useRef(null);

  const items = draft || layout || [];
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(layout || []);

  function startEdit() {
    setDraft(layout ? layout.map((i) => ({ ...i })) : []);
    setEditing(true);
    setSel(null);
  }
  function finishEdit() {
    if (draft && dirty) onCommit(draft);
    setDraft(null);
    setEditing(false);
    setSel(null);
  }
  function cancelEdit() {
    setDraft(null);
    setEditing(false);
    setSel(null);
  }
  const put = (item) =>
    setDraft((d) => {
      const base = d || [];
      return base.some((i) => i.id === item.id)
        ? base.map((i) => (i.id === item.id ? item : i))
        : [...base, item];
    });
  const drop = (id) => setDraft((d) => (d || []).filter((i) => i.id !== id));
  const comps = useMemo(() => items.filter((i) => i.kind === "component"), [items]);
  const grid = useMemo(() => buildGrid(items), [items]);

  /* Match each wire to two boxes on the pan. Anything ending above the
     drivetrain simply has no box, and is counted rather than drawn. */
  const byId = useMemo(() => {
    const m = {};
    comps.forEach((c) => { m[c.compId || abbrev(c.label)] = c; });
    return m;
  }, [comps]);

  const routed = useMemo(() => {
    const out = [];
    let skipped = 0;
    const pairSeen = {};
    wires.forEach((w) => {
      const a = byId[abbrev(w.fromDevice)];
      const b = byId[abbrev(w.toDevice)];
      if (!a || !b || a === b) { skipped++; return; }
      const key = [a.id, b.id].sort().join("|");
      const n = pairSeen[key] || 0;
      pairSeen[key] = n + 1;
      const cells = route(a, b, grid);
      if (!cells) { skipped++; return; }
      const stage = w.stage === "schematic" ? "schematic" : "physical";
      out.push({ w, cells, stage, offset: (n % 3) * 2.6 - 2.6 });
    });

    /* Index every cell a wire passes through, so hovering can report all the
       wires under the cursor rather than just whichever drew last. */
    const atCell = new Map();
    out.forEach((r) => {
      r.cells.forEach(([x, y]) => {
        const k = `${x},${y}`;
        if (!atCell.has(k)) atCell.set(k, []);
        if (!atCell.get(k).includes(r)) atCell.get(k).push(r);
      });
    });
    return { out, skipped, atCell };
  }, [wires, byId, grid]);

  /* Wires under the cursor, checking a one-cell radius so thin lines are
     still catchable with a mouse or a fingertip. */
  const hoverAt = useCallback((cx, cy) => {
    const found = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        (routed.atCell.get(`${cx + dx},${cy + dy}`) || []).forEach((r) => {
          if (!found.includes(r)) found.push(r);
        });
      }
    }
    return found;
  }, [routed]);

  /* ---- dragging, pointer events so it works on phones ---- */
  const cellFromEvent = useCallback((e) => {
    const r = svgRef.current.getBoundingClientRect();
    const scale = COLS * CELL / r.width;
    return {
      x: Math.floor(((e.clientX - r.left) * scale) / CELL),
      y: Math.floor(((e.clientY - r.top) * scale) / CELL),
    };
  }, []);

  function down(e, item) {
    if (!editing) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const c = cellFromEvent(e);
    setSel(item.id);
    setDrag({ id: item.id, dx: c.x - item.x, dy: c.y - item.y, moved: false, item });
  }
  function hover(e) {
    if (editing || drag) { if (tip) setTip(null); return; }
    const c = cellFromEvent(e);
    const hits = hoverAt(c.x, c.y);
    if (!hits.length) { if (tip) setTip(null); return; }
    /* Flip the box toward whichever side has room, so it never spills out
       of the pan. */
    setTip({
      x: c.x, y: c.y,
      flipX: c.x > COLS * 0.55,
      flipY: c.y > ROWS * 0.6,
      wires: hits.map((r) => ({ name: r.w.name, stage: r.stage, color: T[r.w.type]?.color || "#59636E" })),
    });
  }

  function move(e) {
    hover(e);
    if (!drag) return;
    const c = cellFromEvent(e);
    const nx = clamp(c.x - drag.dx, 0, COLS - drag.item.w);
    const ny = clamp(c.y - drag.dy, 0, ROWS - drag.item.h);
    if (nx === drag.item.x && ny === drag.item.y) return;
    setDrag((d) => ({ ...d, moved: true, item: { ...d.item, x: nx, y: ny } }));
  }
  function up() {
    if (!drag) return;
    if (drag.moved) put(drag.item);
    setDrag(null);
  }

  const shown = (it) => (drag && drag.id === it.id ? drag.item : it);

  function add(part) {
    const spot = freeSpot(items, part.w, part.h);
    const label = uniqueLabel(items, part.label);
    put({
      id: `c${Date.now()}${Math.floor(Math.random() * 100)}`,
      kind: "component", compId: abbrev(label), label,
      x: spot.x, y: spot.y, w: part.w, h: part.h,
    });
  }

  /* The label is the device name wires refer to, so renaming a box to
     "BL Azimuth" is what makes that name selectable in Add wire. */
  function rename(item, label) {
    put({ ...item, label, compId: abbrev(label) });
  }
  function addCorner(corner) {
    let pool = items;
    [`${corner} Drive`, `${corner} Azimuth`].forEach((label) => {
      const spot = freeSpot(pool, 4, 3);
      const it = {
        id: `c${Date.now()}${Math.floor(Math.random() * 1000)}`,
        kind: "component", compId: abbrev(label), label,
        x: spot.x, y: spot.y, w: 4, h: 3,
      };
      pool = [...pool, it];
      put(it);
    });
  }

  function addBlock(kind) {
    const size = kind === "grommet" ? { w: 1, h: 1 } : { w: 2, h: 6 };
    const spot = freeSpot(items, size.w, size.h);
    put({
      id: `${kind[0]}${Date.now()}${Math.floor(Math.random() * 100)}`,
      kind, compId: "", label: kind === "grommet" ? "Grommet" : "Obstacle",
      x: spot.x, y: spot.y, ...size,
    });
  }

  const selected = items.find((i) => i.id === sel);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-h">Belly pan</h2>
        <div className="tools">
          {editing ? (
            <>
              {selected && (
                <button className="btn btn-sm btn-del"
                  onClick={() => { drop(selected.id); setSel(null); }}>
                  Remove {selected.kind === "component" ? "component" : selected.kind}
                </button>
              )}
              <button className="btn btn-sm" onClick={cancelEdit}>Cancel</button>
              <button className="btn btn-sm btn-go" onClick={finishEdit} disabled={saving}>
                {saving ? "Saving…" : dirty ? "Done — save" : "Done"}
              </button>
            </>
          ) : (
            <button className="btn btn-sm" onClick={startEdit}>Edit layout</button>
          )}
        </div>
      </div>

      {editing && (
        <div className="palette">
          <p className="palette-h">Components</p>
          <div className="palette-row">
            {PARTS.map((p) => (
              <button key={p.id} className="pbtn" onClick={() => add(p)}>{p.label}</button>
            ))}
          </div>
          <p className="palette-h">Swerve corner</p>
          <div className="palette-row">
            {CORNERS.map((c) => (
              <button key={c} className="pbtn" onClick={() => addCorner(c)}>
                {c} drive + azimuth
              </button>
            ))}
          </div>
          <p className="palette-h">Structure</p>
          <div className="palette-row">
            <button className="pbtn" onClick={() => addBlock("obstacle")}>Obstacle</button>
            <button className="pbtn" onClick={() => addBlock("grommet")}>Grommet</button>
          </div>
        </div>
      )}

      {!items.length ? (
        <p className="empty">
          Nothing placed yet. Hit <strong>Edit layout</strong>, then <strong>Add…</strong> to
          drop in the PDH, battery, and anything else that lives on the drivetrain.
        </p>
      ) : (
        <>
          <div className="pan-wrap">
          <svg ref={svgRef} className={"pan" + (editing ? " pan-edit" : "")}
            viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}
            onPointerMove={move} onPointerUp={up}
            onPointerLeave={() => { up(); setTip(null); }}>
            <defs>
              <pattern id="gp" width={CELL} height={CELL} patternUnits="userSpaceOnUse">
                <path d={`M ${CELL} 0 L 0 0 0 ${CELL}`} fill="none"
                  stroke="#D3D8DE" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width={COLS * CELL} height={ROWS * CELL} fill="url(#gp)" />
            <rect x="2" y="2" width={COLS * CELL - 4} height={ROWS * CELL - 4}
              fill="none" stroke="#59636E" strokeWidth="2" rx="4" />

            {items.filter((i) => i.kind === "obstacle").map((i) => {
              const it = shown(i);
              return (
                <rect key={i.id} x={it.x * CELL} y={it.y * CELL}
                  width={it.w * CELL} height={it.h * CELL}
                  fill="#59636E" opacity={sel === i.id ? 0.45 : 0.22}
                  style={{ cursor: editing ? "move" : "default" }}
                  onPointerDown={(e) => down(e, it)} />
              );
            })}

            {!editing && routed.out.map(({ w, cells, stage, offset }) => {
              const lit = tip && tip.wires.some((t) => t.name === w.name);
              return (
                <path key={w.id} d={toSvgPath(cells, CELL, offset)} fill="none"
                  stroke={T[w.type]?.color || "#59636E"}
                  strokeWidth={lit ? 4.2 : 2.6}
                  strokeDasharray={stage === "schematic" ? "5 4" : undefined}
                  strokeLinecap="round" strokeLinejoin="round"
                  opacity={tip ? (lit ? 1 : 0.28) : 0.9} />
              );
            })}

            {items.filter((i) => i.kind === "grommet").map((i) => {
              const it = shown(i);
              return (
                <circle key={i.id} cx={it.x * CELL + CELL / 2} cy={it.y * CELL + CELL / 2}
                  r={CELL * 0.34} fill="#fff"
                  stroke={sel === i.id ? "#161B22" : "#59636E"}
                  strokeWidth={sel === i.id ? 2.5 : 1.5}
                  style={{ cursor: editing ? "move" : "default" }}
                  onPointerDown={(e) => down(e, it)} />
              );
            })}

            {comps.map((i) => {
              const it = shown(i);
              return (
                <g key={i.id} style={{ cursor: editing ? "move" : "default" }}
                  onPointerDown={(e) => down(e, it)}>
                  <rect x={it.x * CELL} y={it.y * CELL}
                    width={it.w * CELL} height={it.h * CELL} rx="3"
                    fill="#fff" stroke={sel === i.id ? "#161B22" : "#59636E"}
                    strokeWidth={sel === i.id ? 2.5 : 1.5} />
                  <text x={it.x * CELL + (it.w * CELL) / 2}
                    y={it.y * CELL + (it.h * CELL) / 2 + 4}
                    textAnchor="middle" fontSize="11"
                    fontFamily="'IBM Plex Mono', monospace" fill="#161B22">
                    {it.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {tip && (
            <div className="tip" style={{
              left: `${((tip.x + (tip.flipX ? -0.5 : 1.5)) / COLS) * 100}%`,
              top: `${((tip.y + (tip.flipY ? -0.5 : 1.5)) / ROWS) * 100}%`,
              transform: `translate(${tip.flipX ? "-100%" : "0"}, ${tip.flipY ? "-100%" : "0"})`,
            }}>
              {tip.wires.map((t, i) => (
                <div key={t.name} className="tip-row">
                  {i > 0 && <span className="tip-sep" />}
                  <span className="tip-dot" style={{ background: t.color }} />
                  <span className="tip-name">{t.name}</span>
                  <span className="tip-stage">{t.stage === "schematic" ? "planned" : "run"}</span>
                </div>
              ))}
            </div>
          )}
          </div>

          {editing ? (
            <div className="panbar">
              <span className="panhint">
                {selected
                  ? `Drag to move${selected.kind === "component" ? ", or rename it" : ""}`
                  : dirty ? "Unsaved changes — hit Done to save" : "Drag anything to move it"}
              </span>
              {selected && (
                <>
                  {selected.kind === "component" && (
                    <input className="renamer" value={selected.label}
                      aria-label="Component name"
                      placeholder="Name this component"
                      onChange={(e) => rename(selected, e.target.value)} />
                  )}
                  {selected.kind !== "grommet" && (
                    <span className="sizer">
                      <button className="btn btn-sm" onClick={() => resize(selected, -1, 0, put)}>–W</button>
                      <button className="btn btn-sm" onClick={() => resize(selected, 1, 0, put)}>+W</button>
                      <button className="btn btn-sm" onClick={() => resize(selected, 0, -1, put)}>–H</button>
                      <button className="btn btn-sm" onClick={() => resize(selected, 0, 1, put)}>+H</button>
                    </span>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="panbar">
              <span className="panhint">
                {routed.out.length} of {wires.length} wires routed
                {routed.skipped > 0 && ` — ${routed.skipped} end off the drivetrain`}
              </span>
              <span className="key">
                <span className="key-i"><svg width="26" height="4"><line x1="1" y1="2" x2="25" y2="2"
                  stroke="#59636E" strokeWidth="2.6" strokeLinecap="round" /></svg>on the robot</span>
                <span className="key-i"><svg width="26" height="4"><line x1="1" y1="2" x2="25" y2="2"
                  stroke="#59636E" strokeWidth="2.6" strokeDasharray="5 4" strokeLinecap="round" /></svg>planned</span>
              </span>
            </div>
          )}

          <p className="disclaimer">
            Planning view. Routes are the shortest legal path on this model, not a
            record of how the wire actually runs — don't trace from it in the pit.
          </p>
        </>
      )}

      {!sheetUrl && items.length > 0 && (
        <p className="notice">Not connected to a sheet, so this layout stays on this device.</p>
      )}
    </section>
  );
}

/* ------------------------------ helpers ------------------------------ */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function resize(item, dw, dh, put) {
  const w = clamp(item.w + dw, 1, COLS - item.x);
  const h = clamp(item.h + dh, 1, ROWS - item.y);
  if (w !== item.w || h !== item.h) put({ ...item, w, h });
}

/* Two "Kraken x60" boxes would collide when matching wires, so number them. */
function uniqueLabel(items, base) {
  const taken = new Set(items.filter((i) => i.label).map((i) => i.label.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/* Drop new items somewhere empty rather than stacked on the origin. */
function freeSpot(items, w, h) {
  const hit = (x, y) =>
    items.some((i) => x < i.x + i.w && x + w > i.x && y < i.y + i.h && y + h > i.y);
  for (let y = 1; y < ROWS - h; y++) {
    for (let x = 1; x < COLS - w; x++) if (!hit(x, y)) return { x, y };
  }
  return { x: 1, y: 1 };
}
