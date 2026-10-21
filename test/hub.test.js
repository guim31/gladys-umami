// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake Umami: discovery, states,
// scene triggers, persistence across restarts, errors, quiet logs, the
// widget, the scene action and the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import { HUB_TIMINGS, TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  API_KEY,
  BASE,
  CLOUD_KEY,
  FakeUmami,
  PASSWORD,
  USERNAME,
  createClock,
  createDevices,
  createWorld,
  idsOf,
  website,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const MINUTE = 60_000;

test('one device per website, proposed in Discovery, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Blog', 'Shop'],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
    assert.equal(device.features.length, 6);
  }
  assert.deepEqual(devices[0].params, [{ name: 'DOMAIN', value: 'blog.example.org' }]);
  assert.equal(world.fake.states.length, 0, 'nothing published for devices not added');
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the states of an added device, at once, then only the changes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const ids = idsOf(world, 'Blog');
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.ACTIVE)), 2);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.VISITORS)), 12);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.VISITS)), 15);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.PAGEVIEWS)), 41);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.BOUNCE_RATE)), 40);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.TOP_PAGE)), '/posts/hello');
  const shop = idsOf(world, 'Shop');
  assert.equal(world.fake.lastState(shop.feature(FEATURE_KEYS.TOP_PAGE)), '-');
  assert.equal(world.fake.lastState(shop.feature(FEATURE_KEYS.BOUNCE_RATE)), 0);
  assert.deepEqual(
    [...new Set(world.fake.transports.map((entry) => entry.transport))],
    ['local'],
    'a self-hosted server is local',
  );

  const before = world.fake.states.length;
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');

  world.umami.set('Blog', { active: 5 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.states.length, before + 1);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.ACTIVE)), 5);
});

test('requests: two per website and cycle, the top page every 5 minutes, the list every 10', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const paths = () => world.umami.requests.map((r) => new URL(r.url).pathname.split('/').at(-1));
  world.umami.requests = [];
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.deepEqual(paths(), ['active', 'stats', 'active', 'stats']);
  world.umami.requests = [];
  world.clock.advance(4 * MINUTE);
  await world.hub.pollNow();
  assert.deepEqual(paths(), ['active', 'stats', 'metrics', 'active', 'stats']);
  world.umami.requests = [];
  world.clock.advance(5 * MINUTE);
  await world.hub.pollNow();
  assert.equal(paths()[0], 'websites');
});

test('the daily counters follow midnight, and the top page is read again', async (t) => {
  const clock = createClock(new Date(2026, 9, 15, 23, 58).getTime());
  const world = await createWorld({ clock });
  t.after(() => world.app.stop());
  await createDevices(world);
  const ids = idsOf(world, 'Blog');
  world.umami.setToday('Blog', { pageviews: 0, visitors: 0, visits: 0, bounces: 0 });
  world.umami.set('Blog', { topPath: null, active: 0 });
  clock.advance(3 * MINUTE);
  await world.hub.pollNow();
  const stats = world.umami.requests.filter((r) => r.url.includes('/stats')).at(-1);
  assert.equal(
    Number(new URL(stats.url).searchParams.get('startAt')),
    new Date(2026, 9, 16).getTime(),
    'today starts at local midnight',
  );
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.VISITORS)), 0);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.TOP_PAGE)), '-');
});

test('visitor spike: once when the threshold is crossed, again after the pause', async (t) => {
  const world = await createWorld({
    config: { url: BASE, api_key: API_KEY, language: 'en', spike_threshold: 10 },
  });
  t.after(() => world.app.stop());
  world.umami.set('Blog', { active: 12 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.SPIKE).at(-1)?.data, {
    device: idsOf(world, 'Blog').device,
    website: 'Blog',
    domain: 'blog.example.org',
    visitors: 12,
    threshold: 10,
  });
  world.umami.set('Blog', { active: 15 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SPIKE).length, 1, 'still the same spike');
  // Down and up again within 30 minutes: no second event.
  world.umami.set('Blog', { active: 3 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  world.umami.set('Blog', { active: 11 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SPIKE).length, 1, 'within the pause');
  world.umami.set('Blog', { active: 2 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  world.clock.advance(HUB_TIMINGS.spikeCooldownMs);
  world.umami.set('Blog', { active: 20 });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SPIKE).length, 2);
});

test('a spike under way when the integration starts is not announced', async (t) => {
  const umami = new FakeUmami();
  umami.set('Blog', { active: 50 });
  const world = await createWorld({ umami });
  t.after(() => world.app.stop());
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SPIKE).length, 0);
});

