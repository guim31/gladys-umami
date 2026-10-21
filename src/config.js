// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Umami Cloud (no address, an API key), or a self-hosted Umami: its address,
// and an API key (`umami_…`, Umami 3.4+) or a user name and password.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  url: '',
  api_key: '',
  username: '',
  password: '',
  poll_interval: '60',
  spike_threshold: 10,
  silence_hours: 24,
  language: 'fr',
};

export const MAX_SPIKE_THRESHOLD = 1_000_000;
export const MAX_SILENCE_HOURS = 720;

// Pages of the Umami interface: an address copied from the browser points at
// one of them, the API lives at the root.
const INTERFACE_PATH = /\/(websites|dashboard|settings|teams|login|share|api)(\/.*)?$/i;

// The hosts of Umami Cloud: the interface and the API.
const CLOUD_HOST = /^(cloud|api|eu|us)\.umami\.is$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:3000`), or a URL copied from the browser
 * (`https://umami.example.org/websites/…`). HTTP by default for a bare host. A
 * path is kept (Umami behind a reverse proxy sub-path, BASE_PATH), the
 * interface pages dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, '' for Umami Cloud,
 *   null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  const text = raw.trim();
  if (!text) {
    return '';
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  if (CLOUD_HOST.test(url.hostname)) {
    return '';
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme), "Umami Cloud" for the cloud. */
export const hostOf = (url) => (url ? url.replace(/^https?:\/\//, '') : 'Umami Cloud');

function integer(value, fallback, min, max) {
  const number = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value;
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  // A pasted key often carries a trailing space or new line; a password is
  // taken as typed.
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pollInterval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  return {
    url: parseServerUrl(source.url),
    apiKey: text('api_key'),
    username: text('username'),
    password: typeof source.password === 'string' ? source.password : '',
    pollIntervalMs: Number(pollInterval) * 1000,
    spikeThreshold: integer(
      source.spike_threshold,
      DEFAULT_CONFIG.spike_threshold,
      1,
      MAX_SPIKE_THRESHOLD,
    ),
    silenceHours: integer(source.silence_hours, DEFAULT_CONFIG.silence_hours, 1, MAX_SILENCE_HOURS),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/**
 * What is missing to sign in, null when the configuration is complete:
 * 'invalidUrl', 'noKey' (Umami Cloud needs its API key) or 'noCredentials'.
 */
export function missingCredentials(config) {
  if (config.url === null) {
    return 'invalidUrl';
  }
  if (config.url === '') {
    return config.apiKey ? null : 'noKey';
  }
  return config.apiKey || (config.username && config.password) ? null : 'noCredentials';
}
