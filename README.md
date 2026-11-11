# Open Gauge

Live engine gauges on an old Android phone or tablet. Plug a Bluetooth LE ELM327 adapter into the car's OBD-II port, open Open Gauge in Chrome, and connect. There's nothing to install and no account, and it works with no signal once it has loaded.

**Your drives stay on your device.** Open Gauge has no server. Drives are kept in the browser on your phone and only leave it when you export a file yourself. Every sample drive, screenshot and test file in this repo comes from the made-up demo car, never from a real car, and that is the rule for anything added here.

**Read-only.** Open Gauge only reads from the car. It never writes to the engine computer or any other module. Set it up before you drive and don't touch it while moving. Record laps on a closed track, not a public road.

## What it does

- **Gauges:** RPM (with your redline), speed, coolant, throttle, battery voltage, intake air, engine load and manifold pressure. It asks the car which of these it supports and leaves the rest blank.
- **Themes:** Night, Day, and Mirror. Mirror is wide, high contrast, and shows only RPM, speed, coolant and battery, for an Android rear-view mirror screen.
- **Log:** press Record to save a drive. The last 10 drives stay in this browser; export the ones you want to keep.
- **Replay:** play a saved drive back through the gauges at 1×, 4× or 16×.
- **Laps and tags:** while recording, press **Lap** each time you cross the start line, **Tag** when something feels off, and **Lap didn't count** after an off or a cut.
- **Export:** CSV of every reading, or a **Pitwall session** (`pitwall-session/1` JSON) for Pitwall's memory and debrief.
- **Demo car:** try everything without a car. Every number from it is made up.

## What you need

- An Android phone or tablet with Chrome. Web Bluetooth isn't in Safari, so iPhone and iPad can only use the demo car.
- A **Bluetooth LE** ELM327 adapter. Classic-Bluetooth-only adapters can't be reached from a web page. Open Gauge looks for the serial service most BLE clones use (FFF0, FFE0 and a few others) and uses whatever characteristics on it can notify and write.
- The page served over HTTPS (or `localhost`), which Web Bluetooth requires.

## Pitwall sessions

Before exporting, set the track id, name and lap length in Settings. Each timed lap (between two Lap presses) is cut into equal pieces of distance, about one per 10 m. Distance comes from adding up the car's own speed over the lap, so a speedometer that reads a little off still puts each piece in the same place every lap. Each piece holds the lap time, speed and throttle of the first reading inside it.

Steering, brake pressure, slip angle and g-forces aren't on the standard OBD-II list, so they are written as `null`, never guessed. Weather and air temperature are "not recorded" unless you set them; intake air temperature is not used as air temperature because engine heat skews it. Tags become `"source": "tag"` notes, which Pitwall's debrief asks you about afterwards.

The validator in `src/session.js` is the same as Patent Garage's, so a file one accepts, the other accepts too.

## Run it

```
npm run serve        # then open http://localhost:8000
npm test             # node --test, no dependencies
node tools/export-demo-session.js > demo.json   # a made-up session from the demo car
```

## Not yet

- Automatic laps from GPS (for now you press Lap at the line).
- g-forces from the phone's motion sensor. It depends on how the phone is mounted, so it needs a calibration step first.
- A test on a real car. The protocol code is tested against recorded-style replies and the demo car. A real-car test happens on the driver's own phone, and its data stays there.
