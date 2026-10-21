// -----------------------------------------------------------------------------
// The Umami client against the real answers of Umami 3.4.0 and 2.19.0
// (test/fixtures/umami), the three ways to sign in, and the errors. Also the
// parsing of the configuration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CLOUD_API,
  ERROR_KINDS,
  UmamiClient,
  UmamiError,
  count,
  isSelfHostedKey,
} from '../src/umami/client.js';
import { missingCredentials, normalizeConfig, parseServerUrl } from '../src/config.js';
import { API_KEY, BASE, CLOUD_KEY, FakeUmami, PASSWORD, USERNAME } from './helpers/fakeUmami.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/umami/${name}`, import.meta.url), 'utf8'));

/** A request function answering from a fixture file, by endpoint. */
function replay(answers) {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, ...options });
    const { pathname, searchParams } = new URL(url);
    let key;
    if (pathname.endsWith('/auth/login')) {
      key = JSON.parse(options.body).password === PASSWORD ? 'login' : 'login_refused';
    } else if (!options.headers?.authorization) {
      key = 'unauthorized';
    } else if (pathname.endsWith('/teams')) {
      key = 'teams';
    } else if (/\/teams\/[^/]+\/websites$/.test(pathname)) {
      key = 'team_websites';
    } else if (pathname.endsWith('/websites')) {
      key = 'websites';
    } else if (pathname.endsWith('/active')) {
      key = 'active';
    } else if (pathname.endsWith('/stats')) {
      key = 'stats';
    } else {
      key = `metrics_${searchParams.get('type')}`;
    }
    const { status, body } = answers[key];
    return { status, body: typeof body === 'string' ? body : JSON.stringify(body) };
  };
  return { request, calls };
}

for (const [file, expected] of [
  [
    'v3.4.0.json',
    {
      websites: [
        { id: 'f3225440-f256-451d-be30-0aa8b0291d3a', name: 'Blog', domain: 'blog.example.org' },
        { id: '96735b31-c8cd-48d3-b845-0b8c89ce326d', name: 'Shop', domain: 'shop.example.org' },
        // Shared through the team "Marketing".
        { id: 'd74f6adc-341d-4028-9361-48c99c5c0ab3', name: 'Docs', domain: 'docs.example.org' },
      ],
      active: 3,
      stats: { pageviews: 7, visitors: 3, visits: 3, bounces: 1, totaltime: 0 },
      top: { path: '/', views: 3 },
      metricCalls: ['path'],
      complete: true,
    },
  ],
  [
    'v2.19.0.json',
    {
      websites: [
        { id: '4b87b3b6-a257-436b-8d55-e199ab6b55f8', name: 'Blog v2', domain: 'blog.example.org' },
      ],
      active: 2,
      stats: { pageviews: 4, visitors: 2, visits: 2, bounces: 0, totaltime: 0 },
      top: { path: '/', views: 2 },
      metricCalls: ['path', 'url'],
      // Umami 2 has no GET /teams (405): its own list is used alone.
      complete: false,
    },
  ],
]) {
  test(`reads the real answers of Umami ${file.replace('.json', '')}`, async () => {
    const answers = await fixture(file);
    const { request, calls } = replay(answers);
    const client = new UmamiClient({ url: BASE, username: USERNAME, password: PASSWORD, request });
    assert.equal(client.mode, 'login');
    assert.deepEqual(await client.websites(), {
      websites: expected.websites,
      complete: expected.complete,
    });
    const id = expected.websites[0].id;
    assert.equal(await client.active(id), expected.active);
    assert.deepEqual(await client.stats(id, 1, 2), expected.stats);
    assert.deepEqual(await client.topPage(id, 1, 2), expected.top);
    assert.deepEqual(
      calls
        .filter((call) => call.url.includes('/metrics'))
        .map((call) => new URL(call.url).searchParams.get('type')),
      expected.metricCalls,
    );
    // The v2 fallback is remembered.
    await client.topPage(id, 1, 2);
    assert.equal(calls.at(-1).url.includes(`type=${expected.metricCalls.at(-1)}`), true);
    // Signed in once, the token sent as a Bearer.
    assert.equal(calls.filter((call) => call.url.endsWith('/auth/login')).length, 1);
    assert.equal(calls.at(-1).headers.authorization, 'Bearer session-token-replaced');
  });

  test(`a refused password is an auth error (Umami ${file.replace('.json', '')})`, async () => {
    const { request } = replay(await fixture(file));
    const client = new UmamiClient({ url: BASE, username: USERNAME, password: 'x', request });
    await assert.rejects(client.websites(), { kind: ERROR_KINDS.AUTH });
  });
}

