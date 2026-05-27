/**
 * Catalog-driven service matching engine.
 *
 * Services declare their own keywords, aliases, and misspellings.
 * The engine scores every service against the user's text and returns
 * ranked matches with confidence values:
 *
 *   >= 0.85  high   → auto-select, proceed to slot search
 *   0.60-0.84  medium → show top 2-3 candidates, ask user to choose
 *   0.35-0.59  low    → show popular services, ask what they want
 *   < 0.35   none   → no service intent detected
 */

import type { Service } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Extended catalog types                                                      */
/* -------------------------------------------------------------------------- */

export type ServiceAlias = {
  phrase: string;
  weight: number; // 0–1; 1.0 = same certainty as exact name match
};

/**
 * CatalogEntry extends Service so it can be used anywhere Service is expected.
 * The extra fields drive NLU matching and recommendation routing without any
 * hardcoded service IDs anywhere in the engine.
 */
export type CatalogEntry = Service & {
  // Text matching
  keywords: string[]; // single words / short phrases that strongly imply this service
  aliases: ServiceAlias[]; // weighted multi-word patterns
  misspellings: string[]; // common typos, alternate spellings

  // Semantic metadata — replaces hardcoded if/else in recommendation logic.
  // A service declares which attribute values lead to recommending it.
  colorDirections?: ("root" | "lighter" | "darker")[]; // Color services
  lengthHints?: ("short" | "long")[]; // Haircut services
  permStyles?: ("down" | "digital" | "straightening" | "regular")[]; // Perm services

  // Used to build "popular services" fallback for low-confidence responses.
  popularRank?: number; // 1 = most popular, lower = shown first
};

export type ConfidenceLevel = "high" | "medium" | "low" | "none";

export type ServiceMatch = {
  entry: CatalogEntry;
  confidence: number; // 0–1
  level: ConfidenceLevel;
  matchedOn: string; // debug label: "keyword:roots", "alias:full color", "fuzzy:colr≈color"
};

export type CatalogMatchResult = {
  high: ServiceMatch[]; // confidence >= 0.85
  medium: ServiceMatch[]; // 0.60–0.84
  low: ServiceMatch[]; // 0.35–0.59
  all: ServiceMatch[]; // sorted by confidence desc
  topMatch: ServiceMatch | null;
};

/* -------------------------------------------------------------------------- */
/* Text normalization helpers                                                  */
/* -------------------------------------------------------------------------- */

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[b.length][a.length];
}

/* -------------------------------------------------------------------------- */
/* Core matcher                                                                */
/* -------------------------------------------------------------------------- */

function levelFromConfidence(c: number): ConfidenceLevel {
  if (c >= 0.85) return "high";
  if (c >= 0.60) return "medium";
  if (c >= 0.35) return "low";
  return "none";
}

/**
 * Match `text` against all entries in a CatalogEntry[].
 * Returns ranked matches sorted by confidence descending.
 *
 * Scoring tiers (first match wins per service, highest tier used):
 *   1.00  exact service name
 *   0.92  alias weight >= 0.9
 *   0.85  alias weight >= 0.8
 *   0.80  alias weight < 0.8
 *   0.75  keyword (specificity-weighted by keyword length)
 *   0.72  misspelling match
 *   0.65  fuzzy token match (Levenshtein distance 1)
 *   0.50  fuzzy token match (Levenshtein distance 2)
 */
