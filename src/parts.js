/* Component library.
 *
 * Everything here is in INCHES. The grid is CPI cells per inch, so a part's
 * cell footprint is derived, never hand-tuned — change CPI and the whole pan
 * rescales correctly.
 *
 * Dimensions are close enough to plan a belly pan with, taken from vendor
 * drawings and physical measurement. They are NOT a substitute for a CAD
 * model. If a part is off, fix the numbers here: it's the only place they
 * live, and the footprint, port positions, and routing all follow from them.
 *
 * Ports: x and y are offsets in inches from the part's top-left corner.
 * `id` must match what people actually type in the Add wire form — the Add
 * wire port dropdown is generated from these, which is what keeps them in
 * step.
 */

export const CPI = 4;              /* cells per inch — see routing.js */
export const inToCell = (n) => Math.round(n * CPI);

/* ------------------------------------------------------------------ */

const pdhPorts = () => {
  const ports = [];
  /* 20 high-current channels, 10 down each long side. Measured board is
     8.875 x 4.375in, so the channels sit about 0.72in apart. */
  for (let i = 0; i < 10; i++) {
    ports.push({ id: String(i), label: String(i), num: String(i),
      x: 0, y: 0.85 + i * 0.72, edge: "left", kind: "power" });
  }
  for (let i = 0; i < 10; i++) {
    ports.push({ id: String(i + 10), label: String(i + 10), num: String(i + 10),
      x: 4.375, y: 0.85 + i * 0.72, edge: "right", kind: "power" });
  }
  /* low-current channels and the battery/CAN end */
  ["20", "21", "22", "23"].forEach((n, i) => {
    ports.push({ id: n, label: n, num: n,
      x: 0.55 + i * 0.42, y: 8.875, edge: "bottom", kind: "power" });
  });
  ports.push({ id: "BAT", label: "Battery in", x: 3.5, y: 8.875, edge: "bottom", kind: "power" });
  ports.push({ id: "CAN", label: "CAN", x: 2.5, y: 8.875, edge: "bottom", kind: "can" });
  return ports;
};

