#!/usr/bin/env node
/**
 * Lightweight pre-deploy QA suite for Kasa chat + booking logic.
 *
 * Zero dependencies. Hits a LOCALLY running dev server (npm run dev) against
 * the live DB and asserts on the structured JSON from /api/chat and
 * /api/availability. Covers the regression classes that matter before sending
 * the app to a real provider:
 *   - closed-day contradictions      - unsupported services
 *   - fake availability              - booking-flow inputs
 *   - service recommendations        - rate-limit fallback (graceful)
 *   - handoff routing                - multi-person requests
 *
 * Chat tests are THROTTLED (~4s between calls) so the suite doesn't trip the
 * Groq free-tier rate limit itself — except the one test that deliberately
 * floods to verify the graceful 429 fallback.
 *
 * Usage:
 *   1) npm run dev        (in one terminal)
 *   2) node qa/run.mjs    (in another)   — or:  npm run qa
 *
 * Exit code 0 = all passed, 1 = at least one failure (CI-friendly).
 *
 * Tests run against slug=shen-test (the stable internal provider), so they are
 * independent of the real Shen onboarding.
 */

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const SLUG = process.env.QA_SLUG ?? "shen-test";
const CHAT_THROTTLE_MS = Number(process.env.QA_THROTTLE_MS ?? 4000);

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}
function fail(name, detail) {
  failed++;
  failures.push({ name, detail });
  console.log(`  ❌ ${name}\n       ${detail}`);
}
function assert(cond, name, detail) {
  cond ? ok(name) : fail(name, detail);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chat(message, conversation = []) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, slug: SLUG, conversation }),
  });
  return res.json();
}

async function availability(serviceId, weekShift = 0) {
  const res = await fetch(
    `${BASE}/api/availability?slug=${SLUG}&serviceId=${serviceId}&weekShift=${weekShift}`
  );
  return res.json();
}

// Slot shape (from /api/availability): { id, dayLabel:"Thu", dateLabel,
// timeLabel, fullLabel, dateKey:"2026-06-18", dayOfMonth, hour24, isoTime:"10:00" }.
// Helper: a slot's start as an epoch ms (from dateKey + isoTime), or NaN.
function slotStartMs(s) {
  if (!s) return NaN;
  if (typeof s === "string") return Date.parse(s);
  if (s.dateKey && s.isoTime) return Date.parse(`${s.dateKey}T${s.isoTime}:00`);
  return Date.parse(s.startAt ?? s.start ?? s.slotStartAt ?? "");
}

// Extract a weekday set from availability slots. Prefer the slot's own
// dayLabel; fall back to deriving from the timestamp.
function weekdaysOf(slots) {
  const days = new Set();
  for (const s of slots ?? []) {
    if (s?.dayLabel) {
      days.add(s.dayLabel);
      continue;
    }
    const t = slotStartMs(s);
    if (!Number.isNaN(t)) {
      days.add(new Date(t).toLocaleDateString("en-US", { weekday: "short" }));
    }
  }
  return days;
}

