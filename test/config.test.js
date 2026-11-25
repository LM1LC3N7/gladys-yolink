import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig } from '../src/config.js';

test('defaults: no credentials, every risky command off', () => {
  assert.deepEqual(normalizeConfig(), {
    uaid: '',
    secretKey: '',
    refreshInterval: DEFAULTS.refresh_interval,
    liveEvents: true,
    allowUnlock: false,
    allowGarageOpen: false,
    allowValveOpen: false,
    allowSirenStop: true,
    language: 'fr',
  });
});

test('an unchecked box is false, an absent one is its default', () => {
  const config = normalizeConfig({ live_events: false, allow_siren_stop: 'false' });
  assert.equal(config.liveEvents, false);
  assert.equal(config.allowSirenStop, false);
  // Closing a valve is behind no option (2026-11-25): an old key is ignored.
  assert.equal('allowValveClose' in normalizeConfig({ allow_valve_close: false }), false);
});

test('values are trimmed, bounded and typed', () => {
  const config = normalizeConfig({
    uaid: ' ua_1 ',
    secret_key: ' sec ',
    refresh_interval: '5',
    allow_unlock: 'true',
    allow_garage_open: true,
    allow_valve_open: 'false',
    language: 'EN',
  });
  assert.equal(config.uaid, 'ua_1');
  assert.equal(config.secretKey, 'sec');
  assert.equal(config.refreshInterval, 10);
  assert.equal(config.allowUnlock, true);
  assert.equal(config.allowGarageOpen, true);
  assert.equal(config.allowValveOpen, false);
  assert.equal(config.language, 'en');
  assert.equal(normalizeConfig({ refresh_interval: 99999 }).refreshInterval, 1440);
  assert.equal(normalizeConfig({ refresh_interval: '' }).refreshInterval, 30);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
});
