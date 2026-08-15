import { store } from "./store.js";
import { callSheetRaw } from "./sheet.js";
import LayoutTab from "./LayoutTab.jsx";
import { findConflicts } from "./conflicts.js";
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  The five wires this team runs. Color carries the type.             */
/* ------------------------------------------------------------------ */
const TYPES = [
  { id: "PWR12", label: "12 AWG Power", short: "Power",    gauge: "12", color: "#C2352B", plain: "12 AWG power" },
  { id: "PWR22", label: "22 AWG Power", short: "Power",    gauge: "22", color: "#E2711D", plain: "22 AWG power" },
  { id: "CAN",   label: "CAN",          short: "CAN",      gauge: "22", color: "#2E9E6B", plain: "CAN bus" },
  { id: "ETH",   label: "Ethernet",     short: "Ethernet", gauge: "24", color: "#5B4B8A", plain: "Ethernet" },
  { id: "PWM",   label: "PWM",          short: "PWM",      gauge: "26", color: "#2E6FC4", plain: "PWM signal" },
];
const T = Object.fromEntries(TYPES.map((t) => [t.id, t]));

const DEVICES = [
  "Battery", "Main Breaker", "PDH", "PDP", "roboRIO", "VRM", "RSL", "Radio",
  "Pneumatic Hub", "Compressor", "Talon FX", "SPARK MAX", "Kraken X60", "NEO",
  "Limelight", "Front Left Drive", "Front Right Drive", "Back Left Drive",
  "Back Right Drive", "Intake", "Shooter", "Elevator", "Arm", "Wrist", "Climber",
];

const ALIASES = {
  ROBORIO: "RIO", BATTERY: "BATT", "MAIN BREAKER": "BRKR", "PNEUMATIC HUB": "PH",
  COMPRESSOR: "COMP", "SPARK MAX": "SPRK", LIMELIGHT: "LL", "TALON FX": "TLN",
  "KRAKEN X60": "KRKN", RADIO: "RDIO",
};

