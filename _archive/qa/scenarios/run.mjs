#!/usr/bin/env node
/**
 * Provider-relative scenario runner (the beta gate).
 *
 * Drives every scenario from qa/scenarios/index.mjs against the LOCAL dev
 * server. Scenarios derive their expectations from the provider profile, so the
 * same templates are correct for any provider. Today only shen-test is seeded
 * and runs live; nails/generic are reported as skipped until seeded.
 *
 * AI scenarios are throttled (~4s) so the Groq free tier doesn't cause flake;
 * assertions tolerate the graceful rate-limit fallback. Plus two invariants
 * that don't depend on a profile: booking-slot contract + graceful rate-limit.
 *
 * Usage:  npm run dev   (one terminal)   then   npm run qa   (another)
 * Exit 0 = all passed, 1 = failure, 2 = crash (server down).
 */

import { buildScenarios, PROFILES } from "./index.mjs";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const CHAT_THROTTLE_MS = Number(process.env.QA_THROTTLE_MS ?? 4000);

let passed = 0;
let failed = 0;
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(name, { pass, detail }) {
  if (pass) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  ❌ ${name}\n       ${detail}`);
  }
}

async function chat(messages, slug) {
  // Replay all but the last message as prior conversation, assert on the last.
  const conversation = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: messages[i], slug, conversation }),
    });
    const data = await res.json();
    conversation.push({ role: "user", content: messages[i] });
    conversation.push({ role: "assistant", content: data.reply ?? "" });
    await sleep(CHAT_THROTTLE_MS);
  }
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: messages[messages.length - 1], slug, conversation }),
  });
  return res.json();
}

async function availability(serviceId, slug) {
  const res = await fetch(
    `${BASE}/api/availability?slug=${slug}&serviceId=${serviceId}&weekShift=0`
  );
  return res.json();
}

async function run() {
  console.log(`\nKasa provider-relative scenarios → ${BASE}\n`);

  const { scenarios, skipped } = buildScenarios();
  console.log(
    `Profiles: ${PROFILES.map((p) => `${p.slug}${p.seeded ? "" : "(stub)"}`).join(", ")}`
  );
  console.log(`Runnable scenarios: ${scenarios.length}\n`);

  let lastWasAI = false;
  for (const s of scenarios) {
    if (lastWasAI && s.needsAI) await sleep(CHAT_THROTTLE_MS);
    try {
      if (s.kind === "availability") {
        const res = await availability(s.serviceId, s.slug);
        record(s.name, s.assert(res, { slug: s.slug }));
      } else {
        const res = await chat(s.messages, s.slug);
        record(s.name, s.assert(res, { slug: s.slug }));
      }
    } catch (err) {
      record(s.name, { pass: false, detail: `threw: ${err.message}` });
    }
    lastWasAI = s.needsAI;
  }

  // ── Invariant 1: booking-slot contract (deterministic, profile-independent) ─
  console.log("\nInvariants");
  {
    const seeded = PROFILES.find((p) => p.seeded);
    const res = await availability(seeded.services[0].id, seeded.slug);
    const first = res.slots?.[0];
    record("booking slot has the labels the UI needs", {
      pass: first != null && typeof first.timeLabel === "string" && typeof first.dateKey === "string",
      detail: `first slot: ${JSON.stringify(first)}`,
    });
  }

  // ── Invariant 2: graceful rate-limit fallback ──────────────────────────────
  {
    const seeded = PROFILES.find((p) => p.seeded);
    let sawRawError = false;
    let sawGraceful = false;
    let gracefulHadHandoff = true;
    for (let i = 0; i < 8; i++) {
      const res = await chat([`book a ${seeded.services[0].aliases[0] ?? "service"} ${i}`], seeded.slug);
      const reply = res.reply ?? "";
      if (/\b(error|exception|undefined|null|status 5\d\d|http 4\d\d)\b/i.test(reply)) sawRawError = true;
      if (res.source === "fallback" && /moment|busy|try again/i.test(reply)) {
        sawGraceful = true;
        if (res.needsHumanHandoff !== true) gracefulHadHandoff = false;
      }
    }
    record("never shows a raw API error under load", { pass: !sawRawError, detail: "a reply contained error-ish text" });
    if (sawGraceful) {
      record("busy fallback offers human handoff", { pass: gracefulHadHandoff, detail: "a busy reply lacked handoff" });
    } else {
      console.log("  ⓘ rate limit did not trip this run (env-dependent) — graceful path not exercised");
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(52)}`);
  if (skipped.length) {
    console.log(
      "Skipped (unseeded provider stubs): " +
        skipped.map((s) => `${s.slug} (${s.count} ready)`).join(", ")
    );
  }
  console.log(`PASSED ${passed}  FAILED ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f.name}\n      ${f.detail}`);
  }
  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\nScenario runner crashed (is `npm run dev` running?):\n", err.message);
  process.exit(2);
});
