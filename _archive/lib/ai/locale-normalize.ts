/**
 * Locale-agnostic normalization for internal booking enums.
 *
 * The AI may reply in the user's language, but the booking flow's internal
 * fields must always be English app-safe values. Some models leak the user's
 * language into structured fields (e.g. dayOfWeek:"화요일") or drop a field that
 * was present in the raw phrase. This layer:
 *   1. normalizes a dayOfWeek / partOfDay value to the English enum, and
 *   2. recovers from `raw` text when the structured field is missing/malformed.
 *
 * Tier-1 languages only: English, Korean, Simplified Chinese.
 */

export type EnglishDay =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type PartOfDay = "morning" | "afternoon" | "evening";

// ── Day lookups ────────────────────────────────────────────────────────────
// Keyed by lowercased token. Korean and Chinese forms map straight to the
// English enum. Chinese includes 星期/周/礼拜 prefixes and the 日/天 Sunday forms.
const DAY_ALIASES: Record<string, EnglishDay> = {
  // English
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
  mon: "Monday", tue: "Tuesday", tues: "Tuesday", wed: "Wednesday",
  thu: "Thursday", thur: "Thursday", thurs: "Thursday", fri: "Friday",
  sat: "Saturday", sun: "Sunday",

  // Korean — full (월요일) and short (월)
  "월요일": "Monday", "월": "Monday",
  "화요일": "Tuesday", "화": "Tuesday",
  "수요일": "Wednesday", "수": "Wednesday",
  "목요일": "Thursday", "목": "Thursday",
  "금요일": "Friday", "금": "Friday",
  "토요일": "Saturday", "토": "Saturday",
  "일요일": "Sunday", "일": "Sunday",

  // Simplified Chinese — 星期X / 周X / 礼拜X, plus Sunday's 日/天 variants
  "星期一": "Monday", "周一": "Monday", "礼拜一": "Monday",
  "星期二": "Tuesday", "周二": "Tuesday", "礼拜二": "Tuesday",
  "星期三": "Wednesday", "周三": "Wednesday", "礼拜三": "Wednesday",
  "星期四": "Thursday", "周四": "Thursday", "礼拜四": "Thursday",
  "星期五": "Friday", "周五": "Friday", "礼拜五": "Friday",
  "星期六": "Saturday", "周六": "Saturday", "礼拜六": "Saturday",
  "星期日": "Sunday", "星期天": "Sunday", "周日": "Sunday",
  "周天": "Sunday", "礼拜日": "Sunday", "礼拜天": "Sunday",
};

// ── Part-of-day lookups ────────────────────────────────────────────────────
const PART_ALIASES: Record<string, PartOfDay> = {
  // English
  morning: "morning", afternoon: "afternoon", evening: "evening", night: "evening",
  // Korean
  "오전": "morning", "오후": "afternoon", "저녁": "evening", "밤": "evening",
  // Simplified Chinese
  "上午": "morning", "早上": "morning", "凌晨": "morning",
  "中午": "afternoon", "下午": "afternoon",
  "晚上": "evening", "夜里": "evening", "夜晚": "evening",
};

// For raw-text scanning we try longer tokens first so "星期二" matches before "二"
// would, and "화요일" before "화". Ordered longest-first.
const DAY_TOKENS_BY_LEN = Object.keys(DAY_ALIASES).sort((a, b) => b.length - a.length);
const PART_TOKENS_BY_LEN = Object.keys(PART_ALIASES).sort((a, b) => b.length - a.length);

/**
 * Normalize a dayOfWeek value (any Tier-1 language) to the English enum, or
 * null if unrecognized. Accepts the exact field value the model returned.
 */
export function normalizeDayOfWeek(value: string | null | undefined): EnglishDay | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  return DAY_ALIASES[key] ?? DAY_ALIASES[value.trim()] ?? null;
}

/** Normalize a partOfDay value to the English enum, or null if unrecognized. */
export function normalizePartOfDay(value: string | null | undefined): PartOfDay | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  return PART_ALIASES[key] ?? PART_ALIASES[value.trim()] ?? null;
}

/**
 * Recover a day from free `raw` text (e.g. "다음주 화요일 오후", "下周二下午") when
 * the structured field was missing or unrecognized. Substring match, longest
 * token first, so "星期二"/"화요일" win over their single-char forms.
 */
export function recoverDayFromRaw(raw: string | null | undefined): EnglishDay | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const token of DAY_TOKENS_BY_LEN) {
    // English tokens are ASCII → match on the lowercased copy. CJK tokens are
    // case-invariant → match on the original. Try both safely.
    if (lower.includes(token) || raw.includes(token)) return DAY_ALIASES[token];
  }
  return null;
}

/** Recover a part-of-day from free `raw` text when the field was missing. */
export function recoverPartOfDayFromRaw(raw: string | null | undefined): PartOfDay | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const token of PART_TOKENS_BY_LEN) {
    if (lower.includes(token) || raw.includes(token)) return PART_ALIASES[token];
  }
  return null;
}

/**
 * Detect "next week" intent from raw text across Tier-1 languages, for when the
 * model used type="specific_day" but the phrase clearly meant next week.
 *   en: "next week"   ko: "다음주" / "담주"   zh: "下周" / "下星期" / "下礼拜"
 */
export function rawMeansNextWeek(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return (
    /next\s+week/.test(lower) ||
    raw.includes("다음주") ||
    raw.includes("담주") ||
    raw.includes("下周") ||
    raw.includes("下星期") ||
    raw.includes("下礼拜")
  );
}

/**
 * One-shot resolver: given the model's (possibly malformed) dayOfWeek/partOfDay
 * and the raw phrase, return the best English-enum values. Field value wins;
 * raw is the fallback. This is the function the client calls.
 */
export function normalizeTimePreferenceLocale(input: {
  dayOfWeek: string | null;
  partOfDay: string | null;
  raw: string | null;
}): { dayOfWeek: EnglishDay | null; partOfDay: PartOfDay | null; nextWeek: boolean } {
  const dayOfWeek =
    normalizeDayOfWeek(input.dayOfWeek) ?? recoverDayFromRaw(input.raw);
  const partOfDay =
    normalizePartOfDay(input.partOfDay) ?? recoverPartOfDayFromRaw(input.raw);
  return { dayOfWeek, partOfDay, nextWeek: rawMeansNextWeek(input.raw) };
}
