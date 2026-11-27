// Automatic laps from the phone's own GPS. No adapter or extra hardware: the phone already knows
// where it is. Press Lap once at the start line; from then on every time the car crosses that
// line in the same direction, a lap is marked for you.
//
// Positions are only used to find the moment you cross the line. They are never saved in the
// drive or exported, so a drive file still holds no map of where you went.

const R = 6371008.8; // mean Earth radius, m
const rad = d => (d * Math.PI) / 180;

export const GATE_HALF_WIDTH_M = 20; // the line reaches this far either side of where you set it
export const MAX_ACCURACY_M = 25; // fixes worse than this are ignored
export const MIN_LAP_S = 10; // a second crossing sooner than this is GPS wobble, not a lap
export const MIN_SPEED_MPS = 3; // below this the direction of travel is noise

/** Metres east and north of `origin`. Flat-earth is fine over a track. */
export function toLocal(origin, p) {
  return {
    x: rad(p.lon - origin.lon) * Math.cos(rad(origin.lat)) * R,
    y: rad(p.lat - origin.lat) * R
  };
}

/** A start line through `at` (lat, lon), square to the direction of travel `heading` (radians,
 * measured as atan2(north, east) in the local frame). */
export function makeLine(at, heading, halfWidth = GATE_HALF_WIDTH_M) {
  return { origin: { lat: at.lat, lon: at.lon }, dir: { x: Math.cos(heading), y: Math.sin(heading) }, halfWidth };
}

/** If the step from fix `a` to fix `b` crosses `line` going forward, the time of the crossing
 * (interpolated between the two fixes), else null. Fixes are { t, lat, lon }. */
export function crossing(line, a, b) {
  const pa = toLocal(line.origin, a);
  const pb = toLocal(line.origin, b);
  const da = pa.x * line.dir.x + pa.y * line.dir.y; // signed distance past the line
  const db = pb.x * line.dir.x + pb.y * line.dir.y;
  if (!(da < 0 && db >= 0)) return null; // must go from behind the line to past it
  const f = da / (da - db);
  const cx = pa.x + f * (pb.x - pa.x);
  const cy = pa.y + f * (pb.y - pa.y);
  const across = Math.abs(-line.dir.y * cx + line.dir.x * cy); // distance along the line
  if (across > line.halfWidth) return null; // crossed the extended line, not the gate (pit lane)
  return a.t + f * (b.t - a.t);
}

/** Feeds GPS fixes and reports lap crossings. `arm()` sets the line at the latest good fix,
 * which is what pressing Lap at the line does. */
export class AutoLap {
  constructor() {
    this.line = null;
    this.prev = null;
    this.lastCross = -Infinity;
    this.armPending = false;
  }

  /** Set the start line where the car is now. If the car is not moving yet, the line is set at
   * the next fix that shows a direction. Returns whether the line is set. */
  arm(t) {
    this.lastCross = t;
    if (this.prev && this.prev.heading !== null) {
      this.line = makeLine(this.prev, this.prev.heading);
      this.armPending = false;
      return true;
    }
    this.armPending = true;
    return false;
  }

  /** One fix: { t (s, drive time), lat, lon, accuracy (m) }. Returns a crossing time or null. */
  feed(fix) {
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return null;
    if (Number.isFinite(fix.accuracy) && fix.accuracy > MAX_ACCURACY_M) return null;
    let heading = null;
    if (this.prev && fix.t > this.prev.t) {
      const d = toLocal(this.prev, fix);
      const speed = Math.hypot(d.x, d.y) / (fix.t - this.prev.t);
      if (speed >= MIN_SPEED_MPS) heading = Math.atan2(d.y, d.x);
    }
    const prev = this.prev;
    this.prev = { ...fix, heading };
    if (this.armPending && heading !== null) {
      // Pressed while stopped: the line goes where the car was when Lap was pressed.
      this.line = makeLine(prev, heading);
      this.armPending = false;
      return null;
    }
    if (!this.line || !prev) return null;
    const t = crossing(this.line, prev, fix);
    if (t === null || t - this.lastCross < MIN_LAP_S) return null;
    this.lastCross = t;
    return t;
  }
}
