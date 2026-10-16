// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, a fake YoLink cloud behind the transport and fake MQTT brokers.
// Timers and Date are mocked: the tests move the clock second by second.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { YoLinkApp } from '../src/app.js';
import { ACTIONS, TOKEN_URL } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { HOME, IDS, MINUTE, NOW, SECRET, UAID, report } from './fixtures/yolink.js';
import { fakeMqtt, fakeYoLink, settle } from './helpers/fakeYoLink.js';

const CONFIG = { uaid: UAID, secret_key: SECRET };
const dev = (id) => `ext:test-integration:yolink:${id}`;

async function setup(t, { config = CONFIG, server = fakeYoLink(), autoConnect = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const mqtt = fakeMqtt(server, { autoConnect });
  let n = 0;
  const lines = [];
  const logger = createLogger({ level: 'silent' });
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (...args) => lines.push(args.map(String).join(' '));
  }
  const app = new YoLinkApp({
    gladys,
    logger,
    transport: server.transport,
    connect: (endpoint, options) => mqtt.connect(endpoint, options),
    now: () => Date.now(),
    randomId: () => `uuid-${(n += 1)}`,
    stateSpacing: 0,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      t.mock.timers.tick(1000);
      await settle(5);
    }
    await settle();
  };
  return { gladys, app, server, mqtt, advance, lines };
}

const deviceOf = (gladys, id) => gladys.fake.discoveredDevices.find((d) => d.external_id === id);
const featureOf = (gladys, id, role) =>
  deviceOf(gladys, dev(id)).features.find((f) => f.external_id === `${dev(id)}:${role}`);
const create = async (gladys, ...ids) => {
  for (const id of ids) {
    await gladys.fake.deviceCreated(deviceOf(gladys, dev(id)));
  }
  await settle();
};
const createAll = (gladys) =>
  create(gladys, ...gladys.fake.discoveredDevices.map((d) => d.external_id.split(':').at(-1)));
const statesOf = (gladys, id, role) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === `${dev(id)}:${role}`);
const last = (gladys, id, role) => gladys.fake.lastState(`${dev(id)}:${role}`);
const badgeOf = (gladys, id) =>
  gladys.fake.transports.filter((b) => b.device_external_id === dev(id)).at(-1);
const set = (gladys, id, role, value) =>
  gladys.fake.setValue(deviceOf(gladys, dev(id)), featureOf(gladys, id, role), value);

test('without credentials, the status asks for them and nothing is sent', async (t) => {
  const { gladys, server } = await setup(t, { config: {} });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /UAID/);
  assert.equal(server.requests.length, 0);
});

test('start: token, home, both device lists, every state, then live events', async (t) => {
  const { gladys, server, mqtt } = await setup(t);
  const [token] = server.tokenRequests();
  assert.equal(token.body.grant_type, 'client_credentials');
  assert.equal(token.body.client_id, UAID);
  assert.equal(server.calls('Home.getGeneralInfo').length, 1);
  assert.deepEqual(
    server.calls('Home.getDeviceList').map((r) => r.endpoint),
    ['US', 'EU'],
  );
  // EU devices are asked on the EU cloud with their EU token.
  const door = server.calls('DoorSensor.fetchState').find((r) => r.body.targetDevice === IDS.door);
  assert.equal(door.endpoint, 'EU');
  assert.equal(door.body.token, `eu-token-${IDS.door}`);
  // The siren has no fetchState: getState instead.
  assert.equal(server.calls('Siren.getState').length, 1);
  // Hub and remote are not supported: 16 devices.
  assert.equal(gladys.fake.discoveredDevices.length, 16);
  assert.equal(deviceOf(gladys, dev(IDS.hub)), undefined);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /16 devices\. Live events on/);
  // One MQTT connection per cloud, the token as username, no password.
  assert.deepEqual(
    mqtt.connections.map((c) => c.endpoint),
    ['US', 'EU'],
  );
  const { options, client } = mqtt.connections[0];
  assert.equal(options.username, 'at-1');
  assert.equal(options.password, undefined);
  assert.equal(options.reconnectPeriod, 0);
  assert.deepEqual(client.subscriptions, [`yl-home/${HOME}/+/report`]);
});

