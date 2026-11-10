// Write the demo drive as pitwall-session/1 JSON on stdout. Everything in it is made up.
// node tools/export-demo-session.js > demo.json

import { buildSession, validateSession } from '../src/session.js';
import { DEMO_TRACK } from '../src/transports.js';
import { demoDrive } from './demo-drive.js';
import { APP } from '../src/app-info.js';

const drive = await demoDrive();
const { session } = buildSession(drive, {
  track: DEMO_TRACK,
  car: { id: 'demo-car', setup: {} },
  app: `${APP.name}@${APP.version}`
});
const v = validateSession(session);
if (!v.ok) {
  console.error(v.errors.join('\n'));
  process.exit(1);
}
process.stdout.write(JSON.stringify(session, null, 1) + '\n');
