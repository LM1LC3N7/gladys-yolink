// -----------------------------------------------------------------------------
// The live events: one MQTT connection per YoLink cloud the devices use (US,
// EU), subscribed to `yl-home/<home id>/+/report`. The username is the access
// token of the UAC, there is no password (YoLink Open API v2, "MQTT API V2").
//
// The connection is opened by MQTT.js (MIT) with its own reconnection turned
// off: every new connection needs the current access token, and YoLink allows
// a UAC 10 new connections per 5 minutes, so the delays and that budget are
// handled here.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';
import { LIMITS, TIMINGS } from './constants.js';
import { acceptedEvent } from './inventory.js';

const FIVE_MINUTES = 5 * 60_000;

/** Opens one MQTT connection (the only MQTT network access). */
export function mqttConnect(endpoint, options) {
  return mqtt.connect(`mqtt://${endpoint.mqttHost}:${endpoint.mqttPort}`, options);
}

/** CONNACK refusals meaning the token is not accepted (MQTT 3.1.1: 4 and 5). */
const authRefused = (err) =>
  err?.code === 4 || err?.code === 5 || /not authori[sz]ed|bad user ?name/i.test(err?.message);

/** The device id of a report topic `yl-home/<home>/<device>/report`. */
export function reportDevice(topic, homeId) {
  const parts = String(topic).split('/');
  return parts.length === 4 &&
    parts[0] === 'yl-home' &&
    parts[1] === homeId &&
    parts[3] === 'report'
    ? parts[2]
    : undefined;
}

export class LiveEvents {
  constructor({
    connect = mqttConnect,
    token,
    invalidateToken = () => {},
    onReport,
    onChange = () => {},
    logger,
    now = Date.now,
    timers = globalThis,
    randomId = randomUUID,
  }) {
    this.connect = connect;
    this.token = token;
    this.invalidateToken = invalidateToken;
    this.onReport = onReport;
    this.onChange = onChange;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.randomId = randomId;
    this.homeId = undefined;
    /** endpoint name -> { endpoint, client, connected, failures, timer } */
    this.links = new Map();
    /** Times of the connections opened in the last 5 minutes. */
    this.opened = [];
  }

  get topic() {
    return `yl-home/${this.homeId}/+/report`;
  }

  /** Whether every cloud in use has its connection up. */
  get connected() {
    return this.links.size > 0 && [...this.links.values()].every((l) => l.connected);
  }

  /** Connects to the clouds of `endpoints` (and only those) for `homeId`. */
  start(homeId, endpoints) {
    if (homeId !== this.homeId) {
      this.stop();
      this.homeId = homeId;
    }
    const wanted = new Map(endpoints.map((e) => [e.name, e]));
    for (const [name, link] of this.links) {
      if (!wanted.has(name)) {
        this.close(link);
        this.links.delete(name);
      }
    }
    for (const [name, endpoint] of wanted) {
      if (!this.links.has(name)) {
        const link = {
          endpoint,
          client: undefined,
          connected: false,
          failures: 0,
          timer: undefined,
        };
        this.links.set(name, link);
        this.open(link);
      }
    }
  }

  stop() {
    for (const link of this.links.values()) {
      this.close(link);
    }
    this.links.clear();
    this.homeId = undefined;
  }

  close(link) {
    if (link.timer) {
      this.timers.clearTimeout(link.timer);
      link.timer = undefined;
    }
    const { client } = link;
    link.client = undefined;
    link.connected = false;
    client?.removeAllListeners?.();
    // A late error of the closed client must not crash the process.
    client?.on?.('error', () => {});
    client?.end?.(true);
  }

  later(link, wait) {
    if (link.timer) {
      this.timers.clearTimeout(link.timer);
    }
    link.timer = this.timers.setTimeout(() => {
      link.timer = undefined;
      this.open(link);
    }, wait);
  }

  retry(link) {
    const wait = TIMINGS.mqttBackoff[Math.min(link.failures, TIMINGS.mqttBackoff.length - 1)];
    link.failures += 1;
    this.later(link, wait);
  }

  async open(link) {
    if (this.links.get(link.endpoint.name) !== link || link.client) {
      return;
    }
    const now = this.now();
    this.opened = this.opened.filter((t) => now - t < FIVE_MINUTES);
    if (this.opened.length >= LIMITS.connectionsPer5Minutes) {
      this.later(link, this.opened[0] + FIVE_MINUTES - now);
      return;
    }
    let token;
    try {
      token = await this.token();
    } catch (err) {
      this.logger.warn(
        `YoLink live events (${link.endpoint.name}): no access token, ${err.message}`,
      );
      this.retry(link);
      return;
    }
    if (this.links.get(link.endpoint.name) !== link || link.client) {
      return;
    }
    this.opened.push(this.now());
    const client = this.connect(link.endpoint, {
      clientId: `gladys-yolink-${this.randomId()}`,
      username: token,
      protocolVersion: 4,
      clean: true,
      keepalive: TIMINGS.mqttKeepalive,
      reconnectPeriod: 0,
      connectTimeout: TIMINGS.mqttConnectTimeout,
    });
    link.client = client;
    client.on('connect', () => {
      client.subscribe(this.topic, { qos: 0 }, (err) => {
        if (link.client !== client) {
          return;
        }
        if (err) {
          this.logger.warn(`YoLink live events (${link.endpoint.name}): subscription refused`);
          client.end(true);
          return;
        }
        link.connected = true;
        link.failures = 0;
        this.logger.info(`YoLink live events (${link.endpoint.name}) connected`);
        this.onChange();
      });
    });
    client.on('message', (topic, payload) => this.message(topic, payload));
    client.on('error', (err) => {
      // MQTT.js errors carry no credentials; the token is never logged.
      this.logger.warn(`YoLink live events (${link.endpoint.name}): ${err?.message ?? err}`);
      if (authRefused(err)) {
        this.invalidateToken();
      }
    });
    client.on('close', () => {
      if (link.client !== client) {
        return;
      }
      const was = link.connected;
      link.client = undefined;
      link.connected = false;
      client.removeAllListeners();
      client.on('error', () => {});
      if (was) {
        this.logger.warn(`YoLink live events (${link.endpoint.name}) disconnected`);
        this.onChange();
      }
      this.retry(link);
    });
  }

  message(topic, payload) {
    const deviceId = reportDevice(topic, this.homeId);
    if (!deviceId || !payload || payload.length > LIMITS.messageBytes) {
      return;
    }
    let budp;
    try {
      budp = JSON.parse(payload.toString('utf8'));
    } catch {
      return;
    }
    if (!acceptedEvent(budp?.event) || !budp.data || typeof budp.data !== 'object') {
      return;
    }
    try {
      this.onReport(deviceId, budp.event, budp.data);
    } catch (err) {
      this.logger.warn(`YoLink report of ${deviceId} not handled: ${err.message}`);
    }
  }
}
