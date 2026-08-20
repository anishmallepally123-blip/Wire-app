import React, { useState, useRef, useMemo, useCallback } from "react";
import { COLS, ROWS, PAN_IN, buildGrid, routePorts, toSvgPath } from "./routing.js";
import { CPI, PARTS, PART_LIST, PORT_KIND, inToCell, partFor, rotatedSize, portsOfRotated } from "./parts.js";
import { abbrev } from "./naming.js";

const CELL = 7;                       /* screen px per grid cell */
export const CORNERS = ["FL", "FR", "BL", "BR"];

export default function LayoutTab({
  layout, wires, T, editing, setEditing, onCommit, sheetUrl, saving,
}) {
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [drag, setDrag] = useState(null);
  const [tip, setTip] = useState(null);
  const svgRef = useRef(null);

  const items = draft || layout || [];
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(layout || []);
  const comps = useMemo(() => items.filter((i) => i.kind === "component"), [items]);
  const grid = useMemo(() => buildGrid(items), [items]);

  const byName = useMemo(() => {
    const m = {};
    comps.forEach((c) => { m[c.compId || abbrev(c.label)] = c; });
    return m;
  }, [comps]);

  /* Route every wire terminal-to-terminal. A wire only draws when both ends
     resolve to a component AND a port on it — anything else is counted. */
  const routed = useMemo(() => {
    const out = [];
    let offPan = 0, noPort = 0;
    const pairSeen = {};
    wires.forEach((w) => {
      const a = byName[abbrev(w.fromDevice)];
      const b = byName[abbrev(w.toDevice)];
      if (!a || !b || a === b) { offPan++; return; }
      const pa = findPort(a, w.fromPort);
      const pb = findPort(b, w.toPort);
      /* A part with no port map (motors) routes edge-to-edge instead. */
      if ((portsOfRotated(a).length && !pa) || (portsOfRotated(b).length && !pb)) {
        noPort++; return;
      }
      const key = [a.id, b.id].sort().join("|");
      const n = pairSeen[key] || 0;
      pairSeen[key] = n + 1;
      const r = routePorts({ item: a, port: pa }, { item: b, port: pb }, grid);
      if (!r) { offPan++; return; }
      out.push({
        w, route: r,
        stage: w.stage === "schematic" ? "schematic" : "physical",
        offset: ((n % 3) - 1) * 1.6,
      });
    });

    const atCell = new Map();
    out.forEach((r) => {
      r.route.cells.forEach(([x, y]) => {
        const k = `${x},${y}`;
        if (!atCell.has(k)) atCell.set(k, []);
        if (!atCell.get(k).includes(r)) atCell.get(k).push(r);
      });
    });
    return { out, offPan, noPort, atCell };
  }, [wires, byName, grid]);

  const hoverAt = useCallback((cx, cy) => {
    const found = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        (routed.atCell.get(`${cx + dx},${cy + dy}`) || []).forEach((r) => {
          if (!found.includes(r)) found.push(r);
        });
      }
    }
    return found;
  }, [routed]);

  /* ------------------------------ editing ------------------------------ */
  function startEdit() {
    setDraft((layout || []).map((i) => ({ ...i })));
    setEditing(true);
    setSel(null);
    setTip(null);
  }
  function finishEdit() {
    if (draft && dirty) onCommit(draft);
    setDraft(null); setEditing(false); setSel(null);
  }
  function cancelEdit() { setDraft(null); setEditing(false); setSel(null); }

  const put = (item) => setDraft((d) => {
    const base = d || [];
    return base.some((i) => i.id === item.id)
      ? base.map((i) => (i.id === item.id ? item : i))
      : [...base, item];
  });
  const drop = (id) => setDraft((d) => (d || []).filter((i) => i.id !== id));

  const cellFromEvent = useCallback((e) => {
    const r = svgRef.current.getBoundingClientRect();
    const scale = (COLS * CELL) / r.width;
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
    if (!editing && !drag) { hover(e); return; }
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
  function hover(e) {
    const c = cellFromEvent(e);
    const hits = hoverAt(c.x, c.y);
    if (!hits.length) { if (tip) setTip(null); return; }
    setTip({
      x: c.x, y: c.y,
      flipX: c.x > COLS * 0.55,
      flipY: c.y > ROWS * 0.6,
      wires: hits.map((r) => ({
        name: r.w.name, stage: r.stage,
        color: T[r.w.type]?.color || "#59636E",
      })),
    });
  }

  const shown = (it) => (drag && drag.id === it.id ? drag.item : it);

  function addPart(part) {
    const w = inToCell(part.w), h = inToCell(part.h);
    const spot = freeSpot(items, w, h);
    const label = uniqueLabel(items, part.label);
    put({
      id: `c${Date.now()}${Math.floor(Math.random() * 1000)}`,
      kind: "component", partId: part.id, compId: abbrev(label), label,
      x: spot.x, y: spot.y, w, h, rot: 0,
    });
  }

  /* Rotating swaps the footprint and carries the ports round with it. */
  function rotate(item) {
    const part = partFor(item);
    if (!part) return;
    const rot = (((item.rot || 0) + 90) % 360);
    const { w, h } = rotatedSize(part, rot);
    put({
      ...item, rot,
      w: inToCell(w), h: inToCell(h),
      x: clamp(item.x, 0, COLS - inToCell(w)),
      y: clamp(item.y, 0, ROWS - inToCell(h)),
    });
  }

  function addCorner(corner) {
    const part = PARTS.KRK60;
    const w = inToCell(part.w), h = inToCell(part.h);
    let pool = items;
    [`${corner} Drive`, `${corner} Azimuth`].forEach((label) => {
      const spot = freeSpot(pool, w, h);
      const it = {
        id: `c${Date.now()}${Math.floor(Math.random() * 10000)}`,
        kind: "component", partId: part.id, compId: abbrev(label), label,
        x: spot.x, y: spot.y, w, h, rot: 0,
      };
      pool = [...pool, it];
      put(it);
    });
  }
  function addBlock(kind) {
    const size = kind === "grommet"
      ? { w: inToCell(0.75), h: inToCell(0.75) }
      : { w: inToCell(0.5), h: inToCell(6) };
    const spot = freeSpot(items, size.w, size.h);
    put({
      id: `${kind[0]}${Date.now()}${Math.floor(Math.random() * 1000)}`,
      kind, partId: "", compId: "",
      label: kind === "grommet" ? "Grommet" : "Obstacle",
      x: spot.x, y: spot.y, ...size,
    });
  }
  const rename = (item, label) => put({ ...item, label, compId: abbrev(label) });

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
            {PART_LIST.map((p) => (
              <button key={p.id} className="pbtn" onClick={() => addPart(p)}>
                {p.label}<em>{p.w}″×{p.h}″</em>
              </button>
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
          Nothing placed yet. Hit <strong>Edit layout</strong> and drop in the PDH,
          battery, and anything else that lives on the drivetrain.
        </p>
      ) : (
        <>
          <div className="pan-wrap">
            <svg ref={svgRef} className={"pan" + (editing ? " pan-edit" : "")}
              viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}
              onPointerMove={move} onPointerUp={up}
              onPointerLeave={() => { up(); setTip(null); }}>
              <defs>
                <pattern id="inch" width={CPI * CELL} height={CPI * CELL} patternUnits="userSpaceOnUse">
                  <path d={`M ${CPI * CELL} 0 L 0 0 0 ${CPI * CELL}`}
                    fill="none" stroke="#D3D8DE" strokeWidth="0.6" />
                </pattern>
              </defs>
              <rect width={COLS * CELL} height={ROWS * CELL} fill="url(#inch)" />
              <rect x="2" y="2" width={COLS * CELL - 4} height={ROWS * CELL - 4}
                fill="none" stroke="#59636E" strokeWidth="2" rx="4" />

              {items.filter((i) => i.kind === "obstacle").map((i) => {
                const it = shown(i);
                return (
                  <rect key={i.id} x={it.x * CELL} y={it.y * CELL}
                    width={it.w * CELL} height={it.h * CELL}
                    fill="#59636E" opacity={sel === i.id ? 0.45 : 0.2}
                    style={{ cursor: editing ? "move" : "default" }}
                    onPointerDown={(e) => down(e, it)} />
                );
              })}

              {!editing && routed.out.map(({ w, route, stage, offset }) => {
                const lit = tip && tip.wires.some((t) => t.name === w.name);
                return (
                  <path key={w.id} d={toSvgPath(route, CELL, offset)} fill="none"
                    stroke={T[w.type]?.color || "#59636E"}
                    strokeWidth={lit ? 3.4 : 2}
                    strokeDasharray={stage === "schematic" ? "5 4" : undefined}
                    strokeLinecap="round" strokeLinejoin="round"
                    opacity={tip ? (lit ? 1 : 0.22) : 0.88} />
                );
              })}

              {items.filter((i) => i.kind === "grommet").map((i) => {
                const it = shown(i);
                return (
                  <circle key={i.id} cx={(it.x + it.w / 2) * CELL} cy={(it.y + it.h / 2) * CELL}
                    r={(it.w * CELL) / 2} fill="#fff"
                    stroke={sel === i.id ? "#161B22" : "#59636E"}
                    strokeWidth={sel === i.id ? 2.5 : 1.4}
                    style={{ cursor: editing ? "move" : "default" }}
                    onPointerDown={(e) => down(e, it)} />
                );
              })}

              {comps.map((i) => (
                <Footprint key={i.id} item={shown(i)} selected={sel === i.id}
                  editing={editing} onDown={down} />
              ))}
            </svg>

            {tip && (
              <div className="tip" style={{
                left: `${((tip.x + (tip.flipX ? -1 : 3)) / COLS) * 100}%`,
                top: `${((tip.y + (tip.flipY ? -1 : 3)) / ROWS) * 100}%`,
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
                  ? (selected.kind === "component" ? "Rename or drag" : "Drag to move")
                  : dirty ? "Unsaved changes — hit Done to save" : "Drag anything to move it"}
              </span>
              {selected && selected.kind === "component" && (
                <button className="btn btn-sm" onClick={() => rotate(selected)}
                  title="Rotate 90°">Rotate</button>
              )}
              {selected && selected.kind === "component" && (
                <input className="renamer" value={selected.label} aria-label="Component name"
                  placeholder="Name this component"
                  onChange={(e) => rename(selected, e.target.value)} />
              )}
              {selected && selected.kind === "obstacle" && (
                <span className="sizer">
                  <button className="btn btn-sm" onClick={() => resize(selected, -CPI, 0, put)}>–W</button>
                  <button className="btn btn-sm" onClick={() => resize(selected, CPI, 0, put)}>+W</button>
                  <button className="btn btn-sm" onClick={() => resize(selected, 0, -CPI, put)}>–H</button>
                  <button className="btn btn-sm" onClick={() => resize(selected, 0, CPI, put)}>+H</button>
                </span>
              )}
            </div>
          ) : (
            <div className="panbar">
              <span className="panhint">
                {routed.out.length} of {wires.length} routed
                {routed.noPort > 0 && ` — ${routed.noPort} missing a port`}
                {routed.offPan > 0 && ` — ${routed.offPan} off the pan`}
              </span>
              <span className="key">
                <span className="key-i">
                  <svg width="24" height="4"><line x1="1" y1="2" x2="23" y2="2"
                    stroke="#59636E" strokeWidth="2.4" strokeLinecap="round" /></svg>on robot
                </span>
                <span className="key-i">
                  <svg width="24" height="4"><line x1="1" y1="2" x2="23" y2="2"
                    stroke="#59636E" strokeWidth="2.4" strokeDasharray="5 4" strokeLinecap="round" /></svg>planned
                </span>
              </span>
            </div>
          )}

          <p className="disclaimer">
            Planning view, drawn to scale at {PAN_IN.w}″ × {PAN_IN.h}″. Routes are the
            shortest legal path on this model, not a record of how the wire actually
            runs — don't trace from it in the pit.
          </p>
        </>
      )}

      {!sheetUrl && items.length > 0 && (
        <p className="notice">Not connected to a sheet, so this layout stays on this device.</p>
      )}
    </section>
  );
}

/* ------------------------- footprint drawing ------------------------- */

function Footprint({ item, selected, editing, onDown }) {
  const part = partFor(item);
  const x = item.x * CELL, y = item.y * CELL;
  const w = item.w * CELL, h = item.h * CELL;
  const stroke = selected ? "#161B22" : "#59636E";
  const sw = selected ? 2.2 : 1.3;
  const shape = part?.shape || "board";

  return (
    <g style={{ cursor: editing ? "move" : "default" }} onPointerDown={(e) => onDown(e, item)}>
      {shape === "motor" ? (
        <>
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2 - 1}
            fill="#F4F6F8" stroke={stroke} strokeWidth={sw} />
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 5}
            fill="none" stroke="#A5ADB6" strokeWidth="1" />
        </>
      ) : shape === "battery" ? (
        <>
          <rect x={x} y={y} width={w} height={h} rx="2"
            fill="#F4F6F8" stroke={stroke} strokeWidth={sw} />
          <rect x={x + 3} y={y + 3} width={w - 6} height={h * 0.22} rx="1"
            fill="#DDE2E8" stroke="none" />
        </>
      ) : shape === "breaker" ? (
        <>
          <rect x={x} y={y} width={w} height={h} rx="3"
            fill="#F4F6F8" stroke={stroke} strokeWidth={sw} />
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) * 0.22}
            fill="#C2352B" opacity="0.8" />
        </>
      ) : shape === "pdh" ? (
        <>
          <rect x={x} y={y} width={w} height={h} rx="2"
            fill="#F4F6F8" stroke={stroke} strokeWidth={sw} />
          {/* WAGO blocks drawn from the rotated port positions, so they stay
              on the terminal edges however the board is turned */}
          {portsOfRotated(item).filter((p) => /^\d+$/.test(p.id) && +p.id < 20).map((p) => {
            const px = (item.x + p.x * CPI) * CELL, py = (item.y + p.y * CPI) * CELL;
            const vert = p.edge === "left" || p.edge === "right";
            const a = 0.3 * CPI * CELL, b = 0.34 * CPI * CELL;
            return (
              <rect key={p.id}
                x={px - (vert ? b : a) / 2} y={py - (vert ? a : b) / 2}
                width={vert ? b : a} height={vert ? a : b} rx="1"
                fill="#D9C27A" stroke="#A5ADB6" strokeWidth="0.4" />
            );
          })}
          <rect x={x + w * 0.32} y={y + h * 0.4} width={w * 0.36} height={h * 0.2}
            rx="1" fill="#1B1B1B" />
          <text x={x + w * 0.5} y={y + h * 0.545} textAnchor="middle"
            fontSize={Math.min(8, Math.min(w, h) * 0.16)} fill="#7CE07C"
            fontFamily="'IBM Plex Mono', monospace">12.4V</text>
        </>
      ) : (
        <rect x={x} y={y} width={w} height={h} rx="2"
          fill="#F4F6F8" stroke={stroke} strokeWidth={sw} />
      )}

      {/* ports */}
      {portsOfRotated(item).map((p) => {
        const px = (item.x + p.x * CPI) * CELL;
        const py = (item.y + p.y * CPI) * CELL;
        /* Nudge the number outward from whichever edge the port is on, so it
           sits off the board rather than on top of the terminal. */
        const off = 7;
        const nx = px + (p.edge === "left" ? -off : p.edge === "right" ? off : 0);
        const ny = py + (p.edge === "top" ? -off : p.edge === "bottom" ? off : 0)
                      + (p.edge === "left" || p.edge === "right" ? 2.4 : 0);
        return (
          <g key={p.id}>
            <circle cx={px} cy={py} r="2.1" fill="#fff"
              stroke={PORT_KIND[p.kind] || "#59636E"} strokeWidth="1.3" />
            {p.num != null && (
              <text x={nx} y={ny} textAnchor="middle" fontSize="6.5"
                fontFamily="'IBM Plex Mono', monospace" fill="#59636E">{p.num}</text>
            )}
          </g>
        );
      })}

      <text x={x + w / 2} y={y + h + 9} textAnchor="middle"
        fontSize="9" fontFamily="'IBM Plex Mono', monospace" fill="#161B22">
        {item.label}
      </text>
    </g>
  );
}

