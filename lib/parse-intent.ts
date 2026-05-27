/**
 * Mock context-aware booking assistant logic for Shen.
 *
 * Public surface (the page only imports these):
 *   - parseClientMessage(message, context) → Intent
 *   - getClarifyingQuestion(intent, context) → ClarifyingQuestion | null
 *   - getRecommendedServices(intent, clarificationKey?) → Recommendation
 *   - getAssistantResponse(intent, recommendation, context) → AssistantResponse
 *   - rankTimeSlots(slots, hints) → TimeSlot[]
 *   - filterSlotsByRefinement(slots, refinement, context) → { slots, fellBack }
 *   - findSlotByMention(mention, context) → TimeSlot | null
 *
 * The Intent union is the contract the page renders against. To swap in a real
 * LLM later, replace parseClientMessage with a model call that returns the same
 * shape; the rest of the page logic doesn't need to change.
 */

import {
  SERVICES,
  MOCK_TODAY,
  MOCK_TOMORROW,
  MOCK_AVAILABILITY_HORIZON,
  WORKING_DAYS,
  getSlotsForService,
  findBestComboServiceMatch,
} from "./mock-data";
import type { Service, ServiceCategory, TimeSlot } from "./types";
import { matchCatalog, type CatalogEntry } from "./engine/catalog";
import { extractModifiers } from "./engine/intent-patterns";
import { MIA_CATALOG } from "./businesses/mia-hair";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type IntentTag =
  | "Haircut"
  | "Color"
  | "Perm"
  | "Treatment"
  | "Consultation";

export type LengthHint = "short" | "long" | null;
export type PermStyle = "down" | "digital" | "straightening" | null;
export type ColorDirection = "lighter" | "darker" | "root" | null;
export type Period = "morning" | "afternoon" | "evening" | null;
export type Relative =
  | "today"
  | "tomorrow"
  | "this-week"
  | "next-week"
  | "week-after"
  | null;
export type TimeFlexibility = "exact" | "approximate";

export type TimeHints = {
  days: string[]; // ["Fri"] (or ["Sat","Sun"] for "weekend")
  dayOfMonth: number | null; // 12 (from "the 12th")
  dateKey: string | null; // resolved "today"/"tomorrow" → "2026-05-04"
  period: Period;
  relative: Relative;
  hour24: number | null; // for "around 5pm" / "at 2pm"
  // How tightly the user pinned the hour. "at 3pm" → exact (±0.5h tolerance);
  // "around 3pm" → approximate (±1.5h tolerance). Only meaningful when hour24
  // is set; defaults to "exact" otherwise.
  timeFlexibility: TimeFlexibility;
  // 0 = this week, 1 = next week, 2 = week after, null = no week shift mentioned.
  // Resolved from "this week" / "next week" / "week after" / "following week".
  weekShift: number | null;
  // "soonest" / "earliest" / "first available" / "asap" — caller should
  // surface the earliest slot regardless of week/day. Coexists with other
  // hints (e.g. "soonest haircut on Saturday" still narrows by day).
  prefersSoonest: boolean;
};

export type Confidence = "high" | "medium" | "low";

export type RefineRelation = "earlier" | "later" | "more" | "around" | null;

export type Intent =
  | {
      kind: "book";
      rawText: string;
      tags: IntentTag[];
      lengthHint: LengthHint;
      permStyle: PermStyle;
      colorDirection: ColorDirection;
      timeHints: TimeHints;
      confidence: Confidence;
      // When the combo matcher hit a specific Square service, that ID is
      // pinned here. getRecommendedServices honors it verbatim and skips the
      // tag-based recommendation path entirely.
      comboServiceId: string | null;
    }
  | {
      kind: "refine_time";
      rawText: string;
      relation: RefineRelation;
      // Anchor — the date being refined against
      anchorDateKey: string | null;
      // New scoping the user just introduced
      timeHints: TimeHints;
    }
  | {
      kind: "select_slot";
      rawText: string;
      // Either ordinal-based or time/day-based selection
      ordinal: number | null; // 1-indexed
      hour24: number | null;
      dayOfMonth: number | null;
      dateKey: string | null;
    }
  | {
      kind: "switch_service";
      rawText: string;
      // Same shape as `book` but explicit "this is a swap" marker
      tags: IntentTag[];
      lengthHint: LengthHint;
      permStyle: PermStyle;
      colorDirection: ColorDirection;
      timeHints: TimeHints;
      comboServiceId: string | null;
    }
  | {
      // Multi-service or add-service. Same shape, different mode:
      //   "fresh"    — cold start, user mentioned multiple services together
      //                ("color and haircut"). No current service yet.
      //   "additive" — current service exists, user is adding more
      //                ("wait i need color too"). Merge into existing context.
      kind: "add_services";
      rawText: string;
      mode: "fresh" | "additive";
      tags: IntentTag[];
      lengthHint: LengthHint;
      permStyle: PermStyle;
      colorDirection: ColorDirection;
      timeHints: TimeHints;
      comboServiceId: string | null;
    }
  | {
      // Ambiguous mention of a different service category. We hold context
      // and ask the user to confirm. Triggered by phrases like "what about
      // color" or "maybe a perm" — has a service tag but no explicit swap or
      // additive word. The page renders a three-button prompt: Switch / Add /
      // Keep.
      kind: "confirm_switch";
      rawText: string;
      proposedTags: IntentTag[];
      proposedLengthHint: LengthHint;
      proposedPermStyle: PermStyle;
      proposedColorDirection: ColorDirection;
    }
  | {
      kind: "info_query";
      rawText: string;
      asks: ("price" | "duration")[];
    }
  | {
      // User typed free-text in response to a pending clarification, and we
      // matched it to one of the expected option keys. Page handles this
      // like a button tap on that option.
      kind: "clarification_answer";
      rawText: string;
      key: string;
    }
  | {
      // Fuzzy match — user wrote something like "balayge" or "colr". We
      // soft-confirm with Yes/No before committing to a service category.
      kind: "confirm_fuzzy_match";
      rawText: string;
      proposedTag: IntentTag;
      matchedTerm: string; // what we matched to ("color", "haircut", etc.)
    }
  | {
      kind: "unknown";
      rawText: string;
    };

export type ClarifyingQuestion = {
  text: string;
  options: { label: string; key: string }[];
} | null;

export type Recommendation = {
  primary: Service;
  // Additional services the user mentioned alongside the primary. The slot
  // is sized for the primary only; secondaries get noted on the booking and
  // surfaced in the CTA. e.g. user says "color and haircut" → primary =
  // Full Color, additionalServices = [Medium / Long Hair Cut].
  additionalServices: Service[];
  alternates: Service[];
  honestNote: string | null;
  reason: string;
  // Set when the recommender produced an additional service using a default
  // (e.g. lengthHint=null → Medium/Long Haircut by default) that the user
  // didn't explicitly choose. The page uses this to set
  // pendingAdditionalService and ask a follow-up clarification before
  // committing the secondary.
  unresolvedAdditionalCategory: IntentTag | null;
};

export type AssistantResponse = {
  ack: string;
  interpretation: string;
  needsClarification: boolean;
};

export type AssistantContext = {
  // Booking-in-progress
  selectedService: Service | null;
  selectedSlot: TimeSlot | null;
  bookingNotes: string;
  // Multi-service: services the user mentioned alongside the primary that
  // should be noted on the booking but aren't the primary slot driver.
  // Surfaced in the CTA ("Book Full Color + Haircut") and the booking notes.
  additionalServices: Service[];
  // Conversation memory
  lastRecommendedService: Service | null;
  lastShownSlots: TimeSlot[];
  lastAnchorDateKey: string | null;
  lastIntentTags: IntentTag[];
  lastIntentColorDirection: ColorDirection;
  // Time hints from the most recent free-text booking intent. Persisted so
  // that clarification answers ("short", "root touch-up", etc.) can re-use
  // the original day/week/period the user mentioned instead of dropping it.
  // Reset to emptyHints() when a new booking flow starts from scratch.
  lastIntentTimeHints: TimeHints;
  // Pending state — these all live on the parser context so that
  // parseClientMessage's PRIORITY 0 dispatcher can resolve typed answers
  // against any of them before normal parsing runs.
  pendingClarification: { question: string; expectedKeys: string[] } | null;
  // Set when the bot showed a Switch/Add/Keep prompt. Lets the user answer
  // by typing "add color" / "do both" / "keep" etc. without repeating the
  // question.
  pendingSwitch: {
    tags: IntentTag[];
    lengthHint: LengthHint;
    permStyle: PermStyle;
    colorDirection: ColorDirection;
    // Carry the originating time preference so a Switch/Add doesn't drop
    // a "next Tuesday" from the message that prompted the prompt.
    timeHints: TimeHints;
  } | null;
  // Set when fuzzy-match soft-confirmation is in flight ("balayge" → "color
  // service, right?"). Yes/no answers route through here.
  pendingFuzzy: {
    tag: IntentTag;
    timeHints: TimeHints;
  } | null;
  // Set when multi-service has a primary resolved but the secondary still
  // needs clarification. The next clarification answer (button or typed)
  // applies to this category instead of the primary.
  pendingAdditionalService: {
    category: IntentTag;
    lengthHint: LengthHint;
    colorDirection: ColorDirection;
    permStyle: PermStyle;
  } | null;
};

const EMPTY_TIME_HINTS: TimeHints = {
  days: [],
  dayOfMonth: null,
  dateKey: null,
  period: null,
  relative: null,
  hour24: null,
  timeFlexibility: "exact",
  weekShift: null,
  prefersSoonest: false,
};

export const EMPTY_CONTEXT: AssistantContext = {
  selectedService: null,
  selectedSlot: null,
  bookingNotes: "",
  additionalServices: [],
  lastRecommendedService: null,
  lastShownSlots: [],
  lastAnchorDateKey: null,
  lastIntentTags: [],
  lastIntentColorDirection: null,
  lastIntentTimeHints: EMPTY_TIME_HINTS,
  pendingClarification: null,
  pendingSwitch: null,
  pendingFuzzy: null,
  pendingAdditionalService: null,
};

