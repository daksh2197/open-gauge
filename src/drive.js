// A recorded drive: readings over time, the moments you crossed the line, and the spots you tagged.

export const FIELDS = ['rpm', 'speed_kph', 'thr', 'coolant_c', 'intake_c', 'load', 'map_kpa', 'volts'];

export function newDrive({ started = new Date().toISOString(), car = 'Car', adapter = '' } = {}) {
  return { started, car, adapter, samples: [], laps: [], invalid: [], tags: [] };
}

/** Add one reading taken `t` seconds after the drive started. A value not read this time is
 * carried from the last reading that had it, so the log has no gaps the car didn't make. */
export function addSample(drive, t, reading) {
  const last = drive.samples[drive.samples.length - 1];
  const s = { t: round(t, 3) };
  for (const k of FIELDS) {
    if (k in reading) s[k] = reading[k] === null || reading[k] === undefined ? null : reading[k];
    else s[k] = last ? last[k] : null;
  }
  drive.samples.push(s);
  return s;
}

/** You crossed the start line `t` seconds in. The first press starts lap 1. A second press within
 * a second of the last is a double tap and is ignored. Returns whether it counted. */
export function markLap(drive, t) {
  const last = drive.laps[drive.laps.length - 1];
  if (last !== undefined && t - last < 1) return false;
  drive.laps.push(round(t, 3));
  return true;
}

/** The lap you're on doesn't count (off track, cut a corner, traffic). */
export function markInvalid(drive, t) {
  drive.invalid.push(round(t, 3));
}

/** You felt something here. You can talk about it afterwards in the Pitwall debrief. */
export function markTag(drive, t) {
  drive.tags.push(round(t, 3));
}

export function round(v, d) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

/** The drive as CSV, one row per reading. Missing values are blank, never guessed. */
export function toCsv(drive) {
  const head = ['t_s', ...FIELDS].join(',');
  const rows = drive.samples.map(s =>
    [s.t, ...FIELDS.map(k => (s[k] === null ? '' : k === 'thr' || k === 'load' ? round(s[k], 4) : s[k]))].join(',')
  );
  return [head, ...rows].join('\n') + '\n';
}
