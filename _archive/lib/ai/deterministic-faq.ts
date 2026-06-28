/**
 * Deterministic FAQ router.
 *
 * The brief's "deterministic-first" rule: when the answer can be built from
 * catalog/profile data we already have, never call the model. This module
 * pattern-matches a small set of common factual questions ("where is the
 * salon", "what days do you work", "what services", "how much for X",
 * "how long is X", "do you offer X") and returns a structured answer that
 * the chat can render directly.
 *
 * Returns null when the question doesn't match any deterministic pattern,
 * which signals the caller to escalate to the AI provider.
 *
 * Tone: brief, warm, factual. No hedging, no robotic prefixes.
 */

import type { Service } from "@/lib/types";

export type FAQAnswer = {
  /** Bot-text to push as a chat turn. */
  reply: string;
  /** Optional service ids to also surface as a recommendation card. */
  recommendedServiceIds: string[];
  /** Mirrors the AI route's intent field for downstream rendering. */
  intent: "faq" | "service_guidance" | "unsupported";
};

export type FAQContext = {
  stylistName: string;
  location: string | null;
  workingDays: string[] | null;
  services: Service[];
};

/**
 * Try to answer the message deterministically. Returns null if no pattern
 * matched — caller should escalate to AI.
 */
export function tryDeterministicAnswer(
  rawMessage: string,
  ctx: FAQContext
): FAQAnswer | null {
  const message = rawMessage.toLowerCase().trim();
  if (!message) return null;

  // Order matters — most specific patterns first. Each handler returns
  // null if the pattern doesn't quite fit, letting the next one try.

  return (
    answerLocation(message, ctx) ??
    answerWorkingDays(message, ctx) ??
    answerServicesList(message, ctx) ??
    answerPriceQuestion(message, ctx) ??
    answerDurationQuestion(message, ctx) ??
    answerDoYouOffer(message, ctx) ??
    null
  );
}

/* -------------------------------------------------------------------------- */
/* Location                                                                   */
/* -------------------------------------------------------------------------- */

function answerLocation(message: string, ctx: FAQContext): FAQAnswer | null {
  // Patterns: where is, where are, what's the address, what is the location
  const isLocationQ =
    /\bwhere\s+(is|are|'s)\b/.test(message) ||
    /\b(address|location|directions?)\b/.test(message) ||
    /\bhow do (i|we)\s+get\s+(there|to)\b/.test(message);
  if (!isLocationQ) return null;

  if (!ctx.location) {
    return {
      reply: `${ctx.stylistName} hasn't shared a location yet. Want me to send her a quick note to ask?`,
      recommendedServiceIds: [],
      intent: "faq",
    };
  }
  return {
    reply: `${ctx.stylistName} is at ${ctx.location}.`,
    recommendedServiceIds: [],
    intent: "faq",
  };
}

/* -------------------------------------------------------------------------- */
/* Working days / hours                                                       */
/* -------------------------------------------------------------------------- */

function answerWorkingDays(message: string, ctx: FAQContext): FAQAnswer | null {
  const isHoursQ =
    /\bwhat\s+(days?|hours?)\b/.test(message) ||
    /\bwhen\s+(are|is)\s+(you|she|shen)\s+(open|working|available)\b/.test(
      message
    ) ||
    /\b(hours?|schedule|availability)\b/.test(message) ||
    /\bopen\s+(on|today|tomorrow)\b/.test(message);
  if (!isHoursQ) return null;

  if (!ctx.workingDays || ctx.workingDays.length === 0) {
    return {
      reply: `I don't have ${ctx.stylistName}'s working days on file. Tap "Find a time" on any service to see openings.`,
      recommendedServiceIds: [],
      intent: "faq",
    };
  }
  const days = formatList(ctx.workingDays);
  return {
    reply: `${ctx.stylistName} usually works ${days}. For exact openings, tap any service to see times.`,
    recommendedServiceIds: [],
    intent: "faq",
  };
}

/* -------------------------------------------------------------------------- */
/* Services list                                                              */
/* -------------------------------------------------------------------------- */

function answerServicesList(
  message: string,
  ctx: FAQContext
): FAQAnswer | null {
  const isServicesQ =
    /\bwhat\s+services\b/.test(message) ||
    /\bwhat\s+(do|does)\s+(you|she|shen)\s+(offer|do)\b/.test(message) ||
    /\b(menu|service\s+list|services?\s+offered)\b/.test(message) ||
    /\bwhat\s+can\s+(you|she|shen)\s+do\b/.test(message);
  if (!isServicesQ) return null;

  const online = ctx.services.filter((s) => s.status === "online");
  if (online.length === 0) {
    return {
      reply: `${ctx.stylistName} doesn't have any services up yet. Send her a quick note and she'll get back to you.`,
      recommendedServiceIds: [],
      intent: "unsupported",
    };
  }

  // Summarize by category. We don't list every SKU — that's what "Browse
  // all services" is for. Just give the categories with a count.
  const byCategory = new Map<string, number>();
  for (const s of online) {
    byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + 1);
  }
  const categoryList = Array.from(byCategory.entries())
    .map(([cat, count]) => `${cat.toLowerCase()}${count > 1 ? "s" : ""}`)
    .join(", ");
  return {
    reply: `${ctx.stylistName} offers ${categoryList}. Tap "Browse all services" to see everything with prices and durations.`,
    recommendedServiceIds: [],
    intent: "faq",
  };
}

