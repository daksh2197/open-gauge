import test from 'node:test';
import assert from 'node:assert/strict';
import { addSample, markLap, newDrive, toCsv } from '../src/drive.js';
import { BIN_KEYS, binsFor, buildSession, distances, validateSession } from '../src/session.js';
import { DEMO_TRACK } from '../src/transports.js';
import { demoDrive } from '../tools/demo-drive.js';

const TRACK = { id: 'Test Ring', name: 'Test ring', length_m: 1000 };

test('the demo drive exports as a valid session and survives a round trip', async () => {
  const drive = await demoDrive();
  const { session, dropped } = buildSession(drive, { track: DEMO_TRACK, car: { id: 'demo-car', setup: {} } });
  assert.deepEqual(validateSession(session).errors, []);
  const again = JSON.parse(JSON.stringify(session));
  assert.deepEqual(validateSession(again).errors, []);
  assert.deepEqual(again, session);
  assert.equal(dropped, 0);
  assert.equal(session.source, 'car');
  assert.equal(session.track.bins, 200);
  assert.deepEqual(session.laps.map(l => [l.n, l.valid]), [[1, true], [2, true], [3, false]]);
  for (const l of session.laps) {
    assert.equal(l.bins.length, 200);
    assert.ok(l.time_s > 90 && l.time_s < 120);
    // OBD-II has no steering, brake pressure, slip or g: they stay null, never guessed.
    for (const b of l.bins) for (const k of ['steer', 'brk', 'slip_deg', 'ax_g', 'ay_g']) assert.equal(b[k], null);
    const filled = l.bins.filter(b => b.t_s !== null);
    assert.ok(filled.length > 150);
    assert.ok(filled.every(b => b.thr >= 0 && b.thr <= 1 && b.v_mps > 0));
    // Bin times go forward through the lap.
    for (let i = 1; i < filled.length; i++) assert.ok(filled[i].t_s > filled[i - 1].t_s);
  }
  assert.deepEqual(session.notes, [{ lap: 2, bin: session.notes[0].bin, t_s: 20, source: 'tag', text: 'Feel tag' }]);
  assert.ok(session.notes[0].bin > 0 && session.notes[0].bin < 200);
});

test('laps run between Lap presses and bins split each lap by distance', () => {
  const d = newDrive({ started: '2026-11-10T10:00:00Z', car: 'Eclipse GT' });
  // 10 s at a steady 36 km/h (10 m/s) = 100 m, sampled once a second.
  for (let t = 0; t <= 10; t++) addSample(d, t, { speed_kph: 36, thr: 0.5 });
  markLap(d, 0);
  markLap(d, 10);
  const { session } = buildSession(d, { track: { ...TRACK, length_m: 100 } });
  assert.deepEqual(validateSession(session).errors, []);
  assert.equal(session.car.id, 'eclipse-gt');
  assert.equal(session.track.id, 'test-ring');
  const [lap] = session.laps;
  assert.equal(lap.time_s, 10);
  const filled = lap.bins.map((b, i) => [i, b.t_s]).filter(([, t]) => t !== null);
  // 11 readings at even spacing land in bins 0, 5, 10 ... 45 of 50 (the last reading closes the lap).
  assert.deepEqual(filled.slice(0, 3), [[0, 0], [5, 1], [10, 2]]);
  assert.equal(lap.bins[5].v_mps, 10);
  assert.equal(lap.bins[1].t_s, null);
});

test('a double tap on Lap is ignored', () => {
  const d = newDrive();
  assert.equal(markLap(d, 5), true);
  assert.equal(markLap(d, 5.4), false);
  assert.equal(markLap(d, 7), true);
  assert.deepEqual(d.laps, [5, 7]);
});

test('tags outside a timed lap are left out and counted', () => {
  const d = newDrive();
  for (let t = 0; t <= 30; t++) addSample(d, t, { speed_kph: 50 });
  markLap(d, 5);
  markLap(d, 20);
  d.tags.push(2, 10, 25);
  const { session, dropped } = buildSession(d, { track: TRACK });
  assert.equal(dropped, 2);
  assert.deepEqual(session.notes.map(n => [n.lap, n.t_s]), [[1, 5]]);
});

test('missing values stay missing', () => {
  const d = newDrive();
  addSample(d, 0, { speed_kph: 40, thr: null, coolant_c: null });
  addSample(d, 1, { speed_kph: 40 }); // a fast-only reading: slow values carry over
  markLap(d, 0);
  markLap(d, 1);
  const { session } = buildSession(d, { track: TRACK });
  assert.equal(session.laps[0].bins[0].thr, null);
  assert.equal(session.conditions.air_c, null);
  assert.equal(session.conditions.tire_psi, null);
  assert.equal(session.conditions.weather, 'not recorded');
  assert.equal(d.samples[1].coolant_c, null);
  assert.match(toCsv(d), /^t_s,rpm,speed_kph,thr,coolant_c,intake_c,load,map_kpa,volts\n0,,40,,,,,,\n/);
});

test('a lap with no movement exports with empty bins instead of failing', () => {
  const d = newDrive();
  for (let t = 0; t <= 5; t++) addSample(d, t, { speed_kph: 0 });
  markLap(d, 0);
  markLap(d, 5);
  const { session } = buildSession(d, { track: TRACK });
  assert.deepEqual(validateSession(session).errors, []);
  assert.ok(session.laps[0].bins.every(b => BIN_KEYS.every(k => b[k] === null)));
});

test('exporting needs a track', () => {
  assert.throws(() => buildSession(newDrive(), { track: { id: 'x' } }), /Set the track/);
});

test('bin counts and distance', () => {
  assert.equal(binsFor(2000), 200);
  assert.equal(binsFor(100), 50);
  assert.equal(binsFor(90000), 500);
  assert.deepEqual(distances([{ t: 0, speed_kph: 36 }, { t: 2, speed_kph: 72 }]), [0, 30]);
});

test('the validator matches Patent Garage on bad files', () => {
  assert.deepEqual(validateSession([]).errors, ['The file is not a JSON object']);
  const bad = { format: 'pitwall-session/1', source: 'kart' };
  const errs = validateSession(bad).errors;
  assert.ok(errs.includes('source must be "sim" or "car"'));
  assert.ok(errs.includes('session.created is missing'));
});
