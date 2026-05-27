import {
  parseClientMessage,
  EMPTY_CONTEXT,
  filterSlotsByRefinement,
  findSlotByMention,
} from "../lib/parse-intent";
import { getSlotsForService, EARLIEST_SLOTS } from "../lib/mock-data";

function pretty(o: unknown) {
  return JSON.stringify(o, null, 2);
}

console.log("=".repeat(60));
console.log("SMOKE TESTS — context-aware booking assistant");
console.log("=".repeat(60));

// Test 1: cold-start "do you have time today for a women's haircut at 5pm"
{
  const intent = parseClientMessage(
    "do you have time today for a women's haircut at 5pm",
    EMPTY_CONTEXT
  );
  console.log("\n[1] cold start, full sentence");
  console.log(pretty(intent));
  console.assert(intent.kind === "book", "should be book");
}

// Test 2: refine — "do you have any earlier times on the 12th"
{
  const ctx = {
    ...EMPTY_CONTEXT,
    selectedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
    lastShownSlots: getSlotsForService("svc-medium-long-cut").slice(0, 3),
    lastAnchorDateKey: "2026-05-05",
    lastIntentTags: ["Haircut" as const],
  };
  const intent = parseClientMessage(
    "do you have any earlier times on the 12th",
    ctx
  );
  console.log("\n[2] refine — earlier on the 12th");
  console.log(pretty(intent));
  console.assert(intent.kind === "refine_time", "should be refine_time");

  if (intent.kind === "refine_time") {
    const result = filterSlotsByRefinement(
      getSlotsForService("svc-medium-long-cut"),
      intent,
      ctx
    );
    console.log("  filtered slots:");
    result.slots.forEach((s) =>
      console.log(`    ${s.dayLabel} ${s.dateLabel} ${s.timeLabel}`)
    );
    console.log(`  outcome=${result.outcome}, anchor=${result.anchorDateKey}`);
  }
}

// Test 3: refine — "anything later that day"
{
  const ctx = {
    ...EMPTY_CONTEXT,
    selectedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
    lastShownSlots: getSlotsForService("svc-medium-long-cut").filter(
      (s) => s.dateKey === "2026-05-05" && s.hour24 < 10
    ),
    lastAnchorDateKey: "2026-05-05",
    lastIntentTags: ["Haircut" as const],
  };
  const intent = parseClientMessage("anything later that day", ctx);
  console.log("\n[3] refine — later that day");
  console.log(pretty(intent));

  if (intent.kind === "refine_time") {
    const result = filterSlotsByRefinement(
      getSlotsForService("svc-medium-long-cut"),
      intent,
      ctx
    );
    console.log("  filtered slots:");
    result.slots.forEach((s) =>
      console.log(`    ${s.dayLabel} ${s.dateLabel} ${s.timeLabel}`)
    );
  }
}

// Test 4: info — "how much is that?"
{
  const ctx = {
    ...EMPTY_CONTEXT,
    lastRecommendedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
  };
  const intent = parseClientMessage("how much is that?", ctx);
  console.log("\n[4] info — how much");
  console.log(pretty(intent));
  console.assert(intent.kind === "info_query", "should be info_query");
}

// Test 5: select — "book the 2pm"
{
  const slots = getSlotsForService("svc-medium-long-cut");
  const ctx = {
    ...EMPTY_CONTEXT,
    selectedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
    lastShownSlots: slots.slice(0, 5),
    lastAnchorDateKey: "2026-05-06",
  };
  const intent = parseClientMessage("book the 2pm", ctx);
  console.log("\n[5] select — book the 2pm");
  console.log(pretty(intent));
  console.assert(intent.kind === "select_slot", "should be select_slot");

  if (intent.kind === "select_slot") {
    const match = findSlotByMention(intent, ctx);
    console.log("  matched:", match.slot?.fullLabel ?? "(none)");
    if (match.ambiguous)
      console.log(
        "  ambiguous candidates:",
        match.ambiguous.map((s) => s.fullLabel).join(", ")
      );
  }
}

// Test 6: switch — "actually can I do color instead"
{
  const ctx = {
    ...EMPTY_CONTEXT,
    selectedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
    lastIntentTags: ["Haircut" as const],
  };
  const intent = parseClientMessage("actually can I do color instead", ctx);
  console.log("\n[6] switch — color instead");
  console.log(pretty(intent));
  console.assert(intent.kind === "switch_service", "should be switch_service");
}

