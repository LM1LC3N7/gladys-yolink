// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, a fake YoLink cloud behind the transport and fake MQTT brokers.
// Timers and Date are mocked: the tests move the clock second by second.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { YoLinkApp } from '../src/app.js';
import { ACTIONS, TOKEN_URL } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { HOME, IDS, MINUTE, NOW, SECRET, UAID, report } from './fixtures/yolink.js';
import { fakeMqtt, fakeYoLink, settle } from './helpers/fakeYoLink.js';

const CONFIG = { uaid: UAID, secret_key: SECRET };
const dev = (id) => `ext:test-integration:yolink:${id}`;

/** The apps of the running test: stopped before its /data is removed. */
const apps = new Set();

/** A new empty directory standing for /data, removed after the test. */
const dataDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gladys-yolink-'));
  // Registered before the app's own hook: stop every app, let its last write
  // to /data land, then remove the directory (a later write would create it again).
  t.after(async () => {
    for (const app of apps) {
      app.stop();
      await app.keeper.saving;
    }
    apps.clear();
    await settle();
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

async function setup(
  t,
  { config = CONFIG, server = fakeYoLink(), autoConnect = true, data = dataDir(t) } = {},
) {
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
    monotonic: () => Date.now(),
    randomId: () => `uuid-${(n += 1)}`,
    stateSpacing: 0,
    dataDir: data,
  });
  apps.add(app);
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
  return { gladys, app, server, mqtt, advance, lines, data };
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
  assert.deepEqual(roles(IDS.valve), ['valve_open', 'water_close', 'water_open', 'battery']);
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
  assert.equal(last(gladys, IDS.valve, 'valve_open'), 1);
  assert.equal(last(gladys, IDS.leakStop, 'valve_open'), 1);
  assert.equal(last(gladys, IDS.lock, 'lock'), 1);
  assert.equal(last(gladys, IDS.lockV2, 'lock'), 1);
  assert.equal(last(gladys, IDS.siren, 'siren'), 0);
  assert.equal(
    last(gladys, IDS.garage, 'garage'),
    -1,
    'closed: SHUTTER_STATE.CLOSE, from its sensor',
  );
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

// --- Valves: the shutoff, never refused ------------------------------------------------

const keptFile = (data) => {
  try {
    return JSON.parse(readFileSync(join(data, 'yolink-shutoffs.json'), 'utf8')).shutoffs;
  } catch {
    return undefined;
  }
};
const closesOf = (server, type = 'Manipulator') =>
  server
    .calls(`${type}.setState`)
    .filter((r) => (r.body.params.state ?? r.body.params.valve) === 'close');
const statusFr = (gladys) => gladys.fake.connectionStatus.message.fr;
/** A water button of a valve. */
const press = (gladys, id, role) => set(gladys, id, role, 1);
/** The valve switch of 0.1.0-0.1.2 (a scene made with it). */
const legacy = (gladys, id, value) =>
  gladys.fake.setValue(deviceOf(gladys, dev(id)), { external_id: `${dev(id)}:valve` }, value);
/**
 * Waits (bounded) for `condition`: never hangs, whatever the mocked timers.
 * Each round also waits for a file system call, so the real reads and
 * writes of /data (thread pool) progress whatever the load.
 */
const until = async (condition, what) => {
  for (let i = 0; i < 500; i += 1) {
    if (condition()) {
      return;
    }
    await settle(5);
    await stat(tmpdir());
  }
  assert.fail(`timed out waiting for ${what}`);
};

test('valves: the water buttons; closing needs no option, confirmed by the valve', async (t) => {
  const { gladys, server, app, data } = await setup(t);
  await createAll(gladys);
  const reads = server.calls('Manipulator.fetchState').length;
  assert.deepEqual(await press(gladys, IDS.valve, 'water_close'), { success: true });
  assert.equal(server.calls('Manipulator.fetchState').length, reads, 'nothing read before');
  assert.deepEqual(closesOf(server)[0].body.params, { state: 'close' });
  assert.equal(last(gladys, IDS.valve, 'valve_open'), 0, 'the answer is shown');
  // The valve answered its own request closed: confirmed.
  assert.equal(app.keeper.entries.size, 0);
  await app.keeper.saving;
  assert.deepEqual(keptFile(data), []);
  assert.doesNotMatch(statusFr(gladys), /coupure/);
  // A LeakStop: its own parameters.
  assert.deepEqual(await press(gladys, IDS.leakStop, 'water_close'), { success: true });
  assert.deepEqual(server.calls('WaterMeterController.setState')[0].body.params, {
    valve: 'close',
  });
  // Opening: behind its option.
  const refused = await press(gladys, IDS.valve, 'water_open');
  assert.equal(refused.success, false);
  assert.match(refused.error, /ouverture des vannes/);
});

test('valves: the switch of 0.1.2 still works for older scenes; its state is still sent', async (t) => {
  const { gladys, server } = await setup(t);
  await createAll(gladys);
  const old = structuredClone(deviceOf(gladys, dev(IDS.valve)));
  old.features.push({ ...old.features[0], external_id: `${dev(IDS.valve)}:valve` });
  await gladys.fake.deviceCreated(old);
  await settle();
  assert.equal(gladys.fake.lastState(`${dev(IDS.valve)}:valve`), 1);
  assert.deepEqual(await legacy(gladys, IDS.valve, 0), { success: true });
  assert.equal(closesOf(server).length, 1);
  assert.equal((await legacy(gladys, IDS.valve, 1)).success, false, 'opening behind its option');
});

test('valves: opening behind its option, refused within 20 s of a shutoff still kept', async (t) => {
  const server = fakeYoLink();
  server.stuck.add(IDS.valve);
  const { gladys, app, advance } = await setup(t, { server });
  await createAll(gladys);
  await gladys.fake.configUpdated({ ...CONFIG, allow_valve_open: 'true' });
  assert.deepEqual(await press(gladys, IDS.valve, 'water_close'), { success: true });
  assert.equal(app.keeper.entries.size, 1, 'the valve answered open: kept');
  await advance(19_000);
  const early = await press(gladys, IDS.valve, 'water_open');
  assert.equal(early.success, false);
  assert.match(early.error, /il y a moins de 20 s/);
  await advance(2_000);
  assert.deepEqual(await press(gladys, IDS.valve, 'water_open'), { success: true });
  assert.deepEqual(server.calls('Manipulator.setState').at(-1).body.params, { state: 'open' });
  assert.equal(app.keeper.entries.size, 0, 'the opening asked last lets the shutoff go');
  await advance(20 * MINUTE);
  assert.equal(closesOf(server).length, 1, 'never fought');
});

test('valves: an old configuration holding allow_valve_close changes nothing', async (t) => {
  const { gladys, server, app } = await setup(t, {
    config: { ...CONFIG, allow_valve_close: false },
  });
  await createAll(gladys);
  assert.equal('allowValveClose' in app.config, false);
  assert.deepEqual(await press(gladys, IDS.valve, 'water_close'), { success: true });
  assert.equal(closesOf(server).length, 1);
});

test("valves: the cloud's cache never confirms; a report of the valve after the send does", async (t) => {
  const server = fakeYoLink();
  // The cloud still says closed (opened by hand, report lost); the valve does not answer.
  server.states[IDS.valve].state = 'closed';
  const { gladys, mqtt, app, advance } = await setup(t, { server });
  await createAll(gladys);
  server.unreachable.add(IDS.valve);
  const ack = await press(gladys, IDS.valve, 'water_close');
  assert.equal(ack.success, false);
  assert.match(ack.error, /gardée et renvoyée/);
  // fetchState (the cache, an old report) shows closed: not a confirmation.
  server.unreachable.delete(IDS.valve);
  server.stuck.add(IDS.valve);
  server.states[IDS.valve].state = 'open';
  server.queue.push({
    match: (r) => r.body?.method === 'Manipulator.fetchState',
    body: {
      code: '000000',
      data: { online: true, state: { state: 'closed' }, reportAt: '2026-01-01T00:00:00.000Z' },
    },
  });
  // A report without the valve, while the reading kept says closed: kept.
  mqtt.publish('US', report(IDS.valve, 'Manipulator.Report', { battery: 4 }));
  await settle();
  assert.equal(app.keeper.entries.size, 1, 'kept');
  await advance(15_000);
  assert.equal(app.keeper.entries.size, 1, 'kept');
  // An open report: kept.
  mqtt.publish('US', report(IDS.valve, 'Manipulator.Report', { state: 'open', battery: 4 }));
  await settle();
  assert.equal(app.keeper.entries.size, 1, 'kept');
  mqtt.publish('US', report(IDS.valve, 'Manipulator.setState', { state: 'closed' }));
  await settle();
  assert.equal(app.keeper.entries.size, 0, 'closed: done');
});

test('valves: a state read with a report newer than the send confirms', async (t) => {
  const server = fakeYoLink();
  server.stuck.add(IDS.valve);
  const { gladys, app, advance } = await setup(t, { server });
  await createAll(gladys);
  await press(gladys, IDS.valve, 'water_close');
  assert.equal(app.keeper.entries.size, 1);
  // The valve reported closed after the send: the next read confirms it, nothing sent again.
  await advance(1_000);
  server.states[IDS.valve].state = 'closed';
  server.reportAt[IDS.valve] = new Date(Date.now()).toISOString();
  await advance(60_000);
  assert.equal(closesOf(server).length, 1);
  assert.equal(app.keeper.entries.size, 0);
});

test('valves: a read showing the valve closed but the device offline confirms nothing', async (t) => {
  const server = fakeYoLink();
  server.stuck.add(IDS.valve);
  const { gladys, app, advance } = await setup(t, { server });
  await createAll(gladys);
  await press(gladys, IDS.valve, 'water_close');
  server.queue.push({
    match: (r) => r.body?.method === 'Manipulator.fetchState',
    body: {
      code: '000000',
      data: {
        online: false,
        state: { state: 'closed' },
        reportAt: new Date(Date.now() + 1000).toISOString(),
      },
    },
  });
  await advance(60_000);
  assert.equal(app.keeper.entries.size, 1, 'kept');
  assert.equal(closesOf(server).length, 2, 'sent again');
});

test('valves: a jammed valve, sent again 3 times, then every 15 min, given up after 24 h', async (t) => {
  const server = fakeYoLink();
  server.stuck.add(IDS.valve);
  const { gladys, app, advance, data } = await setup(t, { server });
  await createAll(gladys);
  assert.deepEqual(await press(gladys, IDS.valve, 'water_close'), { success: true });
  const firstSent = app.keeper.entries.get(IDS.valve).firstSent;
  for (let resend = 1; resend <= 3; resend += 1) {
    await advance(60_000);
    assert.equal(closesOf(server).length, 1 + resend, `resend ${resend}`);
  }
  await advance(60_000);
  assert.equal(closesOf(server).length, 4, 'held');
  assert.match(statusFr(gladys), /1 retenue : renvoyée toutes les 15 min/);
  await advance(15 * MINUTE);
  assert.equal(closesOf(server).length, 5, 'sent again after 15 min');
  assert.ok(server.calls('Manipulator.fetchState').length <= 4 + 2 + 2);
  t.mock.timers.tick(firstSent + 24 * 60 * MINUTE - 15 * MINUTE - Date.now() - 1_000);
  await settle();
  await advance(15 * MINUTE);
  const sent = closesOf(server).length;
  assert.equal(app.keeper.entries.size, 1);
  await advance(15 * MINUTE);
  assert.equal(app.keeper.entries.size, 0);
  assert.equal(closesOf(server).length, sent, 'not sent at the give-up');
  assert.match(statusFr(gladys), /Coupure abandonnée après 24 h .*: Main valve/);
  await app.keeper.saving;
  assert.deepEqual(keptFile(data), []);
});

test('valves: a LeakStop asleep (class A): told, kept and tried again 15 s later', async (t) => {
  const server = fakeYoLink();
  const leakStop = server.us.find((d) => d.deviceId === IDS.leakStop);
  leakStop.modelName = 'YS5009-UC';
  const { gladys, app, advance } = await setup(t, { server });
  await createAll(gladys);
  server.unreachable.add(IDS.leakStop);
  const ack = await press(gladys, IDS.leakStop, 'water_close');
  assert.equal(ack.success, false);
  assert.match(ack.error, /classe A/);
  assert.match(ack.error, /gardée et renvoyée/);
  assert.equal(app.keeper.entries.size, 1);
  server.unreachable.delete(IDS.leakStop);
  await advance(15_000);
  assert.equal(closesOf(server, 'WaterMeterController').length, 2, 'sent again');
  assert.equal(app.keeper.entries.size, 0, 'the valve answered closed');
});

test('valves: refused credentials keep the shutoff; it leaves once they work', async (t) => {
  const { gladys, server, app, advance } = await setup(t);
  await createAll(gladys);
  app.refused = true;
  const ack = await press(gladys, IDS.valve, 'water_close');
  assert.equal(ack.success, false);
  assert.match(ack.error, /la coupure est gardée et part dès/);
  assert.equal(closesOf(server).length, 0);
  await advance(2 * MINUTE);
  assert.equal(closesOf(server).length, 0, 'nothing while refused');
  await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  await settle();
  assert.equal(closesOf(server).length, 1, 'sent once the credentials work');
});

test('valves: a secret refused on the way of a shutoff is kept: no new try by itself', async (t) => {
  const server = fakeYoLink();
  server.stuck.add(IDS.valve);
  const { gladys, app, advance } = await setup(t, { server });
  await createAll(gladys);
  await press(gladys, IDS.valve, 'water_close');
  server.secret = 'changed elsewhere';
  server.tokens.clear();
  server.refreshTokens.clear();
  app.client.invalidate();
  await advance(60_000);
  assert.equal(app.refused, true);
  const asked = server.tokenRequests().length;
  await advance(5 * MINUTE);
  assert.equal(server.tokenRequests().length, asked, 'no new token request');
  assert.equal(app.keeper.entries.size, 1);
});

test('valves: a click during a pause YoLink asked: one request at once, never two a minute', async (t) => {
  const { gladys, server, app, advance } = await setup(t);
  await createAll(gladys);
  server.stuck.add(IDS.valve);
  app.pausedUntil = Date.now() + 15 * MINUTE;
  await press(gladys, IDS.valve, 'water_close');
  assert.equal(closesOf(server).length, 1, 'the shutoff leaves despite the pause');
  await advance(30_000);
  await press(gladys, IDS.valve, 'water_close');
  assert.equal(closesOf(server).length, 1, 'a second click within a minute waits');
  await advance(10 * MINUTE);
  assert.equal(closesOf(server).length, 1, 'no resend during the pause');
  await advance(6 * MINUTE);
  assert.ok(closesOf(server).length >= 2, 'sent again after the pause');
});

test('valves: limits reached on a shutoff: kept, sent again after the pause', async (t) => {
  const { gladys, server, app, advance } = await setup(t);
  await createAll(gladys);
  server.queue.push({
    match: (r) => r.body?.method === 'Manipulator.setState',
    body: { code: '010301', desc: 'Access denied due to limits reached, Please retry later' },
  });
  const ack = await press(gladys, IDS.valve, 'water_close');
  assert.equal(ack.success, false);
  assert.match(ack.error, /gardée et renvoyée/);
  assert.equal(app.pausedUntil, Date.now() + 15 * MINUTE);
  const requests = server.requests.length;
  await advance(14 * MINUTE);
  assert.equal(server.requests.length, requests, 'nothing during the pause');
  await advance(2 * MINUTE);
  assert.equal(closesOf(server).length, 2, 'sent again after the pause');
});

test('valves: a shutoff kept in /data is sent again after a restart, before the states', async (t) => {
  const server = fakeYoLink();
  server.stuck.add(IDS.valve);
  const data = dataDir(t);
  const first = await setup(t, { server, data });
  await createAll(first.gladys);
  await press(first.gladys, IDS.valve, 'water_close');
  first.app.stop();
  await first.app.keeper.saving;
  assert.equal(keptFile(data).length, 1);
  const before = server.requests.length;
  const gladys = createFakeGladys({ config: CONFIG });
  const app = new YoLinkApp({
    gladys,
    logger: createLogger({ level: 'silent' }),
    transport: server.transport,
    connect: (endpoint, options) => fakeMqtt(server).connect(endpoint, options),
    now: () => Date.now(),
    monotonic: () => Date.now(),
    stateSpacing: 0,
    dataDir: data,
  });
  apps.add(app);
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  assert.equal(closesOf(server).length, 2, 'sent once the devices are listed');
  const after = server.requests.slice(before).map((r) => r.body?.method);
  assert.ok(
    after.indexOf('Manipulator.setState') < after.indexOf('Manipulator.fetchState'),
    'before the states are read',
  );
  assert.match(gladys.fake.connectionStatus.message.fr, /1 coupure gardée/);
});

test('valves: /data unreadable is read again, never written over, then merged', async (t) => {
  const data = dataDir(t);
  mkdirSync(join(data, 'yolink-shutoffs.json'));
  const server = fakeYoLink();
  server.stuck.add(IDS.valve);
  // The LeakStop of the file does not answer: kept, so the merged file stays.
  server.unreachable.add(IDS.leakStop);
  const { gladys, app, advance, lines } = await setup(t, { data, server });
  await createAll(gladys);
  assert.equal(app.shutoffsLoaded, false);
  assert.ok(lines.some((l) => /Reading the shutoffs kept/.test(l)));
  await press(gladys, IDS.valve, 'water_close');
  assert.equal(closesOf(server).length, 1);
  await app.keeper.saving;
  assert.equal(statSync(join(data, 'yolink-shutoffs.json')).isDirectory(), true, 'not written');
  rmSync(join(data, 'yolink-shutoffs.json'), { recursive: true });
  writeFileSync(
    join(data, 'yolink-shutoffs.json'),
    JSON.stringify({ version: 1, shutoffs: [{ id: IDS.leakStop, name: 'Kept', at: 1 }] }),
  );
  await advance(MINUTE);
  await until(() => app.shutoffsLoaded, 'the file read again');
  await until(() => keptFile(data)?.length === 2, 'the file merged');
  await app.keeper.saving;
  await until(
    () => closesOf(server, 'WaterMeterController').length === 1,
    'the shutoff of the file sent',
  );
});

test('valves: a shutoff clicked before the account is read leaves at the first list', async (t) => {
  const server = fakeYoLink();
  server.down = true;
  const { gladys, app, advance } = await setup(t, { server });
  const device = { external_id: dev(IDS.valve), name: 'Main valve' };
  const ack = await gladys.fake.setValue(
    device,
    { external_id: `${dev(IDS.valve)}:water_close` },
    1,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /pas encore configuré ou lu : la coupure est gardée/);
  assert.equal(app.keeper.entries.get(IDS.valve).name, 'Main valve');
  assert.equal(app.keeper.entries.get(IDS.valve).sends, 0, 'nothing counted as sent');
  server.down = false;
  const before = server.requests.length;
  await advance(2 * MINUTE);
  assert.equal(closesOf(server).length, 1);
  const after = server.requests.slice(before).map((r) => r.body?.method);
  assert.ok(after.indexOf('Manipulator.setState') < after.indexOf('Manipulator.fetchState'));
});

test('valves: let go when deleted in Gladys, or missing from two device lists', async (t) => {
  const server = fakeYoLink();
  server.stuck.add(IDS.valve);
  const { gladys, app, advance } = await setup(t, { server });
  await createAll(gladys);
  await press(gladys, IDS.valve, 'water_close');
  await gladys.fake.deviceDeleted(deviceOf(gladys, dev(IDS.valve)));
  assert.equal(app.keeper.entries.size, 0);
  await gladys.fake.deviceCreated(deviceOf(gladys, dev(IDS.valve)));
  await press(gladys, IDS.valve, 'water_close');
  const all = server.us;
  server.us = all.filter((d) => d.deviceId !== IDS.valve);
  app.nextRefreshAt = 0;
  await advance(MINUTE);
  assert.equal(app.keeper.entries.size, 1, 'one list without it is not enough');
  app.nextRefreshAt = 0;
  await advance(MINUTE);
  assert.equal(app.keeper.entries.size, 0);
});

test('valves: an opening in flight when a shutoff is clicked never lets it go', async (t) => {
  const server = fakeYoLink();
  const { gladys, app, advance } = await setup(t, {
    server,
    config: { ...CONFIG, allow_valve_open: true },
  });
  await createAll(gladys);
  server.states[IDS.valve].state = 'closed';
  server.delays.push({
    match: (r) => r.body?.method === 'Manipulator.setState' && r.body.params.state === 'open',
    ms: 2_000,
  });
  const opening = press(gladys, IDS.valve, 'water_open');
  await settle();
  server.stuck.add(IDS.valve);
  server.states[IDS.valve].state = 'open';
  assert.deepEqual(await press(gladys, IDS.valve, 'water_close'), { success: true });
  await advance(3_000);
  await opening;
  assert.equal(app.keeper.entries.size, 1, 'the later shutoff is still kept');
});

test('valves: an opening that cannot leave within 3.5 s is never sent late', async (t) => {
  const server = fakeYoLink();
  const { gladys, app, advance } = await setup(t, {
    server,
    config: { ...CONFIG, allow_valve_open: true },
  });
  await createAll(gladys);
  server.states[IDS.valve].state = 'closed';
  // The token is renewed first, and that takes 4 s.
  server.tokens.clear();
  app.client.invalidate();
  server.delays.push({ match: (r) => r.url === TOKEN_URL, ms: 4_000 });
  const opening = press(gladys, IDS.valve, 'water_open');
  await advance(5_000);
  const ack = await opening;
  assert.equal(ack.success, false);
  assert.match(ack.error, /3,5 secondes/);
  assert.equal(server.calls('Manipulator.setState').length, 0);
});

test('valves: a device created before 0.1.3 keeps its switch when published again', async (t) => {
  const { gladys, app, advance } = await setup(t);
  await createAll(gladys);
  assert.equal(
    deviceOf(gladys, dev(IDS.valve)).features.some((f) => f.external_id.endsWith(':valve')),
    false,
    'a new device: no switch',
  );
  const old = structuredClone(deviceOf(gladys, dev(IDS.valve)));
  old.features.push({ ...old.features[0], external_id: `${dev(IDS.valve)}:valve` });
  await gladys.fake.deviceCreated(old);
  gladys.devices = gladys.devices.map((d) => (d.external_id === old.external_id ? old : d));
  app.nextRefreshAt = 0;
  await advance(MINUTE);
  const valve = deviceOf(gladys, dev(IDS.valve)).features.find((f) =>
    f.external_id.endsWith(':valve'),
  );
  assert.ok(valve, 'still offered: saving it again loses nothing');
  assert.deepEqual([valve.category, valve.type, valve.read_only], ['switch', 'binary', false]);
});

test('valves: clicked while refused, sent 25 h later: its 24 h count from that send', async (t) => {
  const server = fakeYoLink();
  server.stuck.add(IDS.valve);
  const { gladys, app, advance } = await setup(t, { server });
  await createAll(gladys);
  app.refused = true;
  assert.equal((await press(gladys, IDS.valve, 'water_close')).success, false);
  t.mock.timers.tick(25 * 60 * MINUTE);
  await settle();
  await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  await until(() => closesOf(server).length === 1, 'sent once the credentials work');
  await advance(60_000);
  assert.equal(app.keeper.entries.size, 1, 'not given up');
  assert.equal(closesOf(server).length, 2);
});

test('valves: an opening whose option is unchecked right before the request: not sent', async (t) => {
  const { gladys, server, app } = await setup(t, {
    config: { ...CONFIG, allow_valve_open: true },
  });
  await createAll(gladys);
  server.states[IDS.valve].state = 'closed';
  const token = app.client.token.bind(app.client);
  app.client.token = async () => {
    app.config = { ...app.config, allowValveOpen: false };
    return token();
  };
  const ack = await press(gladys, IDS.valve, 'water_open');
  assert.equal(ack.success, false);
  assert.match(ack.error, /ouverture des vannes/);
  assert.equal(server.calls('Manipulator.setState').length, 0);
});

test('valves: a shutoff clicked right before the request of an opening cancels it', async (t) => {
  const { gladys, server, app } = await setup(t, {
    config: { ...CONFIG, allow_valve_open: true },
  });
  await createAll(gladys);
  server.states[IDS.valve].state = 'closed';
  const token = app.client.token.bind(app.client);
  let clicked = false;
  app.client.token = async () => {
    if (!clicked) {
      clicked = true;
      app.keeper.click(IDS.valve, 'Main valve');
    }
    return token();
  };
  const ack = await press(gladys, IDS.valve, 'water_open');
  assert.equal(ack.success, false);
  assert.match(ack.error, /Annulée par une coupure/);
  assert.equal(
    server.calls('Manipulator.setState').filter((r) => r.body.params.state === 'open').length,
    0,
  );
});

test('valves: a shutoff clicked while the configuration is missing is kept in /data', async (t) => {
  const data = dataDir(t);
  const server = fakeYoLink();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config: {} });
  const app = new YoLinkApp({
    gladys,
    logger: createLogger({ level: 'silent' }),
    transport: server.transport,
    connect: (endpoint, options) => fakeMqtt(server).connect(endpoint, options),
    now: () => Date.now(),
    monotonic: () => Date.now(),
    stateSpacing: 0,
    dataDir: data,
  });
  apps.add(app);
  await app.connectedWith(
    () => undefined,
    async () => {
      throw new Error('HTTP 500');
    },
  );
  await app
    .setValue({ name: 'Main valve' }, { external_id: `${dev(IDS.valve)}:water_close` }, 1)
    .catch(() => {});
  await app.keeper.saving;
  assert.deepEqual(
    keptFile(data).map((e) => e.id),
    [IDS.valve],
  );
});

