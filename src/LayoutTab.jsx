import React, { useState, useRef, useMemo, useCallback } from "react";
import { COLS, ROWS, buildGrid, route, toSvgPath } from "./routing.js";

/* Parts the palette offers. `id` doubles as the abbreviation used in wire
   names, so a wire ending at "PDH" finds this box with no extra mapping. */
export const PARTS = [
  { id: "PDH",   label: "PDH",           w: 5, h: 4 },
  { id: "MPM",   label: "MPM",           w: 4, h: 3 },
  { id: "SYSCR", label: "Systemcore",    w: 5, h: 3 },
  { id: "RIO",   label: "roboRIO",       w: 5, h: 3 },
  { id: "BATT",  label: "Battery",       w: 6, h: 4 },
  { id: "BRKR",  label: "Main breaker",  w: 3, h: 2 },
  { id: "KRK60", label: "Kraken x60",    w: 4, h: 3 },
  { id: "KRK44", label: "Kraken x44",    w: 3, h: 3 },
  { id: "RDIO",  label: "Radio",         w: 4, h: 2 },
  { id: "PH",    label: "Pneumatic hub", w: 4, h: 3 },
];

const CELL = 22;

export default function LayoutTab({
  layout, wires, T, editing, setEditing, onSave, onDelete, sheetUrl,
}) {
  const [sel, setSel] = useState(null);
  const [palette, setPalette] = useState(false);
  const [drag, setDrag] = useState(null);
  const svgRef = useRef(null);

  const items = layout || [];
  const comps = useMemo(() => items.filter((i) => i.kind === "component"), [items]);
  const grid = useMemo(() => buildGrid(items), [items]);

  /* Match each wire to two boxes on the pan. Anything ending above the
     drivetrain simply has no box, and is counted rather than drawn. */
  const byId = useMemo(() => {
    const m = {};
    comps.forEach((c) => { m[c.compId || c.id] = c; });
    return m;
  }, [comps]);

  const routed = useMemo(() => {
    const out = [];
    let skipped = 0;
    const pairSeen = {};
    wires.forEach((w) => {
      const a = byId[abbrevOf(w.fromDevice)];
      const b = byId[abbrevOf(w.toDevice)];
      if (!a || !b || a === b) { skipped++; return; }
      const key = [a.id, b.id].sort().join("|");
      const n = pairSeen[key] || 0;
      pairSeen[key] = n + 1;
      const cells = route(a, b, grid);
      if (!cells) { skipped++; return; }
      out.push({ w, cells, offset: (n % 3) * 2.6 - 2.6 });
    });
    return { out, skipped };
  }, [wires, byId, grid]);

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
  function move(e) {
    if (!drag) return;
    const c = cellFromEvent(e);
    const nx = clamp(c.x - drag.dx, 0, COLS - drag.item.w);
    const ny = clamp(c.y - drag.dy, 0, ROWS - drag.item.h);
    if (nx === drag.item.x && ny === drag.item.y) return;
    setDrag((d) => ({ ...d, moved: true, item: { ...d.item, x: nx, y: ny } }));
  }
  function up() {
    if (!drag) return;
    if (drag.moved) onSave(drag.item);   /* one write per drop, not per pixel */
    setDrag(null);
  }

  const shown = (it) => (drag && drag.id === it.id ? drag.item : it);

  function add(part) {
    const spot = freeSpot(items, part.w, part.h);
    onSave({
      id: `c${Date.now()}${Math.floor(Math.random() * 100)}`,
      kind: "component", compId: part.id, label: part.label,
      x: spot.x, y: spot.y, w: part.w, h: part.h,
    });
    setPalette(false);
  }
  function addBlock(kind) {
    const size = kind === "grommet" ? { w: 1, h: 1 } : { w: 2, h: 6 };
    const spot = freeSpot(items, size.w, size.h);
    onSave({
      id: `${kind[0]}${Date.now()}${Math.floor(Math.random() * 100)}`,
      kind, compId: "", label: kind === "grommet" ? "Grommet" : "Obstacle",
      x: spot.x, y: spot.y, ...size,
    });
    setPalette(false);
  }

  const selected = items.find((i) => i.id === sel);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-h">Belly pan</h2>
        <div className="tools">
          <button className={"btn btn-sm" + (editing ? " btn-go" : "")}
            onClick={() => { setEditing(!editing); setSel(null); setPalette(false); }}>
            {editing ? "Done editing" : "Edit layout"}
          </button>
          {editing && (
            <button className="btn btn-sm" onClick={() => setPalette((p) => !p)}>
              Add…
            </button>
          )}
        </div>
      </div>

      {palette && (
        <div className="palette">
          <p className="palette-h">Components</p>
          <div className="palette-row">
            {PARTS.map((p) => (
              <button key={p.id} className="pbtn" onClick={() => add(p)}>{p.label}</button>
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
          <svg ref={svgRef} className={"pan" + (editing ? " pan-edit" : "")}
            viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}
            onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
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

            {!editing && routed.out.map(({ w, cells, offset }) => (
              <path key={w.id} d={toSvgPath(cells, CELL, offset)} fill="none"
                stroke={T[w.type]?.color || "#59636E"} strokeWidth="2.6"
                strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
            ))}

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

          {editing ? (
            <div className="panbar">
              <span className="panhint">
                {selected ? `${selected.label} selected — drag to move` : "Drag anything to move it"}
              </span>
              {selected && (
                <>
                  {selected.kind !== "grommet" && (
                    <span className="sizer">
                      <button className="btn btn-sm" onClick={() => resize(selected, -1, 0, onSave)}>–W</button>
                      <button className="btn btn-sm" onClick={() => resize(selected, 1, 0, onSave)}>+W</button>
                      <button className="btn btn-sm" onClick={() => resize(selected, 0, -1, onSave)}>–H</button>
                      <button className="btn btn-sm" onClick={() => resize(selected, 0, 1, onSave)}>+H</button>
                    </span>
                  )}
                  <button className="btn btn-sm btn-del"
                    onClick={() => { onDelete(selected.id); setSel(null); }}>
                    Remove
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="panbar">
              <span className="panhint">
                {routed.out.length} of {wires.length} wires routed
                {routed.skipped > 0 && ` — ${routed.skipped} end off the drivetrain`}
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

function resize(item, dw, dh, onSave) {
  const w = clamp(item.w + dw, 1, COLS - item.x);
  const h = clamp(item.h + dh, 1, ROWS - item.y);
  if (w !== item.w || h !== item.h) onSave({ ...item, w, h });
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

const ALIASES = {
  ROBORIO: "RIO", "ROBO RIO": "RIO", SYSTEMCORE: "SYSCR", "SYSTEM CORE": "SYSCR",
  BATTERY: "BATT", "MAIN BREAKER": "BRKR", BREAKER: "BRKR", "PNEUMATIC HUB": "PH",
  RADIO: "RDIO", "KRAKEN X60": "KRK60", "KRAKEN X44": "KRK44", KRAKEN: "KRK60",
};
function abbrevOf(raw) {
  const c = (raw || "").trim().toUpperCase().replace(/[^A-Z0-9 \-_/]/g, "");
  if (!c) return "";
  if (ALIASES[c]) return ALIASES[c];
  const w = c.split(/[\s\-_/]+/).filter(Boolean);
  if (w.length === 1) return w[0].slice(0, 6);
  const j = w.join("");
  return j.length <= 6 ? j : w.map((x) => (/^\d+$/.test(x) ? x : x[0])).join("").slice(0, 6);
}