/* -------------------------------------------------------------------------- */
/* Price questions                                                            */
/* -------------------------------------------------------------------------- */

function answerPriceQuestion(
  message: string,
  ctx: FAQContext
): FAQAnswer | null {
  const isPriceQ =
    /\b(how\s+much|price|cost|charge|fee|fees|pricing)\b/.test(message);
  if (!isPriceQ) return null;

  // Only deterministic if we can identify a SPECIFIC service from the
  // message. Otherwise let AI handle vague price questions.
  const match = findServiceByText(message, ctx.services);
  if (!match) return null;

  return {
    reply: `${match.name} is ${match.priceLabel}.`,
    recommendedServiceIds: [match.id],
    intent: "service_guidance",
  };
}

/* -------------------------------------------------------------------------- */
/* Duration questions                                                         */
/* -------------------------------------------------------------------------- */

function answerDurationQuestion(
  message: string,
  ctx: FAQContext
): FAQAnswer | null {
  const isDurationQ =
    /\bhow\s+long\b/.test(message) ||
    /\b(duration|time)\s+(does|is|for)\b/.test(message) ||
    /\b(takes?|lasts?)\s+how\s+long\b/.test(message);
  if (!isDurationQ) return null;

  const match = findServiceByText(message, ctx.services);
  if (!match) return null;

  return {
    reply: `${match.name} usually takes about ${match.durationLabel.toLowerCase()}.`,
    recommendedServiceIds: [match.id],
    intent: "service_guidance",
  };
}

/* -------------------------------------------------------------------------- */
/* "Do you offer X" — yes/no based on catalog                                 */
/* -------------------------------------------------------------------------- */

function answerDoYouOffer(message: string, ctx: FAQContext): FAQAnswer | null {
  const isOfferQ =
    /\bdo\s+(you|she|shen)\s+(offer|do|provide)\b/.test(message) ||
    /\bdoes\s+(she|shen)\s+(offer|do|provide)\b/.test(message);
  if (!isOfferQ) return null;

  const match = findServiceByText(message, ctx.services);
  if (match) {
    return {
      reply: `Yes — ${ctx.stylistName} offers ${match.name} (${match.priceLabel} · ${match.durationLabel.toLowerCase()}).`,
      recommendedServiceIds: [match.id],
      intent: "service_guidance",
    };
  }

  // Couldn't match the service from the catalog. Let AI decide whether
  // this is genuinely unsupported (e.g. "do you do balayage" when no
  // color service matches) or just a service we didn't pattern-match.
  return null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Light-weight service lookup. Searches the catalog for a service whose
 * name, category, or keywords appear in the message. Returns the first
 * online match. Strict: requires word-boundary matching on at least one
 * non-trivial token so "do you cut hair" doesn't match "Hair Wash".
 */
function findServiceByText(message: string, services: Service[]): Service | null {
  const onlineServices = services.filter((s) => s.status === "online");

  // Try whole-name match first (most specific).
  for (const svc of onlineServices) {
    const namePattern = new RegExp(`\\b${escapeRegex(svc.name)}\\b`, "i");
    if (namePattern.test(message)) return svc;
  }

  // Then try category keyword. "How much is a haircut?" → match Haircut category.
  // Skip Treatment because "treatment" is generic.
  const categoryHits: Record<string, Service[]> = {};
  for (const svc of onlineServices) {
    const cat = svc.category;
    if (!categoryHits[cat]) categoryHits[cat] = [];
    categoryHits[cat].push(svc);
  }
  for (const cat of Object.keys(categoryHits)) {
    const catPattern = catKeywordPattern(cat);
    if (catPattern && catPattern.test(message)) {
      const matches = categoryHits[cat];
      if (matches.length === 1) return matches[0];
      // Ambiguous — multiple services in the category. Let AI clarify.
      return null;
    }
  }

  return null;
}

function catKeywordPattern(category: string): RegExp | null {
  switch (category) {
    case "Haircut":
      return /\bhair\s*cut\b|\bhaircut\b|\bcut\b|\btrim\b/i;
    case "Color":
      return /\bcolor\b|\bcolour\b|\bdye\b|\bhighlights?\b|\btouch[-\s]?up\b/i;
    case "Perm":
      return /\bperm\b/i;
    case "Treatment":
      return /\bhead\s*spa\b|\bkeratin\b|\bmilbon\b/i;
    case "Other":
      return /\bwash\b|\bshampoo\b|\bblow\s*out\b|\bblowdry\b/i;
    default:
      return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}
