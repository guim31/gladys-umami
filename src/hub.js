// -----------------------------------------------------------------------------
// The Umami hub: the websites read on a timer of the container (the interval
// chosen in the configuration); the states of the added devices published
// when they change, the scene events fired on transitions, and the views the
// widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and the scene
// events fire for every website, added to Gladys or not.
//
// Requests per website and cycle: visitors right now, and today's statistics.
// The most viewed page is read every 5 minutes, the visits of the last N hours
// (for "no visit for N hours") every 15 minutes, the website list every 10
// minutes. On Umami Cloud (50 requests per 15 seconds), the client waits
// rather than exceed 40 (src/umami/client.js).
//
// What the triggers remember is kept in /data (src/store.js): a restart
// neither announces a spike or a first visitor twice, nor misses a silence.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildWebsiteDevice,
  bounceRate,
  parseWebsiteId,
  topPageText,
  websiteIds,
  websiteValues,
} from './devices.js';
import { ERROR_KINDS, UmamiClient, UmamiError } from './umami/client.js';
import { hostOf, missingCredentials, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'umami-hub' });

export const WIDGET_KEY = 'umami_today';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  SPIKE: 'visitor_spike',
  FIRST_VISITOR: 'first_visitor',
  SILENT: 'website_silent',
});