/* -------------------------------------------------------------------------- */
/* Keyword maps (kept only for consultation detection — services now use      */
/* the catalog engine)                                                        */
/* -------------------------------------------------------------------------- */

const CONSULT_WORDS = [
  "big change",
  "transformation",
  "correction",
  "fix my hair",
  "damaged",
  "damage",
  "new look",
  "drastic",
  "completely different",
  "makeover",
];

const DAY_KEYWORDS: Record<string, string> = {
  monday: "Mon",
  mon: "Mon",
  tuesday: "Tue",
  tue: "Tue",
  tues: "Tue",
  wednesday: "Wed",
  wed: "Wed",
  thursday: "Thu",
  thu: "Thu",
  thurs: "Thu",
  friday: "Fri",
  fri: "Fri",
  saturday: "Sat",
  sat: "Sat",
  sunday: "Sun",
  sun: "Sun",
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => {
    if (w.includes(" ") || w.includes("-")) return text.includes(w);
    const re = new RegExp(`\\b${w}\\b`, "i");
    return re.test(text);
  });
}

/* -------------------------------------------------------------------------- */
/* Clarification free-text matcher                                             */
/*                                                                             */
/* When the bot has just asked a question, the user's next message is most    */
/* likely an answer to that question. This table maps clarification keys to   */
/* the words/phrases users actually type. Lighter than running it through the */
/* whole parser pipeline — and avoids the failure mode where "short" gets     */
/* parsed as low-signal and resets the conversation.                          */
/* -------------------------------------------------------------------------- */

const CLARIFICATION_MATCHERS: Record<string, RegExp[]> = {
  // Haircut length
  "len-short": [
    /\bshort\b/,
    /\bbarber\b/,
    /\bmen'?s\b/,
    /\bman\b/,
    /\bguy\b/,
    /\bbuzz\b/,
    /\bfade\b/,
    /\bcrew\b/,
  ],
  "len-long": [
    /\blong\b/,
    /\bmedium\b/,
    /\bmid\b/,
    /\bwoman\b/,
    /\bwomen'?s?\b/,
    /\bgirl\b/,
    /\blady\b/,
    /\bshoulder\b/,
    /\blayer/,
  ],
  "len-unsure": [
    /\bunsure\b/,
    /\bnot\s+sure\b/,
    /\bdon'?t\s+know\b/,
    /\bidk\b/,
    /\bidc\b/,
    /\bwhatever\b/,
    /\bhelp\b/,
  ],
  // Color direction
  "color-root": [
    /\broot/,
    /\btouch[\s-]*up\b/,
    /\bregrowth\b/,
    /\bbase\b/,
  ],
  "color-full": [
    /\bfull\b/,
    /\ball\s*over\b/,
    /\bwhole\b/,
    /\bcomplete\b/,
    // balayage / highlights intentionally removed: those aren't services
    // the stylist offers, and the unsupported-service guard catches them
    // before they can be mis-tagged as Full Color. See
    // lib/unsupported-services.ts.
  ],
  // Perm style
  "perm-down": [
    /\bdown\b/,
    /\bvolume\b/,
  ],
};

/**
 * Try to map a user's free-text answer to one of the expected clarification
 * option keys. Returns the matched key or null.
 */
