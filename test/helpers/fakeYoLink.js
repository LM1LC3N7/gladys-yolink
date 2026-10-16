// -----------------------------------------------------------------------------
// A fake YoLink behind the transport and the MQTT connect function the
// integration is given: the token endpoint (client credentials and refresh
// token), the US and EU APIs (home, device lists, fetchState, setState,
// toggle) with the BUDP codes of the documentation, and MQTT brokers that
// accept the current access tokens. Records every request. No network.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { ENDPOINTS, TOKEN_URL } from '../../src/constants.js';
import { YoLinkError } from '../../src/yolink.js';
import { HOME, SECRET, UAID, euDevices, initialStates, usDevices } from '../fixtures/yolink.js';

const answer = (status, body) => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const budp = (method, data, code = '000000', desc = 'Success') => ({
  code,
  time: Date.now(),
  msgid: Date.now(),
  method,
  desc,
  ...(data === undefined ? {} : { data }),
});

export function fakeYoLink({ lifetime = 7200 } = {}) {
  const server = {
    uaid: UAID,
    secret: SECRET,
    lifetime,
    us: usDevices(),
    eu: euDevices(),
    states: initialStates(),
    /** deviceIds answering "Cannot connect to the device" */
    unreachable: new Set(),
    /** types answering "method is not supported" to fetchState */
    noFetch: new Set(['Siren']),
    /** { url, endpoint, method, body, token, at } */
    requests: [],
    /** access token -> expiry (ms) */
    tokens: new Map(),
    refreshTokens: new Set(),
    issued: 0,
    down: false,
    /** One-shot answers: { match(request), status, body } */
    queue: [],
    tokenRequests() {
      return this.requests.filter((r) => r.url === TOKEN_URL);
    },
    calls(method) {
      return this.requests.filter((r) => r.body?.method === method);
    },
    issue() {
      this.issued += 1;
      const accessToken = `at-${this.issued}`;
      const refreshToken = `rt-${this.issued}`;
      this.tokens.set(accessToken, Date.now() + this.lifetime * 1000);
      this.refreshTokens.add(refreshToken);
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: this.lifetime,
        token_type: 'bearer',
        scope: ['create'],
      };
    },
    validToken(token) {
      const expiry = this.tokens.get(token);
      return expiry !== undefined && Date.now() < expiry;
    },
    list(endpoint) {
      return endpoint === 'EU' ? this.eu : this.us;
    },
    tokenOf(endpoint, deviceId) {
      return this.list(endpoint).find((d) => d.deviceId === deviceId)?.token;
    },
  };

  server.transport = async (url, { method = 'POST', headers = {}, body } = {}) => {
    const endpoint = Object.values(ENDPOINTS).find((e) => e.url === url)?.name;
    const request = {
      url,
      endpoint,
      method,
      body: url === TOKEN_URL ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body),
      token: String(headers.Authorization ?? '').replace(/^Bearer /, ''),
      at: Date.now(),
    };
    server.requests.push(request);
    if (server.down) {
      throw new YoLinkError('network', 'connection refused');
    }
    const forced = server.queue.findIndex((q) => q.match(request));
    if (forced >= 0) {
      const [{ status = 200, body: forcedBody }] = server.queue.splice(forced, 1);
      return answer(status, forcedBody);
    }

    if (url === TOKEN_URL) {
      const form = request.body;
      if (form.grant_type === 'client_credentials') {
        if (form.client_id !== server.uaid || form.client_secret !== server.secret) {
          return answer(401, { error: 'invalid_client' });
        }
        return answer(200, server.issue());
      }
      if (form.grant_type === 'refresh_token' && server.refreshTokens.has(form.refresh_token)) {
        server.refreshTokens.delete(form.refresh_token);
        return answer(200, server.issue());
      }
      return answer(400, { error: 'invalid_grant' });
    }

    if (!endpoint) {
      return answer(404, 'Not found');
    }
    const bddp = request.body;
    if (!server.validToken(request.token)) {
      return answer(200, budp(bddp.method, undefined, '000103', 'Token is invalid'));
    }
    if (bddp.method === 'Home.getGeneralInfo') {
      return answer(200, budp(bddp.method, { id: HOME }));
    }
    if (bddp.method === 'Home.getDeviceList') {
      return answer(200, budp(bddp.method, { devices: server.list(endpoint) }));
    }
    const [type, action] = String(bddp.method).split('.');
    const device = server.list(endpoint).find((d) => d.deviceId === bddp.targetDevice);
    if (
      !device ||
      device.type !== type ||
      bddp.token !== server.tokenOf(endpoint, device.deviceId)
    ) {
      return answer(200, budp(bddp.method, undefined, '020101', 'The device does not exist'));
    }
    if (server.unreachable.has(device.deviceId)) {
      return answer(200, budp(bddp.method, undefined, '000201', 'Cannot connect to the device'));
    }
    const state = server.states[device.deviceId] ?? {};
    if (action === 'fetchState') {
      if (server.noFetch.has(type)) {
        return answer(200, budp(bddp.method, undefined, '010203', 'method is not supported'));
      }
      return answer(
        200,
        budp(bddp.method, { online: true, state, deviceId: device.deviceId, reportAt: 'x' }),
      );
    }
    if (action === 'getState') {
      // The flat answer of the documentation (Siren.getState).
      return answer(200, budp(bddp.method, { ...state }));
    }
    if (action === 'setState') {
      const p = bddp.params ?? {};
      if (type === 'MultiOutlet') {
        state.state = state.state.map((s, i) =>
          p.chs & (1 << i) ? (p.state === 'open' ? 'open' : 'closed') : s,
        );
      } else if (type === 'LockV2') {
        state.state = { lock: p.state.lock };
      } else if (type === 'Lock') {
        state.state = p.state === 'lock' ? 'locked' : 'unlocked';
      } else if (type === 'Siren') {
        state.state = p.state.alarm ? 'alert' : 'normal';
      } else if (type === 'WaterMeterController') {
        state.state = { ...state.state, valve: p.valve };
      } else {
        state.state = p.state === 'open' ? 'open' : 'closed';
      }
      return answer(200, budp(bddp.method, { state: state.state }));
    }
    if (action === 'toggle') {
      const sensor = server.us.find((d) => d.parentDeviceId === device.deviceId);
      if (sensor) {
        const s = server.states[sensor.deviceId];
        s.state = s.state === 'open' ? 'closed' : 'open';
      }
      return answer(200, budp(bddp.method, {}));
    }
    return answer(200, budp(bddp.method, undefined, '010203', 'method is not supported'));
  };

  return server;
}

