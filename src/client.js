// -----------------------------------------------------------------------------
// The YoLink account: the access token of the User Access Credentials (UAC,
// a UAID and a secret key made in the YoLink app), renewed before it expires
// (with the refresh token first, as YoLink recommends) and once when the API
// refuses it, and the API calls the integration needs. Every request goes
// through the transport of src/yolink.js.
// -----------------------------------------------------------------------------

import { ENDPOINTS, TIMINGS, TOKEN_URL } from './constants.js';
import { YoLinkError, httpError, httpRequest, parseBudp, parseToken } from './yolink.js';

const form = (fields) => new URLSearchParams(fields).toString();

export class YoLinkClient {
  constructor({ transport = httpRequest, now = Date.now } = {}) {
    this.transport = transport;
    this.now = now;
    this.uaid = '';
    this.secretKey = '';
    /** { accessToken, refreshToken?, expiresAt } | null — kept in memory only. */
    this.session = null;
    this.renewing = undefined;
    /** Bumped by configure(): a token asked for older credentials is dropped. */
    this.generation = 0;
  }

  configure({ uaid, secretKey }) {
    this.uaid = uaid;
    this.secretKey = secretKey;
    this.session = null;
    this.generation += 1;
  }

  get hasCredentials() {
    return this.uaid !== '' && this.secretKey !== '';
  }

  /** Forgets the access token: the next call asks for a new one. */
  invalidate() {
    this.session = null;
  }

  async requestToken(fields) {
    const body = form(fields);
    const answer = await this.transport(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
      body,
    });
    if (answer.status < 200 || answer.status >= 300) {
      throw httpError(answer.status, { token: true });
    }
    return parseToken(answer.body, this.now());
  }

  /** A new access token; one request at a time, the others wait for it. */
  renew() {
    if (!this.hasCredentials) {
      return Promise.reject(new YoLinkError('no_credentials', 'no UAID or secret key'));
    }
    if (!this.renewing) {
      const generation = this.generation;
      const refreshToken = this.session?.refreshToken;
      const run = async () => {
        if (refreshToken) {
          try {
            return await this.requestToken({
              grant_type: 'refresh_token',
              client_id: this.uaid,
              refresh_token: refreshToken,
            });
          } catch (err) {
            // An expired refresh token: the credentials themselves give a new one.
            if (err.kind !== 'refused') {
              throw err;
            }
          }
        }
        return this.requestToken({
          grant_type: 'client_credentials',
          client_id: this.uaid,
          client_secret: this.secretKey,
        });
      };
      this.renewing = run()
        .then((session) => {
          if (generation === this.generation) {
            this.session = session;
          }
          return session;
        })
        .finally(() => {
          this.renewing = undefined;
        });
    }
    return this.renewing;
  }

  needsToken() {
    return !this.session || this.now() >= this.session.expiresAt - TIMINGS.tokenMargin;
  }

  /** A valid access token (the MQTT username too). */
  async token() {
    if (this.needsToken()) {
      await this.renew();
    }
    return this.session.accessToken;
  }

  async send(endpoint, bddp, token) {
    const body = JSON.stringify({ time: this.now(), ...bddp });
    const answer = await this.transport(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
    });
    if (answer.status < 200 || answer.status >= 300) {
      throw httpError(answer.status);
    }
    return parseBudp(answer.body);
  }

  /** One BDDP; a refused token is renewed once and the call retried. */
  async call(endpoint, bddp) {
    const token = await this.token();
    try {
      return await this.send(endpoint, bddp, token);
    } catch (err) {
      if (err.kind !== 'unauthorized') {
        throw err;
      }
      if (this.session?.accessToken === token) {
        this.session = null;
      }
      return this.send(endpoint, bddp, await this.token());
    }
  }

  /** The home id, for the MQTT topic. */
  async homeId() {
    const data = await this.call(ENDPOINTS.US, { method: 'Home.getGeneralInfo' });
    if (typeof data.id !== 'string' || data.id === '') {
      throw new YoLinkError('bad_response', 'YoLink sent no home id');
    }
    return data.id;
  }

  /** The raw device list of one cloud. */
  async deviceList(endpoint = ENDPOINTS.US) {
    const data = await this.call(endpoint, { method: 'Home.getDeviceList' });
    if (!Array.isArray(data.devices)) {
      throw new YoLinkError('bad_response', 'YoLink sent no device list');
    }
    return data.devices;
  }

  /** `<type>.<method>` on one device (`{ id, token, type, endpoint }` of src/inventory.js). */
  invoke(device, method, params) {
    return this.call(device.endpoint, {
      method: `${device.type}.${method}`,
      targetDevice: device.id,
      token: device.token,
      ...(params === undefined ? {} : { params }),
    });
  }

  /**
   * The last state the cloud knows (`fetchState`, what yolink-api reads), or
   * the device's own answer (`getState`) for the types without fetchState.
   */
  async state(device) {
    try {
      return await this.invoke(device, 'fetchState');
    } catch (err) {
      if (err.kind !== 'unsupported') {
        throw err;
      }
      return this.invoke(device, 'getState');
    }
  }
}