test('the Gladys devices and their features', async (t) => {
  const { gladys } = await setup(t);
  const roles = (id) =>
    deviceOf(gladys, dev(id)).features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(roles(IDS.door), ['opening', 'battery']);
  assert.deepEqual(roles(IDS.climate), ['temperature', 'humidity', 'battery']);
  assert.deepEqual(roles(IDS.thermometer), ['temperature', 'battery']);
  assert.deepEqual(roles(IDS.outlet), ['switch', 'power']);
  assert.deepEqual(roles(IDS.switch), ['switch']);
  assert.deepEqual(roles(IDS.strip), ['socket-0', 'socket-1', 'socket-2', 'socket-3', 'socket-4']);
  assert.deepEqual(roles(IDS.valve), ['valve', 'battery']);
  assert.deepEqual(roles(IDS.lockV2), ['lock', 'battery']);
  assert.deepEqual(roles(IDS.siren), ['siren', 'battery']);
  assert.deepEqual(roles(IDS.garage), ['garage']);
  const door = deviceOf(gladys, dev(IDS.door));
  assert.equal(door.name, 'Front door');
  assert.deepEqual(
    door.params.find((p) => p.name === 'cloud'),
    { name: 'cloud', value: 'EU' },
  );
  assert.equal(featureOf(gladys, IDS.door, 'opening').name, 'Ouverture');
  assert.equal(featureOf(gladys, IDS.lock, 'lock').read_only, false);
  assert.equal(featureOf(gladys, IDS.door, 'opening').read_only, true);
});

