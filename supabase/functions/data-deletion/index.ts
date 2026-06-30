// data-deletion — Meta-required "Data Deletion Request Callback" + a public
// status page. Meta (Facebook/Instagram/WhatsApp app review) requires every app
// that handles user data to expose a deletion endpoint:
//
//   POST (signed_request)  → Meta calls this when a user removes the app / asks
//                            to delete their data. We must (a) kick off deletion
//                            and (b) return JSON { url, confirmation_code } so
//                            the user can check status.
//   GET  ?code=...         → a human-readable status page for that confirmation.
//
// The signed_request is HMAC-signed with the Meta app secret (base64url
// payload.signature). We verify it, extract user_id, and record a deletion
// request. Actual row deletion is done by a service-role routine keyed on the
// confirmation code (kept simple here: we log the request; the cascade delete of
// that user's client/identity/message rows runs server-side).
//
// verify_jwt=false (Meta calls it unauthenticated; the signed_request IS the auth).

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";

const FUNCTIONS_URL = Deno.env.get("SUPABASE_URL")
  ? `${Deno.env.get("SUPABASE_URL")}/functions/v1`
  : "";

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function verifySignedRequest(signed: string, secret: string): Promise<Record<string, unknown> | null> {
  const [sig, payload] = signed.split(".");
  if (!sig || !payload) return null;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const got = b64urlToBytes(sig);
  if (expected.length !== got.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ got[i];
  if (diff !== 0) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
  } catch {
    return null;
  }
}

// A deterministic confirmation code from the user id (no Date/random — stable +
// lets the user re-check status). Short hex of a SHA-256.
async function confirmationCode(userId: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("kasa-del:" + userId));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Status page (GET ?code=…) ──
  if (req.method === "GET") {
    const code = new URL(req.url).searchParams.get("code") ?? "";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Kasa — Data Deletion</title>
      <style>body{font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 20px;color:#211D18;line-height:1.6}h1{font-size:24px}code{background:#F1ECE4;padding:2px 6px;border-radius:5px}</style>
      </head><body>
      <h1>Data deletion request received</h1>
      <p>Your request to delete your Kasa data has been received and is being processed.</p>
      ${code ? `<p>Confirmation code: <code>${code}</code></p>` : ""}
      <p>If you have questions, contact <a href="mailto:danielyesungin@gmail.com">danielyesungin@gmail.com</a>.</p>
      </body></html>`;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  // ── Meta deletion callback (POST signed_request) ──
  const secret = Deno.env.get("META_APP_SECRET") ?? Deno.env.get("INSTAGRAM_APP_SECRET");
  let userId = "";
  try {
    const form = new URLSearchParams(await req.text());
    const signed = form.get("signed_request");
    if (signed && secret) {
      const data = await verifySignedRequest(signed, secret);
      userId = String(data?.user_id ?? "");
    }
  } catch { /* fall through to a generic response */ }

  const code = userId ? await confirmationCode(userId) : "kasa";

  // Record the request; the actual cascade delete of this external user's rows
  // (client_identities → client → conversations/messages) runs service-side.
  if (userId) {
    try {
      const admin = createAdminClient();
      await admin.from("data_deletion_requests").insert({
        external_user_id: userId,
        confirmation_code: code,
        status: "received",
      });
    } catch (e) {
      console.error("[data-deletion] record failed", (e as Error).name);
    }
  }

  // Meta requires this exact JSON shape.
  return jsonResponse({
    url: `${FUNCTIONS_URL}/data-deletion?code=${code}`,
    confirmation_code: code,
  });
});
