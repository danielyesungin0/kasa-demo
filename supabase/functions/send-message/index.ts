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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { conversation_id?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const text = (body.text ?? "").trim();
  if (!body.conversation_id || !text) {
    return jsonResponse({ error: "missing_required_fields" }, 400);
  }

  const admin = createAdminClient();

  const { data: convo } = await admin
    .from("conversations")
    .select("id, channel_type, window_expires_at, external_thread_id")
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

  // Write the outbound message optimistically (status sent; updated on dispatch).
  const { data: msg, error: msgErr } = await admin
    .from("messages")
    .insert({
      conversation_id: convo.id,
      direction: "out",
      body: text,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (msgErr || !msg) return jsonResponse({ error: "message_save_failed" }, 500);

  // Clear unread on reply.
  await admin.from("conversations").update({ unread: false, last_message_at: new Date().toISOString() }).eq("id", convo.id);

  // TODO(send): dispatch via the channel API (Meta / WeChat / Twilio). On
  // provider failure, set messages.status='failed' and surface it. Phase 4.

  return jsonResponse({ ok: true, message_id: msg.id, channel: convo.channel_type });
});
