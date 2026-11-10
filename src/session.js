// pitwall-session/1: the file Open Gauge and Patent Garage both write, so Pitwall can remember
// every drive. The validator is the same as Patent Garage's src/session.js.
//
// What a car session holds, and what it leaves null:
// - Laps run between your Lap presses. Each lap is cut into `bins` equal pieces of distance,
//   measured by adding up the car's own speed over the lap, so a speedometer that reads a little
//   high or low still puts each bin in the same place on the track every lap.
// - Each bin is the first reading inside it: lap time, speed and throttle.
// - Steering, brake pressure, slip angle and g-forces aren't on the standard OBD-II list, so they
//   are null. A bin the lap passed through without a reading is all null.
// - Tags become notes with source "tag", ready for the Pitwall debrief.

import { round } from './drive.js';

export const FORMAT = 'pitwall-session/1';
export const BIN_KEYS = ['t_s', 'v_mps', 'steer', 'thr', 'brk', 'slip_deg', 'ax_g', 'ay_g'];

const emptyBin = () => ({ t_s: null, v_mps: null, steer: null, thr: null, brk: null, slip_deg: null, ax_g: null, ay_g: null });

/** How many bins a track gets: about one per 10 m, between 50 and 500. */
export function binsFor(length_m) {
  return Math.max(50, Math.min(500, Math.round(length_m / 10)));
}

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'car';
}

/** The laps of a drive: { n, start, end, samples, valid }. Readings before the first Lap press and
 * after the last are the out and in laps, which aren't timed. */
export function laps(drive) {
  const out = [];
  for (let i = 0; i + 1 < drive.laps.length; i++) {
    const start = drive.laps[i];
    const end = drive.laps[i + 1];
    out.push({
      n: i + 1,
      start,
      end,
      samples: drive.samples.filter(s => s.t >= start && s.t <= end),
      valid: !drive.invalid.some(t => t >= start && t < end)
    });
  }
  return out;
}

/** Distance covered at each reading of a lap, in metres, from the car's speed. */
export function distances(samples) {
  const d = [0];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const va = (a.speed_kph ?? b.speed_kph ?? 0) / 3.6;
    const vb = (b.speed_kph ?? a.speed_kph ?? 0) / 3.6;
    d.push(d[i - 1] + ((va + vb) / 2) * (b.t - a.t));
  }
  return d;
}

function lapBins(lap, nb) {
  const bins = Array.from({ length: nb }, () => null);
  const d = distances(lap.samples);
  const total = d[d.length - 1] || 0;
  if (total > 0) {
    lap.samples.forEach((s, i) => {
      const b = Math.min(nb - 1, Math.floor((d[i] / total) * nb));
      if (bins[b]) return;
      bins[b] = {
        ...emptyBin(),
        t_s: round(s.t - lap.start, 3),
        v_mps: s.speed_kph === null ? null : round(s.speed_kph / 3.6, 3),
        thr: s.thr === null ? null : round(s.thr, 4)
      };
    });
  }
  return { bins: bins.map(b => b || emptyBin()), d, total };
}

/**
 * The drive as a pitwall-session/1 object.
 * track: { id, name, length_m }; car: { id, setup }; conditions: { weather, air_c, tire_psi }.
 * Returns { session, dropped } where dropped counts tags made outside a timed lap.
 */
