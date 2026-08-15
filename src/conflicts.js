/* Conflict checks over the manifest.

   The rule that matters: a blank port is not a claim on anything. CAN and
   power wires routinely chain through the same device without naming a
   channel, and flagging those would bury the real conflicts in noise. Only
   an explicitly named port counts as claiming that channel. */

const norm = (s) => (s || "").trim().toUpperCase().replace(/\s+/g, " ");

/* "4", "04" and "port 4" are the same physical channel. Strip to
   alphanumerics, then drop leading zeros on pure numbers so the padding the
   naming code applies can't hide a genuine clash. */
function normPort(s) {
  const c = (s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^\d+$/.test(c) ? String(parseInt(c, 10)) : c;
}

function endpoints(w) {
  return [
    { device: w.fromDevice, port: w.fromPort, side: "from" },
    { device: w.toDevice, port: w.toPort, side: "to" },
  ];
}

/* Two wires landing on the same device AND the same named port. */
export function portConflicts(wires) {
  const claims = new Map();
  wires.forEach((w) => {
    endpoints(w).forEach((e) => {
      const d = norm(e.device);
      const p = normPort(e.port);
      if (!d || !p) return;
      const key = `${d}|${p}`;
      if (!claims.has(key)) claims.set(key, { device: e.device.trim(), port: e.port.trim(), wires: [] });
      claims.get(key).wires.push(w);
    });
  });
  return [...claims.values()]
    .filter((c) => {
      const ids = new Set(c.wires.map((w) => w.id));
      return ids.size > 1;
    })
    .map((c) => ({ ...c, wires: dedupeById(c.wires) }));
}

/* Two wires running between exactly the same pair of endpoints. Usually
   someone logged the same wire twice from two different phones. */
export function duplicateRuns(wires) {
  const seen = new Map();
  wires.forEach((w) => {
    const a = `${norm(w.fromDevice)}|${normPort(w.fromPort)}`;
    const b = `${norm(w.toDevice)}|${normPort(w.toPort)}`;
    if (!norm(w.fromDevice) || !norm(w.toDevice)) return;
    const key = [a, b].sort().join("::");
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(w);
  });
  return [...seen.values()].filter((g) => g.length > 1);
}

function dedupeById(list) {
  const m = new Map();
  list.forEach((w) => m.set(w.id, w));
  return [...m.values()];
}

/* Everything the UI needs: the groups, plus a flat id lookup so a row can
   mark itself without re-scanning. */
export function findConflicts(wires) {
  const ports = portConflicts(wires);
  const dupes = duplicateRuns(wires);
  const flagged = new Map();
  const flag = (w, text) => {
    if (!flagged.has(w.id)) flagged.set(w.id, []);
    flagged.get(w.id).push(text);
  };
  ports.forEach((c) =>
    c.wires.forEach((w) => flag(w, `${c.device} port ${c.port} claimed by ${c.wires.length} wires`))
  );
  dupes.forEach((g) => g.forEach((w) => flag(w, "Same run logged more than once")));
  return { ports, dupes, flagged, count: ports.length + dupes.length };
}
