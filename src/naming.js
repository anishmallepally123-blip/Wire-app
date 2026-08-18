/* Device abbreviation, shared by wire naming and belly pan matching.

   Both must agree exactly: a wire named for "BL Drive" has to find the box
   labelled "BL Drive". Keeping one copy is the only way to guarantee that.

   Short words survive whole. Collapsing every word to its initial would turn
   "BL Drive" and "BR Drive" both into "BD" — the corner letter is the part
   that distinguishes them, so it can't be thrown away. */

const ALIASES = {
  ROBORIO: "RIO", "ROBO RIO": "RIO",
  SYSTEMCORE: "SYSCR", "SYSTEM CORE": "SYSCR",
  BATTERY: "BATT", "MAIN BREAKER": "BRKR", BREAKER: "BRKR",
  RADIO: "RDIO", "KRAKEN X60": "KRK60", "KRAKEN X44": "KRK44",
};

const KEEP_WHOLE = 3;   /* words this short are meaningful in full */
const MAX = 6;

export function abbrev(raw) {
  const c = (raw || "").trim().toUpperCase().replace(/[^A-Z0-9 \-_/]/g, "");
  if (!c) return "";
  if (ALIASES[c]) return ALIASES[c];

  const words = c.split(/[\s\-_/]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, MAX);

  const joined = words.join("");
  if (joined.length <= MAX) return joined;

  const parts = words.map((w) =>
    w.length <= KEEP_WHOLE || /^\d+$/.test(w) ? w : w[0]
  );
  return parts.join("").slice(0, MAX);
}

/* Ports: "4", "04" and "port 4" all mean the same channel. */
export function normPort(raw) {
  const c = (raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return !c ? "" : /^\d+$/.test(c) ? c.padStart(2, "0") : c;
}

export function endpointCode(device, port) {
  const d = abbrev(device);
  const p = normPort(port);
  return d && p ? d + p : d || p;
}
