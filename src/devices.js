// -----------------------------------------------------------------------------
// The YoLink devices -> Gladys devices, and their states (pure).
//
// One Gladys device per supported YoLink device, `ext:<selector>:yolink:<deviceId>`,
// the deviceId being the one YoLink gives the device (stable, unique). The
// features are keyed by their role (the last part of their external id).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { GLADYS, POWER_MODELS, TEMPERATURE_ONLY_MODELS } from './constants.js';
import { FEATURE_NAMES, TYPE_NAMES, word } from './i18n.js';
import {
  alertState,
  batteryOf,
  humidityOf,
  lockState,
  openState,
  powerOf,
  socketCount,
  switchState,
  temperatureOf,
  valveState,
} from './inventory.js';

const binary = { min: 0, max: 1 };
const command = { read_only: false, has_feedback: true };

/** The features, by role. */
export const FEATURES = {
  opening: { category: C.OPENING_SENSOR, type: T.SENSOR.BINARY, ...binary },
  motion: { category: C.MOTION_SENSOR, type: T.SENSOR.BINARY, ...binary },
  leak: { category: C.LEAK_SENSOR, type: T.SENSOR.BINARY, ...binary },
  vibration: { category: C.VIBRATION_SENSOR, type: T.VIBRATION_SENSOR.BINARY, ...binary },
  temperature: {
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -40,
    max: 85,
  },
  humidity: {
    category: C.HUMIDITY_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  },
  battery: { category: C.BATTERY, type: T.BATTERY.INTEGER, unit: U.PERCENT, min: 0, max: 100 },
  switch: { category: C.SWITCH, type: T.SWITCH.BINARY, ...binary, ...command },
  socket: { category: C.SWITCH, type: T.SWITCH.BINARY, ...binary, ...command },
  power: { category: C.SWITCH, type: T.SWITCH.POWER, unit: U.WATT, min: 0, max: 4000 },
  valve: { category: C.SWITCH, type: T.SWITCH.BINARY, ...binary, ...command },
  lock: { category: C.LOCK, type: T.LOCK.BINARY, ...binary, ...command },
  siren: { category: C.SIREN, type: T.SIREN.BINARY, ...binary, ...command },
  garage: { category: C.SWITCH, type: T.SWITCH.BINARY, ...binary, ...command },
};

/** The sockets of a power strip before its first reading (YS6801: four sockets and the USB). */
const DEFAULT_SOCKETS = { YS6801: 5, YS6802: 2 };
const MAX_SOCKETS = 8;

export const deviceIds = (gladys, id) => gladys.externalIds('yolink', String(id));

/** The YoLink id and the role of a feature external id. */
export function parseFeatureId(externalId) {
  const match = /:yolink:([^:]+):([^:]+)$/.exec(String(externalId ?? ''));
  if (!match) {
    return undefined;
  }
  const socket = /^socket-(\d+)$/.exec(match[2]);
  return socket
    ? { id: match[1], role: 'socket', index: Number(socket[1]) }
    : { id: match[1], role: match[2] };
}

export const deviceName = (device, language) =>
  device.name || `${word(TYPE_NAMES[device.kind], language)} ${device.id.slice(-4)}`;

function feature(ids, key, language, role = key, name = word(FEATURE_NAMES[role], language)) {
  return {
    name,
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...FEATURES[role],
  };
}

/** The sockets of a power strip: as many as it reports, or as its model has. */
export function socketsOf(device, reading = {}) {
  const count = socketCount(reading) || DEFAULT_SOCKETS[device.model] || 1;
  return Math.min(count, MAX_SOCKETS);
}

/**
 * The name of a channel. On the YS6801 power strip, channel 0 is the USB ports
 * and channels 1–4 are sockets 1–4; elsewhere channel i is socket i + 1.
 */
export function socketName(device, channel, language) {
  if (USB_FIRST_MODELS.includes(device.model)) {
    return channel === 0
      ? word(FEATURE_NAMES.usb, language)
      : `${word(FEATURE_NAMES.socket, language)} ${channel}`;
  }
  return `${word(FEATURE_NAMES.socket, language)} ${channel + 1}`;
}

const USB_FIRST_MODELS = ['YS6801'];

const BATTERY_KINDS = ['door', 'motion', 'leak', 'climate', 'vibration', 'valve', 'lock', 'siren'];

