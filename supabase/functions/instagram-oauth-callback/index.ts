// ============================================================
// instagram-oauth-callback — completes the Instagram (Meta) connect flow.
//
// Meta redirects here with ?code & ?state. We:
//   1. verify state nonce (CSRF/replay), clear it.
//   2. exchange code → short-lived user token → long-lived user token.
//   3. find the user's Page + its connected IG Business account.
//   4. get the PAGE access token (what IG DM send/receive uses).
//   5. store an instagram `channels` row: connected, external_account_id = the
//      IG username/id, credentials_ref = ENCRYPTED page token + ids.
//   6. redirect into the app via kasa://instagram-connected?status=.
//
// verify_jwt=false (Meta's redirect carries no app JWT; state+nonce are the
// guard). Never logs tokens.
// ============================================================

import { createAdminClient } from "../_shared/supabase-admin.ts";
import { encryptSecret, assertEncryptionKey } from "../_shared/crypto.ts";

const GRAPH = "https://graph.facebook.com/v21.0";
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

  const appId = Deno.env.get("META_APP_ID");
  const appSecret = Deno.env.get("META_APP_SECRET");
  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/instagram-oauth-callback`;
  if (!appId || !appSecret) return redirectToApp("server_misconfigured");

  try {
    // 2a) code → short-lived user token
    const tokRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
    );
    const tok = await tokRes.json();
    if (!tokRes.ok || !tok.access_token) {
      console.error("[ig-callback] token exchange failed", tokRes.status);
      return redirectToApp("exchange_failed");
    }

    // 2b) short → long-lived user token (~60 days)
    const llRes = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tok.access_token}`,
    );
    const ll = await llRes.json();
    const userToken = ll.access_token ?? tok.access_token;

    // 3) find Page + connected IG business account, and the PAGE token.
    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${userToken}`,
    );
    const pages = await pagesRes.json();
    const page = (pages.data ?? []).find((p: any) => p.instagram_business_account) ?? (pages.data ?? [])[0];
    if (!page?.access_token) {
      console.error("[ig-callback] no page/token found");
      return redirectToApp("no_page");
    }
    const ig = page.instagram_business_account;
    const igUsername = ig?.username ? `@${ig.username}` : (page.name ?? "Instagram");

    // 5) store the channels row with the ENCRYPTED page token + ids.
    const credBlob = encryptSecret(JSON.stringify({
      page_id: page.id,
      page_access_token: page.access_token,
      ig_user_id: ig?.id ?? null,
    }));

    // upsert by (stylist_id, type='instagram') via select-then-write.
    const { data: existing } = await admin
      .from("channels").select("id")
      .eq("stylist_id", stylistId).eq("type", "instagram").maybeSingle();
    const row = {
      stylist_id: stylistId,
      type: "instagram",
      connected: true,
      status: "connected",
      external_account_id: igUsername,
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
