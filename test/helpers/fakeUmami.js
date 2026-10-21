// -----------------------------------------------------------------------------
// An in-memory Umami: its websites and figures rendered like the API of Umami
// 3.4 (checked against the real answers of test/fixtures/umami in
// test/client.test.js), or like Umami 2 (`version: 2`: `{ value, prev }`
// statistics, `url` page metric). Signs in like the real one: Umami Cloud key,
// self-hosted `umami_…` key, or user name and password.
// -----------------------------------------------------------------------------

export const BASE = 'http://192.0.2.10:3000';
export const API_KEY = 'umami_testkeytestkeytestkeytestke';
export const CLOUD_KEY = 'cloudkeycloudkeycloudkey12345678';
export const USERNAME = 'gladys';
export const PASSWORD = 'not-a-real-password';

let next = 1;

/** A website of the fake, with a quiet day. */
export function website(fields = {}) {
  const n = next++;
  return {
    id: `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
    name: `Site ${n}`,
    domain: `site${n}.example.org`,
    active: 0,
    today: { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 },
    // Visits of the window asked by "no visit for N hours".
    recentVisits: 5,
    topPath: null,
    ...fields,
  };
}

export class FakeUmami {
  constructor({ websites, version = 3, cloud = false, twoFactor = false } = {}) {
    this.websites = websites ?? [
      website({
        name: 'Blog',
        domain: 'blog.example.org',
        active: 2,
        today: { pageviews: 41, visitors: 12, visits: 15, bounces: 6, totaltime: 900 },
        topPath: '/posts/hello',
      }),
      website({ name: 'Shop', domain: 'shop.example.org' }),
    ];
    this.version = version;
    this.cloud = cloud;
    this.twoFactor = twoFactor;
    this.tokens = new Set();
    /** 'down': the server does not answer; a number: that HTTP status. */
    this.failure = null;
    this.requests = [];
    this.request = this.request.bind(this);
  }

  get(name) {
    return this.websites.find((item) => item.name === name);
  }

  set(name, fields) {
    Object.assign(this.get(name), fields);
  }

  setToday(name, fields) {
    Object.assign(this.get(name).today, fields);
  }

  /** Every session token stops working (Umami restarted, password changed). */
  expireTokens() {
    this.tokens.clear();
  }

  authorized(headers) {
    if (this.cloud) {
      return headers['x-umami-api-key'] === CLOUD_KEY;
    }
    const token = headers.authorization?.replace(/^Bearer /, '');
    return token === API_KEY || this.tokens.has(token);
  }

  async request(url, { method = 'GET', headers = {}, body } = {}) {
    this.requests.push({ url, method });
    if (this.failure === 'down') {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    if (typeof this.failure === 'number') {
      return { status: this.failure, body: '{}' };
    }
    const json = (status, data) => ({ status, body: JSON.stringify(data) });
    const parsed = new URL(url);
    const prefix = this.cloud ? '/v1' : '/api';
    if (!parsed.pathname.startsWith(`${prefix}/`)) {
      return { status: 404, body: '<html>Not found</html>' };
    }
    const path = parsed.pathname.slice(prefix.length);
    const query = Object.fromEntries(parsed.searchParams);

    if (path === '/auth/login' && method === 'POST' && !this.cloud) {
      const { username, password } = JSON.parse(body);
      if (username !== USERNAME || password !== PASSWORD) {
        return json(401, { error: { message: 'Unauthorized', status: 401 } });
      }
      if (this.twoFactor) {
        return json(200, { requiresTwoFactor: true, partialToken: 'partial' });
      }
      const token = `token-${this.tokens.size + 1}-${Date.now()}`;
      this.tokens.add(token);
      return json(200, { token, user: { id: 'u', username } });
    }
    if (!this.authorized(headers)) {
      return json(401, { error: { message: 'Unauthorized', status: 401 } });
    }
    if (path === '/websites') {
      const page = Number(query.page ?? 1);
      const size = Number(query.pageSize ?? 20);
      const data = this.websites
        .slice((page - 1) * size, page * size)
        .map(({ id, name, domain }) => ({ id, name, domain, teamId: null, shareId: null }));
      return json(200, { data, count: this.websites.length, page, pageSize: size });
    }
    const match = path.match(/^\/websites\/([^/]+)\/(active|stats|metrics)$/);
    const site = match && this.websites.find((item) => item.id === match[1]);
    if (!site) {
      return json(404, { error: { message: 'Not found', status: 404 } });
    }
    if (match[2] === 'active') {
      return json(200, { visitors: site.active });
    }
    if (match[2] === 'stats') {
      const startAt = Number(query.startAt);
      const endAt = Number(query.endAt);
      // Today (from midnight) or the window of the silence check.
      const window = endAt - startAt > 0 && !isMidnight(startAt);
      const figures = window
        ? { pageviews: site.recentVisits, visitors: 0, visits: site.recentVisits, bounces: 0 }
        : site.today;
      const out = { totaltime: 0, ...figures };
      if (this.version === 2) {
        return json(
          200,
          Object.fromEntries(Object.entries(out).map(([key, value]) => [key, { value, prev: 0 }])),
        );
      }
      return json(200, { ...out, comparison: {} });
    }
    const type = this.version === 2 ? 'url' : 'path';
    if (query.type !== type) {
      return json(400, { error: { message: 'Bad request', status: 400 } });
    }
    return json(200, site.topPath ? [{ x: site.topPath, y: 9 }] : []);
  }
}

const isMidnight = (time) => {
  const date = new Date(time);
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
};
