# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- YoLink account through a User Access Credential (UAID and secret key) of the
  official Open API v2: access token renewed before it expires, refused
  credentials reported without retrying.
- Door, motion, water leak, temperature and humidity, and vibration sensors,
  with their batteries.
- Plugs and switches (with the power of the Energy plugs), each socket of the
  power strips (the USB ports first on the YS6801), water valves, Lock M1 and
  M2 locks, sirens and garage doors (state from their paired door sensor),
  settable from Gladys.
- Unlocking, opening a garage door, opening a water valve and closing one are
  off by default, each behind its own option; stopping a siren has its own
  option too (on by default).
- Garage doors as a cover command (`shutter`/`state`: open 1, close -1; stop
  refused, the YoLink controller only toggles), never a switch, so a "turn
  everything on/off" cannot reach a door. External id unchanged
  (`…:yolink:<deviceId>:garage`), but its category and type changed from
  `switch`/`binary` during development: not released, no migration.
- Garage doors: one command at a time per door, the sensor read again just
  before a toggle (refused when that read fails, or the sensor is offline or
  without a state), refused before sending when not ready 3.5 s after it
  arrived (Gladys waits 5 s for the answer), and any new command within a
  minute of a toggle refused ("command ignored") until the sensor reports a
  state other than the one of departure (an unknown state never ends it). The
  deadline is checked again before the read and before any send or resend
  after a token renewal. The option and the docs say that a wrong sensor
  makes a "close" open the door, even with opening off.
- Live events over MQTT on the US and EU clouds, on by default, with an option
  to turn them off. YoLink's MQTT is not encrypted: the access token, the
  device ids and every device event travel in clear between Gladys and
  YoLink's broker; the docs, the README and the option say so, and how to turn
  it off. A full refresh every 30 minutes
  (10 to 1440); pauses after errors and when YoLink reports its limits
  reached (the Discovery scan and the test button wait too); badges for
  offline devices and paused live events.
- A clear message when a LeakStop in power-saving mode does not answer; the
  FlowSmart Meter, which has no valve, is skipped.
- "Test the connection" button with a summary of the account.
- Feature names in French or English.
- `LICENSE` (Apache-2.0) and `THIRD_PARTY_NOTICES.md` (yolink-api, MIT),
  copied into the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-yolink/commits/main
