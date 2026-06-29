// ============================================================
// square-oauth-callback — completes the Square OAuth (sandbox) connect flow.
//
// Square redirects here with ?code & ?state after the seller authorizes. We:
//   1. parse state = "<stylistId>.<nonce>" and verify the nonce matches the one
//      square-oauth-start stored (CSRF / replay guard); clear it after.
//   2. exchange the code for access + refresh tokens (/oauth2/token).
//   3. fetch merchant + main location for display (best-effort).
//   4. store tokens ENCRYPTED at rest on the stylist row (same columns the
//      booking/availability functions read via ensureFreshSquareToken).
//   5. redirect back into the app via the kasa:// deep link with a status, so
//      the Connect screen can refresh and show "connected".
//
// verify_jwt = false (Square calls this; there's no app JWT on the redirect —
// the signed state + one-time nonce are the auth). Never logs tokens.
// ============================================================

import { createAdminClient } from "../_shared/supabase-admin.ts";
import { encryptSecret, assertEncryptionKey } from "../_shared/crypto.ts";

const SQUARE_BASE = Deno.env.get("SQUARE_ENVIRONMENT") === "production"
  ? "https://connect.squareup.com"
  : "https://connect.squareupsandbox.com";
const SQUARE_VERSION = "2024-01-18";
const APP_SCHEME = "kasa://square-connected";

function redirectToApp(status: string): Response {
  // 302 into the app's deep link; the dev build registers kasa://.
  return new Response(null, {
    status: 302,
    headers: { Location: `${APP_SCHEME}?status=${encodeURIComponent(status)}` },
  });
}

Deno.serve(async (req) => {
  try {
    assertEncryptionKey();
  } catch {
    return redirectToApp("server_misconfigured");
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const sqError = url.searchParams.get("error");

  if (sqError) return redirectToApp("denied"); // seller declined
  if (!code || !state) return redirectToApp("invalid");

  const [stylistId, nonce] = state.split(".");
  if (!stylistId || !nonce) return redirectToApp("invalid");

  const admin = createAdminClient();

  // Verify the one-time nonce.
  const { data: stylist } = await admin
    .from("stylists")
    .select("id, square_oauth_nonce")
    .eq("id", stylistId)
    .maybeSingle();
  if (!stylist || stylist.square_oauth_nonce !== nonce) {
    return redirectToApp("invalid");
  }

  // Exchange the authorization code for tokens.
  let tokens: { access_token?: string; refresh_token?: string; expires_at?: string; merchant_id?: string };
  try {
    const res = await fetch(`${SQUARE_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
      body: JSON.stringify({
        client_id: Deno.env.get("SQUARE_APPLICATION_ID"),
        client_secret: Deno.env.get("SQUARE_APPLICATION_SECRET"),
        code,
        grant_type: "authorization_code",
        redirect_uri: `${Deno.env.get("SUPABASE_URL")}/functions/v1/square-oauth-callback`,
      }),
    });
    if (!res.ok) {
      console.error("Square token exchange failed:", res.status);
      return redirectToApp("exchange_failed");
    }
    tokens = await res.json();
  } catch (err) {
    console.error("Square token exchange error:", (err as Error).name);
    return redirectToApp("exchange_failed");
  }

  if (!tokens.access_token) return redirectToApp("exchange_failed");

  // Best-effort: fetch merchant + main location for display.
  let businessName: string | null = null;
  let locationId: string | null = null;
  let locationName: string | null = null;
  try {
    const locRes = await fetch(`${SQUARE_BASE}/v2/locations`, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    if (locRes.ok) {
      const body = await locRes.json();
      const main = (body.locations ?? [])[0];
      if (main) {
        locationId = main.id ?? null;
        locationName = main.name ?? null;
        businessName = main.business_name ?? main.name ?? null;
      }
    }
  } catch {
    // non-fatal; connection still valid without display details
  }

  // Persist tokens ENCRYPTED + clear the nonce. These are the exact columns
  // ensureFreshSquareToken / square-create-booking read.
  const { error: updErr } = await admin
    .from("stylists")
    .update({
      square_merchant_id: tokens.merchant_id ?? "connected",
      square_access_token: encryptSecret(tokens.access_token),
      square_refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      square_token_expires_at: tokens.expires_at ?? null,
      square_location_id: locationId,
      square_location_name: locationName,
      square_business_name: businessName,
      square_oauth_nonce: null,
    })
    .eq("id", stylistId);

  if (updErr) {
    console.error("Square connect persist failed:", updErr.message);
    return redirectToApp("persist_failed");
  }

  return redirectToApp("connected");
});
