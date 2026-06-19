import type { Service } from "@/lib/types";

/**
 * "Bare category browse" detection — the guard against pre-picking a single
 * service when the client only named a CATEGORY ("perm", "treatment") with no
 * specifying detail. In that case we should SHOW the category's services and
 * ask, not assume a "closest match".
 *
 * Pure + category-agnostic so it can be unit-tested across perm/treatment/
 * color/haircut. The caller (chat client) supplies the catalog and decides how
 * to render; this just answers "is this a bare multi-service category browse,
 * and which services would we show?".
 */

export type CategoryBrowseInput = {
  /** Real service categories the parser tagged (excluding "Consultation"). */
  tags: string[];
  /** Truthy if the parser pinned a specific SKU / specifying detail. */
  comboServiceId?: string | null;
  lengthHint?: string | null;
  permStyle?: string | null;
  colorDirection?: string | null;
  /** True if a dedicated clarifying question exists for this intent (it wins). */
  hasClarifier?: boolean;
};

/**
 * Returns the bookable services to show as a chooser, or null when this is NOT
 * a bare multi-service category browse (caller falls through to its normal
 * single-service recommendation).
 */
export function categoryBrowseOptions(
  input: CategoryBrowseInput,
  catalog: Service[]
): Service[] | null {
  const realTags = input.tags.filter((t) => t !== "Consultation");
  if (realTags.length !== 1) return null;
  if (input.comboServiceId) return null;
  if (input.lengthHint || input.permStyle || input.colorDirection) return null;
  // A dedicated clarifier (haircut length, color direction) is a better UX
  // than a raw list, so it takes precedence.
  if (input.hasClarifier) return null;

  const category = realTags[0];
  const options = catalog
    .filter((s) => s.category === category && s.status !== "hidden")
    .sort((a, b) => {
      const ra = (a as Service & { popularRank?: number }).popularRank ?? 99;
      const rb = (b as Service & { popularRank?: number }).popularRank ?? 99;
      return ra - rb;
    });

  // Only worth a chooser when there's a genuine choice.
  return options.length >= 2 ? options : null;
}
