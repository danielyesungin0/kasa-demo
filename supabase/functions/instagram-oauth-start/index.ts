// ============================================================
// instagram-oauth-start — begins the Instagram Business Login flow (the newer
// IG-direct path, not via a Facebook Page).
//
// The app's "Connect Instagram" calls this with the stylist's JWT; it returns
// Instagram's OAuth dialog URL. `state` = "<stylistId>.<nonce>" (callback
// verifies the nonce, stored on the stylist row, as a CSRF/replay guard).
// Uses INSTAGRAM_APP_ID (the Instagram-login app id, distinct from META_APP_ID).
// verify_jwt = true.
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";

// Instagram Business Login scopes (the IG-direct API).
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
].join(",");

function randomNonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const igAppId = Deno.env.get("INSTAGRAM_APP_ID");
  if (!igAppId) return jsonResponse({ error: "meta_not_configured" }, 500);

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
    `https://www.instagram.com/oauth/authorize` +
    `?client_id=${encodeURIComponent(igAppId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}`;

  return jsonResponse({ authorize_url: authorizeUrl });
});
