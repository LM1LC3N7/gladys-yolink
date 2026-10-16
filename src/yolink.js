// -----------------------------------------------------------------------------
// The HTTP side of the YoLink Open API v2: HTTPS requests, the token answer,
// the BUDP answers (`{ code, desc, method, data }`) and the errors they end
// with. The only HTTP network access of the integration.
// -----------------------------------------------------------------------------

import https from 'node:https';
import { CODES, LIMITS, TIMINGS } from './constants.js';

/**
 * A failed YoLink call. `kind`:
 * - `no_credentials`: no UAID or secret key in the configuration (never sent);
 * - `refused`: the token request was refused (wrong UAID or secret key);
 * - `unauthorized`: the API refused the access token;
 * - `rate_limited`: "limits reached" (010301) or HTTP 429;
 * - `unavailable`: YoLink is down (5xx, 010000, 010001);
 * - `device`: the device or its hub did not answer (the account is fine);
 * - `unsupported`: the method does not exist for this device type;
 * - `network`, `timeout`: no answer;
 * - `bad_response`, `size`: an answer that is not the expected JSON;
 * - `api`: any other BUDP code; `http`: any other HTTP status.
 */
export class YoLinkError extends Error {
  constructor(kind, message, { status, code } = {}) {
    super(message);
    this.name = 'YoLinkError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> YoLinkError (never the request: the token request carries the secret). */
export function networkError(err) {
  if (err instanceof YoLinkError) {
    return err;
  }
  return new YoLinkError('network', NETWORK_REASONS[err?.code] ?? err?.code ?? 'network error');
}

/** A short, secret-free reason for a log or a status message. */
export function errorReason(err) {
  if (err instanceof YoLinkError) {
    if (err.code) {
      return `${err.message} (code ${err.code})`;
    }
    return err.status ? `${err.message} (HTTP ${err.status})` : err.message;
  }
  return String(err?.message ?? err);
}

/**
 * One HTTPS request; resolves `{ status, body }` whatever the status. The
 * promise settles once: a request destroyed for its size or its timeout may
 * still end or fail after that.
 */
export function httpRequest(
  url,
  {
    method = 'POST',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
  } = {},
) {
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = https.request(new URL(url), { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new YoLinkError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(resolve, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
      );
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    timer = setTimeout(() => {
      settle(
        reject,
        new YoLinkError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end(body);
  });
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    throw new YoLinkError('bad_response', 'YoLink sent an answer that is not JSON');
  }
}

/** The error of a non-2xx HTTP answer. `token`: the answer of the token request. */
export function httpError(status, { token = false } = {}) {
  if (token && [400, 401, 403].includes(status)) {
    return new YoLinkError('refused', 'UAID or secret key refused', { status });
  }
  if (status === 401 || status === 403) {
    return new YoLinkError('unauthorized', 'access token refused', { status });
  }
  if (status === 429) {
    return new YoLinkError('rate_limited', 'too many requests', { status });
  }
  if (status >= 500) {
    return new YoLinkError('unavailable', 'YoLink is unavailable', { status });
  }
  return new YoLinkError('http', 'request failed', { status });
}

/** BUDP codes of a token answer that mean the credentials themselves are refused. */
const TOKEN_REFUSED = ['000106', '010101', '010102', '010103'];

/**
 * A token answer without an access token. With a BUDP `code`: refused for the
 * credential codes only, the error of the code otherwise (a 010000 outage is
 * not a wrong secret). With an OAuth `error` (invalid_client…): refused.
 */
export function tokenError(json) {
  const code = json && typeof json === 'object' ? json.code : undefined;
  if (code !== undefined && code !== null && code !== '') {
    const error = codeError(String(code), json.desc);
    return TOKEN_REFUSED.includes(error.code)
      ? new YoLinkError('refused', 'UAID or secret key refused', { code: error.code })
      : error;
  }
  if (typeof json?.error === 'string' && json.error !== '') {
    return new YoLinkError('refused', 'UAID or secret key refused');
  }
  return new YoLinkError('bad_response', 'YoLink sent no access token');
}

/**
 * The token answer: `{ access_token, refresh_token, expires_in }` (seconds).
 * Throws tokenError() for an answer without an access token.
 */
export function parseToken(body, now) {
  const json = parseJson(body);
  const accessToken = json?.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw tokenError(json);
  }
  const seconds = Number(json.expires_in);
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : TIMINGS.tokenLifetime;
  return {
    accessToken,
    refreshToken:
      typeof json.refresh_token === 'string' && json.refresh_token !== ''
        ? json.refresh_token
        : undefined,
    expiresAt: now + lifetime,
  };
}

/** The error of a BUDP `code`. */
export function codeError(code, desc) {
  const message = typeof desc === 'string' && desc !== '' ? desc.slice(0, 120) : 'request failed';
  const kind = CODES.TOKEN.includes(code)
    ? 'unauthorized'
    : CODES.REFUSED.includes(code)
      ? 'refused'
      : CODES.RATE_LIMITED.includes(code)
        ? 'rate_limited'
        : CODES.UNAVAILABLE.includes(code)
          ? 'unavailable'
          : CODES.DEVICE.includes(code)
            ? 'device'
            : CODES.UNSUPPORTED.includes(code)
              ? 'unsupported'
              : 'api';
  return new YoLinkError(kind, message, { code });
}

/** The `data` of a successful BUDP answer; throws the error of its code otherwise. */
export function parseBudp(body) {
  const json = parseJson(body);
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new YoLinkError('bad_response', 'YoLink sent an answer that is not an object');
  }
  const code = String(json.code ?? '');
  if (code !== CODES.SUCCESS) {
    throw codeError(code, json.desc);
  }
  return json.data && typeof json.data === 'object' ? json.data : {};
}