test('first visitor of the day: once a day, at the first visitor, not at the first start', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(events(world, TRIGGERS.FIRST_VISITOR).length, 0, 'Blog had visitors already');
  world.umami.setToday('Shop', { visitors: 1, visits: 1, pageviews: 1 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.FIRST_VISITOR).map((event) => event.data.website),
    ['Shop'],
  );
  world.umami.setToday('Shop', { visitors: 3 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.FIRST_VISITOR).length, 1);
  // The next day.
  world.clock.advance(24 * 3600_000);
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.FIRST_VISITOR).map((event) => event.data.website),
    ['Shop', 'Blog', 'Shop'],
  );
});

test('no visit for N hours: when the window empties, once, and again after visits', async (t) => {
  const world = await createWorld({
    config: { url: BASE, api_key: API_KEY, language: 'en', silence_hours: 6 },
  });
  t.after(() => world.app.stop());
  const shop = world.umami.get('Shop');
  const window = () =>
    world.umami.requests.filter(
      (r) => r.url.includes(shop.id) && r.url.includes('/stats') && !isToday(r.url),
    );
  const isToday = (url) =>
    Number(new URL(url).searchParams.get('startAt')) === new Date(2026, 9, 15).getTime();
  assert.equal(window().length, 1);
  assert.equal(
    Number(new URL(window()[0].url).searchParams.get('startAt')),
    world.clock.now() - 6 * 3600_000,
  );
  shop.recentVisits = 0;
  world.clock.advance(5 * MINUTE);
  await world.hub.pollNow();
  assert.equal(window().length, 1, 'read every 15 minutes');
  world.clock.advance(10 * MINUTE);
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.SILENT).at(-1)?.data, {
    device: idsOf(world, 'Shop').device,
    website: 'Shop',
    domain: 'shop.example.org',
    hours: 6,
  });
  world.clock.advance(15 * MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SILENT).length, 1, 'once');
  // A visitor: not silent any more, without asking Umami.
  world.umami.set('Shop', { active: 1 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  world.umami.set('Shop', { active: 0 });
  world.clock.advance(15 * MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SILENT).length, 2);
});

test('a website silent since before the start is not announced', async (t) => {
  const umami = new FakeUmami();
  umami.get('Shop').recentVisits = 0;
  const world = await createWorld({ umami });
  t.after(() => world.app.stop());
  world.clock.advance(20 * MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SILENT).length, 0);
});

test('a restart neither announces a spike twice nor forgets the day', async (t) => {
  const first = await createWorld();
  first.umami.set('Blog', { active: 30 });
  first.clock.advance(MINUTE);
  await first.hub.pollNow();
  await first.app.stop();
  assert.equal(events(first, TRIGGERS.SPIKE).length, 1);

  const second = await createWorld({
    umami: first.umami,
    clock: first.clock,
    dataDir: first.dataDir,
  });
  t.after(() => second.app.stop());
  second.clock.advance(MINUTE);
  await second.hub.pollNow();
  assert.equal(events(second, TRIGGERS.SPIKE).length, 0);
  assert.equal(events(second, TRIGGERS.FIRST_VISITOR).length, 0);
  // A website seen for the first time after a restart still only records.
  second.umami.websites.push(website({ name: 'New', active: 99 }));
  second.clock.advance(10 * MINUTE);
  await second.hub.pollNow();
  assert.equal(events(second, TRIGGERS.SPIKE).length, 0);
});

test('Umami down: unreachable badge and status, one warning, back to normal', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.umami.failure = 'down';
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      world.clock.advance(MINUTE);
      await world.hub.pollNow();
    }
  });
  assert.equal(lines.length, 1, 'one line for an outage, not one per read');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.connectionStatus.message.fr, 'Umami ne répond pas');
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  world.umami.failure = null;
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('a normal cycle writes nothing at the info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 6; cycle += 1) {
      world.umami.set('Blog', { active: 3 + cycle });
      world.umami.setToday('Blog', { visitors: 13 + cycle, pageviews: 44 + cycle });
      world.clock.advance(5 * MINUTE);
      await world.hub.pollNow();
    }
  });
  assert.ok(world.fake.states.length > sent, 'states were published');
  assert.deepEqual(lines, []);
});