test('states reach Gladys once the devices are created', async (t) => {
  const { gladys } = await setup(t);
  assert.equal(gladys.fake.states.length, 0);
  await createAll(gladys);
  assert.equal(last(gladys, IDS.door, 'opening'), 1, 'closed is 1 (OPENING_SENSOR_STATE.CLOSE)');
  assert.equal(last(gladys, IDS.door, 'battery'), 100);
  assert.equal(last(gladys, IDS.motion, 'battery'), 50);
  assert.equal(last(gladys, IDS.climate, 'temperature'), 21.4);
  assert.equal(last(gladys, IDS.climate, 'humidity'), 48.2);
  assert.equal(last(gladys, IDS.thermometer, 'temperature'), -18.4);
  assert.equal(last(gladys, IDS.outlet, 'switch'), 0);
  assert.equal(last(gladys, IDS.outlet, 'power'), 0);
  assert.equal(last(gladys, IDS.switch, 'switch'), 1);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => last(gladys, IDS.strip, `socket-${i}`)),
    [1, 0, 1, 0, 0],
  );
  assert.equal(last(gladys, IDS.valve, 'valve'), 1);
  assert.equal(last(gladys, IDS.leakStop, 'valve'), 1);
  assert.equal(last(gladys, IDS.lock, 'lock'), 1);
  assert.equal(last(gladys, IDS.lockV2, 'lock'), 1);
  assert.equal(last(gladys, IDS.siren, 'siren'), 0);
  assert.equal(last(gladys, IDS.garage, 'garage'), 0, 'from its paired door sensor');
  assert.equal(badgeOf(gladys, IDS.door).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('live reports update the states; alerts are moments of their own', async (t) => {
  const { gladys, mqtt, advance } = await setup(t);
  await createAll(gladys);
  mqtt.publish('EU', report(IDS.motion, 'MotionSensor.Alert', { state: 'alert', battery: 2 }));
  await advance(1000);
  mqtt.publish('EU', report(IDS.motion, 'MotionSensor.Alert', { state: 'alert', battery: 2 }));
  await advance(1000);
  assert.deepEqual(
    statesOf(gladys, IDS.motion, 'motion').map((s) => s.state),
    [0, 1, 1],
    'two alerts are two states',
  );
  mqtt.publish('EU', report(IDS.motion, 'MotionSensor.Report', { state: 'normal' }));
  mqtt.publish('EU', report(IDS.door, 'DoorSensor.Alert', { state: 'open', battery: 4 }));
  mqtt.publish(
    'EU',
    report(IDS.climate, 'THSensor.Report', { state: 'normal', temperature: 19.04, humidity: 51 }),
  );
  await advance(1000);
  assert.equal(last(gladys, IDS.motion, 'motion'), 0);
  assert.equal(last(gladys, IDS.door, 'opening'), 0);
  assert.equal(last(gladys, IDS.climate, 'temperature'), 19);
  assert.equal(last(gladys, IDS.climate, 'humidity'), 51);
  // The garage door follows its sensor (reported on the US cloud).
  mqtt.publish('US', report(IDS.garageSensor, 'DoorSensor.Alert', { state: 'open' }));
  await advance(1000);
  assert.equal(last(gladys, IDS.garage, 'garage'), 1);
  // THSensor.DataRecord: the latest record.
  mqtt.publish(
    'EU',
    report(IDS.climate, 'THSensor.DataRecord', {
      records: [
        { time: 2, temperature: 22.5, humidity: 40 },
        { time: 1, temperature: 10, humidity: 10 },
      ],
    }),
  );
  await advance(1000);
  assert.equal(last(gladys, IDS.climate, 'temperature'), 22.5);
});

test('reports of other homes, unknown events and broken payloads are ignored', async (t) => {
  const { gladys, mqtt, advance } = await setup(t);
  await createAll(gladys);
  const before = gladys.fake.states.length;
  const open = report(IDS.door, 'DoorSensor.Alert', { state: 'open' });
  mqtt.publish('EU', open, `yl-home/another-home/${IDS.door}/report`);
  mqtt.publish('EU', report(IDS.door, 'DoorSensor.setOpenRemind', { state: 'open' }));
  mqtt.live('EU').emit('message', `yl-home/${HOME}/${IDS.door}/report`, Buffer.from('{oops'));
  mqtt.publish('EU', report('unknown-device', 'DoorSensor.Alert', { state: 'open' }));
  await advance(2000);
  assert.equal(gladys.fake.states.length, before);
});

test('switches, sockets and the siren follow the commands', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  assert.deepEqual(await set(gladys, IDS.outlet, 'switch', 1), { success: true });
  const [outlet] = server.calls('Outlet.setState');
  assert.deepEqual(outlet.body.params, { state: 'open' });
  assert.equal(outlet.body.targetDevice, IDS.outlet);
  assert.equal(last(gladys, IDS.outlet, 'switch'), 1);

  assert.deepEqual(await set(gladys, IDS.strip, 'socket-3', 1), { success: true });
  assert.deepEqual(server.calls('MultiOutlet.setState')[0].body.params, { chs: 8, state: 'open' });
  assert.equal(last(gladys, IDS.strip, 'socket-3'), 1);
  assert.equal(last(gladys, IDS.strip, 'socket-0'), 1);

  assert.deepEqual(await set(gladys, IDS.siren, 'siren', 1), { success: true });
  assert.deepEqual(server.calls('Siren.setState')[0].body.params, { state: { alarm: true } });
  assert.equal(last(gladys, IDS.siren, 'siren'), 1);
  await advance(1000);
  assert.deepEqual(await set(gladys, IDS.siren, 'siren', 0), { success: true });
  assert.equal(last(gladys, IDS.siren, 'siren'), 0);
});