function matchClarificationFreeText(
  text: string,
  expectedKeys: string[]
): string | null {
  for (const key of expectedKeys) {
    const matchers = CLARIFICATION_MATCHERS[key];
    if (!matchers) continue;
    if (matchers.some((re) => re.test(text))) return key;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Pending Switch/Add/Keep matcher                                             */
/*                                                                             */
/* When the bot has shown a Switch/Add/Keep prompt and the user types instead */
/* of tapping, map the typed text to one of the three actions. Lifted from   */
/* the brief's exact lists.                                                   */
/* -------------------------------------------------------------------------- */

const SWITCH_PHRASES = [
  /\bswitch\b/,
  /\bchange\b/,
  /\binstead\b/,
  /\binstd\b/,
  /\bnot\s+\w+,?\s+\w+\b/, // "not haircut, color"
  /\bforget\s+(it|the)\b/,
];

const ADD_PHRASES = [
  /\badd\b/,
  /\bdo\s+both\b/,
  /\bboth\b/,
  /\bi\s+need\s+both\b/,
  /\bwith\s+\w+\b/, // "with color"
  /\balso\b/,
  /\btoo\b/,
  /\bas\s+well\b/,
  /\bplus\b/,
];

const KEEP_PHRASES = [
  /\bkeep\b/,
  /\bstay\b/,
  /\bsame\b/,
  /^no\.?$/,
  /\bnevermind\b/,
  /\bnever\s*mind\b/,
  /\bforget\s+it\b/,
  /\bcancel\b/,
];

/**
 * Map typed text to a Switch/Add/Keep action. Returns the matching button
 * key or null.
 */
function matchSwitchAddKeepFreeText(text: string): string | null {
  // Order: keep wins on bare "no" / "nevermind"; then explicit switch words;
  // then add words. The order matters because "switch" is a stronger signal
  // than "with" inside "switch with color".
  if (KEEP_PHRASES.some((re) => re.test(text))) return "confirm-switch-no";
  if (SWITCH_PHRASES.some((re) => re.test(text))) return "confirm-switch-yes";
  if (ADD_PHRASES.some((re) => re.test(text))) return "confirm-switch-add";
  return null;
}

/**
 * Map a fuzzy-yes/fuzzy-no typed answer.
 */
function matchFuzzyYesNoFreeText(text: string): string | null {
  if (/^(yes|yeah|yep|yup|sure|ok|okay|correct|right|that'?s\s+it)\.?$/.test(text)) {
    return "fuzzy-yes";
  }
  if (/^(no|nope|nah|wrong|incorrect|not\s+(quite|really))\.?$/.test(text)) {
    return "fuzzy-no";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Catalog-based service helpers (replace hardcoded keyword/fuzzy matching)   */
/* -------------------------------------------------------------------------- */

function findInCatalog(id: string): CatalogEntry {
  const s = MIA_CATALOG.find((x) => x.id === id);
  if (!s) throw new Error(`Service not found in catalog: ${id}`);
  return s;
}

/** Find the best-ranked catalog entry matching a semantic attribute value. */
function findByMeta(
  category: string,
  attr: "colorDirections" | "lengthHints" | "permStyles",
  value: string
): CatalogEntry | null {
  return (
    MIA_CATALOG.filter(
      (e) => e.category === category && (e[attr] ?? []).includes(value as never)
    ).sort((a, b) => (a.popularRank ?? 99) - (b.popularRank ?? 99))[0] ?? null
  );
}

/** All catalog entries in a category, sorted by popularRank. */
function categoryServices(category: string): CatalogEntry[] {
  return MIA_CATALOG.filter((e) => e.category === category).sort(
    (a, b) => (a.popularRank ?? 99) - (b.popularRank ?? 99)
  );
}

// Legacy alias — some callers still use findService(id)
const findService = findInCatalog;

/* -------------------------------------------------------------------------- */
/* Time hint extraction (shared by book / refine / switch)                     */
/* -------------------------------------------------------------------------- */

function extractTimeHints(text: string): TimeHints {
  // Days of the week
  const days: string[] = [];
  for (const [keyword, day] of Object.entries(DAY_KEYWORDS)) {
    const re = new RegExp(`\\b${keyword}\\b`, "i");
    if (re.test(text) && !days.includes(day)) days.push(day);
  }

  // Day of month — "the 12th", "12th", "on the 12"
  let dayOfMonth: number | null = null;
  const dayMatch = text.match(
    /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/
  );
  if (dayMatch) {
    const n = parseInt(dayMatch[1], 10);
    if (n >= 1 && n <= 31) dayOfMonth = n;
  }

  // Period
  let period: Period = null;
  if (/\b(morning|am|a\.m\.)\b/.test(text)) period = "morning";
  else if (/\b(afternoon|noon|midday|after\s*work)\b/.test(text))
    period = "afternoon";
  else if (/\b(evening|night|pm|p\.m\.)\b/.test(text)) period = "evening";

  // Relative — order matters. "week after" must check before "next week" so
  // "next week" doesn't shadow "the week after next week".
  let relative: Relative = null;
  let dateKey: string | null = null;
  let weekShift: number | null = null;
  // "week of the Nth" / "the week of May N" — translate the date to the
  // week it falls in. We use the same week-shift ranges as deriveWeekShiftFromKey.
  const weekOfMatch = text.match(
    /\bweek\s+of\s+(?:the\s+)?(?:may\s+)?(\d{1,2})/
  );
  if (weekOfMatch) {
    const day = parseInt(weekOfMatch[1], 10);
    if (day >= 4 && day <= 10) weekShift = 0;
    else if (day >= 11 && day <= 17) weekShift = 1;
    else if (day >= 18 && day <= 24) weekShift = 2;
    if (weekShift !== null) relative = "this-week"; // generic "week" relative
  }
  if (/\btoday\b/.test(text)) {
    relative = "today";
    dateKey = MOCK_TODAY.dateKey;
    weekShift = 0;
  } else if (/\btomorrow\b/.test(text)) {
    relative = "tomorrow";
    dateKey = MOCK_TOMORROW.dateKey;
    // tomorrow doesn't pin a weekShift — could be same week or next
  } else if (
    /\b(week\s+after|following\s+week|the\s+week\s+after)\b/.test(text)
  ) {
    relative = "week-after";
    weekShift = 2;
  } else if (/\bnext\s*week\b/.test(text)) {
    relative = "next-week";
    weekShift = 1;
  } else if (/\bthis\s*week\b/.test(text)) {
    relative = "this-week";
    weekShift = 0;
  }

  // "weekend" expands to Sat+Sun unless one of those is already present
  // (don't double-add). Treat "this weekend" as the current week too.
  if (/\bweekend\b/.test(text)) {
    if (!days.includes("Sat")) days.push("Sat");
    if (!days.includes("Sun")) days.push("Sun");
    if (/\bthis\s+weekend\b/.test(text) && weekShift === null) {
      weekShift = 0;
    } else if (/\bnext\s+weekend\b/.test(text) && weekShift === null) {
      weekShift = 1;
    }
  }

  // "soonest" / "earliest" / "asap" / "first available" — caller surfaces
  // the earliest matching slot. Plays nicely with other constraints
  // (e.g. "soonest on Saturday" = nearest Saturday's earliest opening).
  const prefersSoonest =
    /\b(soonest|earliest|asap|as\s+soon\s+as\s+possible|first\s+available|first\s+opening)\b/.test(
      text
    );

  // Specific hour — "at 2pm", "5 pm", "around 10:30"
  let hour24: number | null = null;
  let timeFlexibility: TimeFlexibility = "exact";
  // "around" / "near" / "close to" / "ish" signal flexibility
  if (/\b(around|near|close\s+to|approximately|roughly|ish\b)/.test(text)) {
    timeFlexibility = "approximate";
  }
  // 12h with am/pm
  const ampm = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const isPM = ampm[3].toLowerCase() === "pm";
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    hour24 = h + m / 60;
  } else {
    // Bare 24h with colon
    const bare = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (bare) {
      const h = parseInt(bare[1], 10);
      const m = parseInt(bare[2], 10);
      if (h <= 23 && m <= 59) hour24 = h + m / 60;
    }
  }

  return {
    days,
    dayOfMonth,
    dateKey,
    period,
    relative,
    hour24,
    timeFlexibility,
    weekShift,
    prefersSoonest,
  };
}

/* -------------------------------------------------------------------------- */
/* Sub-parsers                                                                 */
/* -------------------------------------------------------------------------- */

function parseSelectSlot(
  text: string,
  context: AssistantContext
): Intent | null {
  // Only meaningful if we have shown slots OR have a service locked
  if (context.lastShownSlots.length === 0) return null;

  // If the message contains refinement signals, defer to parseRefineTime.
  // This prevents "do you have any earlier times on the 12th" from being
  // misread as a slot selection just because it contains "do" and "12".
  if (
    /\bearlier\b|\blater\b|\bbefore\b|\bafter\b|\bsooner\b|\baround\b|\bnear\b|\bany\s+(other|more)\b|\bmore\s+times\b|\banother\b|\bthat\s+day\b|\bsame\s+day\b/.test(
      text
    )
  ) {
    return null;
  }
  // Also bail on questions — "do you have", "what about", "any" by itself
  if (/\b(do\s+you\s+have|what\s+about|any\s+\w+\s+times)\b/.test(text)) {
    return null;
  }

  // Trigger words for explicit selection — "do" alone is too broad,
  // require it as part of "let's do" / "i'll do" / "do the"
  const isSelectVerb =
    /\b(book|take|pick|choose|reserve|hold)\b/.test(text) ||
    /\b(let'?s|i'?ll)\s+(do|take|book|go\s+with)\b/.test(text) ||
    /\bdo\s+(the|that)\b/.test(text) ||
    /^(yes|yeah|yep|sure)[,.\s]/.test(text);

  // Ordinal phrases
  let ordinal: number | null = null;
  for (const [word, n] of Object.entries(ORDINAL_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) {
      ordinal = n;
      break;
    }
  }
  const hints = extractTimeHints(text);

  const hasOrdinal = ordinal !== null;
  const hasSpecificHour = hints.hour24 !== null;
  const hasSpecificDay = hints.days.length > 0 || hints.dayOfMonth !== null;

  // Bare-specific = "the 2pm" / "second one" without a verb
  const isBareSpecific =
    !isSelectVerb && (hasOrdinal || hasSpecificHour) && text.length < 30;

  if (!isSelectVerb && !isBareSpecific) return null;
  if (!hasOrdinal && !hasSpecificHour) return null;

  return {
    kind: "select_slot",
    rawText: text,
    ordinal,
    hour24: hints.hour24,
    dayOfMonth: hints.dayOfMonth,
    dateKey: hints.dateKey,
  };
}

function parseRefineTime(
  text: string,
  context: AssistantContext
): Intent | null {
  // Refinement only makes sense once there's a service in play
  if (!context.selectedService && !context.lastRecommendedService) return null;

  let relation: RefineRelation = null;
  if (/\bearlier\b|\bbefore\b|\bsooner\b/.test(text)) relation = "earlier";
  else if (/\blater\b|\bafter\b/.test(text)) relation = "later";
  else if (/\baround\b|\bnear\b|\bclose\s+to\b/.test(text))
    relation = "around";
  else if (
    // Brief: "yes, more, more times, show more, anything else, other times"
    // — these all mean "show me more times" when slots have already been shown.
    // We require lastShownSlots.length > 0 to avoid catching "yes" in other
    // contexts (acknowledging clarifications, confirming a service, etc.).
    /\bany\s+(other|more)\b|\bmore\s+times\b|\banother\b|\bshow\s+more\b|\banything\s+else\b|\bother\s+times\b/.test(
      text
    ) ||
    (context.lastShownSlots.length > 0 &&
      !context.pendingClarification &&
      /^(yes|yeah|yep|yup|sure|more|ok|okay)\.?$/.test(text.trim()))
  ) {
    relation = "more";
  }

  const hints = extractTimeHints(text);
  const hasNewTimeScope =
    hints.days.length > 0 ||
    hints.dayOfMonth !== null ||
    hints.relative !== null ||
    hints.period !== null ||
    hints.hour24 !== null;

  // Heuristic: "that day" / "same day" anchor to lastAnchorDateKey
  const refersToAnchorDay = /\b(that\s+day|same\s+day)\b/.test(text);

  if (!relation && !hasNewTimeScope && !refersToAnchorDay) return null;

  // If they didn't introduce a new day but said "earlier/later", anchor to last
  let anchorDateKey: string | null = null;
  if (
    !hints.dateKey &&
    hints.dayOfMonth === null &&
    hints.days.length === 0 &&
    (relation === "earlier" || relation === "later" || refersToAnchorDay)
  ) {
    anchorDateKey = context.lastAnchorDateKey;
  }

  return {
    kind: "refine_time",
    rawText: text,
    relation,
    anchorDateKey,
    timeHints: hints,
  };
}

function parseInfoQuery(text: string): Intent | null {
  const asksPrice =
    /\b(how\s+much|price|cost|costs|expensive|\$|fee)\b/.test(text);
  const asksDuration =
    /\b(how\s+long|duration|take|takes|hours?|minutes?|mins?)\b/.test(text);

  if (!asksPrice && !asksDuration) return null;

  const asks: ("price" | "duration")[] = [];
  if (asksPrice) asks.push("price");
  if (asksDuration) asks.push("duration");

  return { kind: "info_query", rawText: text, asks };
}

/* -------------------------------------------------------------------------- */
/* resolveServiceIntent — unified service intent resolver                      */
/*                                                                             */
/* The priority order inside service intents:                                  */
/*   1. Combo match (Square has a built-in combo service for this phrasing)   */
/*   2. Multi/add (multiple categories mentioned, OR additive language)        */
/*   3. Switch (explicit swap language with one new category)                  */
/*   4. Confirm (ambiguous mention with one new category)                      */
/*                                                                             */
/* Returns null when the message has no service mention; the caller then       */
/* falls through to time-intent parsing.                                       */
/* -------------------------------------------------------------------------- */

function resolveServiceIntent(
  text: string,
  context: AssistantContext
): Intent | null {
  const currentService =
    context.selectedService ?? context.lastRecommendedService;
  const hasCurrentService = currentService !== null;

  // PRIORITY 1: Combo Square service
  // Short-circuits everything else. "Men's cut and perm" → "Men's Perm + Hair Cut"
  // as a single Square service, not Haircut + Perm separately.
  const combo = findBestComboServiceMatch(text);
  if (combo) {
    // If there's already a current service and the user is using additive
    // language, this combo becomes additive too (rare but possible — e.g.
    // "i also want a digital perm").
    const addMode = hasCurrentService && hasAdditiveLanguage(text);
    const switchMode =
      hasCurrentService &&
      !addMode &&
      currentService.id !== combo.service.id;

    if (addMode) {
      return {
        kind: "add_services",
        rawText: text,
        mode: "additive",
        tags: [],
        lengthHint: null,
        permStyle: null,
        colorDirection: null,
        timeHints: extractTimeHints(text),
        comboServiceId: combo.service.id,
      };
    }
    if (switchMode) {
      // Explicit-switch fast path (new combo replacing existing service)
      if (hasExplicitSwitchLanguage(text)) {
        return {
          kind: "switch_service",
          rawText: text,
          tags: [],
          lengthHint: null,
          permStyle: null,
          colorDirection: null,
          timeHints: extractTimeHints(text),
          comboServiceId: combo.service.id,
        };
      }
      // Ambiguous switch — ask for confirmation
      return {
        kind: "confirm_switch",
        rawText: text,
        proposedTags: [],
        proposedLengthHint: null,
        proposedPermStyle: null,
        proposedColorDirection: null,
      };
    }
    // Fresh combo intent
    return {
      kind: "book",
      rawText: text,
      tags: [],
      lengthHint: null,
      permStyle: null,
      colorDirection: null,
      timeHints: extractTimeHints(text),
      confidence: "high",
      comboServiceId: combo.service.id,
    };
  }

  // Tag-based extraction for everything else
  const candidate = parseBookCore(text);
  if (candidate.tags.length === 0) return null;

  // PRIORITY 2: Multi-service / add-service
  const additive = hasAdditiveLanguage(text);
  const multipleCategories =
    candidate.tags.filter((t) => t !== "Consultation").length > 1;

  if (additive && hasCurrentService) {
    // "wait i need color too" / "can i add a haircut"
    // parseBookCore (catalog-based) already handles fuzzy tag recovery
    return {
      kind: "add_services",
      rawText: text,
      mode: "additive",
      tags: candidate.tags,
      lengthHint: candidate.lengthHint,
      permStyle: candidate.permStyle,
      colorDirection: candidate.colorDirection,
      timeHints: candidate.timeHints,
      comboServiceId: null,
    };
  }
  if (multipleCategories && !hasCurrentService) {
    // Cold start with multiple categories — "color and haircut", "balayge and trim"
    // parseBookCore (catalog-based) already merges all matched categories via
    // the catalog engine's fuzzy matching, so candidate.tags is complete.
    return {
      kind: "add_services",
      rawText: text,
      mode: "fresh",
      tags: candidate.tags,
      lengthHint: candidate.lengthHint,
      permStyle: candidate.permStyle,
      colorDirection: candidate.colorDirection,
      timeHints: candidate.timeHints,
      comboServiceId: null,
    };
  }
  if (multipleCategories && hasCurrentService) {
    // Mid-conversation multi-service mention — the user named multiple
    // categories at once (e.g. "haircut and perm"). This is a clear ADD
    // intent, not a switch — pre-empt the Switch/Add/Keep prompt and just
    // merge everything. If the new tags include the current category, the
    // additive merge in handleAddServices will de-dup it.
    return {
      kind: "add_services",
      rawText: text,
      mode: "additive",
      tags: candidate.tags,
      lengthHint: candidate.lengthHint,
      permStyle: candidate.permStyle,
      colorDirection: candidate.colorDirection,
      timeHints: candidate.timeHints,
      comboServiceId: null,
    };
  }

  // From here on we need a current service — single-category mentions at
  // cold start route through the standard book path (handled by caller).
  if (!hasCurrentService) return null;

  const currentCategory = currentService.category;
  const hasNewServiceTag = candidate.tags.some(
    (t) => t !== currentCategory && t !== "Consultation"
  );
  if (!hasNewServiceTag) return null;

  // PRIORITY 3: Explicit switch
  if (hasExplicitSwitchLanguage(text)) {
    return {
      kind: "switch_service",
      rawText: text,
      tags: candidate.tags,
      lengthHint: candidate.lengthHint,
      permStyle: candidate.permStyle,
      colorDirection: candidate.colorDirection,
      timeHints: candidate.timeHints,
      comboServiceId: null,
    };
  }

  // PRIORITY 4: Ambiguous mention — confirm
  return {
    kind: "confirm_switch",
    rawText: text,
    proposedTags: candidate.tags,
    proposedLengthHint: candidate.lengthHint,
    proposedPermStyle: candidate.permStyle,
    proposedColorDirection: candidate.colorDirection,
  };
}

/**
 * Detects additive language — the brief lists: "also", "too", "as well",
 * "and", "with", "plus", "both", "wait i need", "can i add".
 *
 * Caveat: "and" is everywhere ("haircut and color", "today and tomorrow").
 * To avoid false additives, we require either (a) an explicit additive word
 * other than "and"/"with", OR (b) "and"/"with" plus the user mentioning a
 * service category (the caller decides if this matters in context).
 */
function hasAdditiveLanguage(text: string): boolean {
  // Strong additive signals (specific to add-service requests)
  if (
    /\b(also|too|as\s+well|plus|both|in\s+addition)\b/.test(text) ||
    /\bwait[, ]+i\s+need\b/.test(text) ||
    /\bcan\s+i\s+add\b/.test(text) ||
    /\badd\s+(a|an|some|the)\b/.test(text)
  ) {
    return true;
  }
  // Weak additive: "i need both" / "do both"
  if (/\b(do|need|want|get)\s+both\b/.test(text)) return true;
  return false;
}

/**
 * Detects clear switch-language — these phrases mean replacement, not addition.
 * The brief lists: "instead", "actually", "switch to", "change to", "rather",
 * "not haircut, color", "forget haircut".
 */
function hasExplicitSwitchLanguage(text: string): boolean {
  return (
    /\b(instead|actually|switch\s+to|change\s+to|rather|make\s+it)\b/.test(
      text
    ) ||
    /\bnot\s+(a\s+|the\s+)?(haircut|color|perm|treatment)/.test(text) ||
    /\bforget\s+(the\s+|that\s+)?(haircut|color|perm|treatment)/.test(text)
  );
}

/**
 * Core "what do they want to book" extraction. Catalog-driven: services
 * declare their own keywords, aliases, and misspellings so this function
 * has no hardcoded service logic.
 */
function parseBookCore(text: string) {
  const result = matchCatalog(text, MIA_CATALOG);
  const mods = extractModifiers(text);

  // Build IntentTags from medium+ confidence matches only.
  // Low-confidence (< 0.60) fuzzy hits are too noisy — "need" fuzzy-matches
  // "dyed" at distance 2 (confidence 0.50), which would falsely tag Color.
  const tagSet = new Set<IntentTag>();
  for (const match of [...result.high, ...result.medium]) {
    const cat = match.entry.category;
    if (
      cat === "Haircut" ||
      cat === "Color" ||
      cat === "Perm" ||
      cat === "Treatment"
    ) {
      tagSet.add(cat as IntentTag);
    }
  }

  // Consultation signals (not a catalog service — kept as a cross-cutting flag)
  if (hasAny(text, CONSULT_WORDS)) tagSet.add("Consultation");

  // colorDirection: modifiers first (regex extraction), then infer from the
  // top Color match's sole declared direction when modifiers give nothing
  let colorDirection: ColorDirection = mods.colorDirection as ColorDirection;
  if (!colorDirection) {
    const topColor = result.all.find((m) => m.entry.category === "Color");
    const dirs = topColor?.entry.colorDirections;
    if (dirs && dirs.length === 1) colorDirection = dirs[0] as ColorDirection;
  }

  return {
    tags: [...tagSet],
    lengthHint: mods.lengthHint as LengthHint,
    permStyle: mods.permStyle as PermStyle,
    colorDirection,
    timeHints: extractTimeHints(text),
  };
}

/* -------------------------------------------------------------------------- */
/* parseClientMessage                                                          */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* parseClientMessage — top-level dispatcher                                   */
/*                                                                             */
/* Sequential fall-through with explicit priority. Service intents always     */
/* beat time intents — if a message mentions services, we handle that first   */
/* even when time language is also present. The internal ordering:            */
/*                                                                             */
/*   1. exact_combo / multi-service / add / switch / confirm   (service)      */
/*   2. info_query (price/duration about current service)                      */
/*   3. select_slot (booking a time we just showed)                            */
/*   4. refine_time (earlier/later/next week...)                               */
/*   5. book (cold-start single service)                                       */
/*   6. unknown (fallback)                                                     */
/* -------------------------------------------------------------------------- */

export function parseClientMessage(
  input: string,
  context: AssistantContext
): Intent {
  const text = input.toLowerCase().trim();
  if (!text) return { kind: "unknown", rawText: input };

  // PRIORITY 0: Pending state. The brief is explicit — pending context
  // always wins over normal parsing. We check in this order:
  //   0a. pendingSwitch  — Switch/Add/Keep prompt is up
  //   0b. pendingFuzzy   — fuzzy-match Yes/No is up
  //   0c. pendingClarification — current-service clarification is up
  //   0d. pendingAdditionalService — primary resolved, secondary still needs
  //                                  clarification
  // Each routes to a synthetic intent that downstream handlers treat like a
  // button tap.

  // 0a: Switch/Add/Keep typed answers
  if (context.pendingSwitch) {
    const action = matchSwitchAddKeepFreeText(text);
    if (action) {
      return {
        kind: "clarification_answer",
        rawText: input,
        key: action,
      };
    }
    // Otherwise fall through — the user might be saying something else
    // entirely, in which case we'll re-ask at the page level.
  }

  // 0b: Fuzzy match Yes/No
  if (context.pendingFuzzy) {
    const action = matchFuzzyYesNoFreeText(text);
    if (action) {
      return {
        kind: "clarification_answer",
        rawText: input,
        key: action,
      };
    }
  }

  // 0c: Pending clarification (length / color / perm option questions)
  if (context.pendingClarification) {
    const matchedKey = matchClarificationFreeText(
      text,
      context.pendingClarification.expectedKeys
    );
    if (matchedKey) {
      return {
        kind: "clarification_answer",
        rawText: input,
        key: matchedKey,
      };
    }
  }

  // 0d: Pending additional service — secondary still needs clarification
  // (e.g. primary Color is set, Haircut needs length). We route to the
  // appropriate clarification keys based on the pending category.
  if (context.pendingAdditionalService) {
    const cat = context.pendingAdditionalService.category;
    const expectedKeys =
      cat === "Haircut"
        ? ["len-short", "len-long", "len-unsure"]
        : cat === "Color"
        ? ["color-root", "color-full"]
        : cat === "Perm"
        ? ["perm-down", "len-short", "len-long"]
        : [];
    const matchedKey = matchClarificationFreeText(text, expectedKeys);
    if (matchedKey) {
      return {
        kind: "clarification_answer",
        rawText: input,
        key: matchedKey,
      };
    }
  }

  // PRIORITY 1: Service intents (combo / multi / add / switch / confirm)
  const serviceIntent = resolveServiceIntent(text, context);
  if (serviceIntent) return serviceIntent;

  // PRIORITY 2: Info query (price/duration). Runs before slot selection
  // because "how long does it take" doesn't pick a slot.
  const info = parseInfoQuery(text);
  if (info) return info;

  // PRIORITY 3: Slot selection — "book the 2pm" / "second one" / "yes"
  const select = parseSelectSlot(text, context);
  if (select) return select;

  // PRIORITY 4: Time refinement — "earlier", "next week", "Friday afternoon"
  const refine = parseRefineTime(text, context);
  if (refine) return refine;

  // PRIORITY 5: Cold-start book intent (single service).
  // The catalog-based parseBookCore already handles fuzzy/typo matching and
  // multi-category detection — no separate fuzzy rescue pass needed.
  const core = parseBookCore(text);

  // If the catalog found multiple distinct service categories, treat this as
  // a multi-service fresh request (same path as "color and haircut").
  const nonConsultTags = core.tags.filter((t) => t !== "Consultation");
  if (
    nonConsultTags.length > 1 &&
    !context.selectedService &&
    !context.lastRecommendedService
  ) {
    return {
      kind: "add_services",
      rawText: input,
      mode: "fresh",
      tags: core.tags,
      lengthHint: core.lengthHint,
      permStyle: core.permStyle,
      colorDirection: core.colorDirection,
      timeHints: core.timeHints,
      comboServiceId: null,
    };
  }

  // Confidence
  let confidence: Confidence;
  if (core.tags.length === 0) {
    confidence = "low";
  } else if (
    core.tags.includes("Perm") &&
    core.tags.includes("Haircut") &&
    !core.lengthHint &&
    !core.permStyle
  ) {
    confidence = "medium";
  } else if (
    core.tags.includes("Color") &&
    !core.colorDirection &&
    !core.tags.includes("Consultation")
  ) {
    confidence = "medium";
  } else {
    confidence = "high";
  }
  if (
    core.tags.length === 1 &&
    core.tags[0] === "Consultation"
  ) {
    confidence = "high";
  }

  return {
    kind: "book",
    rawText: input,
    tags: core.tags,
    lengthHint: core.lengthHint,
    permStyle: core.permStyle,
    colorDirection: core.colorDirection,
    timeHints: core.timeHints,
    confidence,
    comboServiceId: null,
  };
}

/* -------------------------------------------------------------------------- */
/* getClarifyingQuestion                                                       */
/* -------------------------------------------------------------------------- */

export function getClarifyingQuestion(
  intent: Intent,
  context: AssistantContext
): ClarifyingQuestion {
  if (intent.kind !== "book" && intent.kind !== "switch_service") return null;

  const { tags, lengthHint, permStyle } = intent;

  // Combined perm + haircut — ask length
  if (tags.includes("Perm") && tags.includes("Haircut")) {
    if (permStyle === "down") return null;
    if (lengthHint) return null;
    return {
      text: "Got it — for a perm plus haircut, I just need one detail. Is your hair short, or medium-to-long?",
      options: [
        { label: "Short hair", key: "len-short" },
        { label: "Medium or long hair", key: "len-long" },
        { label: "Down perm specifically", key: "perm-down" },
        { label: "Not sure", key: "len-unsure" },
      ],
    };
  }

  // Multi-service Color + Haircut: prefer color clarification first if
  // unresolved; otherwise ask haircut clarification. Brief Fix 2: when
  // current is Full Color (already resolved) and user adds haircut, we
  // must ask the haircut question — not ask color again.
  if (tags.includes("Color") && tags.includes("Haircut")) {
    if (intent.colorDirection === null) {
      return {
        text: "Got it — for the color part, are you thinking root touch-up, or a fuller color?",
        options: [
          { label: "Root touch-up", key: "color-root" },
          { label: "Full color", key: "color-full" },
        ],
      };
    }
    if (!lengthHint) {
      return {
        text: "Is your haircut short / barber length, or medium-to-long?",
        options: [
          { label: "Short / barber", key: "len-short" },
          { label: "Medium or long", key: "len-long" },
        ],
      };
    }
    return null;
  }

  // Standalone haircut without length — ask once
  if (tags.length === 1 && tags[0] === "Haircut" && !lengthHint) {
    return {
      text: "Is your hair short / barber length, or medium-to-long?",
      options: [
        { label: "Short / barber", key: "len-short" },
        { label: "Medium or long", key: "len-long" },
      ],
    };
  }

  // Color without direction — ask once.
  if (
    tags.includes("Color") &&
    !tags.includes("Perm") &&
    !tags.includes("Haircut") &&
    intent.colorDirection === null
  ) {
    return {
      text: "Are you thinking root touch-up, or a fuller color?",
      options: [
        { label: "Root touch-up", key: "color-root" },
        { label: "Full color", key: "color-full" },
      ],
    };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* getRecommendedServices                                                      */
/* -------------------------------------------------------------------------- */

export function getRecommendedServices(
  intent: Extract<Intent, { kind: "book" | "switch_service" }>,
  clarificationKey?: string
): Recommendation {
  // PRIORITY: combo Square service was matched. Honor it verbatim and skip
  // the tag-based recommendation path. The combo matcher already encoded all
  // the disambiguation we needed (men's vs down vs digital perm, etc.).
  if (intent.comboServiceId) {
    const svc = SERVICES.find((s) => s.id === intent.comboServiceId);
    if (svc) {
      return {
        primary: svc,
        additionalServices: [],
        unresolvedAdditionalCategory: null,
        alternates: [],
        honestNote: null,
        reason: `Shen has a service for that: ${svc.name}.`,
      };
    }
  }

  const base = getRecommendedServicesCore(intent, clarificationKey);
  // Detect multi-service mentions that the per-category branches above
  // don't already handle (e.g. Color + Haircut, Treatment + Haircut).
  // Perm + Haircut has dedicated combined services and is already covered.
  const tags = new Set(intent.tags);
  const additional: Service[] = [];
  let unresolvedAdditionalCategory: IntentTag | null = null;

  // Was lengthHint actually resolved (either by user explicit or by
  // clarification key)? clarificationKey "len-short" / "len-long" → resolved.
  // The wrapper sees the post-clarification intent's lengthHint already set.
  const lengthHintResolved =
    intent.lengthHint !== null || clarificationKey === "len-short" ||
    clarificationKey === "len-long";

  if (
    tags.has("Color") &&
    tags.has("Haircut") &&
    base.primary.category === "Color"
  ) {
    const cutId =
      intent.lengthHint === "short" ? "svc-short-cut" : "svc-medium-long-cut";
    additional.push(findService(cutId));
    if (!lengthHintResolved) {
      // We picked a default — flag for the page to set pendingAdditionalService
      unresolvedAdditionalCategory = "Haircut";
    }
  }
  if (
    tags.has("Treatment") &&
    tags.has("Haircut") &&
    base.primary.category === "Treatment"
  ) {
    const cutId =
      intent.lengthHint === "short" ? "svc-short-cut" : "svc-medium-long-cut";
    additional.push(findService(cutId));
    if (!lengthHintResolved) {
      unresolvedAdditionalCategory = "Haircut";
    }
  }
  // Perm + Haircut: same pattern as Color/Treatment + Haircut. The core
  // recommender returns the perm as primary; we add the matching-length
  // haircut here as an additional service so the booking blocks the full
  // time (perm duration + haircut duration). Skipped when the primary is
  // a combo SKU that already includes a cut — adding another haircut
  // would double-book the cut.
  const comboSkusWithCut = new Set<string>([
    "svc-cut-down-perm",   // "Hair Cut + Down Perm"
    "svc-mens-perm-cut",   // "Short Hair Perm + Cut"
  ]);
  if (
    tags.has("Perm") &&
    tags.has("Haircut") &&
    base.primary.category === "Perm" &&
    !comboSkusWithCut.has(base.primary.id)
  ) {
    const cutId =
      intent.lengthHint === "short" ? "svc-short-cut" : "svc-medium-long-cut";
    additional.push(findService(cutId));
    if (!lengthHintResolved) {
      unresolvedAdditionalCategory = "Haircut";
    }
  }
  // De-dupe by id
  const merged = [...base.additionalServices, ...additional].filter(
    (s, i, arr) => arr.findIndex((x) => x.id === s.id) === i
  );
  return { ...base, additionalServices: merged, unresolvedAdditionalCategory };
}

function getRecommendedServicesCore(
  intent: Extract<Intent, { kind: "book" | "switch_service" }>,
  clarificationKey?: string
): Recommendation {
  const tags = new Set(intent.tags);

  let lengthHint = intent.lengthHint;
  let permStyle = intent.permStyle;
  let colorDirection = intent.colorDirection;
  let consultationOverride = false;

  if (clarificationKey === "len-short") lengthHint = "short";
  if (clarificationKey === "len-long") lengthHint = "long";
  if (clarificationKey === "perm-down") permStyle = "down";
  if (clarificationKey === "len-unsure") consultationOverride = true;
  if (clarificationKey === "color-root") colorDirection = "root";
  if (clarificationKey === "color-full") colorDirection = "lighter";

  // Alternates shown under "See other options." For Perm specifically,
  // exclude combo-with-cut SKUs so the user sees actual style alternatives
  // (Regular, Digital, Straightening) rather than other perm+cut bundles
  // they didn't ask about. Bang Perm stays in alternates — it's a real
  // alternative even if it's not the default primary.
  const PERM_COMBOS_HIDDEN_FROM_ALTS = new Set<string>([
    "svc-mens-perm-cut",
    "svc-cut-down-perm",
  ]);
  const alts = (primary: Service, cat: string) => {
    let candidates = categoryServices(cat).filter((e) => e.id !== primary.id);
    if (cat === "Perm") {
      candidates = candidates.filter(
        (e) => !PERM_COMBOS_HIDDEN_FROM_ALTS.has(e.id)
      );
    }
    return candidates.slice(0, 3);
  };

  // SKUs the "default perm primary" picker must NOT return. Two reasons:
  //   1. Combo SKUs that bundle a haircut — picking one and then having the
  //      wrapper append a haircut would double-book the cut.
  //   2. Specialty SKUs like Bang Perm — technically a "regular" perm style
  //      but only fits a specific request (bangs). When the user just asks
  //      for "a perm" or "perm + haircut" with no specifics, they don't
  //      mean a bang perm — they mean the standard whole-head perm.
  const PERM_SKUS_NOT_DEFAULT_PRIMARY = new Set<string>([
    "svc-mens-perm-cut",  // combo with cut
    "svc-cut-down-perm",  // combo with cut
    "svc-bang-perm",       // specialty (bangs only)
  ]);
  function findPermPrimaryExcludingCutCombos(style: string): Service | null {
    return (
      MIA_CATALOG.filter(
        (e) =>
          e.category === "Perm" &&
          !PERM_SKUS_NOT_DEFAULT_PRIMARY.has(e.id) &&
          (e.permStyles ?? []).includes(style as never)
      ).sort((a, b) => (a.popularRank ?? 99) - (b.popularRank ?? 99))[0] ?? null
    );
  }

  if (consultationOverride || tags.has("Consultation")) {
    return {
      primary: synthConsultation(),
      additionalServices: [],
      unresolvedAdditionalCategory: null,
      alternates: [],
      honestNote: null,
      reason: "Shen should take a quick look first.",
    };
  }

  if (tags.has("Perm") && tags.has("Haircut")) {
    // Two paths depending on what the catalog actually offers:
    //   - SHORT hair: Mia has a real bundled combo SKU (svc-mens-perm-cut)
    //     that includes both perm and cut in one package. Use it as the
    //     primary with no additional — the bundle IS the booking. The
    //     wrapper skips appending a haircut because the combo already
    //     includes one. (The catalog name was made gender-neutral to
    //     "Short Hair Perm + Cut" so a woman with short hair picking
    //     "Short hair" sees a service name that makes sense.)
    //   - LONG hair / no length yet: no combo SKU exists, so book two
    //     services — regular perm primary + matching haircut as an
    //     additional. Combined duration blocks the stylist's calendar.
    //   - DOWN perm: dedicated "Hair Cut + Down Perm" combo, primary only.
    if (permStyle === "down") {
      const primary = findByMeta("Perm", "permStyles", "down") ?? synthConsultation();
      return {
        primary,
        additionalServices: [],
        unresolvedAdditionalCategory: null,
        alternates: alts(primary, "Perm"),
        honestNote: null,
        reason: "Down perm with a haircut, bundled.",
      };
    }
    if (lengthHint === "short") {
      const primary = findInCatalog("svc-mens-perm-cut");
      return {
        primary,
        additionalServices: [],
        unresolvedAdditionalCategory: null,
        alternates: alts(primary, "Perm"),
        honestNote: null,
        reason: "Short hair perm + cut, bundled into one appointment.",
      };
    }
    // Long hair OR no length yet → two services. Wrapper appends haircut.
    // Critical: exclude combo SKUs that already bundle a cut, otherwise we
    // get a combo primary + an additional haircut (double-booking the cut).
    const primary =
      findPermPrimaryExcludingCutCombos("regular") ?? synthConsultation();
    return {
      primary,
      additionalServices: [],
      unresolvedAdditionalCategory: null,
      alternates: alts(primary, "Perm"),
      honestNote: null,
      reason:
        lengthHint === "long"
          ? "Perm with a medium-to-long haircut."
          : "Perm with a haircut.",
    };
  }

  if (tags.has("Perm") && !tags.has("Haircut")) {
    if (permStyle === "down") {
      const primary = findByMeta("Perm", "permStyles", "down") ?? synthConsultation();
      return {
        primary,
        additionalServices: [],
        unresolvedAdditionalCategory: null,
        alternates: alts(primary, "Perm"),
        honestNote: null,
        reason: "Down perm — Shen bundles this with a quick cut.",
      };
    }
    if (permStyle === "digital") {
      const primary = findByMeta("Perm", "permStyles", "digital") ?? synthConsultation();
      return {
        primary,
        additionalServices: [],
        unresolvedAdditionalCategory: null,
        alternates: alts(primary, "Perm"),
        honestNote: null,
        reason: "Digital perm is the match here.",
      };
    }
    if (permStyle === "straightening") {
      const primary = findByMeta("Perm", "permStyles", "straightening") ?? synthConsultation();
      return {
        primary,
        additionalServices: [],
        unresolvedAdditionalCategory: null,
        alternates: [],
        honestNote: null,
        reason: "Straightening perm — Shen will plan this carefully.",
      };
    }
    // User wants "a perm" without mentioning a haircut — exclude combo SKUs
    // that already bundle a cut. Otherwise findByMeta would pick the FIRST
    // regular-perm in the catalog (currently the combo) and silently book
    // a cut the user didn't ask for.
    const primary =
      findPermPrimaryExcludingCutCombos("regular") ?? synthConsultation();
    return {
      primary,
      additionalServices: [],
      unresolvedAdditionalCategory: null,
      alternates: alts(primary, "Perm"),
      honestNote: null,
      reason: "Closest match for a regular perm.",
    };
  }

  // Haircut — Color wins as primary when both mentioned (longer service).
  // The wrapper adds Haircut as additionalService.
  if (tags.has("Haircut") && !tags.has("Color")) {
    const primary =
      (lengthHint === "short"
        ? findByMeta("Haircut", "lengthHints", "short")
        : findByMeta("Haircut", "lengthHints", "long")) ??
      categoryServices("Haircut")[0] ??
      synthConsultation();
    return {
      primary,
      additionalServices: [],
      unresolvedAdditionalCategory: null,
      alternates: alts(primary, "Haircut"),
      honestNote: null,
      reason:
        lengthHint === "short"
          ? "Short / barber-length cut."
          : lengthHint === "long"
          ? "Medium-to-long cut."
          : "Most common haircut booking.",
    };
  }

  if (tags.has("Color")) {
    if (colorDirection === "root") {
      const primary = findByMeta("Color", "colorDirections", "root") ?? synthConsultation();
      return {
        primary,
        additionalServices: [],
        unresolvedAdditionalCategory: null,
        alternates: alts(primary, "Color"),
        honestNote: null,
        reason: "Root touch-up — quickest color refresh.",
      };
    }
    if (colorDirection === "lighter") {
      const primary = findByMeta("Color", "colorDirections", "lighter") ?? synthConsultation();
      return {
        primary,
        additionalServices: [],
        unresolvedAdditionalCategory: null,
        alternates: [synthConsultation()],
        honestNote:
          "Going noticeably lighter sometimes needs a consult. Shen can confirm on the day.",
        reason: "Going lighter usually maps to a full color session.",
      };
    }
    if (colorDirection === "darker") {
      const primary = findByMeta("Color", "colorDirections", "darker") ?? synthConsultation();
      return {
        primary,
        additionalServices: [],
        unresolvedAdditionalCategory: null,
        alternates: alts(primary, "Color"),
        honestNote: null,
        reason: "Going darker — full color is the right service.",
      };
    }
    const primary = categoryServices("Color")[0] ?? synthConsultation();
    return {
      primary,
      additionalServices: [],
      unresolvedAdditionalCategory: null,
      alternates: alts(primary, "Color"),
      honestNote: null,
      reason: "Most flexible color booking.",
    };
  }

  if (tags.has("Treatment")) {
    const cats = categoryServices("Treatment");
    const primary = cats[0] ?? synthConsultation();
    return {
      primary,
      additionalServices: [],
      unresolvedAdditionalCategory: null,
      alternates: cats.slice(1, 3),
      honestNote: null,
      reason: "Head spa is Shen's most-booked treatment.",
    };
  }

  return {
    primary: synthConsultation(),
    additionalServices: [],
    unresolvedAdditionalCategory: null,
    alternates: [],
    honestNote: null,
    reason: "When in doubt, a quick consult is the fastest path.",
  };
}

function synthConsultation(): Service {
  return {
    id: "consult-generic",
    name: "Consultation with Shen",
    category: "Other",
    priceLabel: "Free",
    durationMinutes: 30,
    durationLabel: "30 min",
    status: "consultation",
  };
}

/* -------------------------------------------------------------------------- */
/* getAssistantResponse                                                        */
/* -------------------------------------------------------------------------- */

export function getAssistantResponse(
  intent: Extract<Intent, { kind: "book" | "switch_service" }>,
  recommendation: Recommendation,
  context: AssistantContext
): AssistantResponse {
  const isSwitch = intent.kind === "switch_service";
  const { tags } = intent;

  const ack = isSwitch ? "Totally — switching." : "Got it —";

  if (
    tags.includes("Perm") &&
    tags.includes("Haircut") &&
    !intent.lengthHint &&
    !intent.permStyle
  ) {
    return {
      ack,
      interpretation: "for a perm plus haircut, I just need one detail.",
      needsClarification: true,
    };
  }

  if (
    intent.kind === "book" &&
    intent.confidence === "low"
  ) {
    return {
      ack: "",
      interpretation: "",
      needsClarification: true,
    };
  }

  if (recommendation.primary.status === "consultation") {
    return {
      ack,
      interpretation:
        "that sounds like something Shen should take a quick look at first.",
      needsClarification: false,
    };
  }

  if (intent.kind === "book" && intent.confidence === "medium") {
    return {
      ack: "Sounds like",
      interpretation: `${recommendation.primary.name.toLowerCase()} — does that match?`,
      needsClarification: false,
    };
  }

  return {
    ack,
    interpretation: `that sounds like Shen's ${recommendation.primary.name} service.`,
    needsClarification: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Slot ranking + filtering                                                    */
/* -------------------------------------------------------------------------- */

export function rankTimeSlots(
  slots: TimeSlot[],
  hints: TimeHints
): TimeSlot[] {
  const noHints =
    hints.days.length === 0 &&
    !hints.period &&
    !hints.relative &&
    hints.dayOfMonth === null &&
    hints.hour24 === null;
  if (noHints) return slots;

  const score = (s: TimeSlot) => {
    let v = 0;
    if (hints.dayOfMonth !== null && s.dayOfMonth === hints.dayOfMonth)
      v += 12;
    if (hints.dateKey && s.dateKey === hints.dateKey) v += 12;
    if (hints.days.includes(s.dayLabel)) v += 10;
    if (hints.period === "morning" && s.hour24 < 12) v += 5;
    if (hints.period === "afternoon" && s.hour24 >= 12 && s.hour24 < 17)
      v += 5;
    if (hints.period === "evening" && s.hour24 >= 17) v += 5;
    if (hints.hour24 !== null) {
      const diff = Math.abs(s.hour24 - hints.hour24);
      if (diff <= 0.5) v += 8;
      else if (diff <= 1.5) v += 4;
      else if (diff <= 3) v += 2;
    }
    return v;
  };

  return [...slots]
    .map((s, i) => ({ s, i, v: score(s) }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((x) => x.s);
}

/**
 * The shape returned by filterSlotsByRefinement. The page builds copy from
 * these fields so the parser stays UI-agnostic.
 *
 *   scope: what we ended up checking
 *     - "anchor-day": a specific calendar day (anchor.dateKey, anchor.label)
 *     - "week": Mon-Sun window (anchor.weekStart, anchor.weekEnd, anchor.label)
 *     - "all": no scope filter (e.g. "more times")
 *
 *   outcome: what happened
 *     - "found": filters honored, slots returned
 *     - "fuzzy": user wanted exact hour, returned nearest instead
 *     - "fell-through": empty after filters, showing closest-anchor slots
 *     - "past-horizon": user asked beyond MOCK_AVAILABILITY_HORIZON
 *
 *   askedExactHour: the hour the user asked for if they pinned one (for
 *   mismatch copy: "I don't see 3pm exactly...")
 */
export type RefinementOutcome = {
  slots: TimeSlot[];
  scope: "anchor-day" | "week" | "all";
  scopeLabel: string; // "Tue May 5", "the week of May 18", "next week"
  outcome: "found" | "fuzzy" | "fell-through" | "past-horizon";
  askedExactHour: number | null;
  anchorDateKey: string | null;
  // When outcome is "fell-through" or "fuzzy", this describes how far the
  // assistant had to walk to find slots. Drives copy:
  //   "same-day"  — fell back to other times on the requested day
  //   "next-day"      — requested day was empty, jumped to the next day with slots
  //   "this-week"    — fell back to remaining slots in the same week
  //   "next-week"    — current week had nothing, jumped forward
  //   "before-anchor"— no slots exist on or after the anchor; showing earlier slots
  //   null           — applies when outcome is "found"
  fallbackTier:
    | "same-day"
    | "next-day"
    | "this-week"
    | "next-week"
    | "before-anchor"
    | null;
  // True when the user asked about a day Shen doesn't normally work
  // (Sun/Mon in this prototype). Drives a different ack copy:
  // "Shen doesn't usually take appointments on Sundays."
  nonWorkingDay?: boolean;
};

/**
 * Resolve a week shift (0/1/2) to a Mon-Sun date range based on MOCK_TODAY.
 */
function getWeekRange(weekShift: number): {
  startDateKey: string;
  endDateKey: string;
  label: string;
} {
  // MOCK_TODAY is Sun May 3. The start of "this week" (the user's mental
  // model) is the next working day, Mon May 4. Each week is Mon-Sun.
  const baseDay = 4; // Mon May 4 — start of week 0
  const startDay = baseDay + weekShift * 7;
  const endDay = startDay + 6;
  // May has 31 days so week 2 (May 18-24) doesn't roll over into June.
  const startDateKey = `2026-05-${startDay.toString().padStart(2, "0")}`;
  const endDateKey = `2026-05-${endDay.toString().padStart(2, "0")}`;
  const label =
    weekShift === 0
      ? "this week"
      : weekShift === 1
      ? "next week"
      : `the week after May ${baseDay + 7 + 6}`; // "the week after May 17"
  return { startDateKey, endDateKey, label };
}

export function filterSlotsByRefinement(
  allSlots: TimeSlot[],
  intent: Extract<Intent, { kind: "refine_time" }>,
  context: AssistantContext
): RefinementOutcome {
  const { relation, anchorDateKey, timeHints } = intent;
  const askedExactHour =
    timeHints.hour24 !== null && timeHints.timeFlexibility === "exact"
      ? timeHints.hour24
      : null;

  /* -------- Week-scoped requests (highest priority) -------------------- */
  if (timeHints.weekShift !== null && !timeHints.dateKey) {
    const range = getWeekRange(timeHints.weekShift);

    // When user said "week of the Nth", reflect their phrasing in the label
    // ("the week of May 18") rather than the generic "the week after May 17".
    // The parser sets dayOfMonth alongside weekShift in that case.
    const labelOverride =
      timeHints.dayOfMonth !== null
        ? `the week of May ${timeHints.dayOfMonth}`
        : range.label;

    // Past horizon? Only if the *start* of the requested week is past our data
    if (range.startDateKey > MOCK_AVAILABILITY_HORIZON.dateKey) {
      return {
        slots: [],
        scope: "week",
        scopeLabel: labelOverride,
        outcome: "past-horizon",
        askedExactHour: null,
        anchorDateKey: null,
        fallbackTier: null,
      };
    }

    let weekSlots = allSlots.filter(
      (s) => s.dateKey >= range.startDateKey && s.dateKey <= range.endDateKey
    );
    // Period filter on top
    if (timeHints.period) weekSlots = weekSlots.filter(periodMatch(timeHints.period));
    // Day-of-week filter on top
    if (timeHints.days.length > 0)
      weekSlots = weekSlots.filter((s) => timeHints.days.includes(s.dayLabel));

    weekSlots = sortChrono(weekSlots);

    return {
      slots: weekSlots,
      scope: "week",
      scopeLabel: labelOverride,
      outcome: weekSlots.length > 0 ? "found" : "fell-through",
      askedExactHour: null,
      anchorDateKey: null,
      fallbackTier: null,
    };
  }

  /* -------- Day-scoped requests --------------------------------------- */
  // Resolve anchor day. Priority:
  //   1. New explicit day in this message (dayOfMonth, dateKey, days[])
  //   2. anchorDateKey on the intent (set when "earlier"/"later" with no new day)
  //   3. context.lastAnchorDateKey
  let resolvedAnchor: string | null = null;
  // True when the user named a specific day but no slots exist for it. We
  // synthesize the anchor so the tiered fallback messaging fires properly
  // ("I don't see anything on May 18, but here are the closest openings").
  // Without this, an unresolvable dayOfMonth would silently broaden to all
  // slots — a violation of the brief: "If user names a specific date, only
  // show that date or clearly explain that date has no availability."
  let anchorIsSynthetic = false;
  // True when the user named a weekday Shen doesn't normally work
  // (Sun/Mon in this prototype). Drives a different ack: "Shen doesn't
  // usually take appointments on Sundays."
  let nonWorkingDay = false;
  if (timeHints.days.length > 0) {
    const dayName = timeHints.days[0];
    if (
      dayName !== "Sun" &&
      dayName !== "Mon" &&
      dayName !== "Tue" &&
      dayName !== "Wed" &&
      dayName !== "Thu" &&
      dayName !== "Fri" &&
      dayName !== "Sat"
    ) {
      // unreachable — TimeHints["days"] is constrained
    } else if (!WORKING_DAYS.includes(dayName as typeof WORKING_DAYS[number])) {
      nonWorkingDay = true;
    }
  }
  if (timeHints.dateKey) {
    resolvedAnchor = timeHints.dateKey;
  } else if (timeHints.dayOfMonth !== null) {
    const match = allSlots.find((s) => s.dayOfMonth === timeHints.dayOfMonth);
    if (match) {
      resolvedAnchor = match.dateKey;
    } else {
      // Synthesize the anchor in the demo month (May 2026) so fallback fires
      const dd = timeHints.dayOfMonth.toString().padStart(2, "0");
      resolvedAnchor = `2026-05-${dd}`;
      anchorIsSynthetic = true;
    }
  } else if (timeHints.days.length > 0) {
    const dayName = timeHints.days[0];
    const match = allSlots.find((s) => s.dayLabel === dayName);
    if (match) {
      resolvedAnchor = match.dateKey;
    } else {
      // No slots on the requested day for this service. Synthesize an
      // anchor at the next upcoming occurrence of this weekday so the
      // ack copy can say "Looking at Thursday — I don't see openings"
      // instead of generic "the next openings".
      // Day name → JS dayIndex (0=Sun..6=Sat).
      const dayIdx: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const targetIdx = dayIdx[dayName];
      if (targetIdx !== undefined) {
        // MOCK_TODAY is Sun May 3, 2026 (dayIdx=0). Walk forward.
        const todayIdx = 0; // MOCK_TODAY.dayLabel === "Sun"
        let offset = targetIdx - todayIdx;
        if (offset <= 0) offset += 7;
        const targetDay = 3 + offset; // 3 = MOCK_TODAY.dayOfMonth
        resolvedAnchor = `2026-05-${targetDay.toString().padStart(2, "0")}`;
        anchorIsSynthetic = true;
      } else {
        resolvedAnchor = null;
      }
    }
  } else {
    resolvedAnchor = anchorDateKey ?? context.lastAnchorDateKey;
  }

  let scoped = allSlots;
  if (resolvedAnchor) {
    scoped = allSlots.filter((s) => s.dateKey === resolvedAnchor);
  }

  let result: TimeSlot[] = scoped;
  let outcome: RefinementOutcome["outcome"] = "found";

  // Pivot hour for "earlier"/"later"
  let pivotHour: number | null = null;
  const lastOnAnchor = context.lastShownSlots.filter(
    (s) => s.dateKey === resolvedAnchor
  );
  if (lastOnAnchor.length > 0) {
    pivotHour =
      relation === "earlier"
        ? Math.min(...lastOnAnchor.map((s) => s.hour24))
        : relation === "later"
        ? Math.max(...lastOnAnchor.map((s) => s.hour24))
        : null;
  }

  if (relation === "earlier" && pivotHour !== null) {
    result = scoped.filter((s) => s.hour24 < pivotHour);
  } else if (relation === "later" && pivotHour !== null) {
    result = scoped.filter((s) => s.hour24 > pivotHour);
  } else if (relation === "around" && timeHints.hour24 !== null) {
    const tol = timeHints.timeFlexibility === "approximate" ? 2 : 1;
    result = scoped.filter(
      (s) => Math.abs(s.hour24 - timeHints.hour24!) <= tol
    );
  } else if (relation === "more") {
    // "more times" / "yes" / "show more" — surface slots NOT yet shown to the
    // user so they don't see a repeat of what they already saw. If a specific
    // anchor day was set, stay on that day; otherwise broaden to all slots.
    const shownIds = new Set(context.lastShownSlots.map((s) => s.id));
    const pool = resolvedAnchor ? scoped : allSlots;
    result = pool.filter((s) => !shownIds.has(s.id));
  }

  // Period filter on top
  if (timeHints.period) result = result.filter(periodMatch(timeHints.period));

  // Specific hour filter (asked "at 5pm" — exact)
  if (timeHints.hour24 !== null && relation !== "around") {
    const tol = timeHints.timeFlexibility === "approximate" ? 1.5 : 0.25;
    const within = result.filter(
      (s) => Math.abs(s.hour24 - timeHints.hour24!) <= tol
    );
    if (within.length > 0) {
      result = within;
    } else {
      // No exact match — return nearest few, flag as fuzzy
      result = [...result]
        .sort(
          (a, b) =>
            Math.abs(a.hour24 - timeHints.hour24!) -
            Math.abs(b.hour24 - timeHints.hour24!)
        )
        .slice(0, 3);
      if (result.length > 0) outcome = "fuzzy";
    }
  }

  // Tiered fallback hierarchy. The brief: explanation must precede fallback.
  // Walk: (1) anchor day → (2) next day with slots → (3) same week → (4) next
  // week. Track which tier we landed at so the page can describe it.
  let fallbackTier: RefinementOutcome["fallbackTier"] = null;

  if (result.length === 0 && resolvedAnchor) {
    const isDirectional = relation === "earlier" || relation === "later";
    // Tier 1: same anchor day, drop the relation/hour filters
    // Skip when the user's relation was directional and we'd be showing them
    // the opposite direction's slots (e.g. they asked "later" — don't return
    // earlier slots dressed up as "what's still open that day").
    if (scoped.length > 0 && !isDirectional) {
      result = scoped;
      fallbackTier = "same-day";
      outcome = "fell-through";
    }
    // Tier 2: next day with slots after the anchor
    if (result.length === 0) {
      const laterSlots = allSlots
        .filter((s) => s.dateKey > resolvedAnchor)
        .sort(
          (a, b) =>
            a.dateKey.localeCompare(b.dateKey) || a.hour24 - b.hour24
        );
      if (laterSlots.length > 0) {
        const nextDayKey = laterSlots[0].dateKey;
        result = laterSlots.filter((s) => s.dateKey === nextDayKey);
        fallbackTier = "next-day";
        outcome = "fell-through";
      }
    }
    // Tier 3: same week as anchor
    if (result.length === 0) {
      const anchorShift = deriveWeekShiftFromKey(resolvedAnchor);
      if (anchorShift !== null) {
        const range = getWeekRange(anchorShift);
        const weekSlots = allSlots.filter(
          (s) =>
            s.dateKey >= range.startDateKey && s.dateKey <= range.endDateKey
        );
        if (weekSlots.length > 0) {
          result = weekSlots;
          fallbackTier = "this-week";
          outcome = "fell-through";
        }
      }
    }
    // Tier 4: a week AFTER the anchor's week that has slots. Critically, we
    // must start the search from anchorShift+1 — iterating from shift=1
    // would incorrectly surface weeks that are *before* the anchor date.
    if (result.length === 0) {
      const anchorShift4 = deriveWeekShiftFromKey(resolvedAnchor);
      // If the anchor isn't in any known week, start from shift 0 (safest
      // fallback — all weeks are candidate if the anchor is unrecognised).
      const startShift = anchorShift4 !== null ? anchorShift4 + 1 : 0;
      for (let shift = startShift; shift <= 4; shift++) {
        const range = getWeekRange(shift);
        if (range.startDateKey > MOCK_AVAILABILITY_HORIZON.dateKey) break;
        const weekSlots = allSlots.filter(
          (s) =>
            s.dateKey >= range.startDateKey && s.dateKey <= range.endDateKey
        );
        if (weekSlots.length > 0) {
          result = weekSlots;
          fallbackTier = "next-week";
          outcome = "fell-through";
          break;
        }
      }
    }

    // Tier 5 (last resort): no slots exist on or after the anchor at all.
    // Show the closest slots that ARE available (which will be before the
    // anchor) so the user has something to work with. The "before-anchor"
    // tier flag drives copy that is honest about what happened.
    if (result.length === 0) {
      const earlier = sortChrono(allSlots).filter(
        (s) => s.dateKey < resolvedAnchor!
      );
      if (earlier.length > 0) {
        // Show the slots closest to the anchor (the last N in sorted order)
        result = earlier.slice(-4);
        fallbackTier = "before-anchor";
        outcome = "fell-through";
      }
    }
  } else if (result.length === 0 && !resolvedAnchor) {
    // No anchor — just show the next slots we have
    result = allSlots.slice(0, 3);
    outcome = "fell-through";
  }

  result = sortChrono(result);

  // Build scope label for copy. Prefer the slot's own labels when they exist;
  // fall back to computing labels from the dateKey (synthetic anchors —
  // user named a day with no availability).
  const anchorMeta = resolvedAnchor
    ? allSlots.find((s) => s.dateKey === resolvedAnchor)
    : null;
  let scopeLabel: string;
  if (anchorMeta) {
    scopeLabel = `${anchorMeta.dayLabel} ${anchorMeta.dateLabel}`;
  } else if (resolvedAnchor) {
    scopeLabel = formatLabelsFromDateKey(resolvedAnchor);
  } else {
    scopeLabel = "the next openings";
  }

  return {
    slots: result,
    scope: resolvedAnchor ? "anchor-day" : "all",
    scopeLabel,
    outcome,
    askedExactHour,
    anchorDateKey: resolvedAnchor,
    fallbackTier,
    nonWorkingDay,
  };
}

/**
 * Build a human label like "Mon May 18" from a dateKey "2026-05-18".
 * Used when the user named a date with no availability — we still want to
 * say "I don't see anything on Mon May 18" with the proper day-of-week.
 */
function formatLabelsFromDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map((s) => parseInt(s, 10));
  // JS Date months are 0-indexed; we use UTC noon to avoid TZ edge cases.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const dayLabel = dt.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  const dateLabel = dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${dayLabel} ${dateLabel}`;
}

/**
 * Helper for the day-scoped fallback walk. Same logic as deriveWeekShift
 * in the page but copied here to avoid a circular import.
 */
function deriveWeekShiftFromKey(dateKey: string): number | null {
  const ranges = [
    { start: "2026-05-04", end: "2026-05-10", shift: 0 },
    { start: "2026-05-11", end: "2026-05-17", shift: 1 },
    { start: "2026-05-18", end: "2026-05-24", shift: 2 },
  ];
  for (const r of ranges) {
    if (dateKey >= r.start && dateKey <= r.end) return r.shift;
  }
  return null;
}

function periodMatch(period: Period) {
  return (s: TimeSlot) => {
    if (period === "morning") return s.hour24 < 12;
    if (period === "afternoon") return s.hour24 >= 12 && s.hour24 < 17;
    if (period === "evening") return s.hour24 >= 17;
    return true;
  };
}

function sortChrono(slots: TimeSlot[]): TimeSlot[] {
  return [...slots].sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.hour24 - b.hour24
  );
}

/**
 * Get a forward-looking date-range result for chip-driven navigation
 * ("This week / Next week / Week after"). Same shape as
 * filterSlotsByRefinement so the page can render uniformly.
 */
export function getSlotsForWeekShift(
  allSlots: TimeSlot[],
  weekShift: number
): RefinementOutcome {
  const range = getWeekRange(weekShift);
  if (range.startDateKey > MOCK_AVAILABILITY_HORIZON.dateKey) {
    return {
      slots: [],
      scope: "week",
      scopeLabel: range.label,
      outcome: "past-horizon",
      askedExactHour: null,
      anchorDateKey: null,
      fallbackTier: null,
    };
  }
  const weekSlots = sortChrono(
    allSlots.filter(
      (s) => s.dateKey >= range.startDateKey && s.dateKey <= range.endDateKey
    )
  );
  return {
    slots: weekSlots,
    scope: "week",
    scopeLabel: range.label,
    outcome: weekSlots.length > 0 ? "found" : "fell-through",
    askedExactHour: null,
    anchorDateKey: null,
    fallbackTier: null,
  };
}

/* -------------------------------------------------------------------------- */
/* findSlotByMention                                                           */
/* -------------------------------------------------------------------------- */

export function findSlotByMention(
  intent: Extract<Intent, { kind: "select_slot" }>,
  context: AssistantContext
): { slot: TimeSlot | null; ambiguous: TimeSlot[] | null } {
  const candidates = context.lastShownSlots;
  if (candidates.length === 0) return { slot: null, ambiguous: null };

  // Ordinal first
  if (intent.ordinal !== null) {
    const idx = intent.ordinal - 1;
    if (idx >= 0 && idx < candidates.length)
      return { slot: candidates[idx], ambiguous: null };
    return { slot: null, ambiguous: null };
  }

  // Time-based — filter by hour, then by day if given, then disambiguate via anchor
  let pool = candidates;

  if (intent.hour24 !== null) {
    pool = pool.filter((s) => Math.abs(s.hour24 - intent.hour24!) <= 0.25);
  }
  if (intent.dayOfMonth !== null) {
    pool = pool.filter((s) => s.dayOfMonth === intent.dayOfMonth);
  }
  if (intent.dateKey) {
    pool = pool.filter((s) => s.dateKey === intent.dateKey);
  }

  if (pool.length === 0) return { slot: null, ambiguous: null };
  if (pool.length === 1) return { slot: pool[0], ambiguous: null };

  // Multiple matches — try to disambiguate via lastAnchorDateKey
  if (context.lastAnchorDateKey) {
    const anchored = pool.filter(
      (s) => s.dateKey === context.lastAnchorDateKey
    );
    if (anchored.length === 1) return { slot: anchored[0], ambiguous: null };
  }

  return { slot: null, ambiguous: pool };
}

/* -------------------------------------------------------------------------- */
/* Convenience                                                                 */
/* -------------------------------------------------------------------------- */

export function intentToCategory(intent: Intent): ServiceCategory | null {
  if (intent.kind !== "book" && intent.kind !== "switch_service") return null;
  if (intent.tags.includes("Haircut")) return "Haircut";
  if (intent.tags.includes("Color")) return "Color";
  if (intent.tags.includes("Perm")) return "Perm";
  if (intent.tags.includes("Treatment")) return "Treatment";
  return null;
}

// Re-export so the page can call this when it switches the service mid-chat
export { getSlotsForService };
