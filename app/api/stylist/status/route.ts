import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Status + profile for the currently-authed stylist's own row.
 *
 * Returns real connection + identity data so the dashboard and settings page
 * can stop relying on mock STYLIST values. Auth-gated: anonymous → 401;
 * scoped to the requester's own row only.
 *
 * Backwards-compatible: the original `squareConnected` / `squareTokenStale`
 * keys are unchanged, so existing callers (the /setup redirect) keep working.
 */
export async function GET() {
  const userClient = createServerSupabaseClient();
  const { data: authData } = await userClient.auth.getUser();
  if (!authData?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleSupabaseClient();
  const { data: stylist } = await admin
    .from("stylists")
    .select(
      "id, slug, display_name, square_access_token, square_token_expires_at, square_business_name, square_location_name, square_team_member_name, last_synced_at"
    )
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (!stylist) {
    // Authed but no stylist row yet (fresh provider). Report a clean
    // "not set up" state rather than erroring.
    return NextResponse.json({
      hasStylistRow: false,
      squareConnected: false,
      squareTokenStale: false,
      name: null,
      slug: null,
      businessName: null,
      locationName: null,
      teamMemberName: null,
      lastSyncedAt: null,
      syncedServicesCount: 0,
    });
  }

  // Token is "stale" if it expires within 24h or is already past expiry.
  const expiresAt = stylist.square_token_expires_at
    ? new Date(stylist.square_token_expires_at).getTime()
    : null;
  const squareConnected = Boolean(stylist.square_access_token);
  const squareTokenStale =
    squareConnected &&
    expiresAt !== null &&
    expiresAt - Date.now() < 24 * 60 * 60 * 1000;

  // Count this provider's synced services (best-effort; 0 on any error).
  let syncedServicesCount = 0;
  try {
    const { count } = await admin
      .from("provider_services")
      .select("id", { count: "exact", head: true })
      .eq("stylist_id", stylist.id);
    syncedServicesCount = count ?? 0;
  } catch {
    syncedServicesCount = 0;
  }

  // Display name: provider-set wins, then Square data, then a neutral
  // fallback — never the mock "Shen".
  const name =
    stylist.display_name ??
    stylist.square_team_member_name ??
    stylist.square_business_name ??
    null;

  return NextResponse.json({
    hasStylistRow: true,
    squareConnected,
    squareTokenStale,
    name,
    slug: stylist.slug,
    businessName: stylist.square_business_name ?? null,
    locationName: stylist.square_location_name ?? null,
    teamMemberName: stylist.square_team_member_name ?? null,
    lastSyncedAt: stylist.last_synced_at ?? null,
    syncedServicesCount,
  });
}
