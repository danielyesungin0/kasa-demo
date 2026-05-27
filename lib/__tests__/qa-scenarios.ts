/**
 * QA test harness for the booking engine.
 *
 * Run with:  npx tsx lib/__tests__/qa-scenarios.ts
 *
 * Each scenario exercises a real-world user input and asserts the expected
 * intent kind and matched service IDs. Results are printed to the console —
 * no jest required, no external dependencies.
 */

import { matchCatalog } from "@/lib/engine/catalog";
import { detectIntent } from "@/lib/engine/intent-patterns";
import { MIA_CATALOG } from "@/lib/businesses/mia-hair";
import { ARIA_CATALOG } from "@/lib/businesses/aria-nails";
import type { IntentKind } from "@/lib/engine/intent-patterns";

type QAScenario = {
  id: string;
  description: string;
  business: "mia" | "aria-nails";
  input: string;
  expectedIntent: IntentKind;
  expectedServiceIds: string[]; // top match must be one of these, or [] for none
  minConfidence?: number; // default 0
};

/* -------------------------------------------------------------------------- */
/* Scenario definitions                                                        */
/* -------------------------------------------------------------------------- */

const SCENARIOS: QAScenario[] = [
  // ── Hair salon ─────────────────────────────────────────────────────────────
  {
    id: "hair-vague-color",
    description: "Vague color interest",
    business: "mia",
    input: "i wanna get my hair done",
    expectedIntent: "book",
    expectedServiceIds: [], // low confidence — no specific service
  },
  {
    id: "hair-roots",
    description: "Asking for roots done",
    business: "mia",
    input: "i wanna get my roots done",
    expectedIntent: "book",
    expectedServiceIds: ["svc-root-touchup"],
    minConfidence: 0.80,
  },
  {
    id: "hair-roots-colloquial",
    description: "Colloquial root request",
    business: "mia",
    input: "my roots are showing can i come in",
    expectedIntent: "book",
    expectedServiceIds: ["svc-root-touchup"],
    minConfidence: 0.70,
  },
  {
    id: "hair-regrowth",
    description: "Regrowth phrasing",
    business: "mia",
    input: "need to deal with my regrowth",
    expectedIntent: "book",
    expectedServiceIds: ["svc-root-touchup"],
    minConfidence: 0.70,
  },
  {
    id: "hair-whole-hair-colored",
    description: "Whole hair coloring (full color)",
    business: "mia",
    input: "can i get my whole hair colored",
    expectedIntent: "book",
    expectedServiceIds: ["svc-full-color"],
    minConfidence: 0.75,
  },
  {
    id: "hair-blonde",
    description: "Going blonde",
    business: "mia",
    input: "i want to go blonde",
    expectedIntent: "book",
    expectedServiceIds: ["svc-full-color"],
    minConfidence: 0.70,
  },
  {
    id: "hair-misspelled-balayage",
    description: "Misspelled balayage",
    business: "mia",
    input: "can i get a balayge",
    expectedIntent: "book",
    expectedServiceIds: ["svc-full-color"],
    minConfidence: 0.55,
  },
  {
    id: "hair-misspelled-color",
    description: "Misspelled color",
    business: "mia",
    input: "i want colr treatment",
    expectedIntent: "book",
    expectedServiceIds: ["svc-full-color"],
    minConfidence: 0.55,
  },
  {
    id: "hair-trim",
    description: "Just a trim",
    business: "mia",
    input: "just need a trim",
    expectedIntent: "book",
    expectedServiceIds: ["svc-medium-long-cut", "svc-short-cut"],
    minConfidence: 0.75,
  },
  {
    id: "hair-mens-cut",
    description: "Men's cut",
    business: "mia",
    input: "mens haircut please",
    expectedIntent: "book",
    expectedServiceIds: ["svc-short-cut"],
    minConfidence: 0.80,
  },
  {
    id: "hair-roots-and-trim",
    description: "Multi-service: roots and haircut",
    business: "mia",
    input: "i wanna get my roots done and a trim",
    expectedIntent: "book",
    expectedServiceIds: ["svc-root-touchup"],
    minConfidence: 0.80,
  },
  {
    id: "hair-full-color-and-cut",
    description: "Multi-service: color and cut",
    business: "mia",
    input: "full color and haircut please",
    expectedIntent: "book",
    expectedServiceIds: ["svc-full-color"],
    minConfidence: 0.85,
  },
  {
    id: "hair-switch-to-fullcolor",
    description: "Switch from root touchup to full color",
    business: "mia",
    input: "actually can i get my whole hair colored instead",
    expectedIntent: "switch_service",
    expectedServiceIds: ["svc-full-color"],
    minConfidence: 0.75,
  },
  {
    id: "hair-add-haircut",
    description: "Add haircut to existing color",
    business: "mia",
    input: "can i also get a haircut",
    expectedIntent: "add_service",
    expectedServiceIds: ["svc-medium-long-cut", "svc-short-cut"],
    minConfidence: 0.75,
  },
  {
    id: "hair-remove-haircut",
    description: "Remove haircut add-on",
    business: "mia",
    input: "actually skip the haircut",
    expectedIntent: "remove_service",
    expectedServiceIds: [],
  },
  {
    id: "hair-next-week",
    description: "Asks for next week",
    business: "mia",
    input: "do you have anything next week",
    expectedIntent: "change_date",
    expectedServiceIds: [],
  },
  {
    id: "hair-earlier",
    description: "Wants earlier time",
    business: "mia",
    input: "is there anything earlier",
    expectedIntent: "change_time",
    expectedServiceIds: [],
  },
  {
    id: "hair-cancel",
    description: "Cancellation request",
    business: "mia",
    input: "i need to cancel my appointment",
    expectedIntent: "cancel",
    expectedServiceIds: [],
  },
  {
    id: "hair-reschedule",
    description: "Reschedule request",
    business: "mia",
    input: "can we move my appointment to a different day",
    expectedIntent: "reschedule",
    expectedServiceIds: [],
  },
  {
    id: "hair-confirm",
    description: "Confirmation",
    business: "mia",
    input: "yes that works",
    expectedIntent: "confirm",
    expectedServiceIds: [],
  },
  {
    id: "hair-reject",
    description: "Rejection",
    business: "mia",
    input: "no that time doesn't work",
    expectedIntent: "reject",
    expectedServiceIds: [],
  },
  {
    id: "hair-unavailable-time",
    description: "Asking about unavailable time",
    business: "mia",
    input: "do you have anything at 8am",
    expectedIntent: "ask_availability",
    expectedServiceIds: [],
  },
  {
    id: "hair-perm",
    description: "Perm request",
    business: "mia",
    input: "i want to get a perm",
    expectedIntent: "book",
    expectedServiceIds: [
      "svc-womens-regular-perm",
      "svc-mens-perm-cut",
    ],
    minConfidence: 0.70,
  },
  {
    id: "hair-digital-perm",
    description: "Digital perm",
    business: "mia",
    input: "can i get a digital perm",
    expectedIntent: "book",
    expectedServiceIds: ["svc-womens-digital-perm"],
    minConfidence: 0.85,
  },
  {
    id: "hair-head-spa",
    description: "Scalp treatment",
    business: "mia",
    input: "i want a scalp treatment",
    expectedIntent: "book",
    expectedServiceIds: ["svc-head-spa"],
    minConfidence: 0.80,
  },
  {
    id: "hair-something-else",
    description: "User says something else",
    business: "mia",
    input: "something else",
    expectedIntent: "unclear",
    expectedServiceIds: [],
  },

  // ── Nail salon ─────────────────────────────────────────────────────────────
  {
    id: "nail-gel-mani",
    description: "Gel manicure request",
    business: "aria-nails",
    input: "can i get gel nails",
    expectedIntent: "book",
    expectedServiceIds: ["nail-gel-mani"],
    minConfidence: 0.85,
  },
  {
    id: "nail-basic-mani",
    description: "Basic manicure",
    business: "aria-nails",
    input: "i just want a regular manicure",
    expectedIntent: "book",
    expectedServiceIds: ["nail-basic-mani"],
    minConfidence: 0.80,
  },
  {
    id: "nail-acrylics",
    description: "Acrylic full set",
    business: "aria-nails",
    input: "i want to get acrylics",
    expectedIntent: "book",
    expectedServiceIds: ["nail-acrylic-set"],
    minConfidence: 0.85,
  },
  {
    id: "nail-fill",
    description: "Nail fill",
    business: "aria-nails",
    input: "my nails need a fill",
    expectedIntent: "book",
    expectedServiceIds: ["nail-fill"],
    minConfidence: 0.80,
  },
  {
    id: "nail-pedi",
    description: "Pedicure request",
    business: "aria-nails",
    input: "can i get a pedicure",
    expectedIntent: "book",
    expectedServiceIds: ["nail-basic-pedi", "nail-spa-pedi"],
    minConfidence: 0.85,
  },
  {
    id: "nail-mani-pedi",
    description: "Mani and pedi together",
    business: "aria-nails",
    input: "i want a manicure and pedicure",
    expectedIntent: "book",
    expectedServiceIds: ["nail-basic-mani", "nail-gel-mani"],
    minConfidence: 0.80,
  },
  {
    id: "nail-misspelled",
    description: "Misspelled manicure",
    business: "aria-nails",
    input: "i want a manicur",
    expectedIntent: "book",
    expectedServiceIds: ["nail-basic-mani", "nail-gel-mani"],
    minConfidence: 0.60,
  },
  {
    id: "nail-do-my-nails",
    description: "Get my nails done (vague)",
    business: "aria-nails",
    input: "i want to get my nails done",
    expectedIntent: "book",
    expectedServiceIds: ["nail-basic-mani", "nail-gel-mani", "nail-acrylic-set"],
    minConfidence: 0.70,
  },
  {
    id: "nail-nail-art",
    description: "Nail art add-on",
    business: "aria-nails",
    input: "can i add some nail art",
    expectedIntent: "add_service",
    expectedServiceIds: ["nail-art"],
    minConfidence: 0.80,
  },
  {
    id: "nail-remove",
    description: "Remove acrylics",
    business: "aria-nails",
    input: "i need to remove my acrylics",
    expectedIntent: "book",
    expectedServiceIds: ["nail-removal"],
    minConfidence: 0.80,
  },
  {
    id: "nail-cancel",
    description: "Cancel nail appointment",
    business: "aria-nails",
    input: "i can't make it, can i cancel",
    expectedIntent: "cancel",
    expectedServiceIds: [],
  },
];

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