export function buildSession(drive, { track, car = {}, conditions = {}, app = 'open-gauge@1.0.0', created } = {}) {
  if (!track || !track.id || !(track.length_m > 0)) throw new Error('Set the track (id and length) before exporting.');
  const nb = binsFor(track.length_m);
  const outLaps = [];
  const notes = [];
  let dropped = 0;
  const timed = laps(drive);
  const built = timed.map(l => ({ l, ...lapBins(l, nb) }));
  for (const { l, bins } of built) outLaps.push({ n: l.n, time_s: round(l.end - l.start, 3), valid: l.valid, bins });
  for (const t of drive.tags) {
    const hit = built.find(({ l }) => t >= l.start && t < l.end);
    if (!hit || hit.total <= 0) {
      dropped++;
      continue;
    }
    // Where along the lap the tag was: the distance at the reading just before it.
    let i = 0;
    while (i + 1 < hit.l.samples.length && hit.l.samples[i + 1].t <= t) i++;
    const bin = Math.min(nb - 1, Math.floor((hit.d[i] / hit.total) * nb));
    notes.push({ lap: hit.l.n, bin, t_s: round(t - hit.l.start, 3), source: 'tag', text: 'Feel tag' });
  }
  const session = {
    format: FORMAT,
    source: 'car',
    created: created || drive.started,
    app,
    track: { id: slug(track.id), name: track.name || track.id, length_m: track.length_m, bins: nb },
    car: { id: slug(car.id || drive.car), setup: { ...(car.setup || {}) } },
    conditions: {
      weather: conditions.weather || 'not recorded',
      air_c: conditions.air_c ?? null,
      tire_psi: conditions.tire_psi ?? null
    },
    switches: {},
    laps: outLaps,
    notes
  };
  return { session, dropped };
}

// ---- Validator: kept the same as Patent Garage's, so a file one accepts the other accepts ----

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = v => Number.isInteger(v);

function checkKeys(o, req, path, errors) {
  for (const k of req) if (!(k in o)) errors.push(`${path}.${k} is missing`);
  for (const k of Object.keys(o)) if (!req.includes(k)) errors.push(`${path}.${k} is not part of the format`);
}