/** Fake MQTT brokers: `connect(endpoint, options)` returns a client like MQTT.js. */
export function fakeMqtt(server, { autoConnect = true } = {}) {
  const mqtt = {
    /** { endpoint, options, client } */
    connections: [],
    connect(endpoint, options) {
      const client = new EventEmitter();
      client.ended = false;
      client.subscriptions = [];
      client.subscribe = (topic, opts, cb) => {
        client.subscriptions.push(topic);
        setImmediate(() => cb?.(null, [{ topic, qos: 0 }]));
      };
      client.end = () => {
        client.ended = true;
      };
      mqtt.connections.push({ endpoint: endpoint.name, options, client });
      if (autoConnect) {
        setImmediate(() => {
          if (client.ended) {
            return;
          }
          if (server.validToken(options.username)) {
            client.emit('connect', { returnCode: 0 });
          } else {
            const err = new Error('Connection refused: Not authorized');
            err.code = 5;
            client.emit('error', err);
            client.emit('close');
          }
        });
      }
      return client;
    },
    /** The live client of a cloud. */
    live(endpoint) {
      return mqtt.connections.filter((c) => c.endpoint === endpoint && !c.client.ended).at(-1)
        ?.client;
    },
    /** A report from the broker of `endpoint`. */
    publish(endpoint, budp, topic = `yl-home/${HOME}/${budp.deviceId}/report`) {
      mqtt.live(endpoint).emit('message', topic, Buffer.from(JSON.stringify(budp)));
    },
    /** The broker drops the connection. */
    drop(endpoint) {
      const client = mqtt.live(endpoint);
      client.ended = true;
      client.emit('close');
    },
  };
  return mqtt;
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