type ScenarioResult = {
  scenario: QAScenario;
  passed: boolean;
  intentMatch: boolean;
  serviceMatch: boolean;
  confidenceOk: boolean;
  detectedIntent: IntentKind;
  topServiceId: string | null;
  topConfidence: number;
  notes: string;
};

function runScenario(s: QAScenario): ScenarioResult {
  const catalog = s.business === "mia" ? MIA_CATALOG : ARIA_CATALOG;
  const { kind } = detectIntent(s.input);
  const matchResult = matchCatalog(s.input, catalog);
  const top = matchResult.topMatch;
  const topServiceId = top?.entry.id ?? null;
  const topConfidence = top?.confidence ?? 0;

  const intentMatch = kind === s.expectedIntent;
  const serviceMatch =
    s.expectedServiceIds.length === 0
      ? true
      : s.expectedServiceIds.includes(topServiceId ?? "");
  const minConf = s.minConfidence ?? 0;
  const confidenceOk = topConfidence >= minConf;

  const passed = intentMatch && serviceMatch && confidenceOk;

  const notes: string[] = [];
  if (!intentMatch)
    notes.push(`intent: expected "${s.expectedIntent}", got "${kind}"`);
  if (!serviceMatch)
    notes.push(
      `service: expected one of [${s.expectedServiceIds.join(", ")}], got "${topServiceId}" (${topConfidence.toFixed(2)})`
    );
  if (!confidenceOk)
    notes.push(
      `confidence: expected >= ${minConf}, got ${topConfidence.toFixed(2)}`
    );
  if (top?.matchedOn)
    notes.push(`matched via: ${top.matchedOn}`);

  return {
    scenario: s,
    passed,
    intentMatch,
    serviceMatch,
    confidenceOk,
    detectedIntent: kind,
    topServiceId,
    topConfidence,
    notes: notes.join(" | "),
  };
}

