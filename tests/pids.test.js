import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, replyBytes, supported, volts } from '../src/pids.js';

test('decodes the standard formulas', () => {
  assert.equal(decode('rpm', '410C1AF8'), 1726);
  assert.equal(decode('speed_kph', '41 0D 3C'), 60);
  assert.equal(decode('coolant_c', '41057B'), 83);
  assert.equal(decode('thr', '4111FF'), 1);
  assert.equal(decode('intake_c', '410F28'), 0);
});

test('missing data stays missing', () => {
  assert.equal(decode('rpm', 'NO DATA'), null);
  assert.equal(decode('rpm', 'CAN ERROR'), null);
  assert.equal(decode('rpm', '410C1A'), null); // one byte short
  assert.equal(decode('speed_kph', '410C1AF8'), null); // a reply to another PID
});

test('takes the first ECU that answers', () => {
  assert.deepEqual(replyBytes('7E8 03 41 0D 20\n410D21', '0D'), [0x21]);
  assert.deepEqual(replyBytes('410D20\n410D21', '0D'), [0x20]);
});

test('reads the supported-PID bitmask', () => {
  const s = supported({ '00': '4100BE3EB811' });
  for (const p of ['01', '04', '05', '0B', '0C', '0D', '0F', '11', '20']) assert.ok(s.has(p), p);
  assert.ok(!s.has('02'));
  assert.ok(!s.has('0A'));
});

test('reads battery voltage', () => {
  assert.equal(volts('12.6V'), 12.6);
  assert.equal(volts('14V'), 14);
  assert.equal(volts('?'), null);
});
