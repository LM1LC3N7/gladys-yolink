# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
and [MQTT.js](https://github.com/mqttjs/MQTT.js) (the YoLink live events), its
only runtime dependencies. It started from the official JavaScript template;
the YoLink protocol follows the official library YoSmart-Inc/yolink-api (MIT).

## Commands

```bash
npm install
npm test                                  # node --test --test-timeout=60000
node --test test/app.test.js              # one file
node --test --test-name-pattern "lock"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers the handlers)
src/app.js                        YoLinkApp: refresh, live events, states, commands, badges
src/client.js                     UAC token (refresh) and the Open API v2 calls
src/yolink.js                     HTTPS transport, BUDP codes -> YoLinkError (the only HTTP access)
src/live.js                       MQTT connections per cloud (the only MQTT access)
src/inventory.js                  device lists and readings (pure)
src/devices.js                    Gladys devices and states (pure)
src/publisher.js                  300 states/min, moments queued
src/shutoff.js                    ShutoffKeeper: valve shutoffs kept and sent again until seen closed
src/store.js                      /data: the shutoffs kept
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, SDK fake Gladys + fake YoLink (test/helpers)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Valves.** Closing a valve shuts the water off: never refused, behind no
  option (Louis's decision, 2026-11-25), kept and sent again until YoLink
  shows it closed, 24 h at most (src/shutoff.js). Opening stays behind
  `allow_valve_open` (off). The water commands are buttons (`water_close`,
  `water_open`), never a switch; the `valve` switch of 0.1.0-0.1.2 stays
  understood, not offered. Keep the tests that prove it.
- **SDK v0.16.** Features follow the core model: every feature has a numeric
  `min` and `max` (0/0 for text), a non-empty name, `read_only` and
  `has_feedback`, or Gladys answers HTTP 422; the SDK's fake Gladys (0.16.1)
  checks part of it, `test/helpers/coreFeature.js` checks all. The devices
  carry no `poll_frequency` (Gladys 5.3 polls only those): keep it so.
- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