function featuresOf(ids, device, reading, language) {
  const f = (key, role) => feature(ids, key, language, role);
  const features = [];
  switch (device.kind) {
    case 'door':
      features.push(f('opening'));
      break;
    case 'motion':
      features.push(f('motion'));
      break;
    case 'leak':
      features.push(f('leak'));
      break;
    case 'vibration':
      features.push(f('vibration'));
      break;
    case 'climate':
      features.push(f('temperature'));
      if (!TEMPERATURE_ONLY_MODELS.includes(device.model)) {
        features.push(f('humidity'));
      }
      break;
    case 'switch':
      features.push(f('switch'));
      if (POWER_MODELS.includes(device.model)) {
        features.push(f('power'));
      }
      break;
    case 'multi-outlet':
      for (let i = 0; i < socketsOf(device, reading); i += 1) {
        features.push(
          feature(ids, `socket-${i}`, language, 'socket', socketName(device, i, language)),
        );
      }
      break;
    case 'valve':
      features.push(f('valve'));
      break;
    case 'lock':
      features.push(f('lock'));
      break;
    case 'siren':
      features.push(f('siren'));
      break;
    case 'garage':
      features.push(f('garage'));
      break;
    default:
      break;
  }
  if (BATTERY_KINDS.includes(device.kind) || device.type === 'Finger') {
    features.push(f('battery'));
  }
  return features;
}

function params(entries) {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([name, value]) => ({ name, value: String(value) }));
}

/** The Gladys devices of the account. `readings`: deviceId -> last reading. */
export function buildDevices(gladys, devices, readings, language) {
  return devices.map((device) => {
    const ids = deviceIds(gladys, device.id);
    return {
      name: deviceName(device, language),
      external_id: ids.device,
      features: featuresOf(ids, device, readings.get(device.id), language),
      params: params([
        ['yolink_id', device.id],
        ['yolink_type', device.type],
        ['model', device.modelName],
        ['cloud', device.endpoint.name],
      ]),
    };
  });
}

const bit = (value) => (value ? GLADYS.ON : GLADYS.OFF);

/**
 * The Gladys states of one reading: `[{ role, state }]`. `door`: the reading
 * of the door sensor paired with a garage controller, whose state it is.
 */
export function statesOf(device, reading, { door, sockets } = {}) {
  const states = [];
  const add = (role, state) => {
    if (state !== undefined) {
      states.push({ role, state });
    }
  };
  const open = openState(reading);
  const alert = alertState(reading);
  switch (device.kind) {
    case 'door':
      add(
        'opening',
        open === undefined ? undefined : open === 'open' ? GLADYS.OPEN : GLADYS.CLOSED,
      );
      break;
    case 'motion':
    case 'leak':
    case 'vibration':
    case 'siren':
      add(device.kind, alert === undefined ? undefined : bit(alert));
      break;
    case 'climate':
      add('temperature', temperatureOf(reading));
      add(
        'humidity',
        TEMPERATURE_ONLY_MODELS.includes(device.model) ? undefined : humidityOf(reading),
      );
      break;
    case 'switch': {
      const on = switchState(reading);
      add('switch', on === undefined ? undefined : bit(on));
      add('power', POWER_MODELS.includes(device.model) ? powerOf(reading) : undefined);
      break;
    }
    case 'multi-outlet':
      for (let i = 0; i < (sockets ?? socketsOf(device, reading)); i += 1) {
        const on = switchState(reading, i);
        add(`socket-${i}`, on === undefined ? undefined : bit(on));
      }
      break;
    case 'valve': {
      const valve = valveState(reading);
      add('valve', valve === undefined ? undefined : bit(valve));
      break;
    }
    case 'lock': {
      const locked = lockState(reading);
      add('lock', locked === undefined ? undefined : locked ? GLADYS.LOCKED : GLADYS.UNLOCKED);
      break;
    }
    case 'garage': {
      const state = door ? openState(door) : undefined;
      add('garage', state === undefined ? undefined : bit(state === 'open'));
      break;
    }
    default:
      break;
  }
  if (BATTERY_KINDS.includes(device.kind) || device.type === 'Finger') {
    add('battery', batteryOf(reading));
  }
  return states;
}

/** The binary roles whose values are moments (an alert, a door that moved). */
export const MOMENT_ROLES = ['opening', 'motion', 'leak', 'vibration'];
