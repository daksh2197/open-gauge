// OBD-II mode 01 PIDs Open Gauge reads, and how to turn an ELM327 reply into a number.
// Formulas are the standard SAE J1979 ones. Read-only: Open Gauge never writes to the car.

export const PIDS = {
  rpm: { pid: '0C', bytes: 2, unit: 'rpm', label: 'RPM', decode: ([a, b]) => (256 * a + b) / 4 },
  speed_kph: { pid: '0D', bytes: 1, unit: 'km/h', label: 'Speed', decode: ([a]) => a },
  coolant_c: { pid: '05', bytes: 1, unit: '°C', label: 'Coolant', decode: ([a]) => a - 40 },
  thr: { pid: '11', bytes: 1, unit: '%', label: 'Throttle', decode: ([a]) => a / 255 },
  intake_c: { pid: '0F', bytes: 1, unit: '°C', label: 'Intake air', decode: ([a]) => a - 40 },
  load: { pid: '04', bytes: 1, unit: '%', label: 'Load', decode: ([a]) => a / 255 },
  map_kpa: { pid: '0B', bytes: 1, unit: 'kPa', label: 'Manifold', decode: ([a]) => a }
};

// Read every cycle, and only every SLOW_EVERY cycles (they change slowly and each read takes time).
export const FAST = ['rpm', 'speed_kph', 'thr'];
export const SLOW = ['coolant_c', 'intake_c', 'load', 'map_kpa'];
export const SLOW_EVERY = 10;

/** The data bytes of a mode 01 reply to `pid`, or null for NO DATA, errors or a reply to something else.
 * Accepts replies with or without spaces and with several ECUs answering (the first match wins). */
export function replyBytes(text, pid) {
  const want = '41' + pid.toUpperCase();
  for (const line of String(text).split(/[\r\n]+/)) {
    const hex = line.replace(/\s+/g, '').toUpperCase();
    if (!/^[0-9A-F]+$/.test(hex) || !hex.startsWith(want)) continue;
    const data = hex.slice(want.length);
    const out = [];
    for (let i = 0; i + 1 < data.length; i += 2) out.push(parseInt(data.slice(i, i + 2), 16));
    return out;
  }
  return null;
}

/** The value of a named PID from an ELM327 reply, or null if the car didn't give it. */
export function decode(name, text) {
  const p = PIDS[name];
  const bytes = replyBytes(text, p.pid);
  if (!bytes || bytes.length < p.bytes) return null;
  const v = p.decode(bytes);
  return Number.isFinite(v) ? v : null;
}

/** The PIDs a car says it supports, from its replies to 0100, 0120 and 0140. */
export function supported(replies) {
  const out = new Set();
  for (const [base, text] of Object.entries(replies)) {
    const bytes = replyBytes(text, base);
    if (!bytes || bytes.length < 4) continue;
    const start = parseInt(base, 16);
    for (let i = 0; i < 32; i++) {
      if (bytes[i >> 3] & (0x80 >> (i & 7))) out.add((start + i + 1).toString(16).toUpperCase().padStart(2, '0'));
    }
  }
  return out;
}

/** Battery voltage from an ATRV reply such as "12.6V", or null. */
export function volts(text) {
  const m = /(\d{1,2}(?:\.\d+)?)\s*V/i.exec(String(text));
  return m ? Number(m[1]) : null;
}