test('a view-only team member sees the websites of its teams (real Umami 3.4.0 answers)', async () => {
  const answers = await fixture('v3.4.0.json');
  // The viewer's own list is empty: the website comes from the team.
  const { request } = replay({ ...answers, websites: answers.viewer_websites });
  const client = new UmamiClient({ url: BASE, username: USERNAME, password: PASSWORD, request });
  assert.deepEqual(await client.websites(), {
    websites: [
      { id: 'd74f6adc-341d-4028-9361-48c99c5c0ab3', name: 'Docs', domain: 'docs.example.org' },
    ],
    complete: true,
  });
  // A website the viewer cannot read: 401, taken as a website gone.
  const { request: refused } = replay({ ...answers, active: answers.website_unauthorized });
  const other = new UmamiClient({
    url: BASE,
    username: USERNAME,
    password: PASSWORD,
    request: refused,
  });
  await assert.rejects(other.active('96735b31-c8cd-48d3-b845-0b8c89ce326d'), {
    kind: ERROR_KINDS.NOT_FOUND,
  });
});

test('the page metric: the other name after a 400, no top page when both fail', async () => {
  let refuse = new Set(['path']);
  const calls = [];
  const client = new UmamiClient({
    url: BASE,
    apiKey: API_KEY,
    request: async (url) => {
      const type = new URL(url).searchParams.get('type');
      calls.push(type);
      return refuse.has(type)
        ? { status: 400, body: '{}' }
        : { status: 200, body: JSON.stringify([{ x: '/a', y: 2 }]) };
    },
  });
  assert.deepEqual(await client.topPage('id', 1, 2), { path: '/a', views: 2 });
  assert.equal(client.pageMetric, 'url');
  refuse = new Set(['path', 'url']);
  assert.equal(await client.topPage('id', 1, 2), null, 'a passing 400 does not fail the read');
  refuse = new Set(['url']);
  assert.deepEqual(await client.topPage('id', 1, 2), { path: '/a', views: 2 });
  assert.equal(client.pageMetric, 'path', 'back to path');
  assert.deepEqual(calls, ['path', 'url', 'url', 'path', 'url', 'path']);
});

test('Umami Cloud requests stay within its rate limit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const umami = new FakeUmami({ cloud: true });
  const client = new UmamiClient({
    url: '',
    apiKey: CLOUD_KEY,
    rate: { requests: 3, perMs: 15_000 },
    request: (url, options) => umami.request(url.replace(CLOUD_API, `${BASE}/v1`), options),
  });
  const done = [];
  const reads = [1, 2, 3, 4].map((n) =>
    client.active(umami.websites[0].id).then(() => done.push(n)),
  );
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
  assert.equal(done.length, 3, 'the fourth waits');
  t.mock.timers.tick(15_000);
  await Promise.all(reads);
  assert.equal(done.length, 4);
});

test('counts accept numbers, bigint strings and the { value, prev } of Umami 2', () => {
  assert.equal(count(7), 7);
  assert.equal(count('12'), 12);
  assert.equal(count({ value: 4, prev: 0 }), 4);
  assert.equal(count(null), 0);
  assert.equal(count(-3), 0);
  assert.equal(count('abc'), 0);
});

test('Umami Cloud: api.umami.is/v1 and the x-umami-api-key header', async () => {
  const umami = new FakeUmami({ cloud: true });
  const calls = [];
  const client = new UmamiClient({
    url: '',
    apiKey: CLOUD_KEY,
    request: (url, options) => {
      calls.push({ url, headers: options.headers });
      return umami.request(url.replace(CLOUD_API, `${BASE}/v1`), options);
    },
  });
  assert.equal(client.mode, 'cloud');
  assert.equal((await client.websites()).websites.length, 2);
  assert.ok(calls[0].url.startsWith(`${CLOUD_API}/websites?`));
  assert.equal(calls[0].headers['x-umami-api-key'], CLOUD_KEY);
  assert.equal(calls[0].headers.authorization, undefined);
});

test('a self-hosted API key is sent as a Bearer, without login', async () => {
  const umami = new FakeUmami();
  const client = new UmamiClient({ url: BASE, apiKey: API_KEY, request: umami.request });
  assert.equal(client.mode, 'key');
  assert.ok(isSelfHostedKey(API_KEY));
  await client.websites();
  assert.deepEqual(
    umami.requests.map((r) => new URL(r.url).pathname),
    ['/api/websites', '/api/teams'],
  );
});

test('an expired session token is renewed once, then the request is sent again', async () => {
  const umami = new FakeUmami();
  const client = new UmamiClient({
    url: BASE,
    username: USERNAME,
    password: PASSWORD,
    request: umami.request,
  });
  await client.websites();
  umami.expireTokens();
  await client.websites();
  assert.deepEqual(
    umami.requests.map((r) => new URL(r.url).pathname),
    [
      '/api/auth/login',
      '/api/websites',
      '/api/teams',
      '/api/websites',
      '/api/auth/login',
      '/api/websites',
      '/api/teams',
    ],
  );
});

