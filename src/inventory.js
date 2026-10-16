// -----------------------------------------------------------------------------
// The YoLink answers -> plain values (pure).
//
// - readInventory(): the device lists of the two clouds -> the devices, with
//   the cloud each one belongs to and the token to command it with.
// - flatten(): a state answer or an MQTT report -> one flat "reading".
// - the readers of a reading: open/closed, alert, on/off, locked, valve,
//   temperature, humidity, battery, power.
// -----------------------------------------------------------------------------

import { ENDPOINTS, KINDS, MQTT_EVENTS, MQTT_RECORD_EVENT, VALVELESS_MODELS } from './constants.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' && value !== '' ? value : undefined);

/** The cloud of a device (yolink-api `YoLinkDevice.__init__`). */
export function endpointOf({ serviceZone, modelName }) {
  if (typeof serviceZone === 'string' && serviceZone !== '') {
    return serviceZone.startsWith('eu_') ? ENDPOINTS.EU : ENDPOINTS.US;
  }
  return typeof modelName === 'string' && modelName.endsWith('-EC') ? ENDPOINTS.EU : ENDPOINTS.US;
}

/** "YS7704-UC" -> "YS7704". */
export const modelOf = (modelName) => (text(modelName) ?? '').split('-')[0];

/**
 * The devices of the account. The US list has every device; an EU device
 * takes its token from the EU list (yolink-api "sync eu device token").
 * Returns `{ devices, skipped }`, `skipped` being the unsupported types.
 */
export function readInventory(usList, euList = []) {
  const euTokens = new Map(
    euList.filter((d) => text(d?.deviceId) && text(d?.token)).map((d) => [d.deviceId, d.token]),
  );
  const devices = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of usList) {
    const id = text(raw?.deviceId);
    const type = text(raw?.type);
    if (!id || !type || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const endpoint = endpointOf(raw);
    const token =
      endpoint === ENDPOINTS.EU ? (euTokens.get(id) ?? text(raw.token)) : text(raw.token);
    const kind = KINDS[type];
    const valveless = kind === 'valve' && VALVELESS_MODELS.includes(modelOf(raw.modelName));
    if (!kind || !token || valveless) {
      skipped.push({ id, type });
      continue;
    }
    const parent = text(raw.parentDeviceId);
    devices.push({
      id,
      type,
      kind,
      name: text(raw.name) ?? '',
      modelName: text(raw.modelName) ?? '',
      model: modelOf(raw.modelName),
      token,
      endpoint,
      parentId: parent && parent !== 'null' ? parent : undefined,
    });
  }
  return { devices, skipped };
}

/**
 * One flat reading. A state answer nests the values under `data.state`
 * (`fetchState`) or not (`getState` of the plugs); an MQTT report carries them
 * flat in `data`. The outer fields (`online`, `battery`, `reportAt`) stay.
 */
export function flatten(data) {
  if (!isObject(data)) {
    return {};
  }
  return isObject(data.state) ? { ...data, ...data.state } : { ...data };
}

/**
 * A T&H record report (`THSensor.DataRecord`): its latest record as a reading
 * (yolink-api `th_sensor_message_resolve`).
 */
export function latestRecord(data) {
  const records = Array.isArray(data?.records) ? data.records.filter(isObject) : [];
  if (records.length === 0) {
    return undefined;
  }
  const latest = records.reduce((a, b) => (Number(b.time ?? 0) > Number(a.time ?? 0) ? b : a));
  return { temperature: latest.temperature, humidity: latest.humidity };
}

/** Whether an MQTT event is one of the state events (yolink-api `_is_message_acceptable`). */
export function acceptedEvent(event) {
  if (typeof event !== 'string') {
    return false;
  }
  return event === MQTT_RECORD_EVENT || MQTT_EVENTS.some((suffix) => event.endsWith(suffix));
}

const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : undefined);

/** "open" / "closed" of a door sensor or a garage door; undefined otherwise. */
export function openState(reading) {
  const value = lower(reading.state);
  return value === 'open' || value === 'closed' ? value : undefined;
}

/** true on "alert", false on "normal" (motion, leak, vibration, siren "off" too). */
export function alertState(reading) {
  const value = lower(reading.state);
  if (value === 'alert') {
    return true;
  }
  return value === 'normal' || value === 'off' ? false : undefined;
}

/** On/off of a plug, a switch or one socket (`index`) of a power strip. */
export function switchState(reading, index) {
  const value = index === undefined ? reading.state : reading.state?.[index];
  const state = lower(value);
  if (state === 'open') {
    return true;
  }
  return state === 'closed' || state === 'close' ? false : undefined;
}

/** The number of sockets a power strip reports. */
export const socketCount = (reading) => (Array.isArray(reading.state) ? reading.state.length : 0);

/** true locked, false unlocked: `state` (Lock) or `state.lock` (LockV2). */
export function lockState(reading) {
  const value = lower(
    isObject(reading.state) ? reading.state.lock : (reading.state ?? reading.lock),
  );
  if (value === 'locked') {
    return true;
  }
  return value === 'unlocked' ? false : undefined;
}

/** true open, false closed: `state` (Manipulator) or `state.valve` / `valve` (water controllers). */
export function valveState(reading) {
  const value = lower(
    isObject(reading.state) ? reading.state.valve : (reading.valve ?? reading.state),
  );
  if (value === 'open') {
    return true;
  }
  return value === 'closed' || value === 'close' ? false : undefined;
}

const finite = (value) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** °C, one decimal (YoLink reports Celsius). */
export function temperatureOf(reading) {
  const value = finite(reading.temperature);
  return value === undefined ? undefined : Math.round(value * 10) / 10;
}

/** %, one decimal. */
export function humidityOf(reading) {
  const value = finite(reading.humidity);
  return value === undefined || value < 0 || value > 100 ? undefined : Math.round(value * 10) / 10;
}

/** The 0 (empty) to 4 (full) battery level -> %. */
export function batteryOf(reading) {
  const level = finite(reading.battery);
  if (level === undefined || level < 0 || level > 4) {
    return undefined;
  }
  return Math.round(level * 25);
}

/** W, the plugs that measure it. */
export function powerOf(reading) {
  const value = finite(reading.power);
  return value === undefined || value < 0 ? undefined : value;
}
