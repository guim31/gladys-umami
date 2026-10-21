// -----------------------------------------------------------------------------
// Umami client: the REST API of Umami v2 and v3 (self-hosted) and of Umami
// Cloud, read-only. Checked against a real Umami 3.4.0 (PostgreSQL) in Docker.
//
//   GET  /websites?includeTeams=true&page=N   the websites the account sees
//   GET  /websites/<id>/active                visitors of the last 5 minutes
//   GET  /websites/<id>/stats?startAt&endAt   pageviews, visitors, visits,
//                                             bounces, totaltime
//   GET  /websites/<id>/metrics?type=path     the most viewed page (v3; `url`
//                                             on v2, used after a 400)
//
// Three ways in, chosen from the configuration:
//   - Umami Cloud: https://api.umami.is/v1, key in `x-umami-api-key`;
//   - a self-hosted API key (`umami_…`, Umami 3.4+): `Authorization: Bearer`;
//   - a self-hosted user name and password: POST /api/auth/login gives a
//     token (Bearer), asked again once when Umami answers 401 (the token
//     dies with a password change, or a restart of Umami without APP_SECRET).
//
// Redirects are not followed: the credentials would be sent wherever the
// address points (an http:// address redirected to https:// is reported).
// -----------------------------------------------------------------------------

export const CLOUD_API = 'https://api.umami.is/v1';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // key, user name or password refused
  TWO_FACTOR: 'two_factor', // the account asks for a second factor
  RATE_LIMIT: 'rate_limit', // HTTP 429 (Umami Cloud)
  NOT_UMAMI: 'not_umami', // something answers, not the Umami API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  NOT_FOUND: 'not_found', // the website no longer exists
  HTTP: 'http', // any other HTTP error
});

export class UmamiError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'UmamiError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export const MAX_BODY_BYTES = 8 * 1024 * 1024;
// Pages of the website list read at most (100 websites each).
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory Umami
 * (test/helpers/fakeUmami.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, body, timeoutMs = 10_000 } = {},
) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  return { status: response.status, body: await response.text() };
}

/** A self-hosted API key (Umami 3.4+), as Umami tells it from a session token. */
export const isSelfHostedKey = (key) => typeof key === 'string' && key.startsWith('umami_');

/**
 * A count of the API: a number, a numeric string (PostgreSQL bigint), or the
 * `{ value, prev }` of Umami v2. 0 when unusable.
 */
export function count(raw) {
  const value = raw && typeof raw === 'object' ? raw.value : raw;
  const number = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/** One website of the list, normalized; null when it cannot be identified. */
export function normalizeWebsite(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return null;
  }
  const domain = typeof raw.domain === 'string' ? raw.domain.trim() : '';
  const name = (typeof raw.name === 'string' && raw.name.trim()) || domain || id.slice(0, 8);
  return { id, name, domain };
}

