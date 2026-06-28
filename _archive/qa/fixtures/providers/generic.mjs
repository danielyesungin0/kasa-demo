/**
 * STUB — a generic appointment provider (e.g. a consultant/coach): few
 * services, longer durations, a different open-days pattern, minimal categories.
 * Proves the suite isn't tied to a beauty taxonomy at all.
 *
 * seeded:false → skipped live until its qa- row is seeded.
 *
 * @type {import("../types.mjs").ProviderProfile}
 */
export const generic = {
  slug: "qa-generic",
  kind: "generic",
  displayName: "Avery Consulting",
  seeded: false, // TODO: seed qa-generic row, then flip to true

  services: [
    { id: "svc-consultation",  name: "Consultation",      category: "Session", aliases: ["consult", "intro call"], priceCents: 0,     durationMinutes: 30 },
    { id: "svc-strategy",      name: "Strategy Session",  category: "Session", aliases: ["strategy"],              priceCents: 20000, durationMinutes: 90 },
  ],

  categories: ["Session"],

  schedule: {
    // Tue–Sat 11–19; Sun(0) + Mon(1) closed.
    closedDays: [0, 1],
    openDays: [2, 3, 4, 5, 6],
    start: "11:00",
    end: "19:00",
  },

  unsupported: ["haircut", "massage", "legal advice"],

  handoff: {
    multiPerson: false, // generic provider books one at a time, no group concept
    explicitHumanRequest: true,
  },
};
