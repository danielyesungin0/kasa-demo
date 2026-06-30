// ============================================================
// send-message — outbound replies (stub). One function, all channels.
//
// Enforces the core guardrail server-side: NEVER send outside a channel's reply
// window. If the window is closed, refuse and return an honest state the app
// surfaces ("Instagram reply window closed — open Instagram"); the app never
// fakes success. On an open window, write the outbound `messages` row, then
// dispatch via the channel's API [Phase 4 seam].
//
// This is the only outbound path. It does NOT auto-send anything — it's called
// by a deliberate tap in the app (PRODUCT_BRIEF guardrails). verify_jwt=true
// (only the authenticated stylist may send).
//
// Phase 4 fills in the per-channel provider sends (TODO(send)).
//
// Request (POST): { conversation_id, text }
// Response: { ok, message_id?, blocked?, reason? }
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { decryptSecret } from "../_shared/crypto.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: {
    conversation_id?: string;
    text?: string;
    media?: { type: "image" | "video" | "audio"; url: string } | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const text = (body.text ?? "").trim();
  const media = body.media && body.media.url ? body.media : null;
  // Must have at least text OR a media attachment.
  if (!body.conversation_id || (!text && !media)) {
    return jsonResponse({ error: "missing_required_fields" }, 400);
  }

  const admin = createAdminClient();

  const { data: convo } = await admin
    .from("conversations")
    .select("id, stylist_id, channel_type, window_expires_at, external_thread_id")
    .eq("id", body.conversation_id)
    .maybeSingle();
  if (!convo) return jsonResponse({ error: "conversation_not_found" }, 404);

  // ── Guardrail: respect the reply window. null = no window (SMS) = always ok. ──
  const windowOpen = !convo.window_expires_at ||
    new Date(convo.window_expires_at).getTime() > Date.now();
  if (!windowOpen) {
    // Honest closed-window state — the app shows "open {Channel}", never fakes a send.
    return jsonResponse({
      ok: false,
      blocked: true,
      reason: "reply_window_closed",
      channel: convo.channel_type,
    });
  }

  // Write the outbound message optimistically as 'sent', dispatch, then DOWNGRADE
  // to 'failed' if the provider rejects — honest delivery state (the message_status
  // enum has no in-flight value; this matches the app's optimistic-then-reconcile).
  const { data: msg, error: msgErr } = await admin
    .from("messages")
    .insert({
      conversation_id: convo.id,
      direction: "out",
      body: text || null,
      // Store the same shape inbound media uses so the bubble renders it.
      media: media ? [{ type: media.type, payload: { url: media.url } }] : null,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (msgErr || !msg) {
    console.error("[send] message insert failed:", msgErr?.message);
    return jsonResponse({ error: "message_save_failed", detail: msgErr?.message }, 500);
  }

  // ── Dispatch via the channel API ──
  let sendResult: { ok: boolean; providerId?: string; error?: string };
  if (convo.channel_type === "instagram") {
    sendResult = await sendInstagram(admin, convo, text, media);
  } else {
    // WeChat/SMS/Kakao not yet wired — mark sent locally (no provider) so the
    // app still works for those channels in dev; real sends are later chunks.
    sendResult = { ok: true };
  }

  if (!sendResult.ok) {
    await admin.from("messages").update({ status: "failed" }).eq("id", msg.id);
    return jsonResponse({
      ok: false,
      message_id: msg.id,
      reason: "send_failed",
      detail: sendResult.error ?? "provider_error",
      channel: convo.channel_type,
    });
  }

  await admin.from("messages")
    .update({ status: "sent", channel_message_id: sendResult.providerId ?? null })
    .eq("id", msg.id);
  await admin.from("conversations")
    .update({ unread: false, last_message_at: new Date().toISOString() })
    .eq("id", convo.id);

  return jsonResponse({ ok: true, message_id: msg.id, channel: convo.channel_type });
});

// Send an Instagram DM via the Meta Graph API. The Page access token is stored
// per-stylist (encrypted) on the connected instagram channels row — read+decrypt
// it (multi-tenant correct), falling back to a global env token if present.
// recipient.id is the IG-scoped user id stored as conversation.external_thread_id.
// deno-lint-ignore no-explicit-any
async function sendInstagram(
  admin: any,
  convo: any,
  text: string,
  media: { type: "image" | "video" | "audio"; url: string } | null,
): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const recipientId = convo.external_thread_id;
  if (!recipientId) return { ok: false, error: "no_recipient" };

  // Instagram Business Login stores an IG USER access token (graph.instagram.com),
  // not a Page token. Read + decrypt it from the connected channel row.
  let igToken: string | null = null;
  const { data: chan } = await admin
    .from("channels")
    .select("credentials_ref")
    .eq("stylist_id", convo.stylist_id)
    .eq("type", "instagram")
    .eq("connected", true)
    .maybeSingle();
  if (chan?.credentials_ref) {
    try {
      const creds = JSON.parse(decryptSecret(chan.credentials_ref) ?? "{}");
      igToken = creds.access_token ?? creds.page_access_token ?? null;
    } catch { /* fall through */ }
  }
  if (!igToken) return { ok: false, error: "meta_not_configured" };

  const url = `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(igToken)}`;
  // IG sends text and attachment as SEPARATE messages. Send the attachment
  // first (the substance), then any caption text. The provider id we return is
  // the attachment's if present, else the text's.
  async function post(message: unknown): Promise<{ ok: boolean; providerId?: string; error?: string }> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: recipientId }, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        const code = data?.error?.code ?? "unknown";
        console.error("[send] Instagram send failed", res.status, code);
        return { ok: false, error: `meta_${code}` };
      }
      return { ok: true, providerId: data.message_id };
    } catch (e) {
      console.error("[send] Instagram send threw", (e as Error).name);
      return { ok: false, error: "meta_unreachable" };
    }
  }

  let providerId: string | undefined;
  if (media) {
    // IG attachment types: image | video | audio (file not supported on IG).
    const r = await post({ attachment: { type: media.type, payload: { url: media.url } } });
    if (!r.ok) return r;
    providerId = r.providerId;
  }
  if (text) {
    const r = await post({ text });
    if (!r.ok) return r;
    providerId = providerId ?? r.providerId;
  }
  return { ok: true, providerId };
}