test('locks: locking always works, unlocking only when allowed', async (t) => {
  const { gladys, server } = await setup(t);
  await createAll(gladys);
  const refused = await set(gladys, IDS.lockV2, 'lock', 0);
  assert.equal(refused.success, false);
  assert.match(refused.error, /déverrouillage depuis Gladys est désactivé/);
  assert.equal(server.calls('LockV2.setState').length, 0);

  assert.deepEqual(await set(gladys, IDS.lockV2, 'lock', 1), { success: true });
  assert.deepEqual(server.calls('LockV2.setState')[0].body.params, { state: { lock: 'locked' } });

  await gladys.fake.configUpdated({ ...CONFIG, allow_unlock: true });
  assert.deepEqual(await set(gladys, IDS.lock, 'lock', 0), { success: true });
  assert.deepEqual(server.calls('Lock.setState')[0].body.params, { state: 'unlock' });
  assert.equal(last(gladys, IDS.lock, 'lock'), 0, 'the answer of the lock');
});

test('valves: closing and opening only when allowed', async (t) => {
  const { gladys, server } = await setup(t);
  await createAll(gladys);
  const closeRefused = await set(gladys, IDS.valve, 'valve', 0);
  assert.equal(closeRefused.success, false);
  assert.match(closeRefused.error, /fermeture des vannes/);
  assert.equal(server.calls('Manipulator.setState').length, 0);

  await gladys.fake.configUpdated({ ...CONFIG, allow_valve_close: true });
  assert.deepEqual(await set(gladys, IDS.valve, 'valve', 0), { success: true });
  assert.deepEqual(server.calls('Manipulator.setState')[0].body.params, { state: 'close' });
  assert.equal(last(gladys, IDS.valve, 'valve'), 0);

  const refused = await set(gladys, IDS.valve, 'valve', 1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /vannes/);
  assert.equal(server.calls('Manipulator.setState').length, 1);

  assert.deepEqual(await set(gladys, IDS.leakStop, 'valve', 0), { success: true });
  assert.deepEqual(server.calls('WaterMeterController.setState')[0].body.params, {
    valve: 'close',
  });
  assert.equal(last(gladys, IDS.leakStop, 'valve'), 0);

  await gladys.fake.configUpdated({ ...CONFIG, allow_valve_close: true, allow_valve_open: 'true' });
  assert.deepEqual(await set(gladys, IDS.valve, 'valve', 1), { success: true });
  assert.equal(last(gladys, IDS.valve, 'valve'), 1);
});

test('a LeakStop that does not answer: the class A message', async (t) => {
  const server = fakeYoLink();
  const leakStop = server.us.find((d) => d.deviceId === IDS.leakStop);
  leakStop.modelName = 'YS5009-UC';
  const { gladys } = await setup(t, { server, config: { ...CONFIG, allow_valve_close: true } });
  await createAll(gladys);
  server.unreachable.add(IDS.leakStop);
  const ack = await set(gladys, IDS.leakStop, 'valve', 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /classe A/);
});

test('a FlowSmart meter (YS5007) has no valve', async (t) => {
  const server = fakeYoLink();
  server.us.find((d) => d.deviceId === IDS.leakStop).modelName = 'YS5007-UC';
  const { gladys } = await setup(t, { server });
  assert.equal(deviceOf(gladys, dev(IDS.leakStop)), undefined);
});

test('garage doors: closing an open door works, opening only when allowed', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  // Closed already: nothing to do.
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', 0), { success: true });
  assert.equal(server.calls('GarageDoor.toggle').length, 0);
  const refused = await set(gladys, IDS.garage, 'garage', 1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /garage/);
  assert.equal(server.calls('GarageDoor.toggle').length, 0);

  // The sensor is read again just before the toggle.
  server.states[IDS.garageSensor].state = 'open';
  const reads = server.calls('DoorSensor.fetchState').length;
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', 0), { success: true });
  assert.equal(server.calls('DoorSensor.fetchState').length, reads + 1);
  assert.equal(server.calls('GarageDoor.toggle').length, 1);

  await advance(61_000);
  await gladys.fake.configUpdated({ ...CONFIG, allow_garage_open: true });
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', 1), { success: true });
  assert.equal(server.calls('GarageDoor.toggle').length, 2);
});

