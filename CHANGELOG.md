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
- Garage doors: the sensor is read again just before a toggle (refused when
  offline or without a state), and a second toggle within a minute is ignored
  until the sensor reports a change.
- Live events over MQTT on the US and EU clouds, with an option to turn them
  off (YoLink's MQTT is not encrypted), and a full refresh every 30 minutes
  (10 to 1440); pauses after errors and when YoLink reports its limits
  reached (the Discovery scan and the test button wait too); badges for
  offline devices and paused live events.
- A clear message when a LeakStop in power-saving mode does not answer; the
  FlowSmart Meter, which has no valve, is skipped.
- "Test the connection" button with a summary of the account.
- Feature names in French or English.

[Unreleased]: https://github.com/LM1LC3N7/gladys-yolink/commits/main
