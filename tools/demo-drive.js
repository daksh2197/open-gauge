// Record a drive from the made-up demo car, through the same ELM327 code a real adapter uses.
// Used by the tests and by tools/export-demo-session.js.

import { Elm } from '../src/elm.js';
import { addSample, markInvalid, markLap, markTag, newDrive } from '../src/drive.js';
import { DEMO_TRACK, demoState, demoTransport } from '../src/transports.js';

export async function demoDrive({ laps = 3, hz = 5, started = '2026-11-10T18:00:00.000Z' } = {}) {
  let now = 0;
  const elm = new Elm(demoTransport(() => now));
  await elm.start();
  const drive = newDrive({ started, car: 'demo-car', adapter: 'Demo car (made up)' });
  let lap = 0;
  // Drive a little before the line (the out lap), then `laps` timed laps, then a little after.
  const end = 20 + laps * 110;
  for (now = 0; now <= end; now += 1 / hz) {
    const st = demoState(now);
    // The demo driver presses Lap at the line: the first time the car passes 200 m, then each lap.
    const along = st.s - 200;
    if (along >= 0 && Math.floor(along / DEMO_TRACK.length_m) + 1 > lap && lap <= laps) {
      lap++;
      markLap(drive, now);
    }
    addSample(drive, now, await elm.read());
  }
  const [l1, l2] = drive.laps.slice(1);
  if (l1 !== undefined) markTag(drive, l1 + 20); // something felt off 20 s into lap 2
  if (l2 !== undefined) markInvalid(drive, l2 + 30); // lap 3 ran wide
  return drive;
}
