import { DOW_NAMES } from "../fixtures/types.mjs";

/**
 * Provider-agnostic scenario templates.
 *
 * Each template is (profile) => Scenario. The expectation is computed FROM the
 * profile — a closed-day scenario uses THIS provider's closed days, an
 * unsupported scenario uses THIS provider's unsupported list, etc. The same
 * template therefore proves correct (and different) behavior for every provider.
 *
 * Scenario shape:
 *   {
 *     name,                         // human label
 *     kind: "chat" | "availability",// which API it hits
 *     messages: string[],           // chat turns (last is the asserted one) — chat only
 *     serviceId?,                   // availability only
 *     needsAI: boolean,             // true → throttle (free-tier) ; false → deterministic
 *     assert: (res, ctx) => { pass, detail }
 *   }
 *
 * Assertions are TOLERANT of the graceful rate-limit fallback (source:"fallback"
 * with a "busy" reply) so the free tier never causes a false failure.
 */

// A chat reply that is the graceful rate-limit fallback — never counts as a
// failure (it's correct degradation, asserted separately in the rate-limit test).
function isGracefulFallback(res) {
  return (
    res?.source === "fallback" &&
    /moment|busy|try again/i.test(res?.reply ?? "")
  );
}

const lc = (s) => (s ?? "").toLowerCase();

/* ── Templates ──────────────────────────────────────────────────────────── */

// Service discovery — asking for a supported service should not be flagged
// unsupported and should engage the booking/guidance path.
export const supportedServiceTemplate = (p) => {
  const svc = p.services[0];
  const term = svc.aliases[0] ?? lc(svc.name);
  return {
    name: `supported-service (${p.slug}): "${term}"`,
    kind: "chat",
    needsAI: true,
    messages: [`do you do ${term}?`],
    assert: (res) => {
      if (isGracefulFallback(res)) return { pass: true, detail: "graceful fallback" };
      const ok =
        ["booking", "service_guidance", "faq"].includes(res.intent) &&
        res.needsHumanHandoff !== true;
      return { pass: ok, detail: `intent=${res.intent} handoff=${res.needsHumanHandoff} reply=${res.reply}` };
    },
  };
};

// Category question — "do you do <category>" should enumerate / engage, not
// flag unsupported.
export const categoryTemplate = (p) => {
  const category = p.categories[0];
  return {
    name: `category (${p.slug}): "${category}"`,
    kind: "chat",
    needsAI: true,
    messages: [`do you offer ${lc(category)}?`],
    assert: (res) => {
      if (isGracefulFallback(res)) return { pass: true, detail: "graceful fallback" };
      const ok = res.intent !== "unsupported";
      return { pass: ok, detail: `intent=${res.intent} reply=${res.reply}` };
    },
  };
};

