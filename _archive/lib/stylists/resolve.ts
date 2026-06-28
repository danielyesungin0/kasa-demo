import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Shared provider (stylist) resolution.
 *
 * Two resolution paths, with very different trust levels:
 *
 *   getStylistBySlug(slug)  — STRICT. Resolves exactly the row with that slug.
 *                             Never falls back to another stylist. Public
 *                             client routes (/book/[slug]) MUST use this.
 *
 *   getFirstStylist()       — LEGACY / TESTING ONLY. Returns the oldest
 *                             stylist row ("first by created_at"). This is
 *                             the pre-slug behavior. It is intentionally a
 *                             separate, clearly-named function so it can be
 *                             grep'd and removed once every caller is
 *                             slug-aware. Do NOT use for new public routes.
 *
 * API routes accept an optional `slug` and call resolveStylist(slug), which
 * uses the strict path when a slug is present and the legacy path only when
 * it isn't — preserving current /shen behavior without leaking one
 * provider's data to another once slugs are in play.
 */

export type StylistRow = {
  id: string;
  slug: string | null;
  published: boolean;
  display_name: string | null;
  square_business_name: string | null;
  square_location_name: string | null;
  square_team_member_name: string | null;
  service_catalog: Record<string, unknown> | null;
};

const SELECT_COLS =
  "id, slug, published, display_name, square_business_name, square_location_name, square_team_member_name, service_catalog";

/**
 * STRICT slug resolution. Returns the matching row or null. Never falls back.
 * Callers gate on `published` themselves so internal/testing routes can
 * bypass the gate while public routes enforce it.
 */
export async function getStylistBySlug(
  slug: string
): Promise<StylistRow | null> {
  if (!slug || !slug.trim()) return null;
  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin
    .from("stylists")
    .select(SELECT_COLS)
    .eq("slug", slug.trim())
    .maybeSingle();
  if (error || !data) return null;
  return data as StylistRow;
}

/**
 * LEGACY / TESTING ONLY — oldest stylist row. Used to preserve the existing
 * slug-less /shen behavior during the Phase-1 transition. Remove once all
 * callers pass a slug.
 */
export async function getFirstStylist(): Promise<StylistRow | null> {
  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin
    .from("stylists")
    .select(SELECT_COLS)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as StylistRow;
}

/**
 * Resolution for API routes that may or may not yet be passing a slug.
 *   - slug present → STRICT (getStylistBySlug). No cross-provider fallback.
 *   - slug absent  → LEGACY first-row, so existing slug-less /shen calls
 *                    keep working during the transition.
 *
 * Public client surfaces should pass a slug so they always take the strict
 * path. The legacy branch is a temporary bridge, not a feature.
 */
export async function resolveStylist(
  slug: string | null | undefined
): Promise<StylistRow | null> {
  if (slug && slug.trim()) {
    return getStylistBySlug(slug);
  }
  return getFirstStylist();
}
