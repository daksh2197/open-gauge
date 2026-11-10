import { APP } from './app-info.js';
import { Elm } from './elm.js';
import { addSample, markInvalid, markLap, markTag, newDrive, toCsv } from './drive.js';
import { buildSession, slug, validateSession } from './session.js';
import { DEFAULTS, deleteDrive, drives, saveDrive, saveSettings, settings } from './store.js';
import { DEMO_TRACK, bleAvailable, connectBle, demoTransport } from './transports.js';

const $ = id => document.getElementById(id);
let cfg = settings();
let link = null; // { transport, elm, demo }
let drive = null; // the drive being recorded
let t0 = 0; // when the connection started (seconds, performance clock)
let replay = null;
let wakeLock = null;

const now = () => performance.now() / 1000;

// ---- Screens and settings ----

function show(name) {
  for (const b of document.querySelectorAll('[data-screen]')) b.setAttribute('aria-pressed', String(b.dataset.screen === name));
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== name;
  if (name === 'drives') listDrives();
}
for (const b of document.querySelectorAll('[data-screen]')) b.addEventListener('click', () => show(b.dataset.screen));

function applySettings() {
  document.documentElement.dataset.theme = cfg.theme;
  const f = $('settings-form');
  for (const [k, v] of Object.entries(cfg)) if (f.elements[k]) f.elements[k].value = v;
}
$('settings-form').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target);
  cfg = { ...DEFAULTS, ...Object.fromEntries(f.entries()) };
  cfg.redline = Number(cfg.redline) || DEFAULTS.redline;
  $('settings-saved').textContent = saveSettings(cfg) ? 'Saved.' : 'This browser would not save settings.';
  applySettings();
});

// ---- Gauges ----

const fmt = {
  rpm: v => Math.round(v),
  speed_kph: v => Math.round(v),
  coolant_c: v => Math.round(v),
  thr: v => Math.round(v * 100),
  volts: v => v.toFixed(1),
  intake_c: v => Math.round(v),
  load: v => Math.round(v * 100),
  map_kpa: v => Math.round(v)
};

function render(reading) {
  for (const tile of document.querySelectorAll('.tile')) {
    const k = tile.dataset.k;
    if (!(k in reading)) continue;
    const v = reading[k];
    tile.querySelector('.value').textContent = v === null || v === undefined ? '–' : fmt[k](v);
    const bar = tile.querySelector('.meter i');
    let frac = null;
    if (k === 'rpm' && v !== null) frac = v / cfg.redline;
    if (k === 'thr' && v !== null) frac = v;
    if (bar) bar.style.width = frac === null ? '0' : `${Math.min(100, frac * 100)}%`;
    const hot = (k === 'rpm' && v !== null && v >= cfg.redline * 0.95) || (k === 'coolant_c' && v !== null && v >= 105);
    tile.classList.toggle('hot', !!hot);
  }
}

function status(text) {
  $('status').textContent = text;
}

// ---- Connecting and reading ----

async function connect(demo) {
  if (link) return;
  try {
    status(demo ? 'Starting the demo car…' : 'Pick your adapter…');
    const clock = () => now() - t0;
    t0 = now();
    const transport = demo ? demoTransport(clock) : await connectBle();
    const elm = new Elm(transport);
    status(`Talking to ${transport.name}…`);
    await elm.start();
    link = { transport, elm, demo };
    t0 = now();
    status(`Connected: ${transport.name}`);
    $('connect').hidden = true;
    $('controls').hidden = false;
    keepAwake();
    loop();
  } catch (e) {
    link = null;
    status(e && e.name === 'NotFoundError' ? 'No adapter picked' : `Couldn't connect: ${e.message || e}`);
  }
}

async function loop() {
  while (link) {
    const began = now();
    let reading;
    try {
      reading = await link.elm.read();
    } catch (e) {
      status(`Lost the adapter: ${e.message || e}`);
      disconnect();
      return;
    }
    if (!link) return;
    render(reading);
    if (drive) {
      addSample(drive, now() - drive._t0, reading);
      recInfo();
    }
    // At most 10 readings a second, and always give the page a moment to draw.
    await new Promise(r => setTimeout(r, Math.max(0, 100 - (now() - began) * 1000)));
  }
}

function disconnect() {
  if (drive) stopRecording();
  if (link) {
    try {
      link.transport.close();
    } catch {
      /* already gone */
    }
  }
  link = null;
  $('connect').hidden = false;
  $('controls').hidden = true;
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
  status('Not connected');
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* the screen may sleep; nothing else breaks */
  }
}

// ---- Recording ----

function startRecording() {
  drive = newDrive({ car: cfg.car, adapter: link.transport.name });
  drive._t0 = now();
  if (link.demo) {
    // So the demo car exports to its own made-up track.
    drive.demo = true;
  }
  $('btn-rec').textContent = 'Stop recording';
  $('btn-rec').classList.add('on');
  for (const id of ['btn-lap', 'btn-tag', 'btn-invalid']) $(id).disabled = false;
  recInfo();
}

function stopRecording() {
  const d = drive;
  drive = null;
  $('btn-rec').textContent = 'Record';
  $('btn-rec').classList.remove('on');
  for (const id of ['btn-lap', 'btn-tag', 'btn-invalid']) $(id).disabled = true;
  delete d._t0;
  if (d.samples.length) {
    $('rec-info').textContent = saveDrive(d)
      ? `Saved: ${d.samples.length} readings, ${plural(Math.max(0, d.laps.length - 1), 'timed lap')}.`
      : 'This browser would not save the drive. Export it from Drives before closing.';
    lastUnsaved = d;
  }
}
let lastUnsaved = null;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function recInfo() {
  if (!drive) return;
  const secs = Math.round(now() - drive._t0);
  const laps = Math.max(0, drive.laps.length - 1);
  $('rec-info').textContent = `Recording ${secs} s · ${laps} lap${laps === 1 ? '' : 's'} · ${drive.tags.length} tag${drive.tags.length === 1 ? '' : 's'}`;
}

