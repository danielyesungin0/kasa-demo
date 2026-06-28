// ============================================================
// webhook-instagram — inbound Instagram DMs (Meta Graph API). MVP channel.
//
// Thin handler: (1) handle Meta's GET verify handshake, (2) verify the POST
// signature [Phase 4 seam], (3) parse Meta's payload into InboundMessage(s),
// (4) hand off to the shared normalizeInbound(). All dedupe/identity/
// conversation/message/parse-intent logic lives in _shared/inbound.ts.
//
// NOT fully wired until Meta App Review + a connected IG account exist
// (DECISIONS.md #9/#10). Structured so signature verification slots in before
// any normalization. verify_jwt=false (Meta calls it unauthenticated).
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { type InboundMessage, normalizeInbound } from "../_shared/inbound.ts";

// TODO(verify): verify Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw body
// with META_APP_SECRET) BEFORE parsing. Must run on the raw bytes, so read the
// body as text first and pass the verified flag into normalizeInbound.
function verifyMetaSignature(_rawBody: string, _header: string | null): boolean {
  // Phase 4: implement HMAC check. Until then, mark unverified (and the raw
  // payload is still logged to webhook_events for debugging).
  return false;
}

/** Parse a Meta messaging webhook body into zero or more InboundMessages. */
function parseMeta(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const body = payload as {
    entry?: Array<
      { messaging?: Array<Record<string, unknown>> }
    >;
  };
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const sender = (m.sender as { id?: string } | undefined)?.id;
      const message = m.message as
        | { mid?: string; text?: string; attachments?: unknown }
        | undefined;
      if (!sender || !message?.mid) continue; // skip echoes/read receipts/etc.
      out.push({
        channel: "instagram",
        externalUserId: sender,
        channelMessageId: message.mid,
        text: message.text ?? null,
        media: message.attachments ?? null,
        sentAt: typeof m.timestamp === "number"
          ? new Date(m.timestamp).toISOString()
          : null,
      });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Meta verification handshake (GET hub.challenge).
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
    if (mode === "subscribe" && token && expected && token === expected) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // Read raw body once (signature check must run on raw bytes).
  const rawBody = await req.text();
  const signatureVerified = verifyMetaSignature(
    rawBody,
    req.headers.get("x-hub-signature-256"),
  );

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const admin = createAdminClient();
  const messages = parseMeta(payload);

  // Always 200 to Meta quickly so it doesn't retry-storm; process inline for
  // now (volume is tiny). Each message goes through the shared path.
  for (const msg of messages) {
    await normalizeInbound(admin, msg, {
      signatureVerified,
      provider: "instagram",
      rawPayload: payload,
    });
  }

  return jsonResponse({ ok: true, received: messages.length });
});
