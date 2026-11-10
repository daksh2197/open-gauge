import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v))
};
const { KEEP, deleteDrive, drives, saveDrive, settings } = await import('../src/store.js');

test('keeps only the newest drives', () => {
  for (let i = 0; i < KEEP + 3; i++) saveDrive({ started: `2026-11-10T10:${String(i).padStart(2, '0')}:00Z`, samples: [] });
  const all = drives();
  assert.equal(all.length, KEEP);
  assert.equal(all[0].started, '2026-11-10T10:12:00Z');
  deleteDrive(all[0].started);
  assert.equal(drives().length, KEEP - 1);
});

test('settings fall back to defaults', () => {
  assert.equal(settings().theme, 'night');
  assert.equal(settings().weather, 'not recorded');
});
