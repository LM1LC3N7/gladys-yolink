# TODO — YoLink v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, `npx github:GladysAssistant/integration-store .`, then
  update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own, no forum post from a module session.

## Status

- [x] **Milestone 1 — core** (2026-10-16): UAC token (client credentials,
      refresh token, renewal 5 min before expiry and once on a token error,
      refused credentials never retried by themselves); home id, US and EU
      device lists (EU tokens), `fetchState` per device (`getState`
      fallback), full refresh every 30 min (10–1440), backoff and 15-min
      pause on 010301; live MQTT events on each cloud in use with our own
      reconnection and connection budget; door, motion, leak, T&H,
      vibration sensors, plugs/switches (+ power on YS6602/YS6803), power
      strip sockets, valves (Manipulator, WaterMeterController,
      WaterLeakController), Lock/LockV2, sirens, garage doors
      (GarageDoor/Finger, state from the paired sensor); safety options;
      badges; "Test the connection"; en/fr; docs en/fr; cover. Tested against
      made-up answers only.
- [x] **Review fixes** (2026-10-16): garage guard and sensor re-read,
      `allow_valve_close`, `allow_siren_stop`, `live_events`, refused
      credentials from the MQTT side, YS6801 channel names, token answers,
      scan/test during a rate-limit pause, YS5007, LeakStop message.
- [ ] **Milestone 2 — real account**: run against a real home and compare
      with the app (see "To check"); turn the answers (anonymized) into
      fixtures.
- [ ] **Milestone 3 — more**: CO/smoke alarms, power failure alarm, water
      depth sensor, thermostat, dimmer, smart remotes as scene triggers,
      device temperature of the sensors, siren volume, energy of the plugs,
      offline detection from the keepalive times (yolink-api `keepalive_time`).
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## To check on a real account

- `fetchState` answers: is `data.state` the nested reading for every type
  (as yolink-api reads it), and `data.online` present? Which types refuse
  fetchState (the Siren is assumed to, then read with `getState`)?
- `Lock.setState` params `{ "state": "lock" | "unlock" }`: taken from the Home
  Assistant integration, not on the Lock page of the documentation.
- The power strip: number of entries of `state` on YS6801 (4 sockets + USB?)
  and their order; names of the sockets.
- The garage door: is it the door sensor that carries `parentDeviceId` (what
  yolink-api implies), or the controller? Both are handled.
- MQTT: does the broker drop the connection when the access token expires
  (2 h)? Then the reconnection uses the new token; otherwise nothing to do.
  Does a second connection with the same UAC on the EU broker count in the
  same budget?
- Do the EU devices accept the token of the US token endpoint on
  `api-eu.yosmart.com` (yolink-api does it)?
- The battery level of the siren and the valves (0–4 like the sensors?).
- HTTP rate limits: none documented besides 010301; watch for it.

## Decisions

- **Not a duplicate** (checked 2026-10-16): no YoLink service in the Gladys
  core (`server/services`), GitHub search "gladys yolink" finds only this
  repository (created 2026-10-16). YoLink devices are LoRa behind their hub,
  not Matter/Zigbee.
- **Reference reused: YoSmart-Inc/yolink-api** (MIT, the official Python
  library, maintained, the one of Home Assistant). It cannot run in a Node
  container: its protocol logic (endpoints, EU tokens, accepted events,
  paired devices, fetchState, battery 0–4) is ported, and credited in the
  README. No maintained JavaScript client of the Open API v2 exists on npm.
- **MQTT.js** (MIT, the client the Gladys core uses) as the second runtime
  dependency, rather than our own MQTT code; its auto-reconnection is off
  because every connection needs the current access token and YoLink limits
  new connections (10 per 5 min per UAC): 30 s (as yolink-api) to 5 min, 8
  connections per 5 minutes at most. `npm audit --omit=dev`: 0.
- **No TLS on MQTT**: YoLink documents TCP 8003 and WebSocket 8004 only, and
  a TLS handshake fails on both (probe 2026-10-16, US and EU hosts; 8883
  closed). The brief asked for TLS: not possible. The access token (2 h) goes
  over it in clear, never the secret key; whoever reads it can command every
  device (unlocking included) for about 2 h: written in the docs (Privacy).
  The HTTP API and the token endpoint are HTTPS.
- **`live_events` option, on by default — PROVISIONAL, pending Louis's
  decision** (review 2026-10-16): off, no MQTT at all, HTTPS reads only at
  each full refresh.
- **Token in memory only**: a restart asks for a new one (one request), so no
  secret is written to `/data`.
- **Full refresh every 30 min** (Home Assistant's pace), one `fetchState` per
  device half a second apart; the live events carry the changes.
- **Safety options**: `allow_unlock` off (locking always allowed),
  `allow_garage_open` off (closing a door its sensor reports open is
  allowed), `allow_valve_open` off.
- **`allow_valve_close`, off by default — PROVISIONAL, pending Louis's
  decision** (review 2026-10-16): the PIPELINE rule puts valve "coupure"
  behind an option; the anti-leak scene then needs the user to turn it on.
- **`allow_siren_stop`, on by default — PROVISIONAL, pending Louis's
  decision**: a YoLink siren is not an armed alarm system, and stopping one
  triggered by mistake should stay possible; off, the siren stops after its
  own alarm duration.
- **Garage doors** (review B1): the YoLink controller only toggles. Just
  before a toggle the paired sensor is read again (`fetchState`); no sensor,
  sensor offline or without a state -> refused, whatever the options. After a
  toggle, the next ones are ignored (ack success, logged) for 60 s or until
  the sensor reports a change.
- **LeakStop** (YS5009/YS5029): a "device did not answer" on a valve command
  gets a message about the power-saving class A mode. The FlowSmart Meter
  (YS5007) has no valve and is skipped.
- **YS6801 channels**: channel 0 = USB ports, 1–4 = sockets 1–4; other strips
  channel i = socket i + 1. External ids `socket-<channel>` unchanged.
- **Token answers**: a 200 without access token goes through the BUDP codes;
  only 000106, 010101, 010102, 010103, OAuth errors and HTTP 400/401/403 are
  "refused" (never retried by themselves); 010000 or 010301 are not.
- **Version 0.1.0 set by hand** in `package.json` and the manifest (with the
  `docker_image` tag): the one-time exception to "versions belong to the
  Release workflow", the template's 1.0.0 and image name had to be replaced
  for this repository; every later version comes from the Release workflow.
- **Gladys features**: opening-sensor (OPENING_SENSOR_STATE: 1 closed, 0
  open), motion/leak/vibration binary, temperature °C and humidity % decimal,
  battery % (level × 25), switch binary for plugs, sockets, valves (1 open)
  and the garage door (1 open; the core has no garage category and the
  water-valve category has no binary type), lock binary (LOCK.STATE: 1
  locked), siren binary. Alerts and door moves from `Alert`/`StatusChange`
  events are published with `publishStates` (each one counts), the rest with
  `publishChangedStates` and a 30-min heartbeat.
- **Rate limit**: after 010301 the Discovery scan and the test button wait
  for the end of the pause too.
- **Commands wait for the device** on locks, valves and garage doors (the
  state shown is the one the device reports); plugs, sockets and sirens show
  the answer of `setState` at once.
- **Badges**: `cloud`; `cloud` + degraded while the live events are down;
  `unreachable` + degraded for a device YoLink reports offline or that does
  not answer; `unreachable` when YoLink itself is.
- **Not supported yet** (logged once, counted by the test button): hubs,
  remotes, thermostats, dimmers, sprinklers, CO/smoke and power-failure
  alarms, water depth and soil sensors, multi-caps leak sensors.
