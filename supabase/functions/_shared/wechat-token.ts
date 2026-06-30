// WeChat Official Account access_token management.
//
// Unlike Instagram (long-lived per-user token), WeChat uses a single app-level
// access_token fetched from AppID + AppSecret, valid ~2h. We cache it on the
// stylist's wechat channel row (credentials_ref holds {app_id, app_secret,
// access_token?, expires_at?}) and refresh when stale. AppID/secret are stored
// encrypted, same as Square/Instagram creds.
//
// NOTE: WeChat's API is IP-allowlisted in production (you whitelist the caller
// IP in the OA dashboard). Edge Functions egress IPs must be added there for
// live sends — documented in the connect flow.

import { decryptSecret, encryptSecret } from "./crypto.ts";

const WECHAT_API = "https://api.weixin.qq.com";

type WeChatCreds = {
  app_id: string;
  app_secret: string;
  access_token?: string;
  expires_at?: number; // epoch ms
};

// deno-lint-ignore no-explicit-any
type Admin = any;

export type TokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string };

/** Get a valid access_token for the stylist's WeChat OA, refreshing if stale. */
export async function ensureFreshWeChatToken(admin: Admin, stylistId: string): Promise<TokenResult> {
  const { data: chan } = await admin
    .from("channels")
    .select("id, credentials_ref")
    .eq("stylist_id", stylistId)
    .eq("type", "wechat")
    .eq("connected", true)
    .maybeSingle();
  if (!chan?.credentials_ref) return { ok: false, error: "wechat_not_connected" };

  let creds: WeChatCreds;
  try {
    creds = JSON.parse(decryptSecret(chan.credentials_ref) ?? "{}");
  } catch {
    return { ok: false, error: "wechat_creds_unreadable" };
  }
  if (!creds.app_id || !creds.app_secret) return { ok: false, error: "wechat_creds_incomplete" };

  // Reuse cached token if it has >5 min of life left.
  if (creds.access_token && creds.expires_at && creds.expires_at - Date.now() > 5 * 60_000) {
    return { ok: true, accessToken: creds.access_token };
  }

  // Refresh.
  try {
    const res = await fetch(
      `${WECHAT_API}/cgi-bin/token?grant_type=client_credential` +
      `&appid=${encodeURIComponent(creds.app_id)}&secret=${encodeURIComponent(creds.app_secret)}`,
    );
    const data = await res.json();
    if (!data.access_token) {
      console.error("[wechat-token] refresh failed", data.errcode, data.errmsg);
      return { ok: false, error: `wechat_token_${data.errcode ?? "unknown"}` };
    }
    const next: WeChatCreds = {
      ...creds,
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in ?? 7200) * 1000,
    };
    // Persist the cached token (re-encrypted).
    await admin.from("channels")
      .update({ credentials_ref: encryptSecret(JSON.stringify(next)) })
      .eq("id", chan.id);
    return { ok: true, accessToken: data.access_token };
  } catch (e) {
    console.error("[wechat-token] threw", (e as Error).name);
    return { ok: false, error: "wechat_unreachable" };
  }
}

export { WECHAT_API };
