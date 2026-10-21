// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab (the user adds the websites to
// follow, nothing is created on their behalf): one device per Umami website,
// identified by its website id (a uuid, the same in every Umami API).
//
//   active        counter-sensor/integer   visitors of the last 5 minutes
//   visitors      counter-sensor/integer   unique visitors today
//   visits        counter-sensor/integer   visits today
//   pageviews     counter-sensor/integer   page views today
//   bounce_rate   unknown/unknown (%)      visits of one page today, in percent
//   top_page      text/text                the most viewed page today, "-"
//                                          before the first page view
//
// "Today" starts at midnight in the time zone of Gladys (the supervisor
// injects TZ): the daily counters go back to 0 at midnight. The core has no
// percentage category: the bounce rate is `unknown/unknown` with the percent
// unit, as guim31/gladys-gatus does for its uptimes.
//
// Published with should_poll: false: the integration reads Umami on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const WEBSITE_TYPE = 'website';
export const MODEL = 'Umami';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ACTIVE: 'active',
  VISITORS: 'visitors',
  VISITS: 'visits',
  PAGEVIEWS: 'pageviews',
  BOUNCE_RATE: 'bounce_rate',
  TOP_PAGE: 'top_page',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.ACTIVE]: 'Visitors right now',
    [FEATURE_KEYS.VISITORS]: 'Visitors today',
    [FEATURE_KEYS.VISITS]: 'Visits today',
    [FEATURE_KEYS.PAGEVIEWS]: 'Page views today',
    [FEATURE_KEYS.BOUNCE_RATE]: 'Bounce rate today',
    [FEATURE_KEYS.TOP_PAGE]: 'Most viewed page today',
  },
  fr: {
    [FEATURE_KEYS.ACTIVE]: 'Visiteurs en ce moment',
    [FEATURE_KEYS.VISITORS]: "Visiteurs aujourd'hui",
    [FEATURE_KEYS.VISITS]: "Visites aujourd'hui",
    [FEATURE_KEYS.PAGEVIEWS]: "Pages vues aujourd'hui",
    [FEATURE_KEYS.BOUNCE_RATE]: "Taux de rebond aujourd'hui",
    [FEATURE_KEYS.TOP_PAGE]: "Page la plus vue aujourd'hui",
  },
  de: {
    [FEATURE_KEYS.ACTIVE]: 'Besucher gerade jetzt',
    [FEATURE_KEYS.VISITORS]: 'Besucher heute',
    [FEATURE_KEYS.VISITS]: 'Besuche heute',
    [FEATURE_KEYS.PAGEVIEWS]: 'Seitenaufrufe heute',
    [FEATURE_KEYS.BOUNCE_RATE]: 'Absprungrate heute',
    [FEATURE_KEYS.TOP_PAGE]: 'Meistbesuchte Seite heute',
  },
  es: {
    [FEATURE_KEYS.ACTIVE]: 'Visitantes ahora mismo',
    [FEATURE_KEYS.VISITORS]: 'Visitantes hoy',
    [FEATURE_KEYS.VISITS]: 'Visitas hoy',
    [FEATURE_KEYS.PAGEVIEWS]: 'Páginas vistas hoy',
    [FEATURE_KEYS.BOUNCE_RATE]: 'Tasa de rebote hoy',
    [FEATURE_KEYS.TOP_PAGE]: 'Página más vista hoy',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_ACTIVE = 1_000_000;
export const MAX_DAILY = 1_000_000_000;

export const websiteIds = (gladys, id) => gladys.externalIds(WEBSITE_TYPE, id);

/** The website id of a device external id, null when it is not a website of ours. */
export function parseWebsiteId(gladys, externalId) {
  const prefix = websiteIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const counter = (name, externalId, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max },
  );

/** The bounce rate, in whole percent: visits of a single page among all visits. */
export const bounceRate = (stats) =>
  stats.visits > 0 ? Math.min(100, Math.round((stats.bounces / stats.visits) * 100)) : 0;

/** The discovery payload of a website. */
export function buildWebsiteDevice(gladys, website, language = 'en') {
  const ids = websiteIds(gladys, website.id);
  const names = NAMES[language] ?? NAMES.en;
  const params = [];
  if (website.domain) {
    params.push({ name: 'DOMAIN', value: website.domain.slice(0, 255) });
  }
  return {
    name: website.name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params,
    features: [
      counter(names[FEATURE_KEYS.ACTIVE], ids.feature(FEATURE_KEYS.ACTIVE), MAX_ACTIVE),
      counter(names[FEATURE_KEYS.VISITORS], ids.feature(FEATURE_KEYS.VISITORS), MAX_DAILY),
      counter(names[FEATURE_KEYS.VISITS], ids.feature(FEATURE_KEYS.VISITS), MAX_DAILY),
      counter(names[FEATURE_KEYS.PAGEVIEWS], ids.feature(FEATURE_KEYS.PAGEVIEWS), MAX_DAILY),
      sensor(
        names[FEATURE_KEYS.BOUNCE_RATE],
        ids.feature(FEATURE_KEYS.BOUNCE_RATE),
        DEVICE_FEATURE_CATEGORIES.UNKNOWN,
        DEVICE_FEATURE_TYPES.UNKNOWN.UNKNOWN,
        { unit: DEVICE_FEATURE_UNITS.PERCENT, keep_history: true, min: 0, max: 100 },
      ),
      sensor(
        names[FEATURE_KEYS.TOP_PAGE],
        ids.feature(FEATURE_KEYS.TOP_PAGE),
        DEVICE_FEATURE_CATEGORIES.TEXT,
        DEVICE_FEATURE_TYPES.TEXT.TEXT,
        { keep_history: false, min: 0, max: 0 },
      ),
    ],
  };
}

/** The top page as a feature text: never empty, at most 255 characters. */
export const topPageText = (site) => (site.topPage ? site.topPage.slice(0, 255) : '-');

/**
 * The states of a website: `{ device_feature_external_id, state|text }`,
 * nothing for the values not read yet.
 */
export function websiteValues(gladys, site) {
  const ids = websiteIds(gladys, site.id);
  const values = [];
  if (site.active !== null) {
    values.push({ key: FEATURE_KEYS.ACTIVE, state: site.active });
  }
  if (site.today) {
    values.push(
      { key: FEATURE_KEYS.VISITORS, state: site.today.visitors },
      { key: FEATURE_KEYS.VISITS, state: site.today.visits },
      { key: FEATURE_KEYS.PAGEVIEWS, state: site.today.pageviews },
      { key: FEATURE_KEYS.BOUNCE_RATE, state: bounceRate(site.today) },
    );
  }
  if (site.topReadAt) {
    values.push({ key: FEATURE_KEYS.TOP_PAGE, text: topPageText(site) });
  }
  return values.map(({ key, ...value }) => ({
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}
