// Talks to an ELM327 adapter over any transport that can write text and report text it receives.
// A command is sent with a carriage return; the reply ends at the ">" prompt.

import { FAST, PIDS, SLOW, SLOW_EVERY, decode, supported, volts } from './pids.js';

export const INIT = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0'];
const TIMEOUT_MS = 3000;

export class Elm {
  /** transport: { write(text): Promise, onData(fn(text)) } */
  constructor(transport, { timeoutMs = TIMEOUT_MS } = {}) {
    this.t = transport;
    this.timeoutMs = timeoutMs;
    this.buf = '';
    this.waiting = null;
    this.queue = Promise.resolve();
    this.cycle = 0;
    this.have = null; // PIDs the car supports, once known
    transport.onData(text => this._data(text));
  }

  _data(text) {
    this.buf += text;
    const at = this.buf.indexOf('>');
    if (at < 0 || !this.waiting) return;
    const reply = this.buf.slice(0, at);
    this.buf = this.buf.slice(at + 1);
    const w = this.waiting;
    this.waiting = null;
    clearTimeout(w.timer);
    w.resolve(clean(reply));
  }

  /** Send one command and resolve with its reply. Commands go one at a time. */
  send(cmd) {
    const run = () =>
      new Promise((resolve, reject) => {
        this.buf = '';
        const timer = setTimeout(() => {
          this.waiting = null;
          reject(new Error(`No reply to ${cmd}`));
        }, this.timeoutMs);
        this.waiting = { resolve, timer };
        this.t.write(cmd + '\r').catch(e => {
          clearTimeout(timer);
          this.waiting = null;
          reject(e);
        });
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Reset the adapter and find out which PIDs the car answers. */
  async start() {
    for (const c of INIT) await this.send(c);
    const replies = {};
    for (const base of ['00', '20', '40']) {
      try {
        replies[base] = await this.send('01' + base);
      } catch {
        break;
      }
    }
    const s = supported(replies);
    this.have = s.size ? s : null; // an adapter that won't say: try everything
    return this.have;
  }

  /** One reading: the fast PIDs every time, the slow ones every SLOW_EVERY calls. Missing = null. */
  async read() {
    const names = this.cycle % SLOW_EVERY === 0 ? [...FAST, ...SLOW] : FAST;
    this.cycle++;
    const out = {};
    for (const name of names) {
      const pid = PIDS[name].pid;
      if (this.have && !this.have.has(pid)) {
        out[name] = null;
        continue;
      }
      try {
        out[name] = decode(name, await this.send('01' + pid));
      } catch {
        out[name] = null;
      }
    }
    if (names.length > FAST.length) {
      try {
        out.volts = volts(await this.send('ATRV'));
      } catch {
        out.volts = null;
      }
    }
    return out;
  }
}

/** A reply without echo, prompts, "SEARCHING..." and blank lines. */
export function clean(text) {
  return String(text)
    .split(/[\r\n]+/)
    .map(l => l.trim())
    .filter(l => l && !/^SEARCHING/i.test(l))
    .join('\n');
}
