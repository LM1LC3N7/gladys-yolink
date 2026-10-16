// -----------------------------------------------------------------------------
// Made-up YoLink answers, shaped like the official documentation
// (doc.yosmart.com, Open API v2 and the device pages) and the official
// yolink-api library read them. Ids, names and tokens are invented.
// -----------------------------------------------------------------------------

export const NOW = Date.parse('2026-10-16T08:00:00Z');
export const MINUTE = 60_000;
export const UAID = 'ua_TESTTESTTESTTEST';
export const SECRET = 'sec_v1_secretsecretsecret';
export const HOME = 'home0001aaaa0001';

const eu = { serviceZone: 'eu_west_1' };

/** One row of `Home.getDeviceList`. `token` is the US token; EU rows get their own below. */
const row = (deviceId, type, name, modelName, extra = {}) => ({
  deviceId,
  deviceUDID: `udid-${deviceId}`,
  name,
  token: `us-token-${deviceId}`,
  type,
  parentDeviceId: null,
  modelName,
  serviceZone: null,
  ...extra,
});

export const IDS = {
  door: 'd7704000000door1',
  garageSensor: 'd7706000000gsen1',
  garage: 'd4906000000gar01',
  motion: 'd7804000000mot01',
  leak: 'd7903000000leak1',
  climate: 'd8003000000clim1',
  thermometer: 'd8004000000therm',
  vibration: 'd7201000000vib01',
  outlet: 'd6602000000out01',
  switch: 'd5705000000sw001',
  strip: 'd6801000000strip',
  valve: 'd4909000000valve',
  leakStop: 'd5029000000lstop',
  lock: 'd7606000000lock1',
  lockV2: 'd7607000000lock2',
  siren: 'd7103000000siren',
  hub: 'd1603000000hub01',
  remote: 'd3604000000fob01',
};

/** The US device list: every device of the home. */
export function usDevices() {
  return [
    row(IDS.door, 'DoorSensor', 'Front door', 'YS7704-EC', eu),
    row(IDS.garageSensor, 'DoorSensor', 'Garage sensor', 'YS7706-UC', {
      parentDeviceId: IDS.garage,
    }),
    row(IDS.garage, 'GarageDoor', 'Garage', 'YS4906-UC'),
    row(IDS.motion, 'MotionSensor', 'Hallway motion', 'YS7804-EC', eu),
    row(IDS.leak, 'LeakSensor', 'Kitchen leak', 'YS7903-EC', eu),
    row(IDS.climate, 'THSensor', 'Living room', 'YS8003-EC', eu),
    row(IDS.thermometer, 'THSensor', 'Freezer', 'YS8004-UC'),
    row(IDS.vibration, 'VibrationSensor', 'Mailbox', 'YS7201-UC'),
    row(IDS.outlet, 'Outlet', 'Kettle', 'YS6602-UC'),
    row(IDS.switch, 'Switch', 'Porch light', 'YS5705-UC'),
    row(IDS.strip, 'MultiOutlet', 'Desk strip', 'YS6801-UC'),
    row(IDS.valve, 'Manipulator', 'Main valve', 'YS4909-UC'),
    row(IDS.leakStop, 'WaterMeterController', 'LeakStop', 'YS5018-UC'),
    row(IDS.lock, 'Lock', 'Back door lock', 'YS7606-UC'),
    row(IDS.lockV2, 'LockV2', 'Front door lock', 'YS7607-UC'),
    row(IDS.siren, 'Siren', 'Siren', 'YS7103-UC'),
    row(IDS.hub, 'Hub', 'Hub', 'YS1603-UC'),
    row(IDS.remote, 'SmartRemoter', 'Fob', 'YS3604-UC'),
  ];
}

/** The EU device list: the EU devices, with the tokens of the EU cloud. */
export function euDevices() {
  return usDevices()
    .filter((d) => d.serviceZone === 'eu_west_1')
    .map((d) => ({ ...d, token: `eu-token-${d.deviceId}` }));
}

const battery = { battery: 4 };

/** What `fetchState` answers: `{ online, state: {…}, deviceId, reportAt }`. */
export function initialStates() {
  return {
    [IDS.door]: { state: 'closed', ...battery, openRemindDelay: 0, version: '0407' },
    [IDS.garageSensor]: { state: 'closed', battery: 3 },
    [IDS.garage]: {},
    [IDS.motion]: { state: 'normal', battery: 2, devTemperature: 21, sensitivity: 'high' },
    [IDS.leak]: { state: 'normal', ...battery, beep: true },
    [IDS.climate]: {
      state: 'normal',
      ...battery,
      temperature: 21.36,
      humidity: 48.2,
      mode: 'f',
      tempLimit: { max: 30, min: 0 },
    },
    [IDS.thermometer]: { state: 'normal', battery: 1, temperature: -18.4 },
    [IDS.vibration]: { state: 'normal', ...battery },
    [IDS.outlet]: { state: 'closed', power: 0, delay: { on: 0, off: 0 }, version: '0302' },
    [IDS.switch]: { state: 'open', delay: { on: 0, off: 0 } },
    [IDS.strip]: { state: ['open', 'closed', 'open', 'closed', 'closed'], delays: [] },
    [IDS.valve]: { state: 'open', battery: 4, openRemind: 0 },
    [IDS.leakStop]: { state: { valve: 'open', meter: 123456 }, battery: 4 },
    [IDS.lock]: { state: 'locked', battery: 3 },
    [IDS.lockV2]: { state: { lock: 'locked' }, battery: 4, attributes: { autoLock: 30 } },
    [IDS.siren]: { state: 'normal', battery: 4, soundLevel: 2, powerSupply: 'usb' },
  };
}

/** An MQTT report BUDP. */
export const report = (deviceId, event, data) => ({
  event,
  time: NOW,
  msgid: String(NOW),
  data: { ...data, loraInfo: { signal: -60, gatewayId: IDS.hub } },
  deviceId,
});