function parse(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export class UmamiClient {
  /**
   * @param {object} options
   * @param {string|null} options.url self-hosted base URL, null for Umami Cloud
   * @param {string} [options.apiKey] Umami Cloud key, or a self-hosted `umami_…` key
   * @param {string} [options.username] self-hosted login
   * @param {string} [options.password]
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, apiKey = '', username = '', password = '', request, timeoutMs = 10_000 }) {
    this.cloud = !url;
    this.base = this.cloud ? CLOUD_API : `${url}/api`;
    this.apiKey = apiKey;
    this.username = username;
    this.password = password;
    this.request = request ?? httpRequest;
    this.timeoutMs = timeoutMs;
    this.token = null;
    // Umami v2 names the page metric `url`, v3 `path`: learnt at the first 400.
    this.pageMetric = 'path';
  }

  /** How the client signs in: 'cloud', 'key' or 'login'. */
  get mode() {
    if (this.cloud) {
      return 'cloud';
    }
    return this.apiKey ? 'key' : 'login';
  }

  async send(url, { method = 'GET', headers = {}, body } = {}) {
    try {
      return await this.request(url, {
        method,
        headers: { accept: 'application/json', ...headers },
        body,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new UmamiError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new UmamiError(ERROR_KINDS.UNREACHABLE, code ?? err.name ?? err.message);
    }
  }

  check(response, { website = false } = {}) {
    const { status } = response;
    if (status === 401 || status === 403) {
      throw new UmamiError(ERROR_KINDS.AUTH, `Credentials refused (HTTP ${status})`, { status });
    }
    if (status === 429) {
      throw new UmamiError(ERROR_KINDS.RATE_LIMIT, 'Too many requests (HTTP 429)', { status });
    }
    if (status >= 300 && status < 400) {
      throw new UmamiError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new UmamiError(
        website ? ERROR_KINDS.NOT_FOUND : ERROR_KINDS.NOT_UMAMI,
        website ? 'Website not found (HTTP 404)' : 'No Umami API at this address (HTTP 404)',
        { status },
      );
    }
    if (status < 200 || status >= 300) {
      throw new UmamiError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
  }

  /** POST /api/auth/login: a session token. */
  async login() {
    const response = await this.send(`${this.base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    this.check(response);
    const data = parse(response.body);
    if (data?.requiresTwoFactor) {
      throw new UmamiError(ERROR_KINDS.TWO_FACTOR, 'The account asks for a second factor');
    }
    if (!data || typeof data.token !== 'string' || !data.token) {
      throw new UmamiError(ERROR_KINDS.NOT_UMAMI, 'The login answer holds no token');
    }
    this.token = data.token;
  }

  async authHeaders() {
    if (this.mode === 'cloud') {
      return { 'x-umami-api-key': this.apiKey };
    }
    if (this.mode === 'key') {
      return { authorization: `Bearer ${this.apiKey}` };
    }
    if (!this.token) {
      await this.login();
    }
    return { authorization: `Bearer ${this.token}` };
  }

  /** A signed GET, the session token asked again once if Umami refuses it. */
  async get(path, options = {}) {
    let response = await this.send(`${this.base}${path}`, { headers: await this.authHeaders() });
    if (this.mode === 'login' && (response.status === 401 || response.status === 403)) {
      this.token = null;
      response = await this.send(`${this.base}${path}`, { headers: await this.authHeaders() });
    }
    this.check(response, options);
    const data = parse(response.body);
    if (data === null) {
      throw new UmamiError(ERROR_KINDS.NOT_UMAMI, 'The answer is not JSON');
    }
    return data;
  }

  /**
   * The websites of the account and of its teams.
   * @returns {Promise<Array<{ id: string, name: string, domain: string }>>}
   */
  async websites() {
    const found = new Map();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await this.get(`/websites?includeTeams=true&page=${page}&pageSize=${PAGE_SIZE}`);
      // v2 and v3: { data, count, page, pageSize }; v1 answered a bare array.
      const items = Array.isArray(data) ? data : data?.data;
      if (!Array.isArray(items)) {
        throw new UmamiError(ERROR_KINDS.NOT_UMAMI, 'The answer is not an Umami website list');
      }
      for (const website of items.map(normalizeWebsite).filter(Boolean)) {
        if (!found.has(website.id)) {
          found.set(website.id, website);
        }
      }
      const total = Number(data?.count);
      if (
        Array.isArray(data) ||
        items.length < PAGE_SIZE ||
        !Number.isFinite(total) ||
        page * PAGE_SIZE >= total
      ) {
        break;
      }
    }
    return [...found.values()];
  }

  /** Visitors of the last 5 minutes. */
  async active(id) {
    const data = await this.get(`/websites/${encodeURIComponent(id)}/active`, { website: true });
    // v2.0–2.x answered { x: n } for a while, then { visitors: n }.
    return count(data?.visitors ?? data?.x);
  }

  /**
   * Pageviews, visitors, visits, bounces and total time between two dates.
   * @returns {Promise<{ pageviews: number, visitors: number, visits: number, bounces: number, totaltime: number }>}
   */
  async stats(id, startAt, endAt) {
    const data = await this.get(
      `/websites/${encodeURIComponent(id)}/stats?startAt=${startAt}&endAt=${endAt}`,
      { website: true },
    );
    if (!data || typeof data !== 'object' || !('pageviews' in data)) {
      throw new UmamiError(ERROR_KINDS.NOT_UMAMI, 'The answer is not Umami statistics');
    }
    return {
      pageviews: count(data.pageviews),
      visitors: count(data.visitors),
      visits: count(data.visits),
      bounces: count(data.bounces),
      totaltime: count(data.totaltime),
    };
  }

  /**
   * The most viewed page between two dates, null when none.
   * @returns {Promise<{ path: string, views: number }|null>}
   */
  async topPage(id, startAt, endAt) {
    const query = (type) =>
      `/websites/${encodeURIComponent(id)}/metrics?type=${type}&startAt=${startAt}&endAt=${endAt}&limit=1`;
    let data;
    try {
      data = await this.get(query(this.pageMetric), { website: true });
    } catch (err) {
      if (!(err instanceof UmamiError && err.status === 400 && this.pageMetric === 'path')) {
        throw err;
      }
      this.pageMetric = 'url';
      data = await this.get(query(this.pageMetric), { website: true });
    }
    if (!Array.isArray(data)) {
      throw new UmamiError(ERROR_KINDS.NOT_UMAMI, 'The answer is not an Umami metric');
    }
    const top = data.find((item) => item && typeof item.x === 'string' && item.x);
    return top ? { path: top.x, views: count(top.y) } : null;
  }
}
