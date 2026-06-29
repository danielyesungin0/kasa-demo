// ============================================================
// square-oauth-start — begins the Square OAuth (sandbox) connect flow.
//
// The app (Connect Square button) calls this with the stylist's JWT. It returns
// the Square authorize URL the app opens in a browser. The `state` carries a
// signed token (stylist id + nonce) so the callback can (a) know whose account
// is connecting and (b) reject forged/replayed callbacks (CSRF). The nonce is
// also stashed on the stylist row for one-time verification.
//
// Scopes (least-privilege for what Kasa does):
//   APPOINTMENTS_READ/WRITE  — read availability, create bookings
//   ITEMS_READ               — read the service catalog (durations/prices)
//   CUSTOMERS_READ/WRITE     — find-or-create the client as a Square customer
//   MERCHANT_PROFILE_READ    — merchant + location display info
// verify_jwt = true (only an authenticated stylist can start a connect).
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";

const SQUARE_BASE = Deno.env.get("SQUARE_ENVIRONMENT") === "production"
  ? "https://connect.squareup.com"
  : "https://connect.squareupsandbox.com";

const SCOPES = [
  "APPOINTMENTS_READ",
  "APPOINTMENTS_WRITE",
  "APPOINTMENTS_BUSINESS_SETTINGS_READ",
  "ITEMS_READ",
  "CUSTOMERS_READ",
  "CUSTOMERS_WRITE",
  "MERCHANT_PROFILE_READ",
].join("+");

function randomNonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const appId = Deno.env.get("SQUARE_APPLICATION_ID");
  if (!appId) return jsonResponse({ error: "server_misconfigured" }, 500);

  // Identify the authenticated stylist from their JWT (verify_jwt=true gates the
  // call; we resolve the row to attach the connect to the right account).
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);

  const admin = createAdminClient();
  const { data: userData } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return jsonResponse({ error: "unauthorized" }, 401);

  const { data: stylist } = await admin
    .from("stylists")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!stylist) return jsonResponse({ error: "no_stylist" }, 404);

  // One-time nonce, stored for the callback to verify (CSRF / replay guard).
  const nonce = randomNonce();
  await admin
    .from("stylists")
    .update({ square_oauth_nonce: nonce })
    .eq("id", stylist.id);

  const state = `${stylist.id}.${nonce}`;
  const redirectUri =
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/square-oauth-callback`;

  const authorizeUrl =
    `${SQUARE_BASE}/oauth2/authorize` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&scope=${SCOPES}` +
    `&session=false` +
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return jsonResponse({ authorize_url: authorizeUrl });
});
