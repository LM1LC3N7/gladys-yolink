// -----------------------------------------------------------------------------
// Every feature of every supported device kind against the core model
// (test/helpers/coreFeature.js): Gladys answers HTTP 422 otherwise.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { KINDS } from '../src/constants.js';
import { buildDevices } from '../src/devices.js';
import { flatten, readInventory } from '../src/inventory.js';
import { euDevices, initialStates, usDevices } from './fixtures/yolink.js';
import { assertCoreDevice } from './helpers/coreFeature.js';

test('every feature of every device kind follows the core model', () => {
  const gladys = createFakeGladys({ selector: 'yolink' });
  const { devices } = readInventory(usDevices(), euDevices());
  const states = initialStates();
  const readings = new Map(devices.map((d) => [d.id, flatten({ state: states[d.id] ?? {} })]));
  const kinds = new Set();
  for (const language of ['fr', 'en']) {
    for (const device of buildDevices(gladys, devices, readings, language)) {
      assertCoreDevice(device, `${device.name} ${language}`);
    }
  }
  devices.forEach((d) => kinds.add(d.kind));
  assert.deepEqual([...kinds].sort(), [...new Set(Object.values(KINDS))].sort(), 'every kind');
});
