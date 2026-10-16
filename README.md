# gladys-yolink

[Gladys Assistant](https://gladysassistant.com) external integration for
**YoLink** (YoSmart), through the official **YoLink Open API v2**: door,
motion, water leak, temperature and humidity, and vibration sensors, plugs,
switches and power strips, water valves, locks, sirens and garage doors, with
live events over MQTT. Unlocking, opening a garage door and opening or
closing a water valve are off until the user allows them. Unofficial, not
affiliated with YoSmart.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (milestone 1).** Tested with simulated answers only, not
> yet with real YoLink devices.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (YoLinkApp) ⇄ src/client.js ⇄ src/yolink.js ⇄ api.yosmart.com / api-eu.yosmart.com
                                   ├─ src/live.js       MQTT (MQTT.js) yl-home/<home>/+/report, US and EU brokers
                                   ├─ src/inventory.js  device lists and readings (pure)
                                   ├─ src/devices.js    -> Gladys devices and states (pure)
                                   └─ src/publisher.js  300 states/min, moments queued
```

- **Account**: a User Access Credential (UAID + secret key, `secret` field)
  made in the YoLink app. `POST https://api.yosmart.com/open/yolink/token`
  (`client_credentials`) gives a 2-hour access token, renewed 5 minutes before
  it expires with the refresh token (the credentials again if that fails), and
  once when the API answers a token error (000103, 010103, 010104). Refused
  credentials are never retried by themselves. Nothing is written to `/data`.
- **Reading**: `Home.getGeneralInfo` (home id), `Home.getDeviceList` on the US
  cloud and, when the home has EU devices, on the EU cloud (their tokens), then
  `<type>.fetchState` per device (`getState` when unsupported), at start and
  every 30 minutes (10 to 1440). Errors back off 1, 2, 5, 10 then 15 minutes;
  "limits reached" (010301) pauses 15 minutes; a device that does not answer
  (000201…) is marked offline and the refresh goes on.
- **Live events**: one MQTT connection per cloud in use (TCP 8003, the access
  token as user name, no password, a random client id), `reconnectPeriod: 0`
  and our own reconnection (30 s up to 5 min, at most 8 new connections per 5
  minutes: YoLink allows 10). The events yolink-api keeps (`*.Report`,
  `*.Alert`, `*.StatusChange`, `*.getState`, `*.setState`, `*.DevEvent`,
  `THSensor.DataRecord`). YoLink's MQTT has no TLS: the access token travels in
  clear, so the `live_events` option (on by default, pending a decision) turns
  it off, leaving the HTTPS reads only. Refused credentials while reconnecting
  stop everything, like a refused refresh.
- **Devices**: `ext:<selector>:yolink:<deviceId>`; the garage controller takes
  its state from the door sensor paired with it (`parentDeviceId`). YS6801
  channel 0 is the USB ports.
- **Commands**: `<type>.setState` (plugs, switches, sockets with `chs`, valves,
  locks, sirens) and `<type>.toggle` (garage doors), behind the safety options
  (`allow_unlock`, `allow_garage_open`, `allow_valve_open`, `allow_valve_close`,
  `allow_siren_stop`). A garage toggle reads the sensor again first (refused
  when offline or unknown), and a second toggle within 60 s is ignored unless
  the sensor reported a change.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/yolink.js` holds device lists and states shaped like the
documentation (made-up values); `test/helpers/fakeYoLink.js` serves them
behind the transport (token endpoint, US and EU APIs) and fakes the MQTT
brokers.

## Credits

- [YoSmart-Inc/yolink-api](https://github.com/YoSmart-Inc/yolink-api) (MIT),
  YoSmart's official Python library (the one of Home Assistant): endpoints,
  the US/EU split and the EU tokens, device types, accepted MQTT events, paired
  devices, battery levels. Read as the reference and ported to JavaScript (no
  Python runs here).
- The [YoLink Open API documentation](https://doc.yosmart.com) (Open API V2,
  error codes, device methods).
- [MQTT.js](https://github.com/mqttjs/MQTT.js) (MIT), the MQTT client, a runtime
  dependency.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store
(added at the first real release).

## License

Apache-2.0. YoLink is a trademark of YoSmart; this project is not affiliated
with YoSmart.
