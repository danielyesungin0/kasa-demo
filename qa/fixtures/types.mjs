/**
 * Provider profile shape for the eval suite.
 *
 * The whole point of this file: assertions are PROVIDER-RELATIVE. A scenario
 * never hardcodes "Wednesday" or "bleach" — it reads the expectation from the
 * profile. That makes the exact same scenario templates correct for Shen, a
 * nails provider, or a generic appointment provider, just by swapping profiles.
 *
 * JSDoc-typed (not .ts) so the suite runs with plain `node` — no build step,
 * matching qa/run.mjs.
 *
 * @typedef {Object} ProviderService
 * @property {string}      id              svc-* catalog key (matches availability/booking)
 * @property {string}      name
 * @property {string}      category        for "do you do <category>" enumeration
 * @property {string[]}    aliases         e.g. ["trim"] → haircut, for typo/ambiguity
 * @property {number|null} priceCents
 * @property {number}      durationMinutes
 *
 * @typedef {Object} ProviderSchedule
 * @property {number[]} closedDays  0=Sun..6=Sat — source of truth for closed-day asserts
 * @property {number[]} openDays    0=Sun..6=Sat
 * @property {string}   start       "10:00" (24h) — open time
 * @property {string}   end         "19:30" (24h) — close time
 *
 * @typedef {Object} ProviderHandoff
 * @property {boolean} multiPerson           "me and my mom" → handoff
 * @property {boolean} explicitHumanRequest  "talk to a person" → handoff
 *
 * @typedef {Object} ProviderProfile
 * @property {string}            slug         resolves the live DB row (e.g. "shen-test")
 * @property {"hair"|"nails"|"generic"} kind
 * @property {string}            displayName
 * @property {ProviderService[]} services
 * @property {string[]}          categories   distinct categories clients may ask about
 * @property {ProviderSchedule}  schedule
 * @property {string[]}          unsupported  this provider's unsupported terms
 * @property {ProviderHandoff}   handoff
 * @property {boolean}           [seeded]     true if the slug exists in the DB and
 *                                            availability/chat scenarios can run live.
 *                                            Stubs set false → live scenarios skip.
 */

export const DOW_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export {}; // module marker