export const PARTS = {
  PDH: {
    id: "PDH", label: "PDH", w: 4.375, h: 8.875, shape: "pdh",
    ports: pdhPorts(),
  },
  MPM: {
    id: "MPM", label: "MPM", w: 3.0, h: 2.0, shape: "board",
    ports: [
      ...[0, 1, 2, 3, 4, 5].map((i) => ({
        id: String(i), label: String(i), num: String(i),
        x: 0, y: 0.3 + i * 0.28, edge: "left", kind: "power",
      })),
      { id: "BAT", label: "Battery in", x: 3.0, y: 1.0, edge: "right", kind: "power" },
    ],
  },
  SYSCR: {
    /* Limelight Systemcore. Roughly a large phone: 6.3 x 3.1in. Port
       positions read off the board photo, in inches from top-left. */
    id: "SYSCR", label: "Systemcore", w: 6.3, h: 3.1, shape: "board",
    ports: [
      { id: "PWR-", label: "Power −", x: 0.82, y: 0, edge: "top", kind: "power" },
      { id: "PWR+", label: "Power +", x: 1.08, y: 0, edge: "top", kind: "power" },
      { id: "BRIDGE", label: "Bridge", x: 1.54, y: 0, edge: "top", kind: "power" },
      { id: "LINK", label: "Link (USB-C)", x: 2.23, y: 0, edge: "top", kind: "eth" },
      ...[0, 1, 2, 3, 4].map((i) => ({
        id: `CAN${i}`, label: `CAN ${i}`, num: String(i),
        x: 2.94 + i * 0.6, y: 0, edge: "top", kind: "can",
      })),
      { id: "ETH", label: "Ethernet", x: 6.3, y: 1.29, edge: "right", kind: "eth" },
      { id: "RSL", label: "RSL", x: 0.51, y: 3.1, edge: "bottom", kind: "dio" },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({
        id: `SIO${i}`, label: `Smart I/O ${i}`, num: String(i),
        x: 1.10 + i * 0.32, y: 3.1, edge: "bottom", kind: "dio",
      })),
      ...[0, 1, 2, 3].map((i) => ({
        id: `USB${i}`, label: `USB ${i}`, x: 3.58 + i * 0.47, y: 3.1, edge: "bottom", kind: "eth",
      })),
      ...[0, 1].map((i) => ({
        id: `I2C${i}`, label: `I2C ${i}`, x: 5.55 + i * 0.23, y: 3.1, edge: "bottom", kind: "dio",
      })),
    ],
  },
  RIO: {
    id: "RIO", label: "roboRIO", w: 6.2, h: 3.6, shape: "board",
    ports: [
      { id: "PWR", label: "Power", x: 0, y: 0.8, edge: "left", kind: "power" },
      { id: "CAN", label: "CAN", x: 0, y: 2.0, edge: "left", kind: "can" },
      { id: "ETH", label: "Ethernet", x: 6.2, y: 1.0, edge: "right", kind: "eth" },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({
        id: `PWM${i}`, label: `PWM ${i}`, x: 0.7 + i * 0.45, y: 3.6, edge: "bottom", kind: "pwm",
      })),
      ...[0, 1, 2, 3].map((i) => ({
        id: `DIO${i}`, label: `DIO ${i}`, x: 3.9 + i * 0.45, y: 3.6, edge: "bottom", kind: "dio",
      })),
    ],
  },
  BATT: {
    id: "BATT", label: "Battery", w: 7.1, h: 3.0, shape: "battery",
    ports: [
      { id: "+", label: "+", x: 6.3, y: 0, edge: "top", kind: "power" },
      { id: "-", label: "−", x: 0.8, y: 0, edge: "top", kind: "power" },
    ],
  },
  BRKR: {
    id: "BRKR", label: "Main breaker", w: 2.3, h: 1.7, shape: "breaker",
    ports: [
      { id: "BAT", label: "Battery", x: 0, y: 0.85, edge: "left", kind: "power" },
      { id: "LOAD", label: "Load", x: 2.3, y: 0.85, edge: "right", kind: "power" },
    ],
  },
  /* Motors are round cans with a pigtail — no terminal worth pinning down,
     so wires anchor at the nearest edge instead. */
  KRK60: { id: "KRK60", label: "Kraken x60", w: 2.6, h: 2.6, shape: "motor", ports: [] },
  KRK44: { id: "KRK44", label: "Kraken x44", w: 1.8, h: 1.8, shape: "motor", ports: [] },
  NEO:   { id: "NEO",   label: "NEO",        w: 2.2, h: 2.2, shape: "motor", ports: [] },
  RDIO: {
    id: "RDIO", label: "Radio", w: 4.6, h: 3.3, shape: "board",
    ports: [
      { id: "PWR", label: "Power", x: 0, y: 1.6, edge: "left", kind: "power" },
      { id: "ETH", label: "Ethernet", x: 4.6, y: 1.6, edge: "right", kind: "eth" },
    ],
  },
  VRM: {
    id: "VRM", label: "VRM", w: 3.0, h: 2.0, shape: "board",
    ports: [
      { id: "IN", label: "Power in", x: 0, y: 1.0, edge: "left", kind: "power" },
      { id: "12V", label: "12V", x: 3.0, y: 0.6, edge: "right", kind: "power" },
      { id: "5V", label: "5V", x: 3.0, y: 1.4, edge: "right", kind: "power" },
    ],
  },
  RSL: {
    id: "RSL", label: "RSL", w: 1.6, h: 1.6, shape: "board",
    ports: [{ id: "IN", label: "Signal", x: 0, y: 0.8, edge: "left", kind: "power" }],
  },
};

export const PART_LIST = Object.values(PARTS);

/* Colours for the little port dots, so a CAN terminal reads differently
   from a 40A power channel at a glance. */
export const PORT_KIND = {
  power: "#C2352B",
  can:   "#2E9E6B",
  eth:   "#5B4B8A",
  pwm:   "#2E6FC4",
  dio:   "#0F8F94",
};

/* Rotation. Components store rot in degrees (0/90/180/270); the footprint
   swaps w/h at 90 and 270, and port offsets rotate with it. */
export function rotatedSize(part, rot) {
  return (rot === 90 || rot === 270)
    ? { w: part.h, h: part.w }
    : { w: part.w, h: part.h };
}

const EDGE_CW = { top: "right", right: "bottom", bottom: "left", left: "top" };
function rotEdge(edge, rot) {
  let e = edge;
  for (let r = 0; r < ((rot / 90) | 0) % 4; r++) e = EDGE_CW[e] || e;
  return e;
}

export function rotatedPort(part, port, rot) {
  const { w, h } = part;
  let x = port.x, y = port.y;
  if (rot === 90)  { [x, y] = [h - port.y, port.x]; }
  if (rot === 180) { [x, y] = [w - port.x, h - port.y]; }
  if (rot === 270) { [x, y] = [port.y, w - port.x]; }
  return { ...port, x, y, edge: rotEdge(port.edge, rot) };
}

export function portsOfRotated(item) {
  const part = partFor(item);
  if (!part) return [];
  const rot = ((item.rot || 0) % 360 + 360) % 360;
  return part.ports.map((p) => rotatedPort(part, p, rot));
}

export function partFor(item) {
  return PARTS[item.partId] || null;
}

/* Absolute cell position of a port, kept fractional so a dot can sit
   between grid lines — adjacent PDH channels are 1.6 cells apart. */
export function portPos(item, port) {
  return {
    x: item.x + port.x * CPI,
    y: item.y + port.y * CPI,
  };
}

export function portsOf(item) {
  const p = partFor(item);
  return p ? p.ports : [];
}
