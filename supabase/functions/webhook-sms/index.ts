// ============================================================
// webhook-sms — inbound SMS via Twilio. DEFERRED channel (stub).
//
// Twilio is the easiest channel technically but deferred for slow A2P carrier
// registration (DECISIONS.md #9). This stub already parses Twilio's
// form-encoded inbound into the common InboundMessage and routes it through the
// shared normalizeInbound(), so turning it on later is mostly signature + send.
//
// TODO(verify): validate Twilio's X-Twilio-Signature before normalizing.
// verify_jwt=false (Twilio calls it unauthenticated).
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { type InboundMessage, normalizeInbound } from "../_shared/inbound.ts";

function verifyTwilioSignature(_header: string | null, _url: string, _params: URLSearchParams): boolean {
  return false; // Phase 4
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody); // Twilio posts form-encoded
  const signatureVerified = verifyTwilioSignature(
    req.headers.get("x-twilio-signature"),
    req.url,
    params,
  );

  const from = params.get("From"); // E.164
  const smsId = params.get("MessageSid"); // dedupe key
  if (!from || !smsId) {
    return new Response("<Response></Response>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  const msg: InboundMessage = {
    channel: "sms",
    externalUserId: from.replace(/\D/g, ""), // store E.164 digits
    channelMessageId: smsId,
    text: params.get("Body"),
    displayHandle: from,
  };

  const admin = createAdminClient();
  await normalizeInbound(admin, msg, {
    signatureVerified,
    provider: "twilio",
    rawPayload: Object.fromEntries(params),
  });

  // Empty TwiML — we reply via send-message, not inline.
  return new Response("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
});