test('garage doors: a second toggle while the door moves is ignored', async (t) => {
  const server = fakeYoLink();
  server.doorMoves = false;
  server.states[IDS.garageSensor].state = 'open';
  const { gladys, advance, mqtt } = await setup(t, { server });
  await createAll(gladys);
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', 0), { success: true });
  await advance(5000);
  const ignored = await set(gladys, IDS.garage, 'garage', 0);
  assert.equal(ignored.success, false);
  assert.match(ignored.error, /commande ignorée/);
  assert.equal(server.calls('GarageDoor.toggle').length, 1, 'one toggle for two "close"');
  // 60 s later, the guard is over.
  await advance(56_000);
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', 0), { success: true });
  assert.equal(server.calls('GarageDoor.toggle').length, 2);
  // A change reported by the sensor ends the guard at once.
  server.states[IDS.garageSensor].state = 'closed';
  mqtt.publish('US', report(IDS.garageSensor, 'DoorSensor.Alert', { state: 'closed' }));
  await advance(1000);
  server.states[IDS.garageSensor].state = 'open';
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', 0), { success: true });
  assert.equal(server.calls('GarageDoor.toggle').length, 3);
});

test('garage doors: two "close" at the same time send one toggle', async (t) => {
  const server = fakeYoLink();
  server.doorMoves = false;
  server.states[IDS.garageSensor].state = 'open';
  const { gladys } = await setup(t, { server });
  await createAll(gladys);
  const acks = await Promise.all([
    set(gladys, IDS.garage, 'garage', 0),
    set(gladys, IDS.garage, 'garage', 0),
  ]);
  assert.equal(server.calls('GarageDoor.toggle').length, 1);
  assert.deepEqual(
    acks.map((a) => a.success),
    [true, false],
  );
});

for (const code of ['999999', '020101']) {
  test(`garage doors: a sensor read answering ${code} refuses the command`, async (t) => {
    const server = fakeYoLink();
    server.states[IDS.garageSensor].state = 'open';
    const { gladys } = await setup(t, { server });
    await createAll(gladys);
    server.queue.push({
      match: (r) =>
        r.body?.method === 'DoorSensor.fetchState' && r.body.targetDevice === IDS.garageSensor,
      body: { code, desc: 'failed' },
    });
    const refused = await set(gladys, IDS.garage, 'garage', 0);
    assert.equal(refused.success, false);
    assert.match(refused.error, /inconnu/);
    assert.equal(server.calls('GarageDoor.toggle').length, 0);
  });
}

test('garage doors: a sensor fetchState reports offline refuses the command', async (t) => {
  const server = fakeYoLink();
  server.states[IDS.garageSensor].state = 'open';
  const { gladys } = await setup(t, { server });
  await createAll(gladys);
  server.queue.push({
    match: (r) =>
      r.body?.method === 'DoorSensor.fetchState' && r.body.targetDevice === IDS.garageSensor,
    body: { code: '000000', data: { online: false, state: { state: 'open' } } },
  });
  const refused = await set(gladys, IDS.garage, 'garage', 0);
  assert.equal(refused.success, false);
  assert.equal(server.calls('GarageDoor.toggle').length, 0);
});

test('garage doors: a sensor offline refuses the command', async (t) => {
  const server = fakeYoLink();
  server.states[IDS.garageSensor].state = 'open';
  const { gladys } = await setup(t, { server, config: { ...CONFIG, allow_garage_open: true } });
  await createAll(gladys);
  server.unreachable.add(IDS.garageSensor);
  const refused = await set(gladys, IDS.garage, 'garage', 0);
  assert.equal(refused.success, false);
  assert.match(refused.error, /inconnu/);
  assert.equal(server.calls('GarageDoor.toggle').length, 0);
});