test('valves: Gladys connected, the configuration of the SDK used; missing, asked again', async (t) => {
  const { gladys, app } = await setup(t);
  gladys.getConfig = async () => {
    throw new Error('HTTP 500');
  };
  await app.connectedWith(
    () => gladys.config,
    () => gladys.getConfig(),
  );
  assert.equal(app.client.hasCredentials, true);
  assert.doesNotMatch(gladys.fake.connectionStatus.message.fr, /configuration/);
  let calls = 0;
  const fetchConfig = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('HTTP 500');
    }
    return CONFIG;
  };
  app.started = false;
  await app.connectedWith(() => undefined, fetchConfig);
  assert.match(gladys.fake.connectionStatus.message.fr, /configuration n'a pas pu être lue/);
  assert.doesNotMatch(gladys.fake.connectionStatus.message.fr, /refus/);
  t.mock.timers.tick(10_000);
  await until(() => calls === 2, 'asked again in 10 s');
  await until(() => app.started, 'started');
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
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', -1), { success: true });
  assert.equal(server.calls('GarageDoor.toggle').length, 0);
  const refused = await set(gladys, IDS.garage, 'garage', 1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /garage/);
  assert.equal(server.calls('GarageDoor.toggle').length, 0);

  // The sensor is read again just before the toggle.
  server.states[IDS.garageSensor].state = 'open';
  const reads = server.calls('DoorSensor.fetchState').length;
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', -1), { success: true });
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
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', -1), { success: true });
  await advance(5000);
  const ignored = await set(gladys, IDS.garage, 'garage', -1);
  assert.equal(ignored.success, false);
  assert.match(ignored.error, /commande ignorée/);
  assert.equal(server.calls('GarageDoor.toggle').length, 1, 'one toggle for two "close"');
  // 60 s later, the guard is over.
  await advance(56_000);
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', -1), { success: true });
  assert.equal(server.calls('GarageDoor.toggle').length, 2);
  // A change reported by the sensor ends the guard at once.
  server.states[IDS.garageSensor].state = 'closed';
  mqtt.publish('US', report(IDS.garageSensor, 'DoorSensor.Alert', { state: 'closed' }));
  await advance(1000);
  server.states[IDS.garageSensor].state = 'open';
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', -1), { success: true });
  assert.equal(server.calls('GarageDoor.toggle').length, 3);
});