export function runAllScenarios(): {
  results: ScenarioResult[];
  passed: number;
  failed: number;
  total: number;
} {
  const results = SCENARIOS.map(runScenario);
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, failed: results.length - passed, total: results.length };
}

/* -------------------------------------------------------------------------- */
/* CLI entry point                                                             */
/* -------------------------------------------------------------------------- */

function main() {
  const { results, passed, failed, total } = runAllScenarios();

  console.log("\n═══════════════════════════════════════════════");
  console.log("  BOOKING ENGINE QA SCENARIOS");
  console.log("═══════════════════════════════════════════════\n");

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    const biz = r.scenario.business === "mia" ? "💇 Hair" : "💅 Nails";
    console.log(
      `${icon} [${biz}] ${r.scenario.id}`
    );
    console.log(`   Input: "${r.scenario.input}"`);
    if (r.passed) {
      console.log(
        `   Intent: ${r.detectedIntent} | Service: ${r.topServiceId ?? "none"} (${r.topConfidence.toFixed(2)})`
      );
      if (r.notes) console.log(`   ${r.notes}`);
    } else {
      console.log(`   ⚠  ${r.notes}`);
    }
    console.log();
  }

  console.log("═══════════════════════════════════════════════");
  const pct = Math.round((passed / total) * 100);
  console.log(`  ${passed}/${total} passed (${pct}%)`);
  if (failed > 0) {
    console.log(`  ${failed} failed — see ⚠ above for details`);
  }
  console.log("═══════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}