test('a garage door without a sensor: every toggle is refused', async (t) => {
  const server = fakeYoLink();
  server.us = server.us.filter((d) => d.deviceId !== IDS.garageSensor);
  const { gladys } = await setup(t, { server, config: { ...CONFIG, allow_garage_open: true } });
  await createAll(gladys);
  const refused = await set(gladys, IDS.garage, 'garage', 0);
  assert.equal(refused.success, false);
  assert.match(refused.error, /inconnu/);
  assert.equal(server.calls('GarageDoor.toggle').length, 0);
});

test('sirens: stopping can be turned off', async (t) => {
  const { gladys, server } = await setup(t, { config: { ...CONFIG, allow_siren_stop: false } });
  await createAll(gladys);
  assert.deepEqual(await set(gladys, IDS.siren, 'siren', 1), { success: true });
  const refused = await set(gladys, IDS.siren, 'siren', 0);
  assert.equal(refused.success, false);
  assert.match(refused.error, /arrêt des sirènes/);
  assert.equal(server.calls('Siren.setState').length, 1);
});

test('live events off: no MQTT, HTTPS reads only', async (t) => {
  const { gladys, mqtt, app } = await setup(t, { config: { ...CONFIG, live_events: false } });
  await createAll(gladys);
  assert.equal(mqtt.connections.length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /Live events off/);
  assert.equal(badgeOf(gladys, IDS.door).degraded, undefined);
  await gladys.fake.configUpdated({ ...CONFIG, live_events: true });
  await settle();
  assert.equal(mqtt.connections.length, 2);
  assert.equal(app.live.connected, true);
  await gladys.fake.configUpdated({ ...CONFIG, live_events: false });
  await settle();
  assert.ok(mqtt.connections.every((c) => c.client.ended));
});

test('credentials refused while the live events reconnect: everything stops', async (t) => {
  const { gladys, server, mqtt, app, advance } = await setup(t);
  server.tokens.clear();
  server.refreshTokens.clear();
  server.secret = 'changed-in-the-app';
  app.client.invalidate();
  mqtt.drop('US');
  await advance(31_000);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the UAID or the secret key/);
  const count = mqtt.connections.length;
  assert.ok(mqtt.connections.every((c) => c.client.ended));
  await advance(10 * MINUTE);
  assert.equal(mqtt.connections.length, count, 'no retry');
  assert.equal(
    server.tokenRequests().filter((r) => r.body.grant_type === 'client_credentials').length,
    2,
  );
});

test('the power strip channels: USB ports first on the YS6801', async (t) => {
  const { gladys } = await setup(t);
  const names = deviceOf(gladys, dev(IDS.strip)).features.map((f) => f.name);
  assert.deepEqual(names, ['Ports USB', 'Prise 1', 'Prise 2', 'Prise 3', 'Prise 4']);
});

test('the power strip channels of other models start at 1', async (t) => {
  const server = fakeYoLink();
  server.us.find((d) => d.deviceId === IDS.strip).modelName = 'YS6802-UC';
  server.states[IDS.strip].state = ['open', 'closed'];
  const { gladys } = await setup(t, { server });
  const strip = deviceOf(gladys, dev(IDS.strip));
  assert.deepEqual(
    strip.features.map((f) => [f.external_id.split(':').at(-1), f.name]),
    [
      ['socket-0', 'Prise 1'],
      ['socket-1', 'Prise 2'],
    ],
  );
});

test('a command YoLink refuses fails with its message', async (t) => {
  const { gladys, server } = await setup(t);
  await createAll(gladys);
  server.unreachable.add(IDS.switch);
  const ack = await set(gladys, IDS.switch, 'switch', 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Cannot connect to the device \(code 000201\)/);
  assert.equal(last(gladys, IDS.switch, 'switch'), 1);
});

