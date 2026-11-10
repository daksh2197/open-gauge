import test from 'node:test';
import assert from 'node:assert/strict';
import { Elm, clean } from '../src/elm.js';
import { FAST, SLOW } from '../src/pids.js';
import { demoTransport } from '../src/transports.js';

function fake(replies) {
  const listeners = [];
  const sent = [];
  return {
    sent,
    async write(text) {
      sent.push(text);
      const cmd = text.trim();
      const r = replies[cmd];
      if (r === undefined) return; // never answers: the command times out
      // Replies can arrive in pieces, as they do over BLE.
      setTimeout(() => {
        const full = r + '\r\r>';
        for (const fn of listeners) fn(full.slice(0, 3));
        for (const fn of listeners) fn(full.slice(3));
      }, 1);
    },
    onData(fn) {
      listeners.push(fn);
    }
  };
}

test('sends one command at a time and waits for the prompt', async () => {
  const t = fake({ ATZ: 'ELM327 v1.5', '010D': 'SEARCHING...\r410D3C' });
  const elm = new Elm(t);
  const [a, b] = await Promise.all([elm.send('ATZ'), elm.send('010D')]);
  assert.equal(a, 'ELM327 v1.5');
  assert.equal(b, '410D3C');
  assert.deepEqual(t.sent, ['ATZ\r', '010D\r']);
});

test('a command with no reply times out and the next one still works', async () => {
  const t = fake({ '010D': '410D3C' });
  const elm = new Elm(t, { timeoutMs: 20 });
  await assert.rejects(elm.send('0105'), /No reply to 0105/);
  assert.equal(await elm.send('010D'), '410D3C');
});

test('skips PIDs the car says it does not have, and reads the slow ones every tenth time', async () => {
  const t = fake({ ATZ: 'OK', ATE0: 'OK', ATL0: 'OK', ATS0: 'OK', ATH0: 'OK', ATSP0: 'OK',
    '0100': '410000180000', '0120': 'NO DATA', '0140': 'NO DATA',
    '010C': '410C1AF8', '010D': '410D3C', ATRV: '12.4V' });
  const elm = new Elm(t, { timeoutMs: 50 });
  const have = await elm.start();
  assert.ok(have.has('0C') && have.has('0D'));
  assert.ok(!have.has('11'));
  const first = await elm.read();
  assert.deepEqual(Object.keys(first).sort(), [...FAST, ...SLOW, 'volts'].sort());
  assert.equal(first.rpm, 1726);
  assert.equal(first.thr, null); // not supported, so not even asked
  assert.equal(first.volts, 12.4);
  assert.ok(!t.sent.includes('0111\r'));
  const second = await elm.read();
  assert.deepEqual(Object.keys(second).sort(), [...FAST].sort());
});

test('the demo car answers like a car', async () => {
  const elm = new Elm(demoTransport(() => 10));
  await elm.start();
  const r = await elm.read();
  assert.ok(r.speed_kph > 30 && r.speed_kph < 130);
  assert.ok(r.rpm > 1000);
  assert.ok(r.thr >= 0 && r.thr <= 1);
  assert.equal(r.volts, 14.1);
});

test('clean drops searching lines and blanks', () => {
  assert.equal(clean('\r\nSEARCHING...\r410D3C\r\r'), '410D3C');
});
