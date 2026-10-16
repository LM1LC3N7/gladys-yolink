// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { REFRESH_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  refresh_interval: REFRESH_INTERVAL.default,
  // The risky commands are off until the user turns them on.
  allow_unlock: false,
  allow_garage_open: false,
  allow_valve_open: false,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A checkbox may arrive as a boolean or as a string from a form. */
const yes = (value) => value === true || value === 'true' || value === 1 || value === '1';

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
    allowUnlock: yes(raw?.allow_unlock),
    allowGarageOpen: yes(raw?.allow_garage_open),
    allowValveOpen: yes(raw?.allow_valve_open),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
