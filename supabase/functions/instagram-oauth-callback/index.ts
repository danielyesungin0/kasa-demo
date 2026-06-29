// ============================================================
// instagram-oauth-callback — completes Instagram Business Login.
//
// Instagram redirects here with ?code & ?state. We:
//   1. verify state nonce (CSRF/replay), clear it.
//   2. exchange code → short-lived IG user token (api.instagram.com, form POST).
//   3. exchange short → long-lived token (~60 days, graph.instagram.com).
//   4. fetch the IG business profile (id + username).
//   5. store an instagram `channels` row: connected, external_account_id =
//      @username, credentials_ref = ENCRYPTED { ig_user_id, access_token }.
//   6. redirect into the app via kasa://instagram-connected?status=.
//
// Uses INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET (the IG-login credentials).
// verify_jwt=false (IG's redirect carries no app JWT). Never logs tokens.
// ============================================================

import { createAdminClient } from "../_shared/supabase-admin.ts";
import { encryptSecret, assertEncryptionKey } from "../_shared/crypto.ts";

const APP_SCHEME = "kasa://instagram-connected";

function redirectToApp(status: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${APP_SCHEME}?status=${encodeURIComponent(status)}` },
  });
}

Deno.serve(async (req) => {
  try { assertEncryptionKey(); } catch { return redirectToApp("server_misconfigured"); }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return redirectToApp("denied");
  if (!code || !state) return redirectToApp("invalid");

  const [stylistId, nonce] = state.split(".");
  if (!stylistId || !nonce) return redirectToApp("invalid");

  const admin = createAdminClient();
  const { data: stylist } = await admin
    .from("stylists").select("id, meta_oauth_nonce").eq("id", stylistId).maybeSingle();
  if (!stylist || stylist.meta_oauth_nonce !== nonce) return redirectToApp("invalid");

  const igAppId = Deno.env.get("INSTAGRAM_APP_ID");
  const igAppSecret = Deno.env.get("INSTAGRAM_APP_SECRET");
  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/instagram-oauth-callback`;
  if (!igAppId || !igAppSecret) return redirectToApp("server_misconfigured");

  try {
    // 2) code → short-lived token (form-encoded POST to api.instagram.com)
    const form = new URLSearchParams({
      client_id: igAppId,
      client_secret: igAppSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const short = await shortRes.json();
    if (!shortRes.ok || !short.access_token) {
      console.error("[ig-callback] short token failed", shortRes.status);
      return redirectToApp("exchange_failed");
    }
    const igUserId = short.user_id ?? short.user?.id ?? null;

    // 3) short → long-lived token (~60 days)
    const llRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token` +
      `&client_secret=${igAppSecret}&access_token=${short.access_token}`,
    );
    const ll = await llRes.json();
    const accessToken = ll.access_token ?? short.access_token;

    // 4) fetch profile (username) for display
    let username = "Instagram";
    try {
      const meRes = await fetch(
        `https://graph.instagram.com/me?fields=user_id,username&access_token=${accessToken}`,
      );
      if (meRes.ok) {
        const me = await meRes.json();
        if (me.username) username = `@${me.username}`;
      }
    } catch { /* non-fatal */ }

    // 5) store channels row (encrypted creds)
    const credBlob = encryptSecret(JSON.stringify({
      ig_user_id: igUserId,
      access_token: accessToken,
    }));
    const { data: existing } = await admin
      .from("channels").select("id")
      .eq("stylist_id", stylistId).eq("type", "instagram").maybeSingle();
    const row = {
      stylist_id: stylistId,
      type: "instagram",
      connected: true,
      status: "connected",
      external_account_id: username,
      credentials_ref: credBlob,
      last_sync_at: new Date().toISOString(),
    };
    if (existing) await admin.from("channels").update(row).eq("id", existing.id);
    else await admin.from("channels").insert(row);

    await admin.from("stylists").update({ meta_oauth_nonce: null }).eq("id", stylistId);
    return redirectToApp("connected");
  } catch (e) {
    console.error("[ig-callback] threw", (e as Error).name);
    return redirectToApp("exchange_failed");
  }
});