export function matchCatalog(
  rawText: string,
  catalog: CatalogEntry[]
): CatalogMatchResult {
  const text = normalizeText(rawText);
  const tokens = tokenize(text);

  const rawMatches: ServiceMatch[] = [];

  for (const entry of catalog) {
    if (entry.status === "hidden") continue;

    let bestScore = 0;
    let bestMatchedOn = "";

    // Tier 1: Exact service name
    const normalName = normalizeText(entry.name);
    if (text.includes(normalName)) {
      bestScore = 1.0;
      bestMatchedOn = `name:${entry.name}`;
    }

    // Tier 2: Alias match
    for (const alias of entry.aliases) {
      const normalAlias = normalizeText(alias.phrase);
      if (text.includes(normalAlias)) {
        // Map alias weight into the 0.80–0.92 range
        const score = 0.80 + alias.weight * 0.12;
        if (score > bestScore) {
          bestScore = score;
          bestMatchedOn = `alias:${alias.phrase}`;
        }
      }
    }

    // Tier 3: Keyword match (specificity = longer keyword → higher score)
    for (const kw of entry.keywords) {
      const normalKw = normalizeText(kw);
      const matched = kw.includes(" ")
        ? text.includes(normalKw)
        : tokens.includes(normalKw);
      if (matched) {
        // Specificity: 4-char keyword → 0.65, 10-char+ → 0.78
        const specificity = Math.min(0.78, 0.55 + normalKw.length * 0.023);
        if (specificity > bestScore) {
          bestScore = specificity;
          bestMatchedOn = `keyword:${kw}`;
        }
      }
    }

    // Tier 4: Misspelling match
    for (const mis of entry.misspellings) {
      if (text.includes(normalizeText(mis))) {
        const score = 0.72;
        if (score > bestScore) {
          bestScore = score;
          bestMatchedOn = `misspelling:${mis}`;
        }
      }
    }

    // Tier 5: Fuzzy token match on keywords
    if (bestScore < 0.7) {
      for (const token of tokens) {
        if (token.length < 4) continue;
        for (const kw of entry.keywords) {
          if (kw.includes(" ") || kw.length < 4) continue;
          const dist = levenshtein(token, kw);
          if (dist === 1 && 0.65 > bestScore) {
            bestScore = 0.65;
            bestMatchedOn = `fuzzy:${token}≈${kw}`;
          } else if (dist === 2 && 0.50 > bestScore) {
            bestScore = 0.50;
            bestMatchedOn = `fuzzy:${token}≈${kw}`;
          }
        }
      }
    }

    if (bestScore >= 0.35) {
      rawMatches.push({
        entry,
        confidence: bestScore,
        level: levelFromConfidence(bestScore),
        matchedOn: bestMatchedOn,
      });
    }
  }

  const sorted = rawMatches.sort((a, b) => b.confidence - a.confidence);

  return {
    high: sorted.filter((m) => m.level === "high"),
    medium: sorted.filter((m) => m.level === "medium"),
    low: sorted.filter((m) => m.level === "low"),
    all: sorted,
    topMatch: sorted[0] ?? null,
  };
}

/**
 * From a set of matches, determine the single primary service and optional
 * additional services the user mentioned in a multi-service message.
 *
 * Heuristic: if the top match is high-confidence and there is a second
 * high-confidence match in a DIFFERENT category, treat the second as an
 * add-on (Color primary + Haircut add-on, etc.).
 */
export function extractPrimaryAndAddons(result: CatalogMatchResult): {
  primary: CatalogEntry | null;
  addons: CatalogEntry[];
} {
  const top = result.high[0] ?? result.medium[0] ?? null;
  if (!top) return { primary: null, addons: [] };

  const addons: CatalogEntry[] = [];
  for (const match of result.high.slice(1)) {
    if (match.entry.category !== top.entry.category) {
      addons.push(match.entry);
    }
  }

  return { primary: top.entry, addons };
}

/**
 * Find a specific service by ID from a catalog (used for rescheduling, etc.)
 */
export function findById(
  id: string,
  catalog: CatalogEntry[]
): CatalogEntry | undefined {
  return catalog.find((e) => e.id === id);
}

/**
 * Return popular services for the "low confidence" fallback UI.
 */
export function getPopularServices(catalog: CatalogEntry[]): CatalogEntry[] {
  return catalog
    .filter((e) => e.status === "online" && e.popularRank !== undefined)
    .sort((a, b) => (a.popularRank ?? 99) - (b.popularRank ?? 99));
}
