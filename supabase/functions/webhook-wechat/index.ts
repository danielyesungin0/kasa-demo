// ============================================================
// webhook-wechat — inbound WeChat Official Account messages. MVP channel.
//
// Thin handler: (1) WeChat GET echo-challenge on setup, (2) verify the WeChat
// signature [Phase 4 seam], (3) parse WeChat's XML payload into InboundMessage,
// (4) hand off to shared normalizeInbound().
//
// WeChat specifics vs Instagram:
//   - Inbound bodies are XML, not JSON.
//   - Setup is a GET handshake that must echo `echostr`.
//   - Dedupe key: WeChat's MsgId (per-message). Text in <Content>, sender in
//     <FromUserName> (the user's openid).
//   - 48h service window (applied centrally via the channel rule in inbound.ts).
//
// NOT fully wired until a verified Service Account exists (the real gate —
// DECISIONS.md "still open" / INTEGRATIONS.md). verify_jwt=false.
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { type InboundMessage, normalizeInbound } from "../_shared/inbound.ts";

// TODO(verify): verify WeChat's signature — sha1 of sorted [token, timestamp,
// nonce] must equal the `signature` query param. Token = WECHAT_WEBHOOK_TOKEN.
// Used for BOTH the GET handshake and POST messages. Implement in Phase 4.
function verifyWeChatSignature(_params: URLSearchParams): boolean {
  return false;
}

/** Pull a single tag's text out of WeChat XML (handles CDATA). */
function xmlTag(xml: string, tag: string): string | null {
  const m = xml.match(
    new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`),
  );
  return m ? m[1].trim() : null;
}

function parseWeChat(xml: string): InboundMessage | null {
  const fromUser = xmlTag(xml, "FromUserName"); // sender openid
  const msgId = xmlTag(xml, "MsgId"); // dedupe key
  const msgType = xmlTag(xml, "MsgType");
  if (!fromUser) return null;

  const createTime = xmlTag(xml, "CreateTime");
  const sentAt = createTime
    ? new Date(Number(createTime) * 1000).toISOString()
    : null;

  return {
    channel: "wechat",
    externalUserId: fromUser,
    // Event messages (subscribe, etc.) have no MsgId — fall back so dedupe is
    // still stable-ish; real text messages always carry MsgId.
    channelMessageId: msgId ?? `wechat-${fromUser}-${createTime ?? Date.now()}`,
    text: msgType === "text" ? xmlTag(xml, "Content") : null,
    media: msgType !== "text" ? { msgType } : null,
    sentAt,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // WeChat setup handshake: GET with echostr — echo it back when signature ok.
  if (req.method === "GET") {
    const echostr = url.searchParams.get("echostr") ?? "";
    // TODO(verify): require verifyWeChatSignature(url.searchParams) here.
    return new Response(echostr, { status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const rawBody = await req.text(); // XML
  const signatureVerified = verifyWeChatSignature(url.searchParams);

  const msg = parseWeChat(rawBody);
  if (!msg) {
    // Still 200 so WeChat doesn't retry; nothing actionable to normalize.
    return new Response("success", { status: 200 });
  }

  const admin = createAdminClient();
  await normalizeInbound(admin, msg, {
    signatureVerified,
    provider: "wechat",
    rawPayload: rawBody, // raw XML string preserved in webhook_events
  });

  // WeChat expects the literal "success" (or an XML reply) to stop retries.
  return new Response("success", { status: 200 });
});