// Test 7: cold-start ordinal — "I'll take the second one"
{
  const slots = EARLIEST_SLOTS;
  const ctx = {
    ...EMPTY_CONTEXT,
    lastShownSlots: slots,
  };
  const intent = parseClientMessage("I'll take the second one", ctx);
  console.log("\n[7] select — second one");
  console.log(pretty(intent));

  if (intent.kind === "select_slot") {
    const match = findSlotByMention(intent, ctx);
    console.log("  matched:", match.slot?.fullLabel ?? "(none)");
  }
}

// Test 8: combined — "perm and haircut friday afternoon"
{
  const intent = parseClientMessage(
    "perm and haircut friday afternoon",
    EMPTY_CONTEXT
  );
  console.log("\n[8] combined — perm and haircut friday afternoon");
  console.log(pretty(intent));
}

// Test 9: low confidence — "i need help"
{
  const intent = parseClientMessage("i need help", EMPTY_CONTEXT);
  console.log("\n[9] low confidence — i need help");
  console.log(pretty(intent));
}

// Test 10: tomorrow + service — "haircut tomorrow morning"
{
  const intent = parseClientMessage("haircut tomorrow morning", EMPTY_CONTEXT);
  console.log("\n[10] haircut tomorrow morning");
  console.log(pretty(intent));
}

// Test 11: week-relative — "next week"
{
  const ctx = {
    ...EMPTY_CONTEXT,
    selectedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
    lastIntentTags: ["Haircut" as const],
  };
  const intent = parseClientMessage("anything next week", ctx);
  console.log("\n[11] refine — next week");
  console.log(pretty(intent));
  if (intent.kind === "refine_time") {
    console.log(`  weekShift=${intent.timeHints.weekShift}`);
  }
}

// Test 12: week-relative — "week after"
{
  const ctx = {
    ...EMPTY_CONTEXT,
    selectedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
    lastIntentTags: ["Haircut" as const],
  };
  const intent = parseClientMessage("how about the week after", ctx);
  console.log("\n[12] refine — week after");
  console.log(pretty(intent));
  if (intent.kind === "refine_time") {
    console.log(`  weekShift=${intent.timeHints.weekShift}`);
  }
}

// Test 13: fuzzy time — "around 3pm"
{
  const intent = parseClientMessage(
    "haircut tuesday around 3pm",
    EMPTY_CONTEXT
  );
  console.log("\n[13] fuzzy — around 3pm");
  console.log(pretty(intent));
  if (intent.kind === "book") {
    console.log(`  flex=${intent.timeHints.timeFlexibility}`);
  }
}

// Test 14: exact time — "haircut tuesday at 3pm"
{
  const intent = parseClientMessage("haircut tuesday at 3pm", EMPTY_CONTEXT);
  console.log("\n[14] exact — at 3pm");
  console.log(pretty(intent));
  if (intent.kind === "book") {
    console.log(`  flex=${intent.timeHints.timeFlexibility}`);
  }
}

// Test 15: explicit switch — "actually let's do color"
{
  const ctx = {
    ...EMPTY_CONTEXT,
    selectedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
    lastIntentTags: ["Haircut" as const],
  };
  const intent = parseClientMessage("actually let's do color", ctx);
  console.log("\n[15] explicit switch — actually let's do color");
  console.log(`  kind: ${intent.kind}`);
}

// Test 16: ambiguous switch — "what about color"
{
  const ctx = {
    ...EMPTY_CONTEXT,
    selectedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
    lastIntentTags: ["Haircut" as const],
  };
  const intent = parseClientMessage("what about color", ctx);
  console.log("\n[16] ambiguous switch — what about color");
  console.log(`  kind: ${intent.kind}`);
}

// Test 17: ambiguous switch — "maybe a perm"
{
  const ctx = {
    ...EMPTY_CONTEXT,
    selectedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
    lastIntentTags: ["Haircut" as const],
  };
  const intent = parseClientMessage("maybe a perm", ctx);
  console.log("\n[17] ambiguous switch — maybe a perm");
  console.log(`  kind: ${intent.kind}`);
}

// Test 18: multi-service — "color and haircut"
{
  const intent = parseClientMessage("color and haircut", EMPTY_CONTEXT);
  console.log("\n[18] multi-service — color and haircut");
  if (intent.kind === "book") {
    console.log(`  tags: ${JSON.stringify(intent.tags)}`);
  }
}

