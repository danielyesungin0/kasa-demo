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

// Verify WeChat's signature: sha1 of the sorted [token, timestamp, nonce]
// joined, compared to the `signature` query param. Token = WECHAT_WEBHOOK_TOKEN
// (set by you, and entered identically in the WeChat Official Account server
// config). Used for BOTH the GET handshake and POST messages.
async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyWeChatSignature(params: URLSearchParams): Promise<boolean> {
  const token = Deno.env.get("WECHAT_WEBHOOK_TOKEN");
  if (!token) {
    console.error("[wechat] WECHAT_WEBHOOK_TOKEN not set");
    return false;
  }
  const signature = params.get("signature") ?? "";
  const timestamp = params.get("timestamp") ?? "";
  const nonce = params.get("nonce") ?? "";
  const expected = await sha1Hex([token, timestamp, nonce].sort().join(""));
  return expected === signature;
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

  // WeChat setup handshake: GET with echostr — echo it back ONLY when the
  // signature is valid (this is how WeChat confirms you own the callback URL).
  if (req.method === "GET") {
    const ok = await verifyWeChatSignature(url.searchParams);
    if (!ok) return new Response("invalid signature", { status: 403 });
    return new Response(url.searchParams.get("echostr") ?? "", { status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const rawBody = await req.text(); // XML
  const signatureVerified = await verifyWeChatSignature(url.searchParams);
  // Reject unsigned POSTs (don't normalize untrusted data into the inbox).
  if (!signatureVerified) {
    console.error("[wechat] rejected POST: bad signature");
    return new Response("success", { status: 200 }); // 200 so WeChat stops retrying
  }

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
