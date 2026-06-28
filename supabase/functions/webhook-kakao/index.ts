// ============================================================
// webhook-kakao — inbound KakaoTalk. POST-MVP (thin stub).
//
// Kakao has no clean open 2-way API; inbound almost certainly arrives via an
// authorized partner/BSP, whose webhook shape determines parsing. That's a
// separate provider decision (DECISIONS.md #8 exception, INTEGRATIONS.md), so
// this handler only logs the raw payload to webhook_events for now and returns
// 200. Real parsing + normalizeInbound() wiring lands when the BSP is chosen.
//
// TODO(verify): partner/BSP signature scheme — TBD with the chosen provider.
// TODO(parse): map the BSP payload → InboundMessage, then normalizeInbound().
// verify_jwt=false.
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const rawBody = await req.text();
  let payload: unknown = rawBody;
  try {
    payload = JSON.parse(rawBody);
  } catch { /* keep raw string */ }

  // Log only — do not trust or normalize an unverified, unspecified payload yet.
  try {
    const admin = createAdminClient();
    await admin.from("webhook_events").insert({
      provider: "kakao",
      signature_verified: false,
      payload,
    });
  } catch (err) {
    console.error("[webhook-kakao] log failed:", (err as Error).name);
  }

  return jsonResponse({ ok: true, note: "kakao stub — logged only (post-MVP)" });
});