$('btn-ble').addEventListener('click', () => connect(false));
$('btn-demo').addEventListener('click', () => connect(true));
$('btn-stop').addEventListener('click', disconnect);
$('btn-rec').addEventListener('click', () => (drive ? stopRecording() : startRecording()));
$('btn-lap').addEventListener('click', () => drive && markLap(drive, now() - drive._t0) && recInfo());
$('btn-tag').addEventListener('click', () => {
  if (!drive) return;
  markTag(drive, now() - drive._t0);
  recInfo();
});
$('btn-invalid').addEventListener('click', () => drive && markInvalid(drive, now() - drive._t0));

// ---- Drives: list, export, replay ----

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(d) {
  return d.started.replace(/[:.]/g, '-').slice(0, 19);
}

function trackFor(d) {
  if (d.demo) return DEMO_TRACK;
  const length_m = Number(cfg.trackLength);
  if (!cfg.trackId || !(length_m > 0)) return null;
  return { id: cfg.trackId, name: cfg.trackName || cfg.trackId, length_m };
}

function exportSession(d, li) {
  const track = trackFor(d);
  const msg = li.querySelector('.msg');
  if (!track) {
    msg.textContent = 'Set the track id and lap length in Settings first.';
    return;
  }
  const { session, dropped } = buildSession(d, {
    track,
    car: { id: d.demo ? 'demo-car' : d.car, setup: {} },
    conditions: { weather: cfg.weather || 'not recorded' },
    app: `${APP.name}@${APP.version}`
  });
  const v = validateSession(session);
  if (!v.ok) {
    msg.textContent = `Not exported: ${v.errors[0]}`;
    return;
  }
  download(`${slug(track.id)}-${stamp(d)}.pitwall.json`, JSON.stringify(session, null, 1) + '\n', 'application/json');
  msg.textContent = dropped ? `${dropped} tag${dropped === 1 ? ' was' : 's were'} outside a timed lap and left out.` : '';
}

function listDrives() {
  const ul = $('drive-list');
  ul.replaceChildren();
  const all = drives();
  if (lastUnsaved && !all.some(d => d.started === lastUnsaved.started)) all.unshift(lastUnsaved);
  if (!all.length) {
    const li = document.createElement('li');
    li.textContent = 'No drives yet. Connect, press Record, and drive.';
    ul.append(li);
    return;
  }
  for (const d of all) {
    const li = document.createElement('li');
    const what = document.createElement('span');
    what.className = 'what';
    const when = new Date(d.started).toLocaleString();
    const laps = Math.max(0, d.laps.length - 1);
    what.textContent = `${when} · ${d.demo ? 'demo car (made up)' : d.car} · ${d.samples.length} readings · ${laps} timed lap${laps === 1 ? '' : 's'}`;
    const msg = document.createElement('span');
    msg.className = 'note msg';
    const btn = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    li.append(
      what,
      btn('Replay', () => startReplay(d)),
      btn('CSV', () => download(`open-gauge-${stamp(d)}.csv`, toCsv(d), 'text/csv')),
      btn('Pitwall session', () => exportSession(d, li)),
      btn('Delete', () => {
        if (!confirm('Delete this drive from this browser?')) return;
        deleteDrive(d.started);
        if (lastUnsaved && lastUnsaved.started === d.started) lastUnsaved = null;
        listDrives();
      }),
      msg
    );
    ul.append(li);
  }
}

function startReplay(d) {
  if (link) disconnect();
  stopReplay();
  show('gauges');
  $('connect').hidden = true;
  $('replay-controls').hidden = false;
  const origin = d.samples[0] ? d.samples[0].t : 0;
  replay = { d, i: 0, speed: 1, started: now(), from: origin, origin };
  $('btn-replay-speed').textContent = 'Speed 1×';
  status('Replaying a saved drive');
  tickReplay();
}

function tickReplay() {
  if (!replay) return;
  const r = replay;
  const at = r.from + (now() - r.started) * r.speed;
  while (r.i < r.d.samples.length && r.d.samples[r.i].t <= at) r.i++;
  const s = r.d.samples[Math.max(0, r.i - 1)];
  if (s) render(s);
  const end = r.d.samples.length ? r.d.samples[r.d.samples.length - 1].t : 0;
  $('replay-info').textContent = `${Math.round(at - r.origin)} / ${Math.round(end - r.origin)} s`;
  if (r.i >= r.d.samples.length) {
    stopReplay();
    status('Replay finished');
    return;
  }
  r.timer = setTimeout(tickReplay, 100);
}

function stopReplay() {
  if (replay) clearTimeout(replay.timer);
  replay = null;
  $('replay-controls').hidden = true;
  $('connect').hidden = !!link;
}

$('btn-replay-stop').addEventListener('click', () => {
  stopReplay();
  status('Not connected');
});
$('btn-replay-speed').addEventListener('click', () => {
  if (!replay) return;
  const at = replay.from + (now() - replay.started) * replay.speed;
  replay.speed = replay.speed === 1 ? 4 : replay.speed === 4 ? 16 : 1;
  replay.from = at;
  replay.started = now();
  $('btn-replay-speed').textContent = `Speed ${replay.speed}×`;
});

// ---- Start ----

if (!bleAvailable()) {
  $('btn-ble').disabled = true;
  $('ble-note').hidden = false;
}
applySettings();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
