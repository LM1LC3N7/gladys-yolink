// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { REFRESH_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  refresh_interval: REFRESH_INTERVAL.default,
  // Live events over YoLink's MQTT (unencrypted): on by default, Louis's decision, 2026-10-17.
  live_events: true,
  // The risky commands are off until the user turns them on.
  allow_unlock: false,
  allow_garage_open: false,
  allow_valve_open: false,
  // Closing a valve is off too: Louis's decision, 2026-10-17.
  allow_valve_close: false,
  // Stopping a siren stays possible by default: Louis's decision, 2026-10-17.
  allow_siren_stop: true,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A checkbox may arrive as a boolean or as a string from a form; absent = its default. */
const flag = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value === true || value === 'true' || value === 1 || value === '1';
};

export function normalizeConfig(raw = {}) {
  const given = raw?.refresh_interval;
  const interval = given === undefined || given === null || given === '' ? NaN : Number(given);
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  return {
    uaid: String(raw?.uaid ?? '').trim(),
    secretKey: String(raw?.secret_key ?? '').trim(),
    refreshInterval: Number.isFinite(interval)
      ? Math.round(Math.max(REFRESH_INTERVAL.min, Math.min(REFRESH_INTERVAL.max, interval)))
      : DEFAULTS.refresh_interval,
    liveEvents: flag(raw?.live_events, DEFAULTS.live_events),
    allowUnlock: flag(raw?.allow_unlock, DEFAULTS.allow_unlock),
    allowGarageOpen: flag(raw?.allow_garage_open, DEFAULTS.allow_garage_open),
    allowValveOpen: flag(raw?.allow_valve_open, DEFAULTS.allow_valve_open),
    allowValveClose: flag(raw?.allow_valve_close, DEFAULTS.allow_valve_close),
    allowSirenStop: flag(raw?.allow_siren_stop, DEFAULTS.allow_siren_stop),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