export const HUB_TIMINGS = {
  // The website list (added, renamed, deleted websites).
  websitesEveryMs: 10 * 60_000,
  // The most viewed page of the day: one more request per website.
  topEveryMs: 5 * 60_000,
  // The visits of the last N hours, for "no visit for N hours".
  silenceEveryMs: 15 * 60_000,
  // A second spike of the same website is announced after this pause at
  // least, even if the visitors went below the threshold in between.
  spikeCooldownMs: 30 * 60_000,
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads Umami again when the last read is older.
  freshMs: 15_000,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;

/** Midnight of the day of `time`, in the time zone of Gladys (TZ). */
export function startOfDay(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** The local day of `time`, `YYYY-MM-DD`. */
export function dayKey(time) {
  const date = new Date(time);
  const two = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export class UmamiHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/umami/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} websites of the last read, by id */
    this.sites = new Map();
    this.websitesAt = 0;
    this.readAt = 0;
    this.error = null;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = { sites: {} };
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const sites = saved?.sites;
    this.saved = { sites: sites && typeof sites === 'object' ? sites : {} };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    const languageChanged = this.signature !== null && previous.language !== config.language;
    this.config = config;
    const signature = JSON.stringify([config.url, config.apiKey, config.username, config.password]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client =
        missingCredentials(config) === null
          ? new UmamiClient({
              url: config.url,
              apiKey: config.apiKey,
              username: config.username,
              password: config.password,
              request: this.request,
            })
          : null;
      this.sites = new Map();
      this.websitesAt = 0;
      this.readAt = 0;
      this.error = null;
      this.polling = null;
    }
    if (previous.silenceHours !== config.silenceHours) {
      for (const site of this.sites.values()) {
        site.silenceAt = 0; // read the new window at the next cycle
      }
    }
    if (languageChanged) {
      this.discovered = null; // new names for the Discovery tab
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Umami works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading Umami ------------------------------------------------------------

  /** Read Umami now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read failed or is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && (this.error || this.now() - this.readAt >= this.timings.freshMs)) {
      await this.pollNow();
    }
  }

  /**
   * Read Umami and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    try {
      await this.readSites(client);
    } catch (err) {
      if (!(err instanceof UmamiError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    return client === this.client && this.applySuccess();
  }

  /** The website list when due, then the figures of every website. */
  async readSites(client) {
    const now = this.now();
    if (this.websitesAt === 0 || now - this.websitesAt >= this.timings.websitesEveryMs) {
      const { websites, complete } = await client.websites();
      if (client !== this.client) {
        return;
      }
      const next = new Map();
      for (const website of websites) {
        const known = this.sites.get(website.id);
        next.set(website.id, known ? { ...known, ...website } : blankSite(website));
      }
      if (!complete) {
        // The teams could not be read: keep the websites known from them.
        for (const [id, site] of this.sites) {
          if (!next.has(id)) {
            next.set(id, site);
          }
        }
      }
      this.sites = next;
      this.websitesAt = now;
    }
    const start = startOfDay(now);
    const day = dayKey(now);
    for (const site of [...this.sites.values()]) {
      try {
        await this.readSite(client, site, { now, start, day });
      } catch (err) {
        if (!(err instanceof UmamiError && err.kind === ERROR_KINDS.NOT_FOUND)) {
          throw err;
        }
        // Deleted or no longer shared since the last list (Umami answers 401):
        // forget it, list again next time.
        this.sites.delete(site.id);
        this.websitesAt = 0;
      }
    }
  }

  async readSite(client, site, { now, start, day }) {
    const active = await client.active(site.id);
    const today = await client.stats(site.id, start, now);
    let top = null;
    const topDue =
      site.topDay !== day || !site.topReadAt || now - site.topReadAt >= this.timings.topEveryMs;
    if (topDue) {
      top = today.pageviews > 0 ? await client.topPage(site.id, start, now) : null;
    }
    // Visitors right now, or a new visit today: not silent, no request needed.
    let silent = site.silent;
    let silenceAt = site.silenceAt;
    const newVisit = site.today && site.day === day && today.visits > site.today.visits;
    if (active > 0 || newVisit) {
      silent = false;
      silenceAt = now;
    } else if (!silenceAt || now - silenceAt >= this.timings.silenceEveryMs) {
      const window = await client.stats(site.id, now - this.config.silenceHours * 3600_000, now);
      silent = window.visits === 0;
      silenceAt = now;
    }
    // Applied at the end: a failed request leaves the website as it was.
    Object.assign(site, { active, today, day, silent, silenceAt });
    if (topDue) {
      Object.assign(site, {
        topPage: top?.path ?? null,
        topViews: top?.views ?? 0,
        topReadAt: now,
        topDay: day,
      });
    }
  }

  async applySuccess() {
    const firstRead = this.readAt === 0;
    let widgetChanged = this.error !== null || firstRead;
    if (this.error) {
      logger.info('Umami answers again');
    }
    if (firstRead) {
      logger.info(
        `Umami (${hostOf(this.config.url)}, ${this.client.mode}): ${this.sites.size} website(s)`,
      );
    }
    this.error = null;
    this.readAt = this.now();
    const signature = JSON.stringify([...this.sites.values()].map(widgetSignature));
    if (signature !== this.widgetSignature) {
      this.widgetSignature = signature;
      widgetChanged = true;
    }

    let dirty = false;
    for (const site of this.sites.values()) {
      dirty = (await this.transition(site)) || dirty;
    }
    // A website deleted in Umami is forgotten.
    for (const id of Object.keys(this.saved.sites)) {
      if (!this.sites.has(id)) {
        delete this.saved.sites[id];
        dirty = true;
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.store.save(this.saved);
    }
    await this.publishStates();
    return widgetChanged;
  }

  applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Umami: ${err.message}`);
    }
    return wasError !== err.kind;
  }

  /**
   * Compare a website with what the triggers remember; fire the scene events.
   * The first sight of a website only records its state.
   * @returns {boolean} whether the saved state changed
   */
  async transition(site) {
    const now = this.now();
    const first = !this.saved.sites[site.id];
    const saved = this.saved.sites[site.id] ?? { spike: false, spikeAt: 0, firstDay: null };
    const before = JSON.stringify(saved);
    const threshold = this.config.spikeThreshold;

    if (site.active >= threshold) {
      if (first) {
        saved.spike = true; // under way before the integration saw it
      } else if (!saved.spike && now - (saved.spikeAt || 0) >= this.timings.spikeCooldownMs) {
        // A spike starting during the pause is announced once the pause is
        // over, if it still lasts.
        saved.spike = true;
        saved.spikeAt = now;
        logger.info(`${site.name}: ${site.active} visitors right now`);
        await this.fire(TRIGGERS.SPIKE, site, { visitors: site.active, threshold });
      }
    } else if (saved.spike) {
      saved.spike = false;
    }

    if (site.today?.visitors > 0 && saved.firstDay !== site.day) {
      saved.firstDay = site.day;
      if (!first) {
        await this.fire(TRIGGERS.FIRST_VISITOR, site, { visitors: site.today.visitors });
      }
    }

    if (typeof site.silent === 'boolean' && saved.silent !== site.silent) {
      const was = saved.silent;
      saved.silent = site.silent;
      if (was === false && site.silent) {
        logger.info(`${site.name}: no visit for ${this.config.silenceHours} h`);
        await this.fire(TRIGGERS.SILENT, site, { hours: this.config.silenceHours });
      }
    }

    this.saved.sites[site.id] = saved;
    return first || JSON.stringify(saved) !== before;
  }

  async fire(key, site, extra = {}) {
    const data = {
      device: websiteIds(this.gladys, site.id).device,
      website: site.name,
      domain: site.domain,
      ...extra,
    };
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** Publish the Discovery list when it changed (a website added, renamed…). */
  async publishDevices({ force = false } = {}) {
    let devices;
    if (!this.client) {
      devices = [];
    } else if (this.readAt === 0 || this.error) {
      return; // nothing read: keep the list Gladys has
    } else {
      devices = [...this.sites.values()].map((site) =>
        buildWebsiteDevice(this.gladys, site, this.config.language),
      );
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: list the websites again, publish the list. */
  async rediscover() {
    this.websitesAt = 0;
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: send all its states (the SDK forgot
   * what it had published for it), and its badge.
   */
  async onDeviceCreated(device) {
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0 || this.error) {
      return;
    }
    const states = [];
    for (const site of this.sites.values()) {
      if (this.isCreated(websiteIds(this.gladys, site.id).device)) {
        states.push(...websiteValues(this.gladys, site));
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: cloud or local, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    let transport = this.config.url ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.CLOUD;
    if (this.error) {
      transport = DEVICE_TRANSPORTS.UNREACHABLE;
    }
    const entries = [];
    for (const id of this.sites.keys()) {
      const externalId = websiteIds(this.gladys, id).device;
      if (this.isCreated(externalId) && this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    const missing = missingCredentials(this.config);
    if (missing) {
      return { connected: false, message: CONNECTION_TEXT[missing] };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene actions, report) ------------------------------------------

  /** The website of a device external id, null when it is not one (or no longer exists). */
  find(externalId) {
    const id = parseWebsiteId(this.gladys, externalId);
    return id ? (this.sites.get(id) ?? null) : null;
  }

  /** Throws the reason Umami cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** "Test the connection": read Umami now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const sites = [...this.sites.values()];
    const sum = (read) => sites.reduce((total, site) => total + (read(site) ?? 0), 0);
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const status = this.connectionStatus();
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const parts = [
        text.ok,
        text.websites(sites.length),
        text.visitors(sum((site) => site.today?.visitors)),
        text.active(sum((site) => site.active)),
      ];
      message[language] = labelled('Umami', parts.join(', '), language);
    }
    return message;
  }
}

/** A website not read yet. */
export function blankSite(website) {
  return {
    name: '',
    domain: '',
    ...website,
    active: null,
    today: null,
    day: null,
    topPage: null,
    topViews: 0,
    topReadAt: 0,
    topDay: null,
    silent: null,
    silenceAt: 0,
  };
}

/** What the widget shows of a website: it is refreshed when this changes. */
const widgetSignature = (site) => [
  site.id,
  site.name,
  site.active,
  site.today?.visitors,
  site.today?.visits,
  site.today?.pageviews,
  site.today ? bounceRate(site.today) : null,
  topPageText(site),
];
