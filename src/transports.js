// Ways to reach an ELM327: a Bluetooth LE adapter through Web Bluetooth, or the made-up demo car.

// Service ids BLE ELM327 clones commonly use. Web Bluetooth only lets a page open services it
// named up front, so these are listed; the right characteristics are then found by what they can do.
export const BLE_SERVICES = [
  0xfff0,
  0xffe0,
  0x18f0,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
];

export function bleAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

/** Ask the browser for an adapter and return a transport for Elm. */
export async function connectBle() {
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_SERVICES
  });
  const server = await device.gatt.connect();
  let notify = null;
  let write = null;
  for (const id of BLE_SERVICES) {
    let svc;
    try {
      svc = await server.getPrimaryService(id);
    } catch {
      continue;
    }
    for (const ch of await svc.getCharacteristics()) {
      if (!notify && (ch.properties.notify || ch.properties.indicate)) notify = ch;
      if (!write && (ch.properties.write || ch.properties.writeWithoutResponse)) write = ch;
    }
    if (notify && write) break;
  }
  if (!notify || !write) {
    device.gatt.disconnect();
    throw new Error('That adapter has no serial service Open Gauge knows. Is it a BLE ELM327?');
  }
  const listeners = [];
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  notify.addEventListener('characteristicvaluechanged', e => {
    const text = dec.decode(e.target.value);
    for (const fn of listeners) fn(text);
  });
  await notify.startNotifications();
  return {
    name: device.name || 'ELM327',
    async write(text) {
      const bytes = enc.encode(text);
      for (let i = 0; i < bytes.length; i += 20) {
        const part = bytes.slice(i, i + 20);
        if (write.properties.writeWithoutResponse) await write.writeValueWithoutResponse(part);
        else await write.writeValue(part);
      }
    },
    onData(fn) {
      listeners.push(fn);
    },
    close() {
      device.gatt.disconnect();
    }
  };
}

// ---- The demo car: made-up numbers so Open Gauge can be tried without a car ----

export const DEMO_TRACK = { id: 'og-demo-ring', name: 'Open Gauge demo ring (made up)', length_m: 2000 };

/** Where the made-up car is `t` seconds into its drive. Pure, so tests and the app agree. */
export function demoState(t) {
  const L = DEMO_TRACK.length_m;
  // Speed rises and falls three times a lap; distance is integrated in small steps.
  const v = s => 22 + 11 * Math.sin((2 * Math.PI * 3 * s) / L);
  let s = 0;
  const dt = 0.05;
  for (let x = 0; x < t; x += dt) s += v(s) * Math.min(dt, t - x);
  const vNow = v(s);
  const ahead = v(s + vNow * 0.5);
  const thr = Math.max(0, Math.min(1, 0.35 + (ahead - vNow) / 6));
  return {
    s,
    lap: Math.floor(s / L),
    speed_kph: Math.round(vNow * 3.6),
    rpm: Math.round(1800 + vNow * 3.6 * 30),
    thr: Math.round(thr * 255) / 255,
    coolant_c: Math.round(70 + Math.min(20, t / 30)),
    intake_c: 18,
    load: Math.round(thr * 0.8 * 255) / 255,
    map_kpa: Math.round(30 + thr * 70),
    volts: 14.1
  };
}

const hex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase().padStart(2, '0');

/** A transport that answers like an ELM327 in a car, from demoState. `clock` gives seconds. */
export function demoTransport(clock) {
  const listeners = [];
  const reply = cmd => {
    const st = demoState(clock());
    if (cmd.startsWith('AT')) return cmd === 'ATRV' ? `${st.volts.toFixed(1)}V` : cmd === 'ATZ' ? 'ELM327 v1.5' : 'OK';
    const pid = cmd.slice(2);
    const r = { '00': 'BE3EB811', '20': '80000001', '40': '00000000' }[pid];
    if (r) return '41' + pid + r;
    const b = {
      '0C': [Math.floor((st.rpm * 4) / 256), (st.rpm * 4) % 256],
      '0D': [st.speed_kph],
      '05': [st.coolant_c + 40],
      '11': [st.thr * 255],
      '0F': [st.intake_c + 40],
      '04': [st.load * 255],
      '0B': [st.map_kpa]
    }[pid];
    return b ? '41' + pid + b.map(hex).join('') : 'NO DATA';
  };
  return {
    name: 'Demo car (made up)',
    async write(text) {
      const cmd = text.trim().toUpperCase();
      queueMicrotask(() => {
        for (const fn of listeners) fn(reply(cmd) + '\r\r>');
      });
    },
    onData(fn) {
      listeners.push(fn);
    },
    close() {}
  };
}
