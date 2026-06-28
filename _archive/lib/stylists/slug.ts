import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Slug generation for self-serve provider onboarding.
 *
 * A provider's slug is the public booking URL segment (/book/<slug>). It is
 * assigned automatically when a provider connects Square, derived from a
 * preferred slug (carried on the signup link) or their Square business /
 * team-member name — so onboarding never requires manual SQL.
 *
 * Uniqueness is enforced at the DB level by the partial unique index
 * `stylists_slug_key (slug) where slug is not null` (migration 002). This
 * module makes a best-effort dedupe BEFORE the write so the common case is a
 * clean slug; the caller still handles a unique-violation as a race fallback.
 */

const RESERVED_SLUGS = new Set([
  // App routes that must never be shadowed by a provider booking page.
  "api",
  "setup",
  "dashboard",
  "auth",
  "book",
  "internal",
  "admin",
  "login",
  "signup",
]);

/**
 * Normalize an arbitrary string into a URL-safe slug base.
 * Lowercase, ASCII-fold-ish (strip non [a-z0-9]), collapse to single dashes,
 * trim leading/trailing dashes, cap length. Returns "" if nothing usable.
 */
export function slugifyBase(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric → dash
    .replace(/-+/g, "-") // collapse repeats
    .replace(/^-|-$/g, "") // trim edges
    .slice(0, 40)
    .replace(/-$/g, ""); // re-trim if the slice cut mid-dash
}

/**
 * Pick the first usable slug base from an ordered list of candidates
 * (preferred slug, business name, team-member name, …), falling back to
 * "provider" when none yield anything usable.
 */
export function deriveSlugBase(
  candidates: Array<string | null | undefined>
): string {
  for (const c of candidates) {
    const s = slugifyBase(c);
    if (s) return s;
  }
  return "provider";
}

/**
 * Resolve a unique slug for a NEW provider row.
 *
 * - Reserved words and already-taken slugs get a numeric suffix (-2, -3, …).
 * - `excludeStylistId` lets a reconnect keep its own slug without colliding
 *   with itself (not used for fresh rows, but safe for idempotent callers).
 *
 * Best-effort: returns a slug that is free at query time. The caller writes it
 * and, on a unique-violation race, retries by calling this again (the loser of
 * the race will then see the winner's slug as taken and pick the next suffix).
 */
export async function generateUniqueSlug(
  base: string,
  excludeStylistId?: string
): Promise<string> {
  const admin = createServiceRoleSupabaseClient();
  const safeBase = base && base.trim() ? base.trim() : "provider";

  // Pull every existing slug that shares this base prefix in one query, then
  // resolve the first free candidate in memory — avoids a query per attempt.
  const { data: rows } = await admin
    .from("stylists")
    .select("id, slug")
    .like("slug", `${safeBase}%`);

  const taken = new Set(
    ((rows ?? []) as Array<{ id: string; slug: string | null }>)
      .filter((r) => r.id !== excludeStylistId && r.slug)
      .map((r) => r.slug as string)
  );

  const isFree = (candidate: string) =>
    !taken.has(candidate) && !RESERVED_SLUGS.has(candidate);

  if (isFree(safeBase)) return safeBase;

  // Append -2, -3, … until free. Bounded loop; practically never deep.
  for (let n = 2; n < 1000; n++) {
    const candidate = `${safeBase}-${n}`;
    if (isFree(candidate)) return candidate;
  }

  // Pathological fallback: a random suffix is still unique-enough; the DB
  // index is the final guarantee.
  return `${safeBase}-${Date.now().toString(36)}`;
}
