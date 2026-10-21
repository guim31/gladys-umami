// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Umami, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read Umami with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-healthchecks.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { websiteIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { API_KEY, BASE, CLOUD_KEY, FakeUmami, PASSWORD, USERNAME, website } from './fakeUmami.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the tests: 15/10/2026, 10:00 local. */
export function createClock(start = new Date(2026, 9, 15, 10, 0, 0).getTime()) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  umami = new FakeUmami(),
  config = { url: BASE, api_key: API_KEY, language: 'en' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-umami-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: umami.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, umami, app, hub: app.hub, clock, dataDir };
}

/** External ids of the device of a website of the fake, by name. */
export const idsOf = (world, name) => websiteIds(world.gladys, world.umami.get(name).id);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { API_KEY, BASE, CLOUD_KEY, FakeUmami, PASSWORD, USERNAME, website };
