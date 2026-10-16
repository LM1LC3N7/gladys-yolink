// The token handling of the client, and the 300 states per minute of the publisher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YoLinkClient } from '../src/client.js';
import { ENDPOINTS } from '../src/constants.js';
import { StatePublisher } from '../src/publisher.js';
import { NOW, SECRET, UAID } from './fixtures/yolink.js';
import { fakeYoLink } from './helpers/fakeYoLink.js';

function client(server, clock) {
  const c = new YoLinkClient({ transport: server.transport, now: () => clock.now });
  c.configure({ uaid: UAID, secretKey: SECRET });
  return c;
}

test('one token request for concurrent calls', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const server = fakeYoLink();
  const clock = { now: NOW };
  const c = client(server, clock);
  await Promise.all([c.homeId(), c.deviceList(ENDPOINTS.US), c.deviceList(ENDPOINTS.EU)]);
  assert.equal(server.tokenRequests().length, 1);
});

test('an expired refresh token falls back to the credentials', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const server = fakeYoLink();
  const clock = { now: NOW };
  const c = client(server, clock);
  await c.homeId();
  server.refreshTokens.clear();
  clock.now += 2 * 3600_000;
  t.mock.timers.tick(2 * 3600_000);
  await c.homeId();
  assert.deepEqual(
    server.tokenRequests().map((r) => r.body.grant_type),
    ['client_credentials', 'refresh_token', 'client_credentials'],
  );
});

for (const code of ['010104', '000103']) {
  test(`a refresh token answered with code ${code} is dropped for the credentials`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const server = fakeYoLink();
    const clock = { now: NOW };
    const c = client(server, clock);
    await c.homeId();
    server.queue.push({
      match: (r) => r.body?.grant_type === 'refresh_token',
      body: { code, desc: 'The token is expired' },
    });
    clock.now += 2 * 3600_000;
    t.mock.timers.tick(2 * 3600_000);
    await c.homeId();
    assert.deepEqual(
      server.tokenRequests().map((r) => r.body.grant_type),
      ['client_credentials', 'refresh_token', 'client_credentials'],
    );
    assert.equal(c.session.accessToken, 'at-2');
  });
}

test('a refresh token failing for a passing reason is kept', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const server = fakeYoLink();
  const clock = { now: NOW };
  const c = client(server, clock);
  await c.homeId();
  server.queue.push({
    match: (r) => r.body?.grant_type === 'refresh_token',
    status: 503,
    body: 'down',
  });
  clock.now += 2 * 3600_000;
  t.mock.timers.tick(2 * 3600_000);
  await assert.rejects(c.homeId(), { kind: 'unavailable' });
  await c.homeId();
  assert.deepEqual(
    server.tokenRequests().map((r) => r.body.grant_type),
    ['client_credentials', 'refresh_token', 'refresh_token'],
  );
});

test('without credentials nothing is sent', async () => {
  const server = fakeYoLink();
  const c = new YoLinkClient({ transport: server.transport });
  await assert.rejects(c.homeId(), { kind: 'no_credentials' });
  assert.equal(server.requests.length, 0);
});

test('the publisher keeps to 300 states per minute', async () => {
  const sent = [];
  const gladys = {
    publishStates: async (batch) => sent.push(...batch),
    publishChangedStates: async (batch) => {
      sent.push(...batch);
      return { count: batch.length };
    },
    forgetPublishedStates: () => {},
  };
  let now = 0;
  const publisher = new StatePublisher({ gladys, logger: console, now: () => now });
  for (let i = 0; i < 400; i += 1) {
    publisher.push(`f${i}`, { state: i });
  }
  await publisher.flush();
  assert.equal(sent.length, 300);
  await publisher.flush();
  assert.equal(sent.length, 300);
  now += 60_001;
  await publisher.flush();
  assert.equal(sent.length, 400);
});