// Unsupported service — uses THIS provider's unsupported list; must route to
// handoff or clearly decline, never confirm it as bookable.
export const unsupportedTemplate = (p) => {
  const term = p.unsupported[0];
  return {
    name: `unsupported (${p.slug}): "${term}"`,
    kind: "chat",
    needsAI: true,
    messages: [`can I book a ${term}?`],
    assert: (res) => {
      if (isGracefulFallback(res)) return { pass: true, detail: "graceful fallback" };
      const reply = lc(res.reply);
      const declined =
        res.intent === "unsupported" ||
        res.needsHumanHandoff === true ||
        /(don't|do not|isn't|aren't|not offer|not something|unfortunately|message|reach out|contact)/.test(reply);
      const wronglyConfirms =
        /\b(yes|sure|book(ed|ing)?|we offer|i can book)\b/.test(reply) &&
        reply.includes(lc(term)) &&
        !declined;
      return { pass: declined && !wronglyConfirms, detail: `intent=${res.intent} handoff=${res.needsHumanHandoff} reply=${res.reply}` };
    },
  };
};

// Closed day — uses THIS provider's closedDays. Skipped for providers open
// every day (nails) since there's no closed day to ask about.
export const closedDayTemplate = (p) => {
  if (p.schedule.closedDays.length === 0) return null;
  const dayName = DOW_NAMES[p.schedule.closedDays[0]];
  return {
    name: `closed-day (${p.slug}): ${dayName}`,
    kind: "chat",
    needsAI: true,
    messages: [`can I come in on ${dayName}?`],
    assert: (res) => {
      if (isGracefulFallback(res)) return { pass: true, detail: "graceful fallback" };
      const reply = lc(res.reply);
      const signalsClosed = /(not available|unavailable|closed|not open|don't open|isn't open|aren't open)/.test(reply);
      return { pass: signalsClosed, detail: `reply=${res.reply}` };
    },
  };
};

// Price question — asks about a real service; must not flag unsupported.
export const priceTemplate = (p) => {
  const svc = p.services[0];
  return {
    name: `price (${p.slug}): ${svc.name}`,
    kind: "chat",
    needsAI: true,
    messages: [`how much is a ${svc.aliases[0] ?? lc(svc.name)}?`],
    assert: (res) => {
      if (isGracefulFallback(res)) return { pass: true, detail: "graceful fallback" };
      return { pass: res.intent !== "unsupported", detail: `intent=${res.intent} qt=${res.questionType} reply=${res.reply}` };
    },
  };
};

// Off-topic redirect — must NOT answer; should redirect (intent unknown/handoff,
// no off-topic content). Provider-agnostic by construction.
export const offTopicTemplate = (p) => ({
  name: `off-topic redirect (${p.slug})`,
  kind: "chat",
  needsAI: true,
  messages: ["what is the capital of France?"],
  assert: (res) => {
    if (isGracefulFallback(res)) return { pass: true, detail: "graceful fallback" };
    const reply = lc(res.reply);
    const leaked = /paris/.test(reply);
    const redirected = res.intent === "unknown" || res.intent === "handoff" || /help you book|services|find you a time|here to help/.test(reply);
    return { pass: !leaked && redirected, detail: `intent=${res.intent} reply=${res.reply}` };
  },
});

// Multi-person — only meaningful for providers that route groups to handoff.
export const multiPersonTemplate = (p) => {
  if (!p.handoff.multiPerson) return null;
  return {
    name: `multi-person (${p.slug})`,
    kind: "chat",
    needsAI: true,
    messages: ["can I book for me and my two friends?"],
    assert: (res) => {
      if (isGracefulFallback(res)) return { pass: true, detail: "graceful fallback" };
      const ok = res.peopleCount > 1 || res.multiServiceRequest === true || res.needsHumanHandoff === true;
      return { pass: ok, detail: `people=${res.peopleCount} handoff=${res.needsHumanHandoff}` };
    },
  };
};

// Availability respects closed days — provider-relative: NONE of this provider's
// closed days may appear in returned slots. Availability is deterministic.
export const availabilityClosedDaysTemplate = (p) => {
  const svc = p.services[0];
  return {
    name: `availability honors closed days (${p.slug})`,
    kind: "availability",
    needsAI: false,
    serviceId: svc.id,
    assert: (res, ctx) => {
      const slots = res.slots ?? [];
      if (slots.length === 0) {
        return { pass: false, detail: "no slots returned" };
      }
      const closedNames = new Set(p.schedule.closedDays.map((d) => DOW_NAMES[d].slice(0, 3)));
      const present = new Set(slots.map((s) => s.dayLabel));
      const violation = [...present].filter((d) => closedNames.has(d));
      return { pass: violation.length === 0, detail: `closed=${[...closedNames]} present=${[...present]} violations=${violation}` };
    },
  };
};

/**
 * All templates. The runner applies each to each profile (templates returning
 * null for a profile are skipped). Add a new behavior = add one function here;
 * it automatically runs across every provider.
 */
export const TEMPLATES = [
  supportedServiceTemplate,
  categoryTemplate,
  unsupportedTemplate,
  closedDayTemplate,
  priceTemplate,
  offTopicTemplate,
  multiPersonTemplate,
  availabilityClosedDaysTemplate,
];