/* ---------------- naming: endpoints only, no type prefix ---------------- */
function abbrev(raw) {
  const c = (raw || "").trim().toUpperCase().replace(/[^A-Z0-9 \-_/]/g, "");
  if (!c) return "";
  if (ALIASES[c]) return ALIASES[c];
  const w = c.split(/[\s\-_/]+/).filter(Boolean);
  if (w.length === 1) return w[0].slice(0, 6);
  const j = w.join("");
  return j.length <= 6 ? j : w.map((x) => (/^\d+$/.test(x) ? x : x[0])).join("").slice(0, 6);
}
function port(raw) {
  const c = (raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return !c ? "" : /^\d+$/.test(c) ? c.padStart(2, "0") : c;
}
const endpoint = (d, p) => {
  const a = abbrev(d), b = port(p);
  return a && b ? a + b : a || b;
};
function buildName(f, wires, selfId) {
  const a = endpoint(f.fromDevice, f.fromPort);
  const b = endpoint(f.toDevice, f.toPort);
  if (!a || !b) return "";
  const base = `${a}-${b}`;
  const taken = new Set(wires.filter((w) => w.id !== selfId).map((w) => w.name.toUpperCase()));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
function plainName(w) {
  const a = [w.fromDevice, w.fromPort && `port ${w.fromPort}`].filter(Boolean).join(" ");
  const b = [w.toDevice, w.toPort && `port ${w.toPort}`].filter(Boolean).join(" ");
  return a && b ? `${T[w.type].plain}, ${a} to ${b}` : "";
}

/* ------------------------------------------------------------------ */
const KEY = "frc-wires:v3";
const URL_KEY = "frc-sheet-url:v1";
const LAYOUT_KEY = "frc-layout:v1";
const POLL_MS = 20000;
const blank = () => ({
  type: "PWR12", stage: "schematic", fromDevice: "", fromPort: "", toDevice: "",
  toPort: "", notes: "", nameOverride: "",
});

/* Wires saved before staging existed are already on the robot. */
const stageOf = (w) => (w.stage === "schematic" ? "schematic" : "physical");

export default function WireManifest() {
  const [wires, setWires] = useState([]);
  const [form, setForm] = useState(blank());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("add");
  const [layout, setLayout] = useState([]);
  const [editLayout, setEditLayout] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [notice, setNotice] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [sync, setSync] = useState({ state: "loading", msg: "Loading…" });
  const fileRef = useRef(null);
  const busy = useRef(false);

  const cache = useCallback(async (list) => {
    try { await store.set(KEY, JSON.stringify(list)); } catch (e) {}
  }, []);

  const cacheLayout = useCallback(async (items) => {
    try { await store.set(LAYOUT_KEY, JSON.stringify(items)); } catch (e) {}
  }, []);

  /* read the sheet — skipped while one of our own writes is in flight */
  const pull = useCallback(async (url) => {
    if (!url || busy.current) return;
    try {
      const res = await callSheetRaw(url, { action: "list" });
      const list = Array.isArray(res) ? res : res.wires || [];
      setWires(list);
      cache(list);
      /* An empty layout coming back while we hold items locally means the
         write didn't land — keep ours rather than blanking the pan. */
      if (Array.isArray(res.layout) && (res.layout.length || !layout.length)) {
        setLayout(res.layout);
        cacheLayout(res.layout);
      } else if (Array.isArray(res.layout) && !res.layout.length && layout.length) {
        setSync({ state: "off", msg: "Layout didn't save — is the script redeployed?" });
        return;
      }
      setSync({ state: "ok", msg: "Synced to the sheet" });
    } catch (e) {
      setSync({ state: "off", msg: "Can't reach the sheet — saving on this device" });
    }
  }, [cache]);

  /* boot: local cache first so the pit laptop is usable instantly, then the sheet */
  useEffect(() => {
    (async () => {
      try {
        const c = await store.get(KEY);
        if (c && c.value) setWires(JSON.parse(c.value));
      } catch (e) {}
      try {
        const l = await store.get(LAYOUT_KEY);
        if (l && l.value) setLayout(JSON.parse(l.value));
      } catch (e) {}
      let url = "";
      try {
        const u = await store.get(URL_KEY);
        if (u && u.value) { url = u.value; setSheetUrl(url); setUrlDraft(url); }
      } catch (e) {}
      if (url) pull(url);
      else setSync({ state: "none", msg: "Not connected to a sheet yet" });
    })();
  }, [pull]);

  /* other people's edits land here */
  useEffect(() => {
    if (!sheetUrl) return;
    const t = setInterval(() => pull(sheetUrl), POLL_MS);
    return () => clearInterval(t);
  }, [sheetUrl, pull]);

  /* optimistic local write, then the sheet */
  async function push(action, payload, optimistic) {
    setWires(optimistic);
    cache(optimistic);
    if (!sheetUrl) return;
    busy.current = true;
    setSync({ state: "busy", msg: "Saving to the sheet…" });
    try {
      const res = await callSheetRaw(sheetUrl, { action, ...payload });
      const list = Array.isArray(res) ? res : res.wires || [];
      setWires(list);
      cache(list);
      /* An empty layout coming back while we hold items locally means the
         write didn't land — keep ours rather than blanking the pan. */
      if (Array.isArray(res.layout) && (res.layout.length || !layout.length)) {
        setLayout(res.layout);
        cacheLayout(res.layout);
      } else if (Array.isArray(res.layout) && !res.layout.length && layout.length) {
        setSync({ state: "off", msg: "Layout didn't save — is the script redeployed?" });
        return;
      }
      setSync({ state: "ok", msg: "Synced to the sheet" });
    } catch (e) {
      setSync({ state: "off", msg: `Sheet error: ${e.message || e}` });
    } finally {
      busy.current = false;
    }
  }

  async function connect() {
    const url = urlDraft.trim();
    setSheetUrl(url);
    try { await store.set(URL_KEY, url); } catch (e) {}
    if (!url) { setSync({ state: "none", msg: "Not connected to a sheet yet" }); return; }
    setSync({ state: "busy", msg: "Connecting…" });
    await pull(url);
    setShowSetup(false);
  }

  const ty = T[form.type];
  const preview = useMemo(
    () => form.nameOverride.trim().toUpperCase() || buildName(form, wires, editingId),
    [form, wires, editingId]
  );
  const canSubmit = form.fromDevice.trim() && form.toDevice.trim() && preview;

  const counts = useMemo(() => {
    const m = {};
    wires.forEach((w) => (m[w.type] = (m[w.type] || 0) + 1));
    return m;
  }, [wires]);

  const schematic = useMemo(() => wires.filter((w) => stageOf(w) === "schematic"), [wires]);
  const physical = useMemo(() => wires.filter((w) => stageOf(w) === "physical"), [wires]);

  const conflicts = useMemo(() => findConflicts(wires), [wires]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return wires;
    return wires.filter((w) =>
      [w.name, w.fromDevice, w.fromPort, w.toDevice, w.toPort, w.notes,
       T[w.type].label, `${T[w.type].gauge} awg`, plainName(w)]
        .join(" ").toLowerCase().includes(q));
  }, [wires, query]);

  function submit() {
    if (!canSubmit) return;
    const entry = {
      ...form, name: preview, gauge: ty.gauge, stage: form.stage || "schematic",
      id: editingId || `w${Date.now()}${Math.floor(Math.random() * 100)}`,
    };
    const next = editingId
      ? wires.map((w) => (w.id === editingId ? entry : w))
      : [entry, ...wires];
    push("upsert", { wire: entry }, next);
    setForm(blank());
    setEditingId(null);
    setNotice("");
  }
  function edit(w) {
    setForm({ ...blank(), ...w, nameOverride: w.nameOverride || "" });
    setEditingId(w.id);
    setOpenId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const [savingLayout, setSavingLayout] = useState(false);

  /* One write for the whole editing session. The sheet's Layout tab is
     replaced wholesale, which is safe because editing is an explicit mode. */
  async function commitLayout(items) {
    setLayout(items);
    cacheLayout(items);
    if (!sheetUrl) return;
    setSavingLayout(true);
    busy.current = true;
    setSync({ state: "busy", msg: "Saving the layout…" });
    try {
      const res = await callSheetRaw(sheetUrl, { action: "layoutSave", layout: items });
      if (Array.isArray(res.layout)) {
        setLayout(res.layout);
        cacheLayout(res.layout);
      }
      if (Array.isArray(res.wires)) {
        setWires(res.wires);
        cache(res.wires);
      }
      setSync({ state: "ok", msg: "Synced to the sheet" });
    } catch (e) {
      setSync({ state: "off", msg: `Layout not saved: ${e.message || e}` });
    } finally {
      setSavingLayout(false);
      busy.current = false;
    }
  }

  function setStage(w, stage) {
    const entry = { ...w, stage };
    push("upsert", { wire: entry }, wires.map((x) => (x.id === w.id ? entry : x)));
  }

  function remove(id) {
    push("delete", { id }, wires.filter((w) => w.id !== id));
    if (editingId === id) { setForm(blank()); setEditingId(null); }
  }

  function download(text, mime, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
  function exportCsv() {
    const rows = [["Name", "Type", "Gauge", "From", "From port", "To", "To port", "Notes"],
      ...wires.map((w) => [w.name, T[w.type].label, `${T[w.type].gauge} AWG`,
        w.fromDevice, w.fromPort, w.toDevice, w.toPort, w.notes])];
    download(rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"),
      "text/csv", "wire-manifest.csv");
  }
  function importJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        if (!Array.isArray(data)) throw new Error();
        const seen = new Set(wires.map((w) => w.name));
        const add = data.filter((d) => d?.name && !seen.has(d.name));
        push("bulk", { wires: add }, [...wires, ...add]);
        setNotice(`Merged ${add.length} wires from that file.`);
      } catch {
        setNotice("That file isn't a manifest export. Pick a .json saved from this app.");
      }
    };
    rd.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="wm">
      <style>{CSS}</style>

      <header className="masthead">
        <div>
          <div className="eyebrow">FRC electrical subteam</div>
          <h1>Wire Manifest</h1>
        </div>
        <div className="tally">
          <span className="tally-num">{wires.length}</span>
          <span className="tally-lbl">wires<br />logged</span>
        </div>
      </header>

      <div className="syncbar">
        <span className={"pip pip-" + sync.state} />
        <span className="sync-msg">{sync.msg}</span>
        <button className="linkbtn" onClick={() => setShowSetup((s) => !s)}>
          {sheetUrl ? "Change sheet" : "Connect a sheet"}
        </button>
      </div>

      {showSetup && (
        <div className="setup">
          <label className="field">
            <span>Apps Script web app URL</span>
            <input value={urlDraft} placeholder="https://script.google.com/macros/s/…/exec"
              onChange={(e) => setUrlDraft(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn go" onClick={connect}>Connect</button>
            <button className="btn" onClick={() => setShowSetup(false)}>Close</button>
          </div>
          <p className="hint">
            Deploy the Apps Script attached to your team's sheet as a web app, then paste
            its /exec URL here. Every device using this URL reads and writes the same manifest.
          </p>
        </div>
      )}

      <nav className="tabs" role="tablist">
        {[
          ["add", "Add wire", null],
          ["schematic", "Schematic", schematic.length],
          ["manifest", "On the robot", physical.length],
          ["layout", "Belly pan", null],
        ].map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={page === id}
            className={"tab" + (page === id ? " tab-on" : "")}
            onClick={() => { setPage(id); setOpenId(null); }}>
            {label}{n != null && <span className="tab-n">{n}</span>}
          </button>
        ))}
      </nav>

      {page === "add" && (
      <section className="panel">
        <h2 className="panel-h">{editingId ? "Edit wire" : "Log a wire"}</h2>

        <div className="stage-pick" role="group" aria-label="Where this wire lives">
          {[["schematic", "On the schematic"], ["physical", "On the robot"]].map(([v, l]) => (
            <button key={v}
              className={"stage-btn" + (form.stage === v ? " stage-on" : "")}
              onClick={() => setForm((f) => ({ ...f, stage: v }))}>
              {l}
            </button>
          ))}
        </div>

        <div className="chips" role="group" aria-label="Wire type">
          {TYPES.map((t) => (
            <button key={t.id}
              className={"chip" + (form.type === t.id ? " chip-on" : "")}
              style={{ "--c": t.color }}
              onClick={() => setForm((f) => ({ ...f, type: t.id }))}>
              <span className="chip-dot" />
              {t.label}
              {counts[t.id] ? <span className="chip-n">{counts[t.id]}</span> : null}
            </button>
          ))}
        </div>

        <div className="grid">
          <Field label="Starts at" hint="device">
            <input list="devices" value={form.fromDevice} placeholder="PDH"
              onChange={(e) => setForm({ ...form, fromDevice: e.target.value })} />
          </Field>
          <Field label="Port">
            <input value={form.fromPort} placeholder="4"
              onChange={(e) => setForm({ ...form, fromPort: e.target.value })} />
          </Field>
          <Field label="Ends at" hint="device">
            <input list="devices" value={form.toDevice} placeholder="Front Left Drive"
              onChange={(e) => setForm({ ...form, toDevice: e.target.value })} />
          </Field>
          <Field label="Port">
            <input value={form.toPort} placeholder="—"
              onChange={(e) => setForm({ ...form, toPort: e.target.value })} />
          </Field>
          <Field label="Notes" hint="optional" wide>
            <input value={form.notes} placeholder="Runs under the belly pan"
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>

        <datalist id="devices">
          {DEVICES.map((d) => <option key={d} value={d} />)}
        </datalist>

        <div className="label-stage">
          <div className="wire-run" style={{ "--c": ty.color }} />
          <div className="tag" style={{ "--c": ty.color }}>
            <div className="tag-band" />
            <div className="tag-body">
              <div className="tag-name">{preview || "—"}</div>
              <div className="tag-sub">{plainName(form) || "Fill in both ends to name this wire"}</div>
            </div>
            <div className="tag-gauge">{ty.gauge}<small>AWG</small></div>
          </div>
        </div>

        <div className="row">
          <input className="override" value={form.nameOverride}
            placeholder="Override the name (optional)"
            onChange={(e) => setForm({ ...form, nameOverride: e.target.value })} />
          <button className="btn btn-go" disabled={!canSubmit} onClick={submit}>
            {editingId ? "Save changes" : "Add wire"}
          </button>
          {editingId && (
            <button className="btn" onClick={() => { setForm(blank()); setEditingId(null); }}>Cancel</button>
          )}
        </div>
        {notice && <p className="notice">{notice}</p>}
      </section>
      )}

      {page === "layout" && (
        <LayoutTab
          layout={layout}
          wires={physical.length ? physical : wires}
          T={T}
          editing={editLayout}
          setEditing={setEditLayout}
          onCommit={commitLayout}
          sheetUrl={sheetUrl}
          saving={savingLayout}
        />
      )}

      {(page === "schematic" || page === "manifest") && (
      <section className="panel">
        <h2 className="panel-h">
          {page === "schematic" ? "Schematic manifest" : "On the robot"}
        </h2>

        {page === "schematic" && wires.length > 0 && (
          <div className="progress">
            <div className="progress-bar">
              <span style={{ width: `${Math.round((physical.length / wires.length) * 100)}%` }} />
            </div>
            <p className="progress-txt">
              {physical.length} of {wires.length} built
              {schematic.length > 0 && ` — ${schematic.length} left to run`}
            </p>
          </div>
        )}
        <div className="tools">
          <button className="btn btn-sm" onClick={exportCsv} disabled={!wires.length}>Export CSV</button>
          <button className="btn btn-sm" disabled={!wires.length}
            onClick={() => download(JSON.stringify(wires, null, 2), "application/json", "wire-manifest.json")}>
            Back up
          </button>
          <button className="btn btn-sm" onClick={() => fileRef.current.click()}>Import</button>
          <input type="file" accept=".json" ref={fileRef} onChange={importJson} hidden />
        </div>

        <div className="search">
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a name, start point, end point, or note" />
          {query && <button className="clear" onClick={() => setQuery("")}>Clear</button>}
        </div>

        <div className="legend">
          {TYPES.map((t) => (
            <span key={t.id} className="leg"><i style={{ background: t.color }} />{t.label}</span>
          ))}
        </div>

        {conflicts.count > 0 && (
          <details className="warn">
            <summary>
              {conflicts.count} {conflicts.count === 1 ? "conflict" : "conflicts"} to check
            </summary>
            <ul className="warn-list">
              {conflicts.ports.map((c) => (
                <li key={`${c.device}-${c.port}`}>
                  <strong>{c.device} port {c.port}</strong> is claimed by{" "}
                  {c.wires.map((w) => w.name).join(", ")}
                </li>
              ))}
              {conflicts.dupes.map((g) => (
                <li key={g.map((w) => w.id).join("-")}>
                  <strong>Same run logged twice:</strong> {g.map((w) => w.name).join(", ")}
                </li>
              ))}
            </ul>
          </details>
        )}

        {(() => {
          const onPage = filtered.filter((w) => stageOf(w) === (page === "schematic" ? "schematic" : "physical"));
          const pool = page === "schematic" ? schematic : physical;
          if (sync.state === "loading") return <p className="empty">Loading the manifest…</p>;
          if (!pool.length) return (
            <p className="empty">
              {page === "schematic"
                ? "No wires waiting. Anything you add as a schematic wire shows up here."
                : "Nothing on the robot yet. Check wires off the schematic list as you run them."}
            </p>
          );
          if (!onPage.length) return (
            <p className="empty">No wire matches “{query}”. Try a device name or a port number.</p>
          );
          return (
          <>
            <p className="count">{onPage.length} of {pool.length} {pool.length === 1 ? "wire" : "wires"}</p>
            <ul className="list">
              {onPage.map((w) => {
                const t = T[w.type];
                const open = openId === w.id;
                return (
                  <li key={w.id} className={"item" + (open ? " item-open" : "")} style={{ "--c": t.color }}>
                    {page === "schematic" && (
                      <label className="check" title="Mark this wire as run on the robot">
                        <input type="checkbox" checked={false}
                          onChange={() => setStage(w, "physical")} />
                        <span className="sr">Mark {w.name} as run</span>
                      </label>
                    )}
                    <button className="item-top" aria-expanded={open}
                      onClick={() => setOpenId(open ? null : w.id)}>
                      <span className="item-name">
                        {mark(w.name, query)}
                        {conflicts.flagged.has(w.id) && (
                          <span className="flag" title={conflicts.flagged.get(w.id).join("; ")}>!</span>
                        )}
                      </span>
                      <span className="item-path">
                        {mark(w.fromPort ? `${w.fromDevice} ${w.fromPort}` : w.fromDevice, query)}
                        <span className="arrow">→</span>
                        {mark(w.toPort ? `${w.toDevice} ${w.toPort}` : w.toDevice, query)}
                      </span>
                      <span className="item-gauge">{t.gauge}<small>AWG</small></span>
                    </button>
                    {open && (
                      <div className="detail">
                        <dl>
                          <div><dt>Reads as</dt><dd>{plainName(w)}</dd></div>
                          {conflicts.flagged.has(w.id) && (
                            <div>
                              <dt>Check</dt>
                              <dd className="dd-warn">{conflicts.flagged.get(w.id).join("; ")}</dd>
                            </div>
                          )}
                          <div><dt>Starts</dt><dd>{w.fromDevice}{w.fromPort && `, port ${w.fromPort}`}</dd></div>
                          <div><dt>Ends</dt><dd>{w.toDevice}{w.toPort && `, port ${w.toPort}`}</dd></div>
                          <div><dt>Type</dt><dd><i className="swatch" style={{ background: t.color }} />{t.label}</dd></div>
                          {w.notes && <div><dt>Notes</dt><dd>{w.notes}</dd></div>}
                        </dl>
                        <div className="detail-btns">
                          <button className="btn btn-sm" onClick={() => edit(w)}>Edit</button>
                          {page === "manifest" && (
                            <button className="btn btn-sm" onClick={() => setStage(w, "schematic")}>
                              Back to schematic
                            </button>
                          )}
                          <button className="btn btn-sm btn-del" onClick={() => remove(w.id)}>Delete</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
          );
        })()}
      </section>
      )}

      <footer className="foot">
        Saved on this device. Back up and share the file so the whole subteam works off one manifest.
      </footer>
    </div>
  );
}

function Field({ label, hint, wide, children }) {
  return (
    <label className={"field" + (wide ? " field-wide" : "")}>
      <span className="field-l">{label}{hint && <em>{hint}</em>}</span>
      {children}
    </label>
  );
}
function mark(text, q) {
  const s = String(text ?? "");
  const needle = q.trim();
  if (!needle) return s;
  const i = s.toLowerCase().indexOf(needle.toLowerCase());
  if (i === -1) return s;
  return (<>{s.slice(0, i)}<mark>{s.slice(i, i + needle.length)}</mark>{s.slice(i + needle.length)}</>);
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.wm{--ink:#161B22;--ink-2:#59636E;--line:#D3D8DE;--paper:#EDEFF2;--red:#C2352B;
  font-family:'Archivo',system-ui,sans-serif;color:var(--ink);background:var(--paper);
  background-image:linear-gradient(#DDE2E8 1px,transparent 1px),linear-gradient(90deg,#DDE2E8 1px,transparent 1px);
  background-size:24px 24px;min-height:100%;padding:20px 16px 48px}
.wm *{box-sizing:border-box}
.wm button:focus-visible,.wm input:focus-visible{outline:2px solid var(--ink);outline-offset:2px}

.masthead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;max-width:820px;
  margin:0 auto 18px;padding-bottom:14px;border-bottom:2px solid var(--ink)}
.eyebrow{font:600 11px/1 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;
  color:var(--ink-2);margin-bottom:6px}
.masthead h1{font-weight:800;font-size:clamp(28px,7vw,40px);letter-spacing:-.02em;margin:0;line-height:.95}
.pan{width:100%;height:auto;display:block;background:#fff;border:1px solid var(--line);
  border-radius:3px;touch-action:none;user-select:none}
.pan-edit{border-color:var(--ink);border-style:dashed}
.panbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.panhint{flex:1;min-width:140px;font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.06em;
  text-transform:uppercase;color:var(--ink-2)}
.sizer{display:flex;gap:4px}
.sizer .btn{padding:6px 9px;font-family:'IBM Plex Mono',monospace;font-size:11px}
.disclaimer{font:400 12px/1.5 'Archivo',sans-serif;color:var(--ink-2);margin:12px 0 0;
  padding-top:10px;border-top:1px dashed var(--line)}
.palette{background:var(--paper);border:1px solid var(--line);border-radius:3px;
  padding:12px 14px;margin-bottom:14px}
.palette-h{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-2);margin:0 0 7px}
.palette-h + .palette-row{margin-bottom:12px}
.palette-row{display:flex;flex-wrap:wrap;gap:6px}
.palette-row:last-child{margin-bottom:0}
.pbtn{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;
  font:500 13px 'Archivo',sans-serif;color:var(--ink);cursor:pointer}
.pbtn:hover{border-color:var(--ink)}

.warn{background:#FDF3E7;border:1px solid #E8B473;border-left:4px solid #C2352B;
  border-radius:3px;padding:10px 12px;margin-bottom:12px}
.warn summary{font:600 13px 'Archivo',sans-serif;color:#8A2B23;cursor:pointer;list-style:none}
.warn summary::-webkit-details-marker{display:none}
.warn summary::before{content:"▸ ";font-size:11px}
.warn[open] summary::before{content:"▾ "}
.warn-list{margin:9px 0 0;padding:0 0 0 18px;font:400 13px/1.6 'Archivo',sans-serif;color:var(--ink)}
.warn-list strong{font-family:'IBM Plex Mono',monospace;font-size:12px}
.flag{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;
  margin-left:7px;border-radius:50%;background:#C2352B;color:#fff;
  font:700 11px/1 'Archivo',sans-serif;vertical-align:1px}
.dd-warn{color:#8A2B23}

.tabs{max-width:820px;margin:0 auto 14px;display:flex;gap:4px;border-bottom:1px solid var(--line)}
.tab{background:none;border:none;border-bottom:2px solid transparent;padding:9px 14px;margin-bottom:-1px;
  font:600 13px 'Archivo',sans-serif;color:var(--ink-2);cursor:pointer;display:flex;align-items:center;gap:7px}
.tab:hover{color:var(--ink)}
.tab-on{color:var(--ink);border-bottom-color:var(--ink)}
.tab-n{font:600 11px 'IBM Plex Mono',monospace;background:var(--line);color:var(--ink);
  border-radius:999px;padding:1px 7px}
.tab-on .tab-n{background:var(--ink);color:#fff}

.stage-pick{display:flex;gap:6px;margin-bottom:14px}
.stage-btn{flex:1;background:#fff;border:1px solid var(--line);border-radius:3px;padding:9px 12px;
  font:500 13px 'Archivo',sans-serif;color:var(--ink-2);cursor:pointer}
.stage-btn:hover{border-color:var(--ink-2)}
.stage-on{color:var(--ink);border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}

.progress{margin-bottom:14px}
.progress-bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden}
.progress-bar span{display:block;height:100%;background:#2E9E6B;transition:width .3s ease}
.progress-txt{font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;
  color:var(--ink-2);margin:7px 0 0}

.item{display:flex;align-items:stretch;flex-wrap:wrap}
.item>.item-top{flex:1;min-width:0}
.item>.detail{flex-basis:100%}
.check{display:flex;align-items:center;padding:0 4px 0 12px;cursor:pointer;flex-shrink:0}
.check input{width:20px;height:20px;accent-color:#2E9E6B;cursor:pointer;margin:0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

.syncbar{max-width:820px;margin:0 auto 14px;display:flex;align-items:center;gap:8px;
  font:500 12px 'IBM Plex Mono',monospace;color:var(--ink-2)}
.pip{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#A5ADB6}
.pip-ok{background:#2E9E6B}.pip-busy{background:#E2711D}.pip-off{background:var(--red)}
.sync-msg{flex:1;min-width:0}
.linkbtn{background:none;border:none;font:600 12px 'IBM Plex Mono',monospace;color:var(--ink);
  text-decoration:underline;cursor:pointer;padding:0;flex-shrink:0}
.setup{max-width:820px;margin:0 auto 16px;background:#fff;border:1px solid var(--line);
  border-radius:4px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.hint{font:400 12px/1.5 'Archivo',sans-serif;color:var(--ink-2);margin:0}
.tally{display:flex;align-items:center;gap:8px;flex-shrink:0}
.tally-num{font:600 30px/1 'IBM Plex Mono',monospace}
.tally-lbl{font:500 10px/1.2 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-2)}

.panel{max-width:820px;margin:0 auto 18px;background:#fff;border:1px solid var(--line);
  border-radius:4px;padding:18px 16px}
.panel-h{font:700 13px/1 'IBM Plex Mono',monospace;letter-spacing:.12em;text-transform:uppercase;margin:0 0 14px}

.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px}
.chip{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--line);
  border-radius:999px;padding:6px 12px;font:500 13px 'Archivo',sans-serif;color:var(--ink-2);cursor:pointer}
.chip:hover{border-color:var(--ink-2)}
.chip-dot{width:9px;height:9px;border-radius:50%;background:var(--c)}
.chip-on{color:var(--ink);border-color:var(--c);box-shadow:inset 0 0 0 1px var(--c)}
.chip-n{font:600 11px 'IBM Plex Mono',monospace;color:var(--ink-2)}

.grid{display:grid;grid-template-columns:1fr 90px 1fr 90px;gap:12px}
.field{display:flex;flex-direction:column;gap:5px;min-width:0}
.field-wide{grid-column:1/-1}
.field-l{font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-2);display:flex;gap:6px}
.field-l em{font-style:normal;text-transform:none;letter-spacing:0;opacity:.65}
.wm input{width:100%;font:500 15px 'Archivo',sans-serif;color:var(--ink);background:#fff;
  border:1px solid var(--line);border-radius:3px;padding:9px 10px}
.wm input::placeholder{color:#A5ADB6}

.label-stage{position:relative;margin:22px 0 16px;padding:18px 0}
.wire-run{position:absolute;left:0;right:0;top:50%;height:6px;transform:translateY(-50%);border-radius:3px;
  background:linear-gradient(90deg,transparent,var(--c) 8%,var(--c) 92%,transparent)}
.tag{position:relative;display:flex;align-items:stretch;background:#fff;border:1px solid var(--line);
  border-left:none;border-radius:3px;box-shadow:0 2px 0 rgba(22,27,34,.08);overflow:hidden}
.tag-band{width:10px;background:var(--c);flex-shrink:0}
.tag-body{flex:1;padding:10px 12px;min-width:0}
.tag-name{font:600 clamp(15px,4.4vw,22px)/1.2 'IBM Plex Mono',monospace;word-break:break-all}
.tag-sub{font:400 12px/1.3 'Archivo',sans-serif;color:var(--ink-2);margin-top:3px}
.tag-gauge{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 12px;
  border-left:1px dashed var(--line);flex-shrink:0;font:600 17px/1 'IBM Plex Mono',monospace}
.tag-gauge small{font-size:9px;letter-spacing:.08em;color:var(--ink-2);margin-top:2px}

.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.override{flex:1;min-width:180px}
.btn{font:600 13px 'Archivo',sans-serif;background:#fff;color:var(--ink);border:1px solid var(--line);
  border-radius:3px;padding:10px 16px;cursor:pointer}
.btn:hover:not(:disabled){border-color:var(--ink)}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-go{background:var(--ink);color:#fff;border-color:var(--ink)}
.btn-sm{padding:7px 11px;font-size:12px}
.btn-del{color:var(--red)}
.notice{font:400 13px 'Archivo',sans-serif;color:var(--red);margin:10px 0 0}

.tools{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.search{position:relative;margin-bottom:12px}
.search input{padding-right:64px}
.clear{position:absolute;right:5px;top:5px;bottom:5px;border:none;background:none;
  font:500 12px 'IBM Plex Mono',monospace;color:var(--ink-2);cursor:pointer;padding:0 8px}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin-bottom:14px}
.leg{display:inline-flex;align-items:center;gap:5px;font:500 11px 'IBM Plex Mono',monospace;color:var(--ink-2)}
.leg i{width:14px;height:5px;border-radius:2px;display:inline-block}
.count{font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-2);margin:0 0 8px}
.empty{font:400 14px 'Archivo',sans-serif;color:var(--ink-2);padding:22px 0;margin:0;text-align:center}

.list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.item{border:1px solid var(--line);border-left:5px solid var(--c);border-radius:3px;background:#fff;overflow:hidden}
.item-open{border-color:var(--ink);border-left-color:var(--c)}
.item-top{display:grid;grid-template-columns:1fr auto;gap:2px 14px;width:100%;text-align:left;
  background:none;border:none;padding:11px 13px;cursor:pointer;font:inherit}
.item-name{font:600 15px 'IBM Plex Mono',monospace;word-break:break-all}
.item-path{font:400 13px 'Archivo',sans-serif;color:var(--ink-2)}
.item-gauge{grid-row:1/3;align-self:center;display:flex;flex-direction:column;align-items:center;
  font:600 16px/1 'IBM Plex Mono',monospace;padding-left:12px;border-left:1px dashed var(--line)}
.item-gauge small{font-size:9px;letter-spacing:.08em;color:var(--ink-2);margin-top:2px}
.arrow{margin:0 7px;color:var(--c);font-weight:700}
.wm mark{background:#FFE9A8;color:inherit;border-radius:2px}

.detail{border-top:1px dashed var(--line);padding:12px 13px}
.detail dl{margin:0 0 12px;display:grid;gap:7px}
.detail dl>div{display:grid;grid-template-columns:82px 1fr;gap:10px}
.detail dt{font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2)}
.detail dd{margin:0;font:400 14px 'Archivo',sans-serif}
.swatch{display:inline-block;width:14px;height:5px;border-radius:2px;margin-right:7px;vertical-align:middle}
.detail-btns{display:flex;gap:6px}

.foot{max-width:820px;margin:0 auto;font:400 12px/1.5 'Archivo',sans-serif;color:var(--ink-2);text-align:center}

@media (max-width:620px){
  .grid{grid-template-columns:1fr 84px}
  .item-gauge{padding-left:10px}
}
@media (prefers-reduced-motion:reduce){.wm *{transition:none!important}}
`;
