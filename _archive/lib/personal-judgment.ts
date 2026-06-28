/**
 * Deterministic "personal professional judgment" detector.
 *
 * Consultation-first principle: ANSWER FIRST, recommend second, ESCALATE LAST.
 * Escalation should be RARE — only when the client is genuinely asking for a
 * decision that is the stylist's to make about THIS person's hair:
 *
 *   - personalized feasibility ("will this work on MY hair?")
 *   - safety ("will bleach damage my hair?", "is it safe after a perm?")
 *   - guarantees ("can you guarantee…", "are you sure it'll…")
 *   - one-session / transformation promises ("platinum in one session?",
 *     "from this to this in one appointment?")
 *
 * Everything else — service differences, durations, prices, what's offered,
 * "what do people usually book", "which is closest" — the assistant ANSWERS.
 * Uncertainty is NOT a reason to escalate; it's a reason to hedge inside the
 * answer.
 *
 * This is the narrow, deterministic replacement for the old "when unsure →
 * handoff" behavior. It runs in the chat route as a safety net that fires
 * regardless of what the model returned, mirroring detectUnsupportedService.
 *
 * False positives are costly here (an unnecessary handoff is exactly what the
 * consultation-first vision is trying to eliminate), so the patterns require
 * the personal/safety/guarantee SHAPE — not merely a sensitive word.
 *
 * Returns a short label describing why it escalated, or null.
 */

const JUDGMENT_PATTERNS: { re: RegExp; label: string }[] = [
  // ── Personalized feasibility: judgment about THIS person's hair/result ────
  // Require a first-person / "this person" possessive near a feasibility verb
  // so generic "will this last" (answerable) doesn't trip it.
  {
    re: /\b(will|would|can|could)\b[^.?!]*\b(work|look good|suit|turn out|hold|last)\b[^.?!]*\b(on|for|with)\s+(my|me|mine)\b/,
    label: "personal feasibility (will it work on my hair)",
  },
  {
    re: /\b(work|good|right|suitable|possible)\b[^.?!]*\b(for|on)\s+(my|me)\b[^.?!]*\b(hair|face|skin|head|curls|texture)\b/,
    label: "personal feasibility (suits my hair)",
  },
  {
    re: /\b(can|could|will|would)\s+you\b[^.?!]*\b(do|achieve|get|pull off|make)\b[^.?!]*\b(this|that|it)\b[^.?!]*\b(on|to|for)\s+(my|me)\b/,
    label: "personal feasibility (can you do this on me)",
  },
  {
    re: /\bis\s+my\s+hair\b[^.?!]*\b(long enough|healthy enough|thick enough|too (short|damaged|fine|thin)|able to|ready)\b/,
    label: "personal feasibility (is my hair able to)",
  },

  // ── Safety / damage / chemical history ───────────────────────────────────
  {
    re: /\b(is|will|would|could|can)\b[^.?!]*\b(it|this|that|bleach|color|colour|perm|relaxer|treatment)\b[^.?!]*\b(safe|damage|damaging|ruin|fry|break|harm|hurt)\b/,
    label: "safety / damage concern",
  },
  {
    re: /\b(safe|okay|ok|alright|fine|risky|dangerous)\b[^.?!]*\b(after|since|because)\b[^.?!]*\b(perm|relaxer|keratin|bleach|color|colour|chemical|treatment|dye|box dye)\b/,
    label: "safety after chemical history",
  },
  {
    re: /\b(recently|just)\b[^.?!]*\b(permed|relaxed|bleached|colored|coloured|dyed|chemically (treated|straightened)|keratin)\b/,
    label: "recent chemical history (safety)",
  },
  {
    re: /\bchemically\s+(treated|straightened|processed)\b/,
    label: "chemical history (safety)",
  },

  // ── One-session / transformation guarantees ──────────────────────────────
  {
    re: /\bin\s+(one|a single|1)\s+(session|sitting|appointment|visit|go|day)\b/,
    label: "one-session transformation",
  },
  {
    re: /\b(go|get)\b[^.?!]*\b(platinum|blonde?|white|silver|grey|gray|red|black)\b[^.?!]*\b(in\s+(one|a|1)\b|today|same day|right away)/,
    label: "drastic color in one session",
  },
  {
    re: /\bfrom\s+(this|here|my current|brown|black|dark|red)\b[^.?!]*\bto\s+(this|that|platinum|blonde?|white|silver)\b/,
    label: "this-to-that transformation",
  },

  // ── Explicit guarantees ──────────────────────────────────────────────────
  {
    re: /\b(can|will)\s+you\s+guarantee\b|\bguarantee(d)?\b[^.?!]*\b(it|this|result|look|won'?t|outcome)\b/,
    label: "guarantee request",
  },
  {
    re: /\bare\s+you\s+(100%\s+)?(sure|certain|positive)\b[^.?!]*\b(it'?ll|it will|this will|i'?ll|i will|i can)\b/,
    label: "certainty / promise request",
  },
];

/**
 * Detect whether a message is asking for personalized professional judgment,
 * safety, a guarantee, or a one-session transformation promise — i.e. the
 * NARROW set of things the assistant should defer to the stylist on.
 *
 * Returns a short label (used for the handoff summary) or null.
 */
export function looksLikePersonalJudgment(message: string): string | null {
  const t = ` ${message.toLowerCase().replace(/\s+/g, " ")} `;
  for (const { re, label } of JUDGMENT_PATTERNS) {
    if (re.test(t)) return label;
  }
  return null;
}