test('a two-factor account is told to use an API key', async () => {
  const umami = new FakeUmami({ twoFactor: true });
  const client = new UmamiClient({
    url: BASE,
    username: USERNAME,
    password: PASSWORD,
    request: umami.request,
  });
  await assert.rejects(client.websites(), { kind: ERROR_KINDS.TWO_FACTOR });
});

test('every list page is read, a website listed twice kept once', async () => {
  const websites = Array.from({ length: 230 }, (_, n) => ({
    id: `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
    name: `Site ${n}`,
    domain: '',
  }));
  websites.push({ ...websites[0] });
  const umami = new FakeUmami({ websites });
  const client = new UmamiClient({ url: BASE, apiKey: API_KEY, request: umami.request });
  const { websites: found } = await client.websites();
  assert.equal(found.length, 230);
  assert.equal(umami.requests.filter((r) => r.url.includes('/api/websites')).length, 3);
});

test('errors: down, certificate, 429, redirect, not Umami, deleted website', async () => {
  const umami = new FakeUmami();
  const client = new UmamiClient({ url: BASE, apiKey: API_KEY, request: umami.request });
  umami.failure = 'down';
  await assert.rejects(client.websites(), { kind: ERROR_KINDS.UNREACHABLE });
  for (const [status, kind] of [
    [429, ERROR_KINDS.RATE_LIMIT],
    [301, ERROR_KINDS.REDIRECT],
    [500, ERROR_KINDS.HTTP],
    [403, ERROR_KINDS.AUTH],
  ]) {
    umami.failure = status;
    await assert.rejects(client.websites(), { kind }, `HTTP ${status}`);
  }
  umami.failure = null;
  await assert.rejects(client.active('00000000-0000-4000-8000-0000000000ff'), {
    kind: ERROR_KINDS.NOT_FOUND,
  });
  const other = new UmamiClient({ url: `${BASE}/other`, apiKey: API_KEY, request: umami.request });
  await assert.rejects(other.websites(), { kind: ERROR_KINDS.NOT_UMAMI });

  const tls = new UmamiClient({
    url: BASE,
    apiKey: API_KEY,
    request: async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
      });
    },
  });
  await assert.rejects(tls.websites(), (err) => err instanceof UmamiError && err.kind === 'tls');
});

test('no secret in the error messages', async () => {
  const umami = new FakeUmami();
  umami.failure = 401;
  const client = new UmamiClient({ url: BASE, apiKey: API_KEY, request: umami.request });
  const err = await client.websites().catch((error) => error);
  assert.ok(!err.message.includes(API_KEY));
});

// --- Configuration -----------------------------------------------------------------

test('the address: bare host, copied URL, sub-path, Umami Cloud', () => {
  assert.equal(parseServerUrl('192.0.2.10:3000'), 'http://192.0.2.10:3000');
  assert.equal(
    parseServerUrl(' https://umami.example.org/websites/abc/realtime '),
    'https://umami.example.org',
  );
  assert.equal(parseServerUrl('https://example.org/umami/'), 'https://example.org/umami');
  assert.equal(parseServerUrl('https://example.org/umami/dashboard'), 'https://example.org/umami');
  assert.equal(parseServerUrl(''), '');
  assert.equal(parseServerUrl('https://cloud.umami.is/websites'), '');
  assert.equal(parseServerUrl('https://api.umami.is/v1'), '');
  assert.equal(parseServerUrl('ftp://example.org'), null);
  assert.equal(parseServerUrl('https://user:pw@example.org'), null);
});

test('normalized configuration and what is missing to sign in', () => {
  const config = normalizeConfig({
    url: '192.0.2.10:3000',
    api_key: ` ${API_KEY}\n`,
    poll_interval: 120,
    spike_threshold: '25',
    silence_hours: 0,
    language: 'de',
  });
  assert.equal(config.url, 'http://192.0.2.10:3000');
  assert.equal(config.apiKey, API_KEY);
  assert.equal(config.pollIntervalMs, 120_000);
  assert.equal(config.spikeThreshold, 25);
  assert.equal(config.silenceHours, 1);
  assert.equal(config.language, 'de');
  assert.equal(missingCredentials(config), null);

  const defaults = normalizeConfig({});
  assert.equal(defaults.url, '');
  assert.equal(defaults.pollIntervalMs, 60_000);
  assert.equal(defaults.spikeThreshold, 10);
  assert.equal(defaults.silenceHours, 24);
  assert.equal(defaults.language, 'fr');
  assert.equal(missingCredentials(defaults), 'noKey');
  assert.equal(missingCredentials(normalizeConfig({ url: BASE })), 'noCredentials');
  assert.equal(missingCredentials(normalizeConfig({ url: BASE, username: 'a' })), 'noCredentials');
  assert.equal(
    missingCredentials(normalizeConfig({ url: BASE, username: 'a', password: 'b' })),
    null,
  );
  assert.equal(missingCredentials(normalizeConfig({ url: 'ftp://x' })), 'invalidUrl');
});
