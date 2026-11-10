// Saved drives and settings, kept in this browser only. Nothing leaves the device unless you export it.

const DRIVES = 'og.drives';
const SETTINGS = 'og.settings';
export const KEEP = 10;

export const DEFAULTS = {
  theme: 'night',
  redline: 7000,
  car: 'My car',
  trackId: '',
  trackName: '',
  trackLength: '',
  weather: 'not recorded'
};

function get(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function set(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // full or blocked: the drive is still on screen to export
  }
}

export const settings = () => ({ ...DEFAULTS, ...get(SETTINGS, {}) });
export const saveSettings = s => set(SETTINGS, s);
export const drives = () => get(DRIVES, []);

/** Keep a drive, newest first, and only the last KEEP. Returns false if the browser refused. */
export function saveDrive(drive) {
  const all = [drive, ...drives().filter(d => d.started !== drive.started)].slice(0, KEEP);
  return set(DRIVES, all);
}

export function deleteDrive(started) {
  return set(DRIVES, drives().filter(d => d.started !== started));
}