/* ------------------------------ helpers ------------------------------ */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* "4", "04", "Ch 4" and "PWM0" all have to find their terminal. */
export function findPort(item, raw) {
  /* Must use the ROTATED ports — the unrotated set sends wires to where the
     terminal would be if the board had never been turned. */
  const ports = portsOfRotated(item);
  if (!ports.length) return null;
  const want = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9+-]/g, "");
  if (!want) return ports[0] || null;           /* unspecified: use the first */
  const num = /^\d+$/.test(want) ? String(parseInt(want, 10)) : null;
  return (
    ports.find((p) => p.id.toUpperCase() === want) ||
    (num && ports.find((p) => p.id === num)) ||
    (num && ports.find((p) => p.num === num)) ||
    ports.find((p) => p.id.toUpperCase().replace(/[^A-Z0-9+-]/g, "") === want) ||
    null
  );
}

function resize(item, dw, dh, put) {
  const w = clamp(item.w + dw, CPI / 2, COLS - item.x);
  const h = clamp(item.h + dh, CPI / 2, ROWS - item.y);
  if (w !== item.w || h !== item.h) put({ ...item, w, h });
}

function uniqueLabel(items, base) {
  const taken = new Set(items.filter((i) => i.label).map((i) => i.label.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

function freeSpot(items, w, h) {
  const hit = (x, y) =>
    items.some((i) => x < i.x + i.w && x + w > i.x && y < i.y + i.h && y + h > i.y);
  const step = Math.max(1, Math.round(CPI / 2));
  for (let y = CPI; y < ROWS - h; y += step) {
    for (let x = CPI; x < COLS - w; x += step) if (!hit(x, y)) return { x, y };
  }
  return { x: CPI, y: CPI };
}