test('the access token is renewed before it expires, with the refresh token', async (t) => {
  const { server, advance } = await setup(t, { server: fakeYoLink({ lifetime: 3600 }) });
  assert.equal(server.tokenRequests().length, 1);
  await advance(31 * MINUTE);
  // The 30-minute refresh: the token is still valid (55 min with the margin).
  assert.equal(server.tokenRequests().length, 1);
  await advance(30 * MINUTE);
  const requests = server.tokenRequests();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body, {
    grant_type: 'refresh_token',
    client_id: UAID,
    refresh_token: 'rt-1',
  });
});

test('a token refused by the API is renewed once and the call retried', async (t) => {
  const { app, server } = await setup(t);
  server.tokens.clear();
  const before = server.requests.length;
  await app.testConnection();
  const calls = server.requests
    .slice(before)
    .filter((r) => r.body?.method === 'Home.getDeviceList');
  assert.deepEqual(
    calls.map((r) => `${r.endpoint} ${r.token}`),
    ['US at-1', 'US at-2', 'EU at-2'],
  );
});

test('refused credentials stop everything until the configuration changes', async (t) => {
  const config = { uaid: UAID, secret_key: 'wrong-secret' };
  const { gladys, server, advance, mqtt, lines } = await setup(t, { config });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the UAID or the secret key/);
  await advance(2 * 60 * MINUTE);
  assert.equal(server.tokenRequests().length, 1, 'never retried by itself');
  assert.equal(mqtt.connections.length, 0);
  assert.ok(lines.every((l) => !l.includes('wrong-secret')));
  await gladys.fake.configUpdated({ uaid: UAID, secret_key: SECRET, language: 'en' });
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(deviceOf(gladys, dev(IDS.door)).features[0].name, 'Door');
});

test('the test button retries refused credentials and summarizes the account', async (t) => {
  const server = fakeYoLink();
  server.secret = 'another';
  const { gladys } = await setup(t, { server });
  server.secret = SECRET;
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /16 supported devices, 2 other devices not supported yet/);
  const again = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.match(again.data.message.fr, /Déjà lu/);
});