export function validateSession(obj) {
  const errors = [];
  if (!isObj(obj)) return { ok: false, errors: ['The file is not a JSON object'] };
  checkKeys(obj, ['format', 'source', 'created', 'app', 'track', 'car', 'conditions', 'switches', 'laps', 'notes'], 'session', errors);
  if ('format' in obj && obj.format !== FORMAT) errors.push(`format must be "${FORMAT}"`);
  if ('source' in obj && obj.source !== 'sim' && obj.source !== 'car') errors.push('source must be "sim" or "car"');
  if ('created' in obj && (typeof obj.created !== 'string' || Number.isNaN(Date.parse(obj.created)))) errors.push('created must be an ISO-8601 date string');
  if ('app' in obj && (typeof obj.app !== 'string' || !/^[a-z0-9-]+@\d+\.\d+/.test(obj.app))) errors.push('app must look like "name@1.2"');
  let nb = null;
  if ('track' in obj) {
    const t = obj.track;
    if (!isObj(t)) errors.push('track must be an object');
    else {
      checkKeys(t, ['id', 'name', 'length_m', 'bins'], 'track', errors);
      if ('id' in t && (typeof t.id !== 'string' || !t.id)) errors.push('track.id must be a non-empty string');
      if ('name' in t && typeof t.name !== 'string') errors.push('track.name must be a string');
      if ('length_m' in t && !(isNum(t.length_m) && t.length_m > 0)) errors.push('track.length_m must be a positive number');
      if ('bins' in t) { if (isInt(t.bins) && t.bins > 0) nb = t.bins; else errors.push('track.bins must be a positive integer'); }
    }
  }
  if ('car' in obj) {
    const c = obj.car;
    if (!isObj(c)) errors.push('car must be an object');
    else {
      checkKeys(c, ['id', 'setup'], 'car', errors);
      if ('id' in c && typeof c.id !== 'string') errors.push('car.id must be a string');
      if ('setup' in c && !isObj(c.setup)) errors.push('car.setup must be an object');
    }
  }
  if ('conditions' in obj) {
    const c = obj.conditions;
    if (!isObj(c)) errors.push('conditions must be an object');
    else {
      checkKeys(c, ['weather', 'air_c', 'tire_psi'], 'conditions', errors);
      if ('weather' in c && typeof c.weather !== 'string') errors.push('conditions.weather must be a string');
      if ('air_c' in c && c.air_c !== null && !isNum(c.air_c)) errors.push('conditions.air_c must be a number or null');
      if ('tire_psi' in c && c.tire_psi !== null) {
        const tp = c.tire_psi;
        if (!isObj(tp)) errors.push('conditions.tire_psi must be an object or null');
        else {
          checkKeys(tp, ['fl', 'fr', 'rl', 'rr'], 'conditions.tire_psi', errors);
          for (const k of Object.keys(tp)) if (tp[k] !== null && !isNum(tp[k])) errors.push(`conditions.tire_psi.${k} must be a number or null`);
        }
      }
    }
  }
  if ('switches' in obj) {
    if (!isObj(obj.switches)) errors.push('switches must be an object');
    else for (const k of Object.keys(obj.switches)) if (typeof obj.switches[k] !== 'boolean') errors.push(`switches.${k} must be true or false`);
  }
  if ('laps' in obj) {
    if (!Array.isArray(obj.laps)) errors.push('laps must be an array');
    else obj.laps.forEach((l, i) => {
      const p = `laps[${i}]`;
      if (!isObj(l)) { errors.push(`${p} must be an object`); return; }
      checkKeys(l, ['n', 'time_s', 'valid', 'bins'], p, errors);
      if ('n' in l && !isInt(l.n)) errors.push(`${p}.n must be an integer`);
      if ('time_s' in l && !(isNum(l.time_s) && l.time_s > 0)) errors.push(`${p}.time_s must be a positive number`);
      if ('valid' in l && typeof l.valid !== 'boolean') errors.push(`${p}.valid must be true or false`);
      if ('bins' in l) {
        if (!Array.isArray(l.bins)) errors.push(`${p}.bins must be an array`);
        else {
          if (nb !== null && l.bins.length !== nb) errors.push(`${p}.bins has ${l.bins.length} entries, track.bins is ${nb}`);
          let shown = 0;
          l.bins.forEach((b, j) => {
            const bp = `${p}.bins[${j}]`, before = errors.length;
            if (!isObj(b)) { errors.push(`${bp} must be an object`); return; }
            checkKeys(b, BIN_KEYS, bp, errors);
            for (const k of BIN_KEYS) if (k in b && b[k] !== null && !isNum(b[k])) errors.push(`${bp}.${k} must be a number or null`);
            if (isNum(b.steer) && (b.steer < -1 || b.steer > 1)) errors.push(`${bp}.steer must be between -1 and 1`);
            for (const k of ['thr', 'brk']) if (isNum(b[k]) && (b[k] < 0 || b[k] > 1)) errors.push(`${bp}.${k} must be between 0 and 1`);
            if (errors.length > before) { if (++shown > 3) errors.length = before; }
          });
        }
      }
    });
  }
  if ('notes' in obj) {
    if (!Array.isArray(obj.notes)) errors.push('notes must be an array');
    else obj.notes.forEach((n, i) => {
      const p = `notes[${i}]`;
      if (!isObj(n)) { errors.push(`${p} must be an object`); return; }
      checkKeys(n, ['lap', 'bin', 't_s', 'source', 'text'], p, errors);
      if ('lap' in n && !isInt(n.lap)) errors.push(`${p}.lap must be an integer`);
      if ('bin' in n && !(isInt(n.bin) && n.bin >= 0 && (nb === null || n.bin < nb))) errors.push(`${p}.bin must be an integer from 0 to track.bins - 1`);
      if ('t_s' in n && !isNum(n.t_s)) errors.push(`${p}.t_s must be a number`);
      if ('source' in n && !['tag', 'interview', 'voice'].includes(n.source)) errors.push(`${p}.source must be "tag", "interview" or "voice"`);
      if ('text' in n && typeof n.text !== 'string') errors.push(`${p}.text must be a string`);
    });
  }
  return { ok: errors.length === 0, errors };
}
