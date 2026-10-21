// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// A threshold on one figure is already a scene condition on the device
// feature. The action is about what a condition cannot do: put the figures of
// a website in a message ("Blog: 132 visitors and 410 page views today, 4
// right now, most viewed page /posts/hello"). It reads Umami again when the
// last read is older than 15 seconds.
// -----------------------------------------------------------------------------

import { bounceRate } from './devices.js';
import { ACTION_TEXT, SENTENCE_TEXT, pick } from './texts.js';

export const SCENE_ACTIONS = {
  async get_website_stats(hub, { fields = {} }) {
    hub.assertReadable();
    await hub.refreshIfStale();
    hub.assertReadable();
    const language = hub.config.language;
    const site = hub.find(fields.device);
    if (!site) {
      throw new Error(pick(ACTION_TEXT.unknownWebsite, language));
    }
    const today = site.today ?? { visitors: 0, visits: 0, pageviews: 0, bounces: 0 };
    const active = site.active ?? 0;
    const words = SENTENCE_TEXT[language] ?? SENTENCE_TEXT.en;
    const parts = [words.today(site.name, today.visitors, today.pageviews), words.active(active)];
    if (site.topPage) {
      parts.push(words.top(site.topPage));
    }
    return {
      name: site.name,
      active,
      visitors: today.visitors,
      visits: today.visits,
      pageviews: today.pageviews,
      bounce_rate: bounceRate(today),
      top_page: site.topPage ?? '',
      sentence: `${parts.join(', ')}.`,
    };
  },
};