test('YoLink down: unreachable status, badges, backoff, then recovery', async (t) => {
  const { gladys, server, advance, app } = await setup(t);
  await createAll(gladys);
  server.down = true;
  app.nextRefreshAt = 0;
  await advance(MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot be reached \(connection refused\)/);
  assert.equal(badgeOf(gladys, IDS.door).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  const tried = server.requests.length;
  await advance(30_000);
  assert.equal(server.requests.length, tried, 'waits a minute');
  server.down = false;
  await advance(2 * MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(badgeOf(gladys, IDS.door).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('limits reached: a 15-minute pause', async (t) => {
  const { gladys, server, advance, app } = await setup(t);
  server.queue.push({
    match: (r) => r.body?.method === 'Home.getDeviceList',
    body: { code: '010301', desc: 'Access denied due to limits reached, Please retry later' },
  });
  app.nextRefreshAt = 0;
  await advance(MINUTE);
  assert.match(gladys.fake.connectionStatus.message.en, /limit is reached: pausing for 15 min/);
  const tried = server.calls('Home.getDeviceList').length;
  // Neither the Discovery scan nor the test button reads during the pause.
  await advance(MINUTE);
  await gladys.fake.scanRequest();
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.match(ack.data.message.en, /limit is reached: pausing for 14 min/);
  await advance(13 * MINUTE);
  assert.equal(server.calls('Home.getDeviceList').length, tried);
  await advance(2 * MINUTE);
  assert.ok(server.calls('Home.getDeviceList').length > tried);
});

test('a device that does not answer is marked offline, the others go on', async (t) => {
  const server = fakeYoLink();
  server.unreachable.add(IDS.vibration);
  const { gladys, mqtt, advance } = await setup(t, { server });
  await createAll(gladys);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const badge = badgeOf(gladys, IDS.vibration);
  assert.equal(badge.transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(badge.degraded, true);
  assert.equal(last(gladys, IDS.door, 'opening'), 1);
  // A report brings it back.
  mqtt.publish('US', report(IDS.vibration, 'VibrationSensor.Alert', { state: 'alert' }));
  await advance(1000);
  assert.equal(badgeOf(gladys, IDS.vibration).transport, DEVICE_TRANSPORTS.CLOUD);
  assert.equal(last(gladys, IDS.vibration, 'vibration'), 1);
});

test('MQTT: reconnects after a drop, with a fresh connection and the badge degraded meanwhile', async (t) => {
  const { gladys, mqtt, advance } = await setup(t);
  await createAll(gladys);
  mqtt.drop('EU');
  await settle();
  assert.match(gladys.fake.connectionStatus.message.en, /Live events connecting/);
  assert.equal(badgeOf(gladys, IDS.door).degraded, true);
  await advance(29_000);
  assert.equal(mqtt.connections.length, 2);
  await advance(2000);
  assert.equal(mqtt.connections.length, 3);
  const latest = mqtt.connections.at(-1);
  assert.equal(latest.endpoint, 'EU');
  assert.notEqual(latest.options.clientId, mqtt.connections[1].options.clientId);
  assert.match(gladys.fake.connectionStatus.message.en, /Live events on/);
  assert.equal(badgeOf(gladys, IDS.door).degraded, undefined);
});

test('MQTT: no sliding 5-minute window with more than 8 connections', async (t) => {
  const { mqtt, advance } = await setup(t);
  // A flapping broker: every connection is dropped a second after it opens,
  // which resets the backoff each time.
  for (let second = 0; second < 20 * 60; second += 1) {
    for (const endpoint of ['US', 'EU']) {
      if (mqtt.live(endpoint)) {
        mqtt.drop(endpoint);
      }
    }
    await advance(1000);
  }
  const times = mqtt.connections.map((c) => c.at).sort((a, b) => a - b);
  assert.ok(times.length > 10, `${times.length} connections`);
  for (const start of times) {
    const inWindow = times.filter((at) => at >= start && at < start + 5 * MINUTE).length;
    assert.ok(inWindow <= 8, `${inWindow} connections in the 5 minutes after ${start}`);
  }
});

test('a Gladys restart resends the Discovery list without reading YoLink again', async (t) => {
  const { gladys, server } = await setup(t);
  const before = server.requests.length;
  const published = () =>
    gladys.fake.requests.filter((r) => r.method === 'POST' && r.path === '/discovered_device');
  const lists = published().length;
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(server.requests.length, before);
  assert.equal(published().length, lists + 1);
  assert.equal(gladys.fake.discoveredDevices.length, 16);
});

test('the Discovery scan reads again, at most every 30 seconds', async (t) => {
  const { gladys, server, advance } = await setup(t);
  const lists = () => server.calls('Home.getDeviceList').length;
  const before = lists();
  await gladys.fake.scanRequest();
  assert.equal(lists(), before);
  await advance(31_000);
  await gladys.fake.scanRequest();
  await settle();
  assert.equal(lists(), before + 2);
});

test('the secret key and the tokens are never logged', async (t) => {
  const { gladys, server, lines, mqtt, advance } = await setup(t);
  await createAll(gladys);
  mqtt.drop('US');
  await advance(MINUTE);
  await set(gladys, IDS.lock, 'lock', 0);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(!line.includes(SECRET), line);
    assert.ok(!/\bat-\d|\brt-\d/.test(line), line);
  }
  // The secret key only ever goes to the token endpoint.
  const withSecret = server.requests.filter((r) => JSON.stringify(r.body).includes(SECRET));
  assert.ok(withSecret.length > 0 && withSecret.every((r) => r.url === TOKEN_URL));
});
