/**
 * Deterministic intent detection via reusable pattern groups.
 *
 * Each IntentPattern is self-contained: it declares the regex patterns that
 * trigger it, an optional negation set, and a priority. The detector runs
 * all patterns in priority order and returns the first match.
 *
 * Adding a new intent or adjusting phrasing is a one-line change in the
 * PATTERNS array — no giant if/else chain to navigate.
 */

export type IntentKind =
  | "book"
  | "add_service"
  | "switch_service"
  | "remove_service"
  | "ask_availability"
  | "choose_slot"
  | "change_time"
  | "change_date"
  | "reschedule"
  | "cancel"
  | "confirm"
  | "reject"
  | "unclear";

export type ColorDirection = "root" | "lighter" | "darker" | null;
export type LengthHint = "short" | "long" | null;
export type PermStyle = "down" | "digital" | "straightening" | null;

export type IntentModifiers = {
  colorDirection: ColorDirection;
  lengthHint: LengthHint;
  permStyle: PermStyle;
  isJustOne: boolean; // "just a cut" → strip add-ons
};

type IntentPattern = {
  id: string;
  patterns: RegExp[];
  intent: IntentKind;
  priority: number; // higher = tested first
  /** If any of these match, this pattern is suppressed */
  negateIf?: RegExp[];
};

/* -------------------------------------------------------------------------- */
/* Pattern registry                                                            */
/* -------------------------------------------------------------------------- */

