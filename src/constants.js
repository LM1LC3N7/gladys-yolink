// -----------------------------------------------------------------------------
// Manifest keys, YoLink Open API v2 constants, limits and timings.
//
// The API values come from the official YoLink documentation
// (doc.yosmart.com, "Open API V2" and the device pages) and from the official
// Python library YoSmart-Inc/yolink-api (MIT): endpoints, device types,
// accepted MQTT events, the US/EU split of the devices.
// -----------------------------------------------------------------------------

/** The token endpoint is the US one for every account (yolink-api `OAUTH2_TOKEN`). */
export const TOKEN_URL = 'https://api.yosmart.com/open/yolink/token';

/**
 * The two YoLink clouds. A device belongs to the EU one when its `serviceZone`
 * starts with `eu_`, or (no zone) when its model ends with `-EC`
 * (yolink-api `YoLinkDevice`). MQTT: plain TCP on 8003, the only transport
 * YoLink documents besides WebSocket on 8004 (neither offers TLS).
 */
export const ENDPOINTS = {
  US: {
    name: 'US',
    url: 'https://api.yosmart.com/open/yolink/v2/api',
    mqttHost: 'mqtt.api.yosmart.com',
    mqttPort: 8003,
  },
  EU: {
    name: 'EU',
    url: 'https://api-eu.yosmart.com/open/yolink/v2/api',
    mqttHost: 'api-eu.yosmart.com',
    mqttPort: 8003,
  },
};

/** BUDP `code` values (doc.yosmart.com, "Error Code"). */
export const CODES = {
  SUCCESS: '000000',
  /** Token problems: sign in again. */
  TOKEN: ['000103', '010103', '010104'],
  /** Credentials refused by the API itself. */
  REFUSED: ['000106', '010101', '010102'],
  /** "Access denied due to limits reached, Please retry later". */
  RATE_LIMITED: ['010301'],
  /** The cloud itself is down. */
  UNAVAILABLE: ['010000', '010001'],
  /** The device (or its hub) did not answer: the account is fine. */
  DEVICE: ['000101', '000102', '000201', '000202', '000203', '020104', '020105'],
  /** "method is not supported". */
  UNSUPPORTED: ['010203'],
};

/**
 * YoLink device types -> the kind of Gladys device made of them. Other
 * types (hubs, remotes, thermostats, sprinklers…) are not supported yet.
 */
export const KINDS = {
  DoorSensor: 'door',
  MotionSensor: 'motion',
  LeakSensor: 'leak',
  THSensor: 'climate',
  VibrationSensor: 'vibration',
  Outlet: 'switch',
  Switch: 'switch',
  MultiOutlet: 'multi-outlet',
  Manipulator: 'valve',
  WaterMeterController: 'valve',
  WaterLeakController: 'valve',
  Lock: 'lock',
  LockV2: 'lock',
  Siren: 'siren',
  GarageDoor: 'garage',
  Finger: 'garage',
};

/** Temperature-only THSensor models (no humidity probe). */
export const TEMPERATURE_ONLY_MODELS = ['YS8004', 'YS8014', 'YS8017'];

/** Outlet models that measure their power (the others always report 0). */
export const POWER_MODELS = ['YS6602', 'YS6803'];

/**
 * MQTT events kept, by the end of their name (yolink-api
 * `_is_message_acceptable`), plus the dated T&H records.
 */
export const MQTT_EVENTS = ['Report', 'Alert', 'StatusChange', 'getState', 'setState', 'DevEvent'];
export const MQTT_RECORD_EVENT = 'THSensor.DataRecord';
/** Events after which a binary sensor value is a moment of its own (a new alert, a door that moved). */
export const MOMENT_EVENTS = ['Alert', 'StatusChange'];

/**
 * Gladys values (server/utils/constants.js of the Gladys core, not exported
 * by the SDK).
 */
export const GLADYS = {
  ON: 1,
  OFF: 0,
  /** OPENING_SENSOR_STATE */
  OPEN: 0,
  CLOSED: 1,
  /** LOCK.STATE */
  UNLOCKED: 0,
  LOCKED: 1,
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** Full refresh (device list and every state), in minutes. */
export const REFRESH_INTERVAL = { min: 10, max: 1440, default: 30 };

export const LIMITS = {
  /** Gladys: 300 states per minute. */
  statesPerMinute: 300,
  /** States per publishStates request. */
  statesPerRequest: 100,
  /** Largest HTTP answer read (a device list of a big home is a few tens of KB). */
  responseBytes: 4 * 1024 * 1024,
  /** Largest MQTT message read. */
  messageBytes: 64 * 1024,
  /** Dated states kept while Gladys is unreachable. */
  queuedEvents: 500,
  /**
   * MQTT connections opened per 5 minutes, all clouds together. YoLink allows
   * a UAC 5 open connections and 10 new ones per 5 minutes.
   */
  connectionsPer5Minutes: 8,
};

export const TIMINGS = {
  requestTimeout: 15_000,
  /** The publisher sends what is pending every second. */
  flushInterval: 1_000,
  /** The scheduler looks every minute whether a refresh is due. */
  tickInterval: 60_000,
  /** An unchanged state is sent again every 30 minutes. */
  stateHeartbeat: 30 * 60_000,
  /** Renew the access token this long before it expires (yolink-api examples: 5 min). */
  tokenMargin: 5 * 60_000,
  /** Lifetime assumed when the token answer gives none (YoLink: 2 h). */
  tokenLifetime: 2 * 60 * 60_000,
  /** Between two state requests of a refresh, to stay gentle with the API. */
  stateSpacing: 500,
  /** Pauses after a failed refresh: 1, 2, 5, 10 then 15 minutes. */
  backoff: [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000],
  /** After "limits reached". */
  rateLimitPause: 15 * 60_000,
  /** MQTT reconnection delays: 30 s (yolink-api), then up to 5 minutes. */
  mqttBackoff: [30_000, 60_000, 2 * 60_000, 5 * 60_000],
  mqttKeepalive: 60,
  mqttConnectTimeout: 30_000,
  /** The "Test the connection" button and the Discovery scan read YoLink at most this often. */
  testCooldown: 30_000,
};
