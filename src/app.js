// -----------------------------------------------------------------------------
// The integration: the YoLink account (UAC), a full refresh at start and every
// 30 minutes by default (device list and the state of each device), the live
// events of MQTT in between, the Gladys devices and their states, the
// commands (plugs, switches, valves, locks, sirens, garage doors) with the
// risky ones off by default, and the transport badges. index.js only wires
// the SDK handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { YoLinkClient } from './client.js';
import { normalizeConfig } from './config.js';
import {
  ENDPOINTS,
  LEAK_STOP_MODELS,
  MOMENT_EVENTS,
  MQTT_RECORD_EVENT,
  TIMINGS,
} from './constants.js';
import {
  MOMENT_ROLES,
  buildDevices,
  deviceIds,
  deviceName,
  parseFeatureId,
  socketsOf,
  statesOf,
} from './devices.js';
import { T, age, word } from './i18n.js';
import { endpointOf, flatten, latestRecord, openState, readInventory } from './inventory.js';
import { LiveEvents } from './live.js';
import { StatePublisher } from './publisher.js';
import { errorReason } from './yolink.js';

/** Errors after which only a change of the configuration (or the test button) helps. */
const REFUSED = new Set(['refused', 'no_credentials']);
/** Errors meaning YoLink did not answer usefully: the devices are unreachable. */
const OFFLINE = new Set(['network', 'timeout', 'unavailable', 'bad_response', 'size', 'http']);
/** Errors of one device: the refresh goes on with the others. */
const DEVICE_ERRORS = new Set(['device', 'unsupported', 'api']);
/** The device kind each command role belongs to. */
const KIND_OF_ROLE = {
  switch: 'switch',
  socket: 'multi-outlet',
  valve: 'valve',
  lock: 'lock',
  siren: 'siren',
  garage: 'garage',
};

