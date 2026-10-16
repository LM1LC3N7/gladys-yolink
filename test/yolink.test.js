// The parsing of the YoLink answers, the inventory and the readers of a reading.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENDPOINTS } from '../src/constants.js';
import {
  acceptedEvent,
  alertState,
  batteryOf,
  endpointOf,
  flatten,
  humidityOf,
  latestRecord,
  lockState,
  readInventory,
  switchState,
  temperatureOf,
  valveState,
} from '../src/inventory.js';
import { codeError, errorReason, httpError, parseBudp, parseToken } from '../src/yolink.js';
import { IDS, euDevices, usDevices } from './fixtures/yolink.js';

test('BUDP answers: data on success, the error of the code otherwise', () => {
  assert.deepEqual(parseBudp('{"code":"000000","data":{"id":"h"}}'), { id: 'h' });
  assert.deepEqual(parseBudp('{"code":"000000"}'), {});
  const cases = {
    '000103': 'unauthorized',
    '010104': 'unauthorized',
    '010101': 'refused',
    '010301': 'rate_limited',
    '010000': 'unavailable',
    '000201': 'device',
    '020104': 'device',
    '010203': 'unsupported',
    999999: 'api',
  };
  for (const [code, kind] of Object.entries(cases)) {
    assert.throws(() => parseBudp(JSON.stringify({ code, desc: 'x' })), { kind, code });
  }
  assert.throws(() => parseBudp('<html>'), { kind: 'bad_response' });
  assert.throws(() => parseBudp('[1]'), { kind: 'bad_response' });
  assert.equal(errorReason(codeError('000201', 'Cannot connect')), 'Cannot connect (code 000201)');
  assert.equal(errorReason(httpError(503)), 'YoLink is unavailable (HTTP 503)');
});

test('token answers', () => {
  const now = 1000;
  assert.deepEqual(parseToken('{"access_token":"a","refresh_token":"r","expires_in":7200}', now), {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: now + 7200_000,
  });
  assert.equal(parseToken('{"access_token":"a"}', now).expiresAt, now + 2 * 3600_000);
  assert.throws(() => parseToken('{"error":"invalid_client"}', now), { kind: 'refused' });
  // A 200 with a BUDP code: refused for the credential codes only.
  for (const code of ['000106', '010101', '010102', '010103']) {
    assert.throws(() => parseToken(JSON.stringify({ code, desc: 'x' }), now), {
      kind: 'refused',
      code,
    });
  }
  assert.throws(() => parseToken('{"code":"010000","desc":"Service is not available"}', now), {
    kind: 'unavailable',
  });
  assert.throws(() => parseToken('{"code":"010301"}', now), { kind: 'rate_limited' });
  assert.throws(() => parseToken('{}', now), { kind: 'bad_response' });
  assert.equal(httpError(400, { token: true }).kind, 'refused');
  assert.equal(httpError(403, { token: true }).kind, 'refused');
  assert.equal(httpError(500, { token: true }).kind, 'unavailable');
  assert.equal(httpError(401, { token: true }).kind, 'refused');
  assert.equal(httpError(401).kind, 'unauthorized');
  assert.equal(httpError(429).kind, 'rate_limited');
});

test('the cloud of a device', () => {
  assert.equal(endpointOf({ serviceZone: 'eu_west_1' }), ENDPOINTS.EU);
  assert.equal(endpointOf({ serviceZone: 'us_west_1', modelName: 'YS7704-EC' }), ENDPOINTS.US);
  assert.equal(endpointOf({ modelName: 'YS7704-EC' }), ENDPOINTS.EU);
  assert.equal(endpointOf({ modelName: 'YS7704-UC' }), ENDPOINTS.US);
  assert.equal(endpointOf({}), ENDPOINTS.US);
});

test('the inventory: EU tokens, parents, unsupported types', () => {
  const { devices, skipped } = readInventory(usDevices(), euDevices());
  assert.equal(devices.length, 16);
  assert.deepEqual(
    skipped.map((s) => s.type),
    ['Hub', 'SmartRemoter'],
  );
  const door = devices.find((d) => d.id === IDS.door);
  assert.equal(door.token, `eu-token-${IDS.door}`);
  assert.equal(door.model, 'YS7704');
  assert.equal(door.kind, 'door');
  assert.equal(devices.find((d) => d.id === IDS.garageSensor).parentId, IDS.garage);
  assert.equal(devices.find((d) => d.id === IDS.garage).parentId, undefined);
  // Broken rows and duplicates are dropped.
  const again = readInventory([...usDevices(), { type: 'Lock' }, usDevices()[0], null]);
  assert.equal(again.devices.length, 16);
  // A FlowSmart meter (YS5007) has no valve: skipped.
  const meter = readInventory([
    { deviceId: 'm1', type: 'WaterMeterController', token: 't', modelName: 'YS5007-UC' },
  ]);
  assert.equal(meter.devices.length, 0);
  assert.deepEqual(meter.skipped, [{ id: 'm1', type: 'WaterMeterController' }]);
});

test('readings: nested or flat answers, the readers', () => {
  assert.deepEqual(flatten({ online: true, state: { state: 'open', battery: 4 } }), {
    online: true,
    state: 'open',
    battery: 4,
  });
  assert.deepEqual(flatten({ state: 'open', power: 3 }), { state: 'open', power: 3 });
  assert.deepEqual(flatten(null), {});
  assert.equal(lockState(flatten({ state: { state: 'locked' } })), true);
  assert.equal(lockState(flatten({ state: { state: { lock: 'unlocked' } } })), false);
  assert.equal(lockState(flatten({ state: { lock: 'locked' }, battery: 3 })), true);
  assert.equal(valveState(flatten({ state: 'closed' })), false);
  assert.equal(valveState(flatten({ state: { state: { valve: 'open' } } })), true);
  assert.equal(valveState(flatten({ state: { valve: 'close', waterTemp: 12 } })), false);
  assert.equal(switchState({ state: ['open', 'closed'] }, 1), false);
  assert.equal(switchState({ state: 'open' }), true);
  assert.equal(alertState({ state: 'alert' }), true);
  assert.equal(alertState({ state: 'off' }), false);
  assert.equal(alertState({ state: 'error' }), undefined);
  assert.equal(temperatureOf({ temperature: '21.26' }), 21.3);
  assert.equal(humidityOf({ humidity: 120 }), undefined);
  assert.deepEqual(
    [0, 2, 4, 5, 'x'].map((battery) => batteryOf({ battery })),
    [0, 50, 100, undefined, undefined],
  );
  assert.deepEqual(
    latestRecord({
      records: [
        { time: 1, temperature: 3 },
        { time: 5, temperature: 9 },
      ],
    }),
    {
      temperature: 9,
      humidity: undefined,
    },
  );
  assert.equal(latestRecord({}), undefined);
});

test('the MQTT events kept', () => {
  for (const event of [
    'DoorSensor.Alert',
    'Lock.Report',
    'Outlet.StatusChange',
    'THSensor.DataRecord',
    'Siren.setState',
  ]) {
    assert.equal(acceptedEvent(event), true, event);
  }
  for (const event of ['DoorSensor.setOpenRemind', 'Hub.online', undefined, 3]) {
    assert.equal(acceptedEvent(event), false, String(event));
  }
});