async function run() {
  console.log(`\nKasa QA suite → ${BASE} (slug=${SLUG})\n`);

  // ── 1. Availability is real (no fake Mon/Wed) ──────────────────────────────
  // shen-test is closed Mon + Wed; slots must never appear on those days.
  console.log("Availability / fake-slot guard");
  {
    const { slots } = await availability("svc-short-cut");
    assert(
      Array.isArray(slots) && slots.length > 0,
      "availability returns slots",
      `got ${slots?.length} slots`
    );
    const days = weekdaysOf(slots);
    assert(!days.has("Mon"), "no Monday slots (closed day)", `weekdays: ${[...days]}`);
    assert(!days.has("Wed"), "no Wednesday slots (closed day)", `weekdays: ${[...days]}`);
  }

  // ── 2. Chat: closed-day contradiction ──────────────────────────────────────
  // Asking about a closed day must NOT claim availability on it.
  console.log("\nChat / closed-day contradiction");
  {
    const r = await chat("can I come in on Wednesday?");
    const reply = (r.reply ?? "").toLowerCase();
    // The reply must signal Wednesday is closed/unavailable, NOT offer it.
    // Accept any clear "closed/not available/not open" signal; reject a
    // positive "yes we're open Wednesday" that lacks a negation.
    const signalsClosed =
      /(not available|unavailable|closed|not open|don't open|isn't open|aren't open)/.test(reply);
    const claimsOpen =
      /\b(yes|sure|of course)\b.*wednesday|wednesday.*\b(is|we're|we are)\b.*\b(available|open)\b/.test(reply) &&
      !signalsClosed;
    assert(
      signalsClosed && !claimsOpen,
      "does not claim open on Wednesday (signals closed)",
      `reply: ${r.reply}`
    );
    await sleep(CHAT_THROTTLE_MS);
  }

  // ── 3. Chat: service recommendation ────────────────────────────────────────
  console.log("\nChat / service recommendation");
  {
    const r = await chat("I need a haircut");
    // Either AI recommends a haircut service id, OR (on rate-limit) degrades
    // gracefully — both are acceptable; a WRONG service id is not.
    const recs = r.recommendedServiceIds ?? [];
    const graceful = r.source === "fallback";
    const hasHaircut = recs.some((id) => id.includes("cut"));
    assert(
      hasHaircut || recs.length === 0 || graceful,
      "haircut maps to a cut service (or degrades cleanly)",
      `intent=${r.intent} recs=${JSON.stringify(recs)} source=${r.source}`
    );
    await sleep(CHAT_THROTTLE_MS);
  }

  // ── 4. Chat: unsupported service ───────────────────────────────────────────
  console.log("\nChat / unsupported service");
  {
    const r = await chat("do you do bleach and balayage?");
    const reply = (r.reply ?? "").toLowerCase();
    // Should NOT confirm bleach as a normal bookable service. Acceptable:
    // says not offered, routes to handoff, or degrades gracefully.
    const wronglyConfirms =
      /\b(yes|sure|book|we offer|i can book)\b/.test(reply) &&
      reply.includes("bleach") &&
      !/(don't|do not|not offer|isn't|aren't|unfortunately|can't|unable|reach out|message|contact)/.test(reply);
    assert(!wronglyConfirms, "does not wrongly confirm bleach", `reply: ${r.reply}`);
    await sleep(CHAT_THROTTLE_MS);
  }

  // ── 5. Chat: multi-person request ──────────────────────────────────────────
  console.log("\nChat / multi-person request");
  {
    const r = await chat("can I book for me and my two friends?");
    const graceful = r.source === "fallback";
    assert(
      r.peopleCount > 1 || r.multiServiceRequest === true || r.needsHumanHandoff === true || graceful,
      "detects group / routes appropriately",
      `peopleCount=${r.peopleCount} multi=${r.multiServiceRequest} handoff=${r.needsHumanHandoff} source=${r.source}`
    );
    await sleep(CHAT_THROTTLE_MS);
  }

  // ── 6. Chat: handoff routing ───────────────────────────────────────────────
  console.log("\nChat / handoff routing");
  {
    const r = await chat("I have a complaint and need to speak to a person directly");
    const graceful = r.source === "fallback";
    assert(
      r.needsHumanHandoff === true || graceful,
      "explicit human request routes to handoff",
      `handoff=${r.needsHumanHandoff} intent=${r.intent} source=${r.source}`
    );
    await sleep(CHAT_THROTTLE_MS);
  }

  // ── 7. Booking-flow input sanity (API contract) ────────────────────────────
  // We don't create a real booking here (that's Playwright's job); we assert
  // the availability slot shape the booking flow depends on is present.
  console.log("\nBooking-flow / slot contract");
  {
    const { slots } = await availability("svc-head-spa");
    const first = slots?.[0];
    assert(
      first != null && !Number.isNaN(slotStartMs(first)),
      "first slot has a parseable start time",
      `first slot: ${JSON.stringify(first)}`
    );
    assert(
      first != null && typeof first.timeLabel === "string" && typeof first.dateKey === "string",
      "slot has the labels the booking UI needs",
      `first slot: ${JSON.stringify(first)}`
    );
  }

  // ── 8. Rate-limit graceful fallback ────────────────────────────────────────
  // Deliberately flood to provoke a 429, then assert the friendly fallback
  // (never a raw error) and that it offers the human escape hatch.
  console.log("\nChat / rate-limit graceful fallback");
  {
    // Flood to try to provoke a 429. Whether the limit trips is environmental
    // (depends on recent token usage), so we DON'T require it — instead we
    // assert the invariant that must ALWAYS hold: no raw error is ever shown,
    // and ANY fallback we do see is the graceful kind (busy + handoff offered).
    let sawRawError = false;
    let sawGraceful = false;
    let gracefulHadHandoff = true;
    for (let i = 0; i < 8; i++) {
      const r = await chat(`book a perm please attempt ${i}`);
      const reply = r.reply ?? "";
      if (/\b(error|exception|undefined|null|status 5\d\d|http 4\d\d)\b/i.test(reply)) {
        sawRawError = true;
      }
      const isBusyFallback =
        r.source === "fallback" && /moment|busy|try again/i.test(reply);
      if (isBusyFallback) {
        sawGraceful = true;
        if (r.needsHumanHandoff !== true) gracefulHadHandoff = false;
      }
      // no throttle here — we WANT to hit the limit if usage allows
    }
    // Invariant 1: never a raw API error, regardless of rate-limit state.
    assert(!sawRawError, "never shows a raw API error under load", "a reply contained error-ish text");
    // Invariant 2: IF a busy fallback occurred, it offered handoff. (Skipped
    // cleanly when the limit didn't trip — that's an environment condition,
    // not a regression.)
    if (sawGraceful) {
      assert(gracefulHadHandoff, "busy fallback offers human handoff", "a busy reply lacked needsHumanHandoff");
    } else {
      console.log("  ⓘ rate limit did not trip this run (env-dependent) — graceful-fallback path not exercised");
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(48)}`);
  console.log(`PASSED ${passed}  FAILED ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f.name}\n      ${f.detail}`);
  }
  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\nQA suite crashed (is `npm run dev` running?):\n", err.message);
  process.exit(2);
});