export class YoLinkApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'yolink' }),
    transport,
    connect,
    now = Date.now,
    timers = globalThis,
    randomId,
    stateSpacing = TIMINGS.stateSpacing,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.stateSpacing = stateSpacing;
    this.client = new YoLinkClient({ transport, now });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.live = new LiveEvents({
      connect,
      token: () => this.client.token(),
      invalidateToken: () => this.client.invalidate(),
      onReport: (id, event, data) => this.report(id, event, data),
      onChange: () => this.liveChanged(),
      onRefused: (err) => this.failed(err).catch((e) => this.logger.warn(`YoLink: ${e.message}`)),
      logger,
      now,
      timers,
      randomId,
    });
    this.config = normalizeConfig();
    /** id -> device of src/inventory.js, the supported ones */
    this.devices = new Map();
    this.skipped = [];
    /** id -> last reading (flat) */
    this.readings = new Map();
    /** id -> false when YoLink reports the device offline */
    this.online = new Map();
    this.homeId = undefined;
    this.readAt = undefined;
    this.nextRefreshAt = 0;
    /** Until when YoLink asked to slow down: no scan or test read before. */
    this.pausedUntil = 0;
    /** garageId -> { until, door }: a toggle just sent, and the sensor state then */
    this.garageGuards = new Map();
    this.published = undefined;
    /** deviceId -> badge last published (JSON) */
    this.transports = new Map();
    this.timer = undefined;
    this.running = undefined;
    this.generation = 0;
    this.refused = false;
    this.offline = false;
    this.failures = 0;
    this.lastTestAt = -Infinity;
    this.started = false;
    this.lastStatus = undefined;
    this.warned = new Set();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.client.configure({ uaid: this.config.uaid, secretKey: this.config.secretKey });
    this.publisher.start();
    if (!this.client.hasCredentials) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    await this.setStatus(false, T.connecting);
    this.timer = this.timers.setInterval(() => {
      this.tick().catch((err) => this.logger.error(`YoLink refresh failed: ${err.message}`));
    }, TIMINGS.tickInterval);
    await this.refresh();
  }

  stop() {
    this.generation += 1;
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
    this.publisher.stop();
    this.live.stop();
  }

  /** Forgets the account and the failures: new credentials, or a restart. */
  reset() {
    this.devices.clear();
    this.skipped = [];
    this.readings.clear();
    this.online.clear();
    this.homeId = undefined;
    this.readAt = undefined;
    this.nextRefreshAt = 0;
    this.pausedUntil = 0;
    this.garageGuards.clear();
    this.published = undefined;
    this.transports.clear();
    this.refused = false;
    this.offline = false;
    this.failures = 0;
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (Discovery list,
   * status, badges) without reading YoLink again.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.transports.clear();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishAllTransports();
  }

  /** New credentials restart; a new language renames; the rest applies at once. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.uaid !== previous.uaid || next.secretKey !== previous.secretKey) {
      return this.start(raw);
    }
    this.config = next;
    if (next.refreshInterval !== previous.refreshInterval && this.readAt !== undefined) {
      this.nextRefreshAt = this.readAt + next.refreshInterval * 60_000;
    }
    if (next.language !== previous.language) {
      await this.publishDevices();
    }
    if (next.liveEvents !== previous.liveEvents && this.readAt !== undefined && !this.refused) {
      this.syncLive();
      await this.liveChanged();
    }
  }

  /** Live events on (configuration) -> the MQTT connections of the clouds in use; off -> none. */
  syncLive() {
    if (this.config.liveEvents && this.homeId !== undefined) {
      this.live.start(this.homeId, this.endpoints());
    } else {
      this.live.stop();
    }
  }

  /** The live events for the messages: true, false (connecting) or 'off'. */
  liveState() {
    return this.config.liveEvents ? this.live.connected : 'off';
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Full refresh ----------------------------------------------------------

  /** Every minute: a refresh when one is due. */
  async tick() {
    if (this.now() >= this.nextRefreshAt) {
      await this.refresh();
    }
  }

  /** One refresh at a time: a call during a refresh joins it. */
  refresh() {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  sleep(ms) {
    return ms > 0 ? new Promise((resolve) => this.timers.setTimeout(resolve, ms)) : undefined;
  }

  async run() {
    const generation = this.generation;
    if (!this.client.hasCredentials || this.refused) {
      return;
    }
    try {
      this.homeId ??= await this.client.homeId();
      const us = await this.client.deviceList(ENDPOINTS.US);
      // The EU devices take their token from the EU cloud (yolink-api does the same).
      const eu = us.some((d) => endpointOf(d ?? {}) === ENDPOINTS.EU)
        ? await this.client.deviceList(ENDPOINTS.EU)
        : [];
      if (generation !== this.generation) {
        return;
      }
      this.applyInventory(us, eu);
      for (const device of this.devices.values()) {
        if (generation !== this.generation) {
          return;
        }
        await this.readState(device);
        await this.sleep(this.stateSpacing);
      }
      if (generation !== this.generation) {
        return;
      }
      this.readAt = this.now();
      this.nextRefreshAt = this.readAt + this.config.refreshInterval * 60_000;
      this.failures = 0;
      this.offline = false;
      await this.publishDevices();
      this.queueAll();
      this.syncLive();
      await this.setStatus(true, this.statusMessage());
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    }
    await this.publishAllTransports();
    await this.flush();
  }

  applyInventory(us, eu) {
    const { devices, skipped } = readInventory(us, eu);
    this.devices = new Map(devices.map((d) => [d.id, d]));
    this.skipped = skipped;
    for (const { id, type } of skipped) {
      if (!this.warned.has(id)) {
        this.warned.add(id);
        this.logger.info(`YoLink device ${id} (${type}) is not supported yet`);
      }
    }
    for (const id of [...this.readings.keys()]) {
      if (!this.devices.has(id)) {
        this.readings.delete(id);
        this.online.delete(id);
      }
    }
  }

  /** The state of one device; a device that does not answer is marked offline. */
  async readState(device) {
    try {
      const data = await this.client.state(device);
      this.readings.set(device.id, flatten(data));
      this.online.set(device.id, data.online !== false);
    } catch (err) {
      if (!DEVICE_ERRORS.has(err.kind)) {
        throw err;
      }
      if (err.kind === 'device') {
        this.online.set(device.id, false);
      }
      this.logger.info(`${deviceName(device, 'en')}: no state (${errorReason(err)})`);
    }
  }

  /** The clouds the devices use (the US one at least). */
  endpoints() {
    const names = new Set([...this.devices.values()].map((d) => d.endpoint.name));
    return Object.values(ENDPOINTS).filter((e) => e === ENDPOINTS.US || names.has(e.name));
  }

  statusMessage() {
    return T.connected(this.devices.size, this.liveState());
  }

  async failed(err) {
    const reason = errorReason(err);
    if (REFUSED.has(err.kind)) {
      this.refused = true;
      this.live.stop();
      this.logger.warn(`YoLink refused the credentials: ${reason}`);
      await this.setStatus(false, T.refused);
      return;
    }
    let wait;
    if (err.kind === 'rate_limited') {
      wait = TIMINGS.rateLimitPause;
      this.pausedUntil = this.now() + wait;
      await this.setStatus(this.readAt !== undefined, T.rateLimited(age(wait)));
    } else {
      wait = TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)];
      this.offline = OFFLINE.has(err.kind) || this.offline;
      await this.setStatus(false, T.unreachable(reason, age(wait)));
    }
    this.failures += 1;
    this.nextRefreshAt = this.now() + wait;
    this.logger.warn(`YoLink: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  // --- Live events -----------------------------------------------------------

  /** An MQTT report of one device. */
  report(id, event, data) {
    const device = this.devices.get(id);
    if (!device) {
      return;
    }
    const values = event === MQTT_RECORD_EVENT ? latestRecord(data) : flatten(data);
    if (!values) {
      return;
    }
    this.readings.set(id, { ...this.readings.get(id), ...values });
    const wasOffline = this.online.get(id) === false;
    this.online.set(id, true);
    const moment = MOMENT_EVENTS.some((suffix) => event.endsWith(`.${suffix}`));
    this.queue(device, { moment });
    for (const garage of this.garagesOf(device)) {
      // The sensor reported: a guard against a second toggle ends on a change.
      this.garageMoving(garage);
      this.queue(garage, { moment });
    }
    if (device.kind === 'multi-outlet') {
      this.publishDevices().catch(() => {});
    }
    if (wasOffline) {
      this.publishAllTransports().catch(() => {});
    }
  }

  async liveChanged() {
    if (this.readAt !== undefined && !this.refused) {
      await this.setStatus(true, this.statusMessage());
    }
    await this.publishAllTransports();
  }

  // --- Gladys ----------------------------------------------------------------

  async publishDevices() {
    if (this.readAt === undefined) {
      return;
    }
    const devices = buildDevices(
      this.gladys,
      [...this.devices.values()],
      this.readings,
      this.config.language,
    );
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /** The door sensor whose state is the one of a garage controller. */
  doorOf(garage) {
    for (const d of this.devices.values()) {
      if (d.kind === 'door' && (d.parentId === garage.id || d.id === garage.parentId)) {
        return d;
      }
    }
    return undefined;
  }

  garagesOf(device) {
    if (device.kind !== 'door') {
      return [];
    }
    return [...this.devices.values()].filter(
      (d) => d.kind === 'garage' && this.doorOf(d) === device,
    );
  }

  /** "open" / "closed" / undefined: the garage door, from its door sensor. */
  garageState(garage) {
    const door = this.doorOf(garage);
    return door ? openState(this.readings.get(door.id) ?? {}) : undefined;
  }

  /** Queues the states of one device (the features created in Gladys only). */
  queue(device, { moment = false, created = this.createdFeatures() } = {}) {
    const reading = this.readings.get(device.id) ?? {};
    const door = device.kind === 'garage' ? this.doorOf(device) : undefined;
    const ids = deviceIds(this.gladys, device.id);
    for (const { role, state } of statesOf(device, reading, {
      door: door ? (this.readings.get(door.id) ?? {}) : undefined,
      sockets: device.kind === 'multi-outlet' ? socketsOf(device, reading) : undefined,
    })) {
      const id = ids.feature(role);
      if (!created.has(id)) {
        continue;
      }
      if (moment && MOMENT_ROLES.includes(role)) {
        this.publisher.pushEvent(id, { state });
      } else {
        this.publisher.push(id, { state });
      }
    }
  }

  queueAll(created = this.createdFeatures()) {
    for (const device of this.devices.values()) {
      this.queue(device, { created });
    }
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  badge(device) {
    if (this.refused || this.offline) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (this.online.get(device.id) === false) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE, degraded: true, message: T.offline };
    }
    if (
      this.config.liveEvents &&
      this.homeId !== undefined &&
      this.readAt !== undefined &&
      !this.live.connected
    ) {
      return { transport: DEVICE_TRANSPORTS.CLOUD, degraded: true, message: T.liveDown };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  }

  async publishAllTransports() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const entries = [];
    for (const device of this.devices.values()) {
      const externalId = deviceIds(this.gladys, device.id).device;
      if (!created.has(externalId)) {
        continue;
      }
      const entry = { external_id: externalId, ...this.badge(device) };
      const json = JSON.stringify(entry);
      if (this.transports.get(externalId) !== json) {
        this.transports.set(externalId, json);
        entries.push(entry);
      }
    }
    if (entries.length > 0) {
      await this.gladys
        .publishTransports(entries)
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.transports.delete(device?.external_id);
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueAll(created);
    await this.flush();
    await this.publishAllTransports();
  }

  async deviceDeleted(device) {
    this.transports.delete(device?.external_id);
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: a fresh refresh if the last one is old enough. */
  async scan() {
    if (
      this.client.hasCredentials &&
      !this.refused &&
      this.now() >= this.pausedUntil &&
      (this.readAt === undefined || this.now() - this.readAt >= TIMINGS.testCooldown)
    ) {
      await this.refresh();
      return;
    }
    await this.publishDevices();
  }

  // --- Commands --------------------------------------------------------------

  denied(key) {
    return new Error(word(T.denied[key], this.config.language));
  }

  async setValue(_gladysDevice, feature, value) {
    const target = parseFeatureId(feature?.external_id);
    const role = target?.role;
    if (!target || !Object.hasOwn(KIND_OF_ROLE, role)) {
      throw new Error(`${feature?.external_id} cannot be set`);
    }
    const on = Number(value);
    if (on !== 0 && on !== 1) {
      throw new Error(`Unexpected value "${value}" (0 or 1)`);
    }
    if (this.refused) {
      throw new Error(word(T.refused, this.config.language));
    }
    const device = this.devices.get(target.id);
    if (!device) {
      throw new Error('Unknown YoLink device: wait for the first reading of the account');
    }
    if (role === 'garage' && device.kind === 'garage') {
      await this.refreshGarageDoor(device);
    }
    const command = this.commandOf(device, role, on === 1, target.index);
    if (!command) {
      return;
    }
    let answer;
    try {
      answer = await this.client.invoke(device, command.method, command.params);
    } catch (err) {
      if (
        err.kind === 'device' &&
        device.kind === 'valve' &&
        LEAK_STOP_MODELS.includes(device.model)
      ) {
        throw new Error(word(T.leakStopAsleep, this.config.language), { cause: err });
      }
      // The ack shows the message: YoLink's own, with its code.
      throw new Error(errorReason(err), { cause: err });
    }
    this.logger.info(`${deviceName(device, 'en')}: ${command.method} ${command.log}`);
    if (role === 'garage') {
      this.garageGuards.set(device.id, {
        until: this.now() + TIMINGS.garageGuard,
        door: this.garageState(device),
      });
    }
    const fromAnswer = flatten(answer);
    const reading = command.optimistic
      ? { ...command.optimistic, ...fromAnswer }
      : 'state' in fromAnswer
        ? fromAnswer
        : undefined;
    if (reading) {
      this.readings.set(device.id, { ...this.readings.get(device.id), ...reading });
      this.queue(device);
      await this.flush();
    }
  }

  /**
   * Just before a garage toggle: the sensor of the door read again, so the
   * toggle never relies on an old state. A sensor offline or without a state
   * leaves the door unknown, and commandOf() refuses.
   */
  async refreshGarageDoor(garage) {
    const door = this.doorOf(garage);
    if (!door) {
      return;
    }
    try {
      await this.readState(door);
    } catch (err) {
      this.online.set(door.id, false);
      this.logger.info(`${deviceName(door, 'en')}: no state (${errorReason(err)})`);
    }
    for (const g of this.garagesOf(door)) {
      this.queue(g);
    }
  }

  /** A garage toggle in progress: the guard holds until it expires or the sensor reports a change. */
  garageMoving(garage) {
    const guard = this.garageGuards.get(garage.id);
    if (!guard) {
      return false;
    }
    if (this.now() >= guard.until || this.garageState(garage) !== guard.door) {
      this.garageGuards.delete(garage.id);
      return false;
    }
    return true;
  }

  /**
   * The BDDP of a command, after the safety options: `{ method, params, log,
   * optimistic? }`, or null when there is nothing to do. `optimistic`: the
   * reading shown before YoLink reports it (the harmless commands only; a
   * lock, a valve or a garage door wait for the device to report).
   */
  commandOf(device, role, on, index) {
    const { allowUnlock, allowGarageOpen, allowValveOpen, allowValveClose, allowSirenStop } =
      this.config;
    if (device.kind !== KIND_OF_ROLE[role] || (role === 'socket' && !(index >= 0 && index < 8))) {
      throw new Error(`${role} is not a feature of this ${device.type}`);
    }
    switch (role) {
      case 'switch': {
        const state = on ? 'open' : 'close';
        return {
          method: 'setState',
          params: { state },
          log: state,
          optimistic: { state: on ? 'open' : 'closed' },
        };
      }
      case 'socket': {
        const state = on ? 'open' : 'close';
        const sockets = [...(this.readings.get(device.id)?.state ?? [])];
        sockets[index] = on ? 'open' : 'closed';
        return {
          method: 'setState',
          params: { chs: 1 << index, state },
          log: `${state} socket ${index + 1}`,
          optimistic: { state: Array.from(sockets, (s) => s ?? 'closed') },
        };
      }
      case 'valve': {
        if (on && !allowValveOpen) {
          throw this.denied('valve');
        }
        if (!on && !allowValveClose) {
          throw this.denied('valveClose');
        }
        const state = on ? 'open' : 'close';
        return {
          method: 'setState',
          params: device.type === 'Manipulator' ? { state } : { valve: state },
          log: state,
        };
      }
      case 'lock': {
        if (!on && !allowUnlock) {
          throw this.denied('unlock');
        }
        return {
          method: 'setState',
          params:
            device.type === 'LockV2'
              ? { state: { lock: on ? 'locked' : 'unlocked' } }
              : { state: on ? 'lock' : 'unlock' },
          log: on ? 'lock' : 'unlock',
        };
      }
      case 'siren':
        if (!on && !allowSirenStop) {
          throw this.denied('sirenStop');
        }
        return {
          method: 'setState',
          params: { state: { alarm: on } },
          log: on ? 'alarm on' : 'alarm off',
          optimistic: { state: on ? 'alert' : 'normal' },
        };
      case 'garage': {
        const door = this.doorOf(device);
        const current =
          door && this.online.get(door.id) !== false ? this.garageState(device) : undefined;
        if (on && !allowGarageOpen) {
          throw this.denied('garage');
        }
        if (current === undefined) {
          // A toggle on a door of unknown state may do the opposite.
          throw this.denied('garageUnknown');
        }
        if ((current === 'open') === on) {
          return null;
        }
        if (this.garageMoving(device)) {
          // A second toggle while the door moves would reverse it.
          this.logger.info(`${deviceName(device, 'en')}: toggle ignored, the door is moving`);
          return null;
        }
        return { method: 'toggle', params: undefined, log: on ? '(open)' : '(close)' };
      }
      default:
        return null;
    }
  }

  // --- "Test the connection" button -----------------------------------------

  async testConnection() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    if (this.readAt !== undefined && this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const summary = this.summary();
      return {
        en: `${T.test.cooldown.en} ${summary.en}`,
        fr: `${T.test.cooldown.fr} ${summary.fr}`,
      };
    }
    if (this.now() < this.pausedUntil) {
      // YoLink asked to slow down: the button does not read before the pause ends.
      return T.rateLimited(age(this.pausedUntil - this.now()));
    }
    this.lastTestAt = this.now();
    // One token request per click: the button is how refused credentials are retried.
    this.refused = false;
    this.nextRefreshAt = 0;
    await this.running;
    await this.refresh();
    const [connected, message] = JSON.parse(this.lastStatus ?? '[false,null]');
    if (!connected || this.readAt === undefined) {
      return message ?? T.noCredentials;
    }
    return this.summary();
  }

  summary() {
    return T.test.summary(this.devices.size, this.skipped.length, this.liveState());
  }
}
