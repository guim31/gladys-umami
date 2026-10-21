// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene outputs.
// Four languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './umami/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// What is missing in the configuration (src/config.js missingCredentials).
export const CONNECTION_TEXT = {
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.10:3000',
    fr: 'Adresse incomprise, ex. http://192.168.1.10:3000',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.10:3000',
    es: 'Dirección no válida, p. ej. http://192.168.1.10:3000',
  },
  noKey: {
    en: 'Umami Cloud: paste your API key. Your own server: fill in its address.',
    fr: "Umami Cloud : collez votre clé d'API. Votre propre serveur : indiquez son adresse.",
    de: 'Umami Cloud: Füge deinen API-Schlüssel ein. Eigener Server: Gib seine Adresse an.',
    es: 'Umami Cloud: pegue su clave de API. Su propio servidor: indique su dirección.',
  },
  noCredentials: {
    en: 'Fill in an API key, or a user name and its password.',
    fr: "Indiquez une clé d'API, ou un nom d'utilisateur et son mot de passe.",
    de: 'Gib einen API-Schlüssel an, oder einen Benutzernamen und sein Passwort.',
    es: 'Indique una clave de API, o un nombre de usuario y su contraseña.',
  },
};

// One short explanation per error kind (src/umami/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Umami does not answer',
    fr: 'Umami ne répond pas',
    de: 'Umami antwortet nicht',
    es: 'Umami no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key, user name or password refused',
    fr: "clé d'API, nom d'utilisateur ou mot de passe refusé",
    de: 'API-Schlüssel, Benutzername oder Passwort abgelehnt',
    es: 'clave de API, nombre de usuario o contraseña rechazados',
  },
  [ERROR_KINDS.TWO_FACTOR]: {
    en: 'this account uses two-factor login: use an API key',
    fr: "ce compte a la double authentification : utilisez une clé d'API",
    de: 'dieses Konto nutzt Zwei-Faktor-Anmeldung: Nutze einen API-Schlüssel',
    es: 'esta cuenta usa doble autenticación: use una clave de API',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many requests: choose a longer refresh interval',
    fr: 'trop de requêtes : choisissez un intervalle plus long',
    de: 'zu viele Anfragen: Wähle ein längeres Intervall',
    es: 'demasiadas peticiones: elija un intervalo más largo',
  },
  [ERROR_KINDS.NOT_UMAMI]: {
    en: 'no Umami at this address',
    fr: 'aucun Umami à cette adresse',
    de: 'kein Umami unter dieser Adresse',
    es: 'no hay ningún Umami en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'this website no longer exists in Umami',
    fr: "ce site n'existe plus dans Umami",
    de: 'diese Website existiert in Umami nicht mehr',
    es: 'este sitio ya no existe en Umami',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    websites: (n) => `${n} website(s)`,
    visitors: (n) => `${n} visitor(s) today`,
    active: (n) => `${n} right now`,
  },
  fr: {
    ok: 'Connecté',
    websites: (n) => `${n} site(s)`,
    visitors: (n) => `${n} visiteur(s) aujourd'hui`,
    active: (n) => `${n} en ce moment`,
  },
  de: {
    ok: 'Verbunden',
    websites: (n) => `${n} Website(s)`,
    visitors: (n) => `${n} Besucher heute`,
    active: (n) => `${n} gerade jetzt`,
  },
  es: {
    ok: 'Conectado',
    websites: (n) => `${n} sitio(s)`,
    visitors: (n) => `${n} visitante(s) hoy`,
    active: (n) => `${n} ahora mismo`,
  },
};

export const ACTION_TEXT = {
  unknownWebsite: {
    en: 'This device is not an Umami website.',
    fr: "Cet appareil n'est pas un site Umami.",
    de: 'Dieses Gerät ist keine Umami-Website.',
    es: 'Este dispositivo no es un sitio de Umami.',
  },
};

// The `sentence` output of "Read the figures of a website".
export const SENTENCE_TEXT = {
  en: {
    today: (name, visitors, pageviews) =>
      `${name}: ${visitors} visitor(s) and ${pageviews} page view(s) today`,
    active: (n) => `${n} right now`,
    top: (page) => `most viewed page ${page}`,
  },
  fr: {
    today: (name, visitors, pageviews) =>
      `${name} : ${visitors} visiteur(s) et ${pageviews} page(s) vue(s) aujourd'hui`,
    active: (n) => `${n} en ce moment`,
    top: (page) => `page la plus vue ${page}`,
  },
  de: {
    today: (name, visitors, pageviews) =>
      `${name}: ${visitors} Besucher und ${pageviews} Seitenaufrufe heute`,
    active: (n) => `${n} gerade jetzt`,
    top: (page) => `meistbesuchte Seite ${page}`,
  },
  es: {
    today: (name, visitors, pageviews) =>
      `${name}: ${visitors} visitante(s) y ${pageviews} página(s) vista(s) hoy`,
    active: (n) => `${n} ahora mismo`,
    top: (page) => `página más vista ${page}`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