const PATTERNS: IntentPattern[] = [
  // ── Manage existing appointments ──────────────────────────────────────────
  {
    id: "cancel",
    priority: 110,
    intent: "cancel",
    patterns: [
      /\bcancel\b/i,
      /\bcan'?t\s+make\s+it\b/i,
      /\bdon'?t\s+want\s+(it|the\s+appointment)\b/i,
      /\bneed\s+to\s+cancel\b/i,
      /\bcancellation\b/i,
    ],
  },
  {
    id: "reschedule",
    priority: 105,
    intent: "reschedule",
    patterns: [
      /\breschedule\b/i,
      /\bmove\s+(my\s+)?appointment\b/i,
      /\bchange\s+my\s+appointment\b/i,
      /\bcan'?t\s+make\s+it.*can\s+(we|you)\b/i,
      /\bneed\s+a\s+different\s+(time|day|date)\b/i,
    ],
  },

  // ── Explicit yes / no ─────────────────────────────────────────────────────
  {
    id: "confirm",
    priority: 90,
    intent: "confirm",
    patterns: [
      /^(yes|yeah|yep|yup|sure|ok|okay|great|perfect|sounds\s+good|let'?s\s+(do|go|book|check)|do\s+it|book\s+it|i'?m\s+in|go\s+ahead|proceed|please|absolutely)\.?$/i,
      /\bconfirm\b/i,
      /\bbook\s+(it|this|that)\b/i,
      /\bthat\s+(works?|sounds?\s+good)\b/i,
    ],
  },
  {
    id: "reject",
    priority: 90,
    intent: "reject",
    patterns: [
      /^(no|nope|nah|not\s+(really|sure)|never\s+mind|nevermind|actually\s+no|that'?s\s+ok)\.?$/i,
      /\bdon'?t\s+(want|book|need)\s+(it|this|that)\b/i,
      /\bthat'?s\s+(not|too)\b/i,
      /\bdoesn'?t\s+work\b/i,
      /\bwon'?t\s+work\b/i,
      /\bcan'?t\s+(do|make)\s+(it|that)\b/i,
      /\bpass\b/i,
    ],
  },

  // ── Service-change intents ─────────────────────────────────────────────────
  {
    id: "switch_service",
    priority: 85,
    intent: "switch_service",
    patterns: [
      /\bactually\b/i,
      /\binstead\b/i,
      /\bchange\s+(it\s+)?to\b/i,
      /\bswitch\s+(to|it)\b/i,
      /\brather\s+(have|get|do|go\s+with)\b/i,
      /\bmake\s+it\b/i,
      /\bforget\s+(the|that|about)\b/i,
      /\bnot\s+\w+[,;]\s*\w+\b/i, // "not color, haircut"
    ],
  },
  {
    id: "add_service",
    priority: 80,
    intent: "add_service",
    patterns: [
      /\b(also|as\s+well|on\s+top|in\s+addition)\b/i,
      /\bcan\s+i\s+(also|add)\b/i,
      /\badd\s+(a|an|the|on)?\b/i,
      /\bwhile\s+i'?m\s+(at\s+it|there)\b/i,
      /\band\s+also\b/i,
    ],
    // "too" and "and a/an" alone are too noisy — kept out intentionally
  },
  {
    id: "remove_service",
    priority: 86,
    intent: "remove_service",
    patterns: [
      /\bremove\s+the\b/i,
      /\bdrop\s+the\b/i,
      /\bskip\s+the\b/i,
      /\bno\s+(haircut|cut|color|colour|perm|treatment|nails|manicure|pedicure|gel)\b/i,
      /\bwithout\s+(the\s+)?(haircut|cut|color|colour|perm|nails|polish)\b/i,
    ],
    /** Booking a removal service ("remove my acrylics") is a book intent, not remove_service */
    negateIf: [/\bremove\s+my\b/i, /\bi\s+need\s+to\s+remove\b/i, /\bi\s+want\s+to\s+remove\b/i],
  },

  // ── Availability / timing ─────────────────────────────────────────────────
  {
    id: "ask_availability",
    priority: 70,
    intent: "ask_availability",
    patterns: [
      /\bdo\s+you\s+have\b/i,
      /\bany\s+(openings?|availability|slots?|times?|appointments?)\b/i,
      /\bare\s+you\s+(available|open|free)\b/i,
      /\bwhat\s+(times?|days?|slots?|openings?)\b/i,
      /\bwhen\s+(are\s+you|can\s+i|is\s+\w+\s+available)\b/i,
      /\bshow\s+me\s+(times?|slots?|availability)\b/i,
      /\bfind\s+(me\s+)?(times?|slots?|availability)\b/i,
    ],
    /** Requesting a specific date range is change_date, not ask_availability */
    negateIf: [/\bnext\s+week\b/i, /\bdifferent\s+day\b/i, /\banother\s+day\b/i],
  },
  {
    id: "choose_slot",
    priority: 68,
    intent: "choose_slot",
    patterns: [
      /\b(i'?ll\s+take|i'?ll\s+do|let'?s\s+do|take|choose|pick|reserve|select)\s+(the\s+)?\d/i,
      /\b(first|second|third|fourth|that|this)\s+one\b/i,
      /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i,
      /\b(book|take)\s+(the\s+)?\d{1,2}(:\d{2})?\s*(am|pm)?\b/i,
    ],
  },
  {
    id: "change_time",
    priority: 65,
    intent: "change_time",
    patterns: [
      /\b(earlier|later|sooner|earlier\s+in\s+the\s+day)\b/i,
      /\b(morning|afternoon|evening|night)\s+(time|slot|appointment)?\b/i,
      /\b(different|another)\s+time\b/i,
      /\b(show\s+me\s+more|more\s+times|other\s+(options?|times?|slots?))\b/i,
      /\b(something|anything)\s+(earlier|later)\b/i,
    ],
    negateIf: [/\bnext\s+week\b/i, /\bdifferent\s+day\b/i],
  },
  {
    id: "change_date",
    priority: 65,
    intent: "change_date",
    patterns: [
      /\bnext\s+week\b/i,
      /\b(different|another)\s+day\b/i,
      /\bwhat\s+about\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      /\bhow\s+about\s+(next|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
      /\bany\s+other\s+days?\b/i,
    ],
  },

  // ── Fresh booking (lowest explicit priority, beaten by everything above) ──
  {
    id: "book",
    priority: 40,
    intent: "book",
    patterns: [
      /\b(book|schedule|make|set\s+up)\s+(a|an|my)?\s*(appointment|booking|session)?\b/i,
      /\b(i\s+(?:just\s+)?want|i'?d\s+like|i\s+need|can\s+i\s+get|looking\s+for|i'?m\s+looking)\b/i,
      /\b(get|have|do)\s+(a|an|my)\s+\w+\b/i, // "get a cut", "do my nails"
      /\b(appointment|booking|session)\b/i,
      /\bjust\s+(need|want|a)\b/i,              // "just need a trim", "just want a mani"
      /\bneed\s+(a|an|to)\b/i,                  // "need a fill", "need to deal with"
      /\bcan\s+i\s+(come\s+in|get\s+in)\b/i,   // "can i come in"
      /\bplease\b/i,                             // "haircut please", "full color please"
    ],
  },

  // ── Catch-all ─────────────────────────────────────────────────────────────
  {
    id: "unclear",
    priority: 0,
    intent: "unclear",
    patterns: [/.*/], // always matches — final fallback
  },
];

/* -------------------------------------------------------------------------- */
/* Modifier extractors                                                         */
/* -------------------------------------------------------------------------- */

const COLOR_DIRECTION_PATTERNS: [RegExp, ColorDirection][] = [
  // Root / regrowth signals
  [/\b(full\s+color|full\s+colour|full\s+head|all[\s-]over|whole\s+hair|all\s+of\s+(my\s+)?hair)\b/i, "lighter"],
  [/\b(root|roots|root\s+color|root\s+touch[\s-]?up|root\s+colour|regrowth|grown\s+out|grow\s+out|outgrowth)\b/i, "root"],
  [/\b(lighter|blonde|blonder|highlight|highlights|balayage|bleach|bleached|bleaching)\b/i, "lighter"],
  [/\b(darker|deep|rich|brunette|going\s+dark)\b/i, "darker"],
];

const LENGTH_HINT_PATTERNS: [RegExp, LengthHint][] = [
  [/\b(short|barber|men'?s|buzz|pixie|crop|close)\b/i, "short"],
  [/\b(medium|long|shoulder|mid[\s-]?length|women'?s)\b/i, "long"],
];

const PERM_STYLE_PATTERNS: [RegExp, PermStyle][] = [
  [/\bdown\s+perm\b/i, "down"],
  [/\bdigital\s+perm\b/i, "digital"],
  [/\b(straighten|rebond|straight\s+perm)\b/i, "straightening"],
];

export function extractModifiers(text: string): IntentModifiers {
  let colorDirection: ColorDirection = null;
  for (const [re, dir] of COLOR_DIRECTION_PATTERNS) {
    if (re.test(text)) {
      colorDirection = dir;
      break;
    }
  }

  let lengthHint: LengthHint = null;
  for (const [re, hint] of LENGTH_HINT_PATTERNS) {
    if (re.test(text)) {
      lengthHint = hint;
      break;
    }
  }

  let permStyle: PermStyle = null;
  for (const [re, style] of PERM_STYLE_PATTERNS) {
    if (re.test(text)) {
      permStyle = style;
      break;
    }
  }

  const isJustOne =
    /\bjust\s+(a|one|the)\b/i.test(text) ||
    /\bonly\s+(a|one|the)\b/i.test(text);

  return { colorDirection, lengthHint, permStyle, isJustOne };
}

/* -------------------------------------------------------------------------- */
/* Public detector                                                             */
/* -------------------------------------------------------------------------- */

export type DetectedIntent = {
  kind: IntentKind;
  patternId: string;
  modifiers: IntentModifiers;
};

const SORTED_PATTERNS = [...PATTERNS].sort((a, b) => b.priority - a.priority);

export function detectIntent(text: string): DetectedIntent {
  const modifiers = extractModifiers(text);

  for (const group of SORTED_PATTERNS) {
    // Check negation first
    if (group.negateIf?.some((re) => re.test(text))) continue;
    // Check patterns
    if (group.patterns.some((re) => re.test(text))) {
      return { kind: group.intent, patternId: group.id, modifiers };
    }
  }

  return { kind: "unclear", patternId: "unclear", modifiers };
}
