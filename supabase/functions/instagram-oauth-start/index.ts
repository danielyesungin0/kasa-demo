// ============================================================
// instagram-oauth-start — begins the real Instagram (Meta) connect flow.
//
// The app's "Connect Instagram" calls this with the stylist's JWT; it returns
// Meta's OAuth dialog URL. `state` = "<stylistId>.<nonce>" (the callback verifies
// the nonce, stored on the stylist row, as a CSRF/replay guard). After the
// seller authorizes, Meta redirects to instagram-oauth-callback.
//
// Scopes are the IG-messaging set; the Meta app must have these (via App Review
// for production, or be in dev mode with the account added as a tester).
// verify_jwt = true.
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";

const SCOPES = [
  "instagram_basic",
  "instagram_manage_messages",
  "pages_show_list",
  "pages_manage_metadata",
  "pages_messaging",
  "business_management",
].join(",");

function randomNonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const appId = Deno.env.get("META_APP_ID");
  if (!appId) return jsonResponse({ error: "meta_not_configured" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);

  const admin = createAdminClient();
  const { data: userData } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return jsonResponse({ error: "unauthorized" }, 401);

  const { data: stylist } = await admin
    .from("stylists").select("id").eq("user_id", userId).maybeSingle();
  if (!stylist) return jsonResponse({ error: "no_stylist" }, 404);

  const nonce = randomNonce();
  await admin.from("stylists").update({ meta_oauth_nonce: nonce }).eq("id", stylist.id);

  const state = `${stylist.id}.${nonce}`;
  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/instagram-oauth-callback`;

  const authorizeUrl =
    `https://www.facebook.com/v21.0/dialog/oauth` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}`;

  return jsonResponse({ authorize_url: authorizeUrl });
});
