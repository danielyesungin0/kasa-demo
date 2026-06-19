import type { Service, ServiceCategory } from "@/lib/types";

/**
 * "Bare category browse" detection — the guard against pre-picking a single
 * service (or asking abstract button-clarifiers) when the client only named a
 * CATEGORY ("perm", "treatment", "color", "haircut") with no specifying
 * detail. In that case we SHOW the category's services as cards and ask — one
 * consistent pattern for every category.
 *
 * Pure + category-agnostic so it can be unit-tested. The caller (chat client)
 * supplies the catalog and renders; this answers "is this a bare multi-service
 * category browse, and which services would we show?".
 */

export type CategoryBrowseInput = {
  /** Raw user text — used to detect a bare category word like "treatment". */
  rawText: string;
  /** Real service categories the parser tagged (excluding "Consultation"). */
  tags: string[];
  /** Truthy if the parser pinned a specific SKU / specifying detail. */
  comboServiceId?: string | null;
  lengthHint?: string | null;
  permStyle?: string | null;
  colorDirection?: string | null;
};

/** Category words → catalog category. Bare mentions of these = browse. */
const CATEGORY_WORDS: { re: RegExp; category: ServiceCategory }[] = [
  { re: /\b(perm|perms)\b/, category: "Perm" },
  { re: /\b(treatment|treatments|treat)\b/, category: "Treatment" },
  { re: /\b(colou?r|colou?rs|dye|highlights?)\b/, category: "Color" },
  { re: /\b(haircut|haircuts|hair\s*cut|cut|trim)\b/, category: "Haircut" },
  { re: /\b(manicure|mani|nails?)\b/, category: "Manicure" },
  { re: /\b(pedicure|pedi)\b/, category: "Pedicure" },
];

/** Short noun words that, by themselves, are just a category mention. */
function isBareCategoryPhrase(rawText: string): boolean {
  // "treatment", "a perm", "any colors?", "haircut please" — short, no
  // specifics. Strip filler; if what remains is just a category word, it's bare.
  const stripped = rawText
    .toLowerCase()
    .replace(/[?.!,]/g, " ")
    .replace(/\b(a|an|the|some|any|get|want|book|need|do|you|offer|please|i|i'd|like|to|for|me|hi|hey|hello)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Bare if 1–2 leftover words (e.g. "treatment", "hair cut").
  return stripped.length > 0 && stripped.split(" ").length <= 2;
}

/**
 * Detect a bare category word in the message ("treatment", "perm", "color").
 * Returns the category, or null. Used as a fallback when the parser tagged
 * nothing (low confidence) but the message is clearly just a category.
 */
export function detectBareCategory(rawText: string): ServiceCategory | null {
  if (!isBareCategoryPhrase(rawText)) return null;
  const t = ` ${rawText.toLowerCase()} `;
  for (const { re, category } of CATEGORY_WORDS) {
    if (re.test(t)) return category;
  }
  return null;
}

/** Bookable (non-hidden) services in a category, popular first. */
export function bookableInCategory(
  category: ServiceCategory,
  catalog: Service[]
): Service[] {
  return catalog
    .filter((s) => s.category === category && s.status !== "hidden")
    .sort((a, b) => {
      const ra = (a as Service & { popularRank?: number }).popularRank ?? 99;
      const rb = (b as Service & { popularRank?: number }).popularRank ?? 99;
      return ra - rb;
    });
}

/**
 * Returns the bookable services to show as a chooser, or null when this is NOT
 * a bare multi-service category browse (caller falls through to its normal
 * single-service recommendation).
 *
 * Two ways to qualify:
 *   1. The parser tagged exactly one category with no specifics, OR
 *   2. The message is a bare category word the parser didn't tag (low conf).
 */
export function categoryBrowseOptions(
  input: CategoryBrowseInput,
  catalog: Service[]
): Service[] | null {
  // A pinned SKU or any specifying detail means they were specific — book it.
  if (input.comboServiceId) return null;
  if (input.lengthHint || input.permStyle || input.colorDirection) return null;

  const realTags = input.tags.filter((t) => t !== "Consultation");

  let category: ServiceCategory | null = null;
  if (realTags.length === 1) {
    category = realTags[0] as ServiceCategory;
  } else if (realTags.length === 0) {
    // Parser tagged nothing — fall back to a bare-category-word match.
    category = detectBareCategory(input.rawText);
  } else {
    // Multiple categories = a real multi-service request, not a browse.
    return null;
  }
  if (!category) return null;

  const options = bookableInCategory(category, catalog);
  // Only worth a chooser when there's a genuine choice.
  return options.length >= 2 ? options : null;
}
