import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoLap, crossing, makeLine, MIN_LAP_S } from '../src/gpslap.js';

// A made-up circular track (not a real place): 1,000 m round, centre at 0.5 N, 0.5 E.
const C = { lat: 0.5, lon: 0.5 };
const RADIUS = 1000 / (2 * Math.PI);
const M_PER_DEG = (Math.PI / 180) * 6371008.8;

function at(angle, r = RADIUS) {
  return {
    lat: C.lat + (r * Math.sin(angle)) / M_PER_DEG,
    lon: C.lon + (r * Math.cos(angle)) / (M_PER_DEG * Math.cos((C.lat * Math.PI) / 180))
  };
}

// Anticlockwise at a steady speed, one fix a second, with a few metres of wobble.
function laps({ n = 3, speed = 25, hz = 1, wobble = 3, seed = 1 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const fixes = [];
  const lapS = 1000 / speed;
  for (let t = 0; t <= n * lapS + 5; t += 1 / hz) {
    const p = at((speed * t) / RADIUS, RADIUS + wobble * rnd());
    fixes.push({ t, ...p, accuracy: 5 });
  }
  return { fixes, lapS };
}

test('a lap is counted every time round after one press at the line', () => {
  const { fixes, lapS } = laps({ n: 4 });
  const auto = new AutoLap();
  const marks = [];
  for (const f of fixes) {
    const t = auto.feed(f);
    if (t !== null) marks.push(t);
    if (f.t === 2) auto.arm(f.t); // pressed Lap at the line, 2 s in
  }
  assert.equal(marks.length, 4);
  for (let i = 1; i < marks.length; i++) assert.ok(Math.abs(marks[i] - marks[i - 1] - lapS) < 0.5, `lap ${i}: ${marks[i] - marks[i - 1]}`);
});

test('pressed while stopped, the line waits for the car to move', () => {
  const auto = new AutoLap();
  const still = at(0);
  for (let t = 0; t < 5; t++) auto.feed({ t, ...still, accuracy: 4 });
  assert.equal(auto.arm(4), false);
  const { fixes } = laps({ n: 2, wobble: 0 });
  const marks = [];
  for (const f of fixes) {
    const t = auto.feed({ ...f, t: f.t + 5 });
    if (t !== null) marks.push(t);
  }
  assert.ok(auto.line);
  assert.equal(marks.length, 2);
});

test('driving the wrong way through the line is not a lap', () => {
  const line = makeLine(at(0), Math.PI / 2); // travel is north at angle 0 going anticlockwise
  const before = { t: 0, ...at(-0.02) };
  const after = { t: 1, ...at(0.02) };
  assert.notEqual(crossing(line, before, after), null);
  assert.equal(crossing(line, after, { ...before, t: 2 }), null);
});

test('crossing the line far to one side (a pit lane) is not a lap', () => {
  const line = makeLine(at(0), Math.PI / 2);
  const wide = RADIUS + 60;
  assert.equal(crossing(line, { t: 0, ...at(-0.02, wide) }, { t: 1, ...at(0.02, wide) }), null);
});

test('poor fixes are ignored, and GPS wobble at the line is not a second lap', () => {
  const auto = new AutoLap();
  const { fixes } = laps({ n: 2 });
  let marks = 0;
  for (const f of fixes) {
    if (auto.feed(f) !== null) marks++;
    if (f.t === 2) auto.arm(f.t);
  }
  assert.equal(marks, 2);
  assert.equal(auto.feed({ t: 999, lat: 10, lon: 10, accuracy: 80 }), null);
  assert.ok(MIN_LAP_S >= 5);
});

test('positions are not kept beyond the last fix', () => {
  const auto = new AutoLap();
  for (const f of laps({ n: 1 }).fixes) auto.feed(f);
  assert.deepEqual(Object.keys(auto).sort(), ['armPending', 'lastCross', 'line', 'prev']);
});
