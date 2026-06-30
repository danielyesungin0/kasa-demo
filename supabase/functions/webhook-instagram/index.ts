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
import { decryptSecret } from "../_shared/crypto.ts";

// Verify the X-Hub-Signature-256: HMAC-SHA256 of the RAW body keyed by the app
// secret, compared to "sha256=...". Instagram Business Login webhooks are signed
// with INSTAGRAM_APP_SECRET; classic Meta/Page webhooks with META_APP_SECRET —
// accept either so the source can be either configuration. Must run on the raw
// bytes; timing-safe compare.
async function hmacHex(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyMetaSignature(
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;
  const expected = header.startsWith("sha256=") ? header.slice(7) : header;
  const secrets = [
    Deno.env.get("INSTAGRAM_APP_SECRET"),
    Deno.env.get("META_APP_SECRET"),
  ].filter((s): s is string => Boolean(s));
  for (const secret of secrets) {
    if (timingSafeEqual(await hmacHex(secret, rawBody), expected)) return true;
  }
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
      const recipient = (m.recipient as { id?: string } | undefined)?.id;
      const message = m.message as
        | { mid?: string; text?: string; attachments?: unknown; is_echo?: boolean }
        | undefined;
      if (!message?.mid) continue; // read receipts / reactions / etc. — skip

      const isEcho = message.is_echo === true;
      // ECHO = the stylist's OWN message, sent from the Instagram app (not Kasa).
      // Record it so the chat stays in sync. For an echo the CLIENT is the
      // recipient (and the business is the sender); for inbound it's the reverse.
      const clientExternalId = isEcho ? recipient : sender;
      const businessId = isEcho ? sender : recipient;
      if (!clientExternalId) continue;
      // SELF-GUARD: never treat the business's own account as a client. (Without
      // this, a malformed echo where recipient==business would create a bogus
      // self-client whose thread collects messages from every real chat.)
      if (clientExternalId === businessId) continue;

      out.push({
        channel: "instagram",
        externalUserId: clientExternalId,
        channelMessageId: message.mid,
        // Reply target is always the client's IG-scoped id.
        externalThreadId: clientExternalId,
        text: message.text ?? null,
        media: message.attachments ?? null,
        direction: isEcho ? "out" : "in",
        businessAccountId: businessId ?? null,
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
  const signatureVerified = await verifyMetaSignature(
    rawBody,
    req.headers.get("x-hub-signature-256"),
  );

  // Security gate: once META_APP_SECRET is configured (real deployment), REJECT
  // any POST that fails signature verification — that's a forged/replayed call.
  // Before the secret is set (local dev w/ simulated payloads), allow through so
  // the pipeline is testable; those are flagged signatureVerified=false.
  const secretConfigured = Boolean(
    Deno.env.get("INSTAGRAM_APP_SECRET") || Deno.env.get("META_APP_SECRET"),
  );
  if (secretConfigured && !signatureVerified) {
    return jsonResponse({ error: "invalid_signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const admin = createAdminClient();
  const messages = parseMeta(payload);

  // Enrich each message with the sender's IG username (Meta's webhook only gives
  // the IGSID). We look it up via the connected account's token so the client
  // shows a real @handle instead of "New client". Best-effort; cached per id.
  const handleCache = new Map<string, string | null>();
  for (const msg of messages) {
    if (!msg.displayHandle) {
      msg.displayHandle = await resolveIgUsername(admin, msg.externalUserId, handleCache);
    }
  }

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

// Look up an Instagram sender's @username from their IGSID, using the connected
// account's stored token. Returns "@username" or null. Never logs the token.
// deno-lint-ignore no-explicit-any
async function resolveIgUsername(admin: any, igsid: string, cache: Map<string, string | null>): Promise<string | null> {
  if (cache.has(igsid)) return cache.get(igsid) ?? null;
  let handle: string | null = null;
  try {
    const { data: chan } = await admin
      .from("channels")
      .select("credentials_ref")
      .eq("type", "instagram")
      .eq("connected", true)
      .maybeSingle();
    if (chan?.credentials_ref) {
      const creds = JSON.parse(decryptSecret(chan.credentials_ref) ?? "{}");
      const token = creds.access_token;
      if (token) {
        // IG Graph: GET /{igsid}?fields=username (works for users who messaged you)
        const res = await fetch(
          `https://graph.instagram.com/v21.0/${igsid}?fields=username,name&access_token=${token}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.username) handle = `@${data.username}`;
          else if (data.name) handle = data.name;
        }
      }
    }
  } catch {
    // best-effort — fall back to "New client"
  }
  cache.set(igsid, handle);
  return handle;
}