// Test 19: select with no match → tier fallback (compute outcome)
{
  const slots = getSlotsForService("svc-medium-long-cut");
  const ctx = {
    ...EMPTY_CONTEXT,
    selectedService: {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut" as const,
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online" as const,
    },
    // Pretend user is currently looking at slots on the 16th and asks for "later"
    lastShownSlots: slots.filter((s) => s.dateKey === "2026-05-09"),
    lastAnchorDateKey: "2026-05-09",
    lastIntentTags: ["Haircut" as const],
  };
  const intent = parseClientMessage("anything later that day", ctx);
  console.log("\n[19] fallback hierarchy — later when none exist");
  if (intent.kind === "refine_time") {
    const result = filterSlotsByRefinement(
      getSlotsForService("svc-medium-long-cut"),
      intent,
      ctx
    );
    console.log(`  outcome=${result.outcome}, tier=${result.fallbackTier}`);
    console.log(
      `  surfaced ${result.slots.length} slot(s) starting at ${
        result.slots[0]?.fullLabel ?? "(none)"
      }`
    );
  }
}

/* ---------------------------------------------------------------------------
   Edge case matrix — the brief's A through Q tests
--------------------------------------------------------------------------- */

console.log("\n" + "=".repeat(60));
console.log("EDGE CASE MATRIX (brief's A-Q)");
console.log("=".repeat(60));

const haircutCtx = {
  ...EMPTY_CONTEXT,
  selectedService: {
    id: "svc-medium-long-cut",
    name: "Medium / Long Hair Cut",
    category: "Haircut" as const,
    priceLabel: "$120",
    durationMinutes: 75,
    durationLabel: "1 hr 15 min",
    status: "online" as const,
  },
  lastIntentTags: ["Haircut" as const],
};

function describe(label: string, intent: import("../lib/parse-intent").Intent) {
  const k = intent.kind;
  const extra =
    k === "book" || k === "switch_service"
      ? ` combo=${intent.comboServiceId ?? "—"} tags=${JSON.stringify(intent.tags)}`
      : k === "add_services"
      ? ` mode=${intent.mode} combo=${intent.comboServiceId ?? "—"} tags=${JSON.stringify(intent.tags)}`
      : k === "confirm_switch"
      ? ` proposed=${JSON.stringify(intent.proposedTags)}`
      : "";
  console.log(`  ${label.padEnd(35)} → ${k}${extra}`);
}

// A: existing combo service
describe("A. men's cut and perm", parseClientMessage("i need a men's cut and perm", EMPTY_CONTEXT));

// B: combo different order
describe("B. perm and haircut for men", parseClientMessage("perm and haircut for men", EMPTY_CONTEXT));

// C: down perm combo
describe("C. haircut and down perm", parseClientMessage("haircut and down perm", EMPTY_CONTEXT));

// D: multi no combo (cold start)
describe("D. women's haircut and color", parseClientMessage("i need a women's haircut and color treatment", EMPTY_CONTEXT));

// E: add service after selection
describe("E. wait i need color too", parseClientMessage("wait i need color too", haircutCtx));

// F: both
describe("F. i need both", parseClientMessage("i need both", haircutCtx));

// G: clear switch
describe("G. actually color instead", parseClientMessage("actually color instead", haircutCtx));

// H: ambiguous
describe("H. what about color", parseClientMessage("what about color", haircutCtx));

// I: specific time unavailable (just parses; filter would handle the rest)
describe("I. haircut next tue at 3pm", parseClientMessage("i need a haircut next tuesday at 3pm", EMPTY_CONTEXT));

// J: more times — just "yes"
describe("J. yes (with shown slots)", parseClientMessage("yes", { ...haircutCtx, lastShownSlots: getSlotsForService("svc-medium-long-cut").slice(0, 3) }));

// K: week after
describe("K. what about the week after", parseClientMessage("what about the week after", haircutCtx));

// L: earlier that day
describe("L. anything earlier that day", parseClientMessage("anything earlier that day", { ...haircutCtx, lastAnchorDateKey: "2026-05-05" }));

// M: price question with combo context
describe("M. how much is that", parseClientMessage("how much is that", haircutCtx));

// N: slot selection
describe("N. book the 2pm", parseClientMessage("book the 2pm", { ...haircutCtx, lastShownSlots: getSlotsForService("svc-medium-long-cut").filter(s => s.dateKey === "2026-05-06") }));

// O: vague
describe("O. i need my hair done", parseClientMessage("i need my hair done", EMPTY_CONTEXT));

// P: big change
describe("P. i want a huge transformation", parseClientMessage("i want a huge transformation", EMPTY_CONTEXT));

console.log("\n" + "=".repeat(60));
console.log("DONE");
console.log("=".repeat(60));