test('garage doors: two "close" at the same time send one toggle', async (t) => {
  const server = fakeYoLink();
  server.doorMoves = false;
  server.states[IDS.garageSensor].state = 'open';
  const { gladys } = await setup(t, { server });
  await createAll(gladys);
  const acks = await Promise.all([
    set(gladys, IDS.garage, 'garage', -1),
    set(gladys, IDS.garage, 'garage', -1),
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
    const refused = await set(gladys, IDS.garage, 'garage', -1);
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
  const refused = await set(gladys, IDS.garage, 'garage', -1);
  assert.equal(refused.success, false);
  assert.equal(server.calls('GarageDoor.toggle').length, 0);
});

test('garage doors: a sensor offline refuses the command', async (t) => {
  const server = fakeYoLink();
  server.states[IDS.garageSensor].state = 'open';
  const { gladys } = await setup(t, { server, config: { ...CONFIG, allow_garage_open: true } });
  await createAll(gladys);
  server.unreachable.add(IDS.garageSensor);
  const refused = await set(gladys, IDS.garage, 'garage', -1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /inconnu/);
  assert.equal(server.calls('GarageDoor.toggle').length, 0);
});

test('a garage door without a sensor: every toggle is refused', async (t) => {
  const server = fakeYoLink();
  server.us = server.us.filter((d) => d.deviceId !== IDS.garageSensor);
  const { gladys } = await setup(t, { server, config: { ...CONFIG, allow_garage_open: true } });
  await createAll(gladys);
  const refused = await set(gladys, IDS.garage, 'garage', -1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /inconnu/);
  assert.equal(server.calls('GarageDoor.toggle').length, 0);
});

test('garage doors are a cover command, never a switch', async (t) => {
  const { gladys, app } = await setup(t);
  const garage = featureOf(gladys, IDS.garage, 'garage');
  assert.equal(garage.category, 'shutter');
  assert.equal(garage.type, 'state');
  assert.deepEqual([garage.min, garage.max], [-1, 1]);
  assert.equal(garage.read_only, false);
  assert.equal(garage.name, 'Porte de garage');
  // No switch at all on a garage controller: "turn everything on" cannot reach a door.
  for (const device of app.devices.values()) {
    if (device.kind === 'garage') {
      const features = deviceOf(gladys, dev(device.id)).features;
      assert.ok(
        features.every((f) => f.category !== 'switch'),
        device.id,
      );
    }
  }
});

test('garage doors: stop and other values are refused, nothing is sent', async (t) => {
  const server = fakeYoLink();
  server.states[IDS.garageSensor].state = 'open';
  const { gladys } = await setup(t, { server, config: { ...CONFIG, allow_garage_open: true } });
  await createAll(gladys);
  const reads = server.calls('DoorSensor.fetchState').length;
  const stop = await set(gladys, IDS.garage, 'garage', 0);
  assert.equal(stop.success, false);
  assert.match(stop.error, /arrêter/);
  for (const value of [2, 0.5, 'open']) {
    assert.equal((await set(gladys, IDS.garage, 'garage', value)).success, false, String(value));
  }
  assert.equal(server.calls('DoorSensor.fetchState').length, reads);
  assert.equal(server.calls('GarageDoor.toggle').length, 0);
});

test('garage doors: a sensor too slow for the 5 s ack refuses before acting', async (t) => {
  const server = fakeYoLink();
  server.states[IDS.garageSensor].state = 'open';
  const { gladys, advance } = await setup(t, { server });
  await createAll(gladys);
  server.delays.push({
    match: (r) =>
      r.body?.method === 'DoorSensor.fetchState' && r.body.targetDevice === IDS.garageSensor,
    ms: 4000,
  });
  const pending = set(gladys, IDS.garage, 'garage', -1);
  await advance(6000);
  const refused = await pending;
  assert.equal(refused.success, false);
  assert.match(refused.error, /à temps/);
  assert.equal(server.calls('GarageDoor.toggle').length, 0, 'never sent after the deadline');
});

test('garage doors: while the door moves, even a command "already done" is refused', async (t) => {
  const server = fakeYoLink();
  server.doorMoves = false;
  server.states[IDS.garageSensor].state = 'open';
  const { gladys, advance } = await setup(t, {
    server,
    config: { ...CONFIG, allow_garage_open: true },
  });
  await createAll(gladys);
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', -1), { success: true });
  await advance(2000);
  // The sensor still says "open" (state of departure): "open" is not a success.
  const ignored = await set(gladys, IDS.garage, 'garage', 1);
  assert.equal(ignored.success, false);
  assert.match(ignored.error, /commande ignorée/);
  assert.equal(server.calls('GarageDoor.toggle').length, 1);
});

test('garage doors: an unknown sensor state never lifts the guard', async (t) => {
  const server = fakeYoLink();
  server.doorMoves = false;
  server.states[IDS.garageSensor].state = 'open';
  const { gladys, app, advance } = await setup(t, { server });
  await createAll(gladys);
  assert.deepEqual(await set(gladys, IDS.garage, 'garage', -1), { success: true });
  const garage = app.devices.get(IDS.garage);
  app.readings.set(IDS.garageSensor, {});
  assert.equal(app.garageMoving(garage), true, 'no state: still guarded');
  app.readings.set(IDS.garageSensor, { state: 'open' });
  assert.equal(app.garageMoving(garage), true, 'the state of departure: still guarded');
  await advance(61_000);
  assert.equal(app.garageMoving(garage), false, 'expired');
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
