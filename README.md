# Umami for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the figures of your [Umami](https://umami.is/) websites — on Umami
Cloud or on your own server — into Gladys.

- **One device per website**: visitors right now (last 5 minutes), and the
  visitors, visits, page views, bounce rate and most viewed page of the day.
- **Scene triggers**: visitor spike (above a threshold of your choice), first
  visitor of the day, no visit for N hours (a broken tracking script) — for
  any website, added to Gladys or not.
- **Scene action**: read the figures of a website, with a ready-made sentence
  for a message.
- **Dashboard widget**: the day at a glance, per website.
- Texts in English, French, German and Spanish.

Tested against a real self-hosted Umami 3.4.0 and 2.19.0 (Docker, PostgreSQL),
with a user name and password and with a self-hosted API key. Developed without
an Umami Cloud account (same API, `x-umami-api-key` header): feedback welcome
on [the issues](https://github.com/guim31/gladys-umami/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- Umami Cloud and an API key, or a self-hosted Umami 2 or 3 with an API key
  (Umami 3.4+) or a user name and password (a view-only user is enough).

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-umami`. Then open its configuration: leave
the address empty for Umami Cloud or enter the address of your server, fill in
the API key (or user name and password), and add the websites from the
Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

At the chosen interval (one minute by default), the container reads, for every
website, `GET /websites/{id}/active` and `GET /websites/{id}/stats` from
midnight (time zone of Gladys); the most viewed page every 5 minutes, the
visits of the last N hours every 15 minutes, the website list every 10
minutes (with the websites shared in its teams). On Umami Cloud the client
keeps below 40 requests per 15 seconds. It publishes the states of the devices added to Gladys when they
change and fires the scene events on transitions. What the triggers remember
is kept in `/data`, so a restart announces nothing twice. Redirects are not
followed, so the credentials are never sent to another host.

## Limits

- Read-only, one Umami account per configuration.
- The spike and silence thresholds are the same for every website.
- Umami 1 is not supported. A self-signed HTTPS certificate is not accepted
  (use `http://` on the local network).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the Umami
API.

## Credits

- [Umami](https://github.com/umami-software/umami) by Umami Software and
  contributors (MIT): the API answers in `test/fixtures/umami` come from its
  Docker images, and the logo of the cover from its repository
  (`src/assets/logo-white.svg`).
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-healthchecks](https://github.com/guim31/gladys-healthchecks).

Not affiliated with Umami Software, Inc.

## License

Apache-2.0, see [LICENSE](LICENSE).
