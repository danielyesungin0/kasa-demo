/**
 * Shen — the live internal test provider (slug=shen-test). This is the BETA
 * GATE provider: the only fully-seeded profile today. Values mirror the live
 * DB row (closed Mon + Wed, real services/categories, unsupported color/adjacent
 * techniques).
 *
 * @type {import("../types.mjs").ProviderProfile}
 */
export const shenTest = {
  slug: "shen-test",
  kind: "hair",
  displayName: "Shen",
  seeded: true,

  services: [
    { id: "svc-short-cut",       name: "Short Haircut",      category: "Haircut",   aliases: ["haircut", "trim", "cut"], priceCents: null, durationMinutes: 60 },
    { id: "svc-medium-long-cut", name: "Medium/Long Haircut",category: "Haircut",   aliases: ["long haircut"],            priceCents: null, durationMinutes: 75 },
    { id: "svc-head-spa",        name: "Head Spa",           category: "Treatment", aliases: ["scalp treatment"],         priceCents: null, durationMinutes: 60 },
    { id: "svc-keratin",         name: "Keratin Treatment",  category: "Treatment", aliases: ["keratin"],                 priceCents: null, durationMinutes: 150 },
    { id: "svc-root-touchup",    name: "Root Touch-up",      category: "Color",     aliases: ["roots"],                   priceCents: null, durationMinutes: 90 },
    { id: "svc-full-color",      name: "Full Color",         category: "Color",     aliases: ["color", "dye"],            priceCents: null, durationMinutes: 120 },
  ],

  categories: ["Haircut", "Treatment", "Color", "Perm"],

  schedule: {
    // Live row: Sun/Tue/Thu/Fri/Sat active; Mon(1) + Wed(3) closed.
    closedDays: [1, 3],
    openDays: [0, 2, 4, 5, 6],
    start: "10:00",
    end: "19:30",
  },

  // Color-adjacent + adjacent-business techniques Shen doesn't offer.
  unsupported: ["bleach", "balayage", "highlights", "extensions", "nails", "waxing"],

  handoff: {
    multiPerson: true,
    explicitHumanRequest: true,
  },
};
