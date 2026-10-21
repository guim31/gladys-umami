// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `umami_today`.
//
// The use case: a glance at the wall tablet tells how the day goes on the
// websites — visitors right now, visitors, visits and page views today — and,
// for several websites, which one draws the visitors. One website: its most
// viewed page of the day under the figures.
//
// Every website by default, or the ones chosen in the widget settings
// (devices added to Gladys). The figures are sent as values, not bound to
// device features: the widget works before the devices are added.
//
// Budget (8 components, 2 texts): four tiles, one text when Umami does not
// answer, one caption (one website) or one status list of ten rows at most
// (several), a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, labelled, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  pick: {
    en: 'Fill in your Umami account in the configuration of the integration.',
    fr: "Renseignez votre compte Umami dans la configuration de l'intégration.",
    de: 'Trage dein Umami-Konto in der Konfiguration der Integration ein.',
    es: 'Indique su cuenta de Umami en la configuración de la integración.',
  },
  empty: {
    en: 'No website yet: add one in Umami.',
    fr: 'Aucun site pour le moment : ajoutez-en un dans Umami.',
    de: 'Noch keine Website: Füge eine in Umami hinzu.',
    es: 'Todavía no hay ningún sitio: añada uno en Umami.',
  },
  active: { en: 'Right now', fr: 'En ce moment', de: 'Gerade jetzt', es: 'Ahora mismo' },
  visitors: { en: 'Visitors', fr: 'Visiteurs', de: 'Besucher', es: 'Visitantes' },
  visits: { en: 'Visits', fr: 'Visites', de: 'Besuche', es: 'Visitas' },
  pageviews: { en: 'Page views', fr: 'Pages vues', de: 'Seitenaufrufe', es: 'Páginas vistas' },
  now: { en: 'now', fr: 'en ligne', de: 'jetzt', es: 'ahora' },
  top: {
    en: 'Most viewed page',
    fr: 'Page la plus vue',
    de: 'Meistbesuchte Seite',
    es: 'Página más vista',
  },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Umami read again.',
    fr: 'Umami relu.',
    de: 'Umami neu gelesen.',
    es: 'Umami leído de nuevo.',
  },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The websites the widget shows: the chosen devices, or every website. */
export function selectSites(hub, settings) {
  const chosen = [settings?.websites ?? []].flat().filter((id) => typeof id === 'string' && id);
  if (chosen.length === 0) {
    return [...hub.sites.values()];
  }
  return [...new Set(chosen)].map((id) => hub.find(id)).filter(Boolean);
}

const visitorsOf = (site) => site.today?.visitors ?? 0;

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.pick, language);
  }
  const sites = selectSites(hub, settings).sort(
    (a, b) =>
      visitorsOf(b) - visitorsOf(a) ||
      (b.active ?? 0) - (a.active ?? 0) ||
      a.name.localeCompare(b.name),
  );
  if (sites.length === 0 && !hub.error) {
    return message(TEXT.empty, language);
  }

  const sum = (read) => sites.reduce((total, site) => total + (read(site) ?? 0), 0);
  const active = sum((site) => site.active);
  const components = [
    {
      type: 'value',
      value: active,
      label: pick(TEXT.active, language),
      icon: 'radio',
      color: active > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: sum(visitorsOf),
      label: pick(TEXT.visitors, language),
      icon: 'users',
      color: WIDGET_COLORS.INFO,
    },
    {
      type: 'value',
      value: sum((site) => site.today?.visits),
      label: pick(TEXT.visits, language),
      icon: 'log-in',
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: sum((site) => site.today?.pageviews),
      label: pick(TEXT.pageviews, language),
      icon: 'file-text',
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];

  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }

  if (sites.length === 1) {
    if (sites[0].topPage) {
      components.push({
        type: 'text',
        variant: 'caption',
        text: fit(labelled(pick(TEXT.top, language), sites[0].topPage, language), 80),
      });
    }
  } else if (sites.length > 1) {
    const shown = sites.length > MAX_ROWS ? sites.slice(0, MAX_ROWS - 1) : sites;
    const now = pick(TEXT.now, language);
    const items = shown.map((site) => ({
      label: fit(site.name, 40),
      value: fit(`${visitorsOf(site)} · ${site.active ?? 0} ${now}`, 40),
      icon: (site.active ?? 0) > 0 ? 'radio' : 'globe',
      color: (site.active ?? 0) > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    }));
    if (sites.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${sites.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }

  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
