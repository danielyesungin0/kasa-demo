/**
 * STUB — a nails/spa provider with a DIFFERENT shape than Shen: open 7 days,
 * short durations, no perms/color taxonomy, its own unsupported list.
 *
 * seeded:false → live availability/chat scenarios SKIP this profile until its
 * row is seeded (slug must start "qa-" per the seeding safety guard). The shape
 * is fully specified so expanding to 100+ multi-provider scenarios is a
 * fill-in-and-seed, not a redesign. The whole point: the SAME scenario
 * templates must produce correct, DIFFERENT expectations here vs. Shen — e.g.
 * this provider is never "closed Wednesday".
 *
 * @type {import("../types.mjs").ProviderProfile}
 */
export const nails = {
  slug: "qa-nails",
  kind: "nails",
  displayName: "Lux Nails",
  seeded: false, // TODO: seed qa-nails row, then flip to true

  services: [
    { id: "svc-manicure",     name: "Manicure",       category: "Manicure", aliases: ["mani"],        priceCents: 3000, durationMinutes: 30 },
    { id: "svc-gel-manicure", name: "Gel Manicure",   category: "Manicure", aliases: ["gel", "gels"], priceCents: 4500, durationMinutes: 45 },
    { id: "svc-pedicure",     name: "Pedicure",       category: "Pedicure", aliases: ["pedi"],        priceCents: 5000, durationMinutes: 50 },
  ],

  categories: ["Manicure", "Pedicure"],

  schedule: {
    // Open every day 9–5 — must NEVER be reported as "closed" on any weekday.
    closedDays: [],
    openDays: [0, 1, 2, 3, 4, 5, 6],
    start: "09:00",
    end: "17:00",
  },

  unsupported: ["acrylic removal", "haircut", "massage"],

  handoff: {
    multiPerson: true,
    explicitHumanRequest: true,
  },
};
