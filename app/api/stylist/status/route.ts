import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Returns whether the currently-authed stylist has finished Square setup.
 * Used by /setup to redirect already-set-up stylists to /dashboard.
 *
 * Auth-gated: anonymous callers get 401. Result is scoped to the requester's
 * own stylist row, never another stylist's.
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
    .select("square_access_token, square_token_expires_at")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  // Token is considered "stale" if it expires within 24 hours OR is already
  // past expiry. The dashboard surfaces a reconnect banner so the stylist
  // can re-auth before bookings start failing.
  const expiresAt = stylist?.square_token_expires_at
    ? new Date(stylist.square_token_expires_at).getTime()
    : null;
  const stale =
    Boolean(stylist?.square_access_token) &&
    expiresAt !== null &&
    expiresAt - Date.now() < 24 * 60 * 60 * 1000;

  return NextResponse.json({
    squareConnected: Boolean(stylist?.square_access_token),
    squareTokenStale: stale,
  });
}
