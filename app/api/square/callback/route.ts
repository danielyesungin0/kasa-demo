import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";

const SQUARE_BASE = "https://connect.squareupsandbox.com";

/**
 * App URL for OAuth redirects. Prefers NEXT_PUBLIC_APP_URL, falls back to
 * the request's own origin so the redirect always returns the user to the
 * same host they came from (works for localhost, LAN IP, or production
 * without code changes).
 */
function getAppUrl(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (envUrl) return envUrl;
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const APP_URL = getAppUrl(request);
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");
  const userId = searchParams.get("state");

  if (errorParam) {
    return NextResponse.redirect(`${APP_URL}/setup?square_error=${encodeURIComponent(errorParam)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${APP_URL}/setup?square_error=missing_code`);
  }
  if (!userId) {
    return NextResponse.redirect(`${APP_URL}/setup?square_error=no_user`);
  }

  const admin = createServiceRoleSupabaseClient();

  // Resolve email from Supabase auth
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const userEmail = authUser?.user?.email ?? null;

  // ── 1. Exchange authorization code for tokens ─────────────────────────────
  let tokenData: {
    access_token?: string;
    refresh_token?: string;
    merchant_id?: string;
    expires_at?: string;
  };

  try {
    const res = await fetch(`${SQUARE_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Square-Version": "2024-01-18" },
      body: JSON.stringify({
        client_id: process.env.SQUARE_APPLICATION_ID,
        client_secret: process.env.SQUARE_APPLICATION_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: process.env.SQUARE_REDIRECT_URL,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("Square token exchange failed:", res.status, body);
      return NextResponse.redirect(`${APP_URL}/setup?square_error=token_exchange_failed`);
    }

    tokenData = await res.json();
  } catch (err) {
    console.error("Square token exchange error:", err);
    return NextResponse.redirect(`${APP_URL}/setup?square_error=token_exchange_failed`);
  }

  if (!tokenData.access_token) {
    return NextResponse.redirect(`${APP_URL}/setup?square_error=token_exchange_failed`);
  }

  const accessToken = tokenData.access_token;

  // ── 2. Fetch location ID (first active location) ──────────────────────────
  let locationId: string | null = null;
  let businessName: string | null = null;
  let locationName: string | null = null;
  try {
    const res = await fetch(`${SQUARE_BASE}/v2/locations`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": "2024-01-18" },
    });
    const data = await res.json();
    const active = (data.locations ?? []).find((l: any) => l.status === "ACTIVE");
    const loc = active ?? data.locations?.[0] ?? null;
    locationId = loc?.id ?? null;
    businessName = loc?.business_name ?? null;
    locationName = loc?.name ?? null;
  } catch (err) {
    console.error("Square locations fetch failed:", err);
  }

  // ── 3. Fetch team member ID via Bookings profile ──────────────────────────
  // Square's Bookings API requires a "booking profile" per team member.
  // We use the Bookings team member profiles endpoint which only needs
  // APPOINTMENTS_ALL_READ (not EMPLOYEES_READ which has stricter OAuth).
  //
  // Sandbox accounts (and some production setups) leave the booking profile's
  // display_name empty. When that happens, we fall back to /v2/team-members
  // which returns the team member's given_name + family_name directly. This
  // keeps the stylist's real name visible on /shen without manual data entry.
  let teamMemberId: string | null = null;
  let teamMemberDisplayName: string | null = null;
  if (locationId) {
    try {
      const res = await fetch(
        `${SQUARE_BASE}/v2/bookings/team-member-booking-profiles?location_id=${locationId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": "2024-01-18" },
        }
      );
      const data = await res.json();
      const profiles: any[] = data.team_member_booking_profiles ?? [];
      const active = profiles.find((p) => p.is_bookable !== false);
      const chosen = active ?? profiles[0] ?? null;
      teamMemberId = chosen?.team_member_id ?? null;
      const profileName = chosen?.display_name?.trim() || null;
      teamMemberDisplayName = profileName;
    } catch (err) {
      console.error("Square team member profiles fetch failed:", err);
    }
  }

  // Fallback: if the booking profile didn't give us a display name, hit the
  // team-members endpoint and assemble one from given_name + family_name.
  if (teamMemberId && !teamMemberDisplayName) {
    try {
      const res = await fetch(
        `${SQUARE_BASE}/v2/team-members/${teamMemberId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": "2024-01-18" },
        }
      );
      if (res.ok) {
        const data = await res.json();
        const tm = data.team_member;
        const composed = [tm?.given_name, tm?.family_name]
          .map((s: string | undefined) => s?.trim())
          .filter(Boolean)
          .join(" ");
        teamMemberDisplayName = composed || null;
      }
    } catch (err) {
      // Non-fatal — we still have business_name and the API's fallback chain
      // will surface that instead.
      console.error("Square team-members fallback fetch failed:", err);
    }
  }

  // ── 4. Upsert everything into stylists table ──────────────────────────────
  const { error: upsertError } = await admin
    .from("stylists")
    .upsert(
      {
        user_id: userId,
        email: userEmail,
        // Encrypted at rest — must round-trip through decryptSecret() on read.
        square_access_token: encryptSecret(accessToken),
        square_refresh_token: encryptSecret(tokenData.refresh_token ?? null),
        square_merchant_id: tokenData.merchant_id ?? null,
        square_token_expires_at: tokenData.expires_at ?? null,
        square_location_id: locationId,
        square_location_name: locationName,
        square_business_name: businessName,
        square_team_member_id: teamMemberId,
        square_team_member_name: teamMemberDisplayName,
      },
      { onConflict: "user_id" }
    );

  if (upsertError) {
    console.error("Supabase upsert error:", upsertError);
    return NextResponse.redirect(`${APP_URL}/setup?square_error=db_save_failed`);
  }

  return NextResponse.redirect(`${APP_URL}/setup?connected=true`);
}