test('missing or refused credentials: a clear status, no device', async (t) => {
  const empty = await createWorld({ config: { language: 'en' } });
  t.after(() => empty.app.stop());
  assert.equal(empty.fake.connectionStatus.connected, false);
  assert.match(empty.fake.connectionStatus.message.en, /Umami Cloud/);
  assert.deepEqual(empty.fake.discoveredDevices, []);

  const refused = await createWorld({
    config: { url: BASE, username: USERNAME, password: 'wrong', language: 'en' },
  });
  t.after(() => refused.app.stop());
  assert.equal(refused.fake.connectionStatus.connected, false);
  assert.match(refused.fake.connectionStatus.message.en, /refused/);
});

test('user name and password, and Umami Cloud, end at the same devices', async (t) => {
  const login = await createWorld({
    config: { url: BASE, username: USERNAME, password: PASSWORD, language: 'en' },
  });
  t.after(() => login.app.stop());
  assert.equal(login.fake.discoveredDevices.length, 2);

  const umami = new FakeUmami({ cloud: true });
  const cloud = await createWorld({
    umami,
    config: { api_key: CLOUD_KEY, language: 'en' },
  });
  t.after(() => cloud.app.stop());
  // The cloud client calls https://api.umami.is/v1: the fake answers under /v1.
  assert.equal(cloud.hub.client.mode, 'cloud');
  assert.ok(umami.requests.every((r) => r.url.startsWith('https://api.umami.is/v1/')));
  assert.equal(cloud.fake.discoveredDevices.length, 2);
  await createDevices(cloud);
  assert.equal(cloud.fake.transports.at(-1).transport, 'cloud');
});

test('reconfiguring the language renames the features proposed in Discovery', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated({ url: BASE, api_key: API_KEY, language: 'fr' });
  const names = world.fake.discoveredDevices[0].features.map((f) => f.name);
  assert.ok(names.includes('Visiteurs en ce moment'));
});

test('a website deleted in Umami disappears from Discovery', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.umami.websites = world.umami.websites.filter((w) => w.name !== 'Shop');
  world.clock.advance(MINUTE);
  await world.hub.pollNow(); // 404 on Shop: forgotten, the list read again next time
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.deepEqual(
    world.fake.discoveredDevices.map((d) => d.name),
    ['Blog'],
  );
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the widget: totals, one row per website, valid content in every language', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language });
    assert.equal(ack.success, true, ack.error);
    const { content } = ack.data;
    validateWidgetContent(content);
    const values = content.components.filter((c) => c.type === 'value').map((c) => c.value);
    assert.deepEqual(values, [2, 12, 15, 41]);
    const rows = content.components.find((c) => c.type === 'status').items;
    assert.deepEqual(
      rows.map((row) => row.label),
      ['Blog', 'Shop'],
    );
    assert.ok(content.components.length <= 8);
  }
  await createDevices(world);
  const one = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { websites: [idsOf(world, 'Blog').device] },
    language: 'en',
  });
  const caption = one.data.content.components.find((c) => c.type === 'text');
  assert.equal(caption.text, 'Most viewed page: /posts/hello');
  assert.equal(
    one.data.content.components.find((c) => c.type === 'status'),
    undefined,
  );

  const refreshed = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {});
  assert.equal(refreshed.success, true, refreshed.error);
});

test('the widget asks for the account when nothing is configured', async (t) => {
  const world = await createWorld({ config: { language: 'en' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'de' });
  assert.match(ack.data.content.components[0].text, /Umami-Konto/);
});

test('the scene action reads the figures and writes a sentence', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_website_stats', {
    device: idsOf(world, 'Blog').device,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    name: 'Blog',
    active: 2,
    visitors: 12,
    visits: 15,
    pageviews: 41,
    bounce_rate: 40,
    top_page: '/posts/hello',
    sentence:
      'Blog: 12 visitor(s) and 41 page view(s) today, 2 right now, most viewed page /posts/hello.',
  });
  const unknown = await world.fake.sceneAction('get_website_stats', { device: 'other:1' });
  assert.equal(unknown.success, false);
});

test('"Test the connection" answers one line per language', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.en,
    'Umami: Connected, 2 website(s), 12 visitor(s) today, 2 right now',
  );
  assert.match(ack.data.message.fr, /^Umami : Connecté/);
});

test('the container reads Umami on its own timer, without Gladys polling', async (t) => {
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.hub.config.pollIntervalMs = 20;
  world.hub.schedulePoll();
  world.umami.set('Blog', { active: 7 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(world.fake.lastState(idsOf(world, 'Blog').feature(FEATURE_KEYS.ACTIVE)), 7);
});

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}
