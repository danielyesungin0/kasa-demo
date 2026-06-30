// ============================================================
// inbound — the ONE shared inbound-normalization path every channel calls.
//
// Per-channel webhook handlers stay thin: they verify the provider signature
// (Phase 4 seam), parse that provider's payload into a common `InboundMessage`,
// and hand off to normalizeInbound(). All the shared logic lives here so every
// channel inherits identical behavior (INTEGRATIONS.md "Normalization contract").
//
// normalizeInbound does, in order:
//   0. log raw payload to webhook_events (with signature_verified flag) so we
//      can debug without trusting unverified data
//   1. DEDUPE on (channel, channel_message_id) — a webhook redelivery must
//      never create a duplicate messages row (inbound twin of booking idem.)
//   2. IDENTITY — match via client_identities (channel + external_user_id),
//      create client + identity if new
//   3. CONVERSATION — one per client per channel; set window_expires_at from
//      the channel's reply-window rule
//   4. MESSAGE — insert the inbound `messages` row (direction:'in')
//   5. ENRICH — call parse-intent (message-first, non-blocking, fail-safe). A
//      slow/failed AI call must NEVER drop the message (DECISIONS.md #12).
// ============================================================

type ChannelType = "instagram" | "sms" | "wechat" | "kakao";

// Reply-window rules per channel (hours). 0 = no window limit (SMS).
const WINDOW_HOURS: Record<ChannelType, number> = {
  instagram: 24,
  wechat: 48,
  sms: 0,
  kakao: 0, // consultation session; modeled when Kakao is built (post-MVP)
};

/** Common shape every per-channel handler produces from its raw payload. */
export type InboundMessage = {
  channel: ChannelType;
  /** Provider's stable id for the sender (IG-scoped id / E.164 / openid / kakao key). */
  externalUserId: string;
  /** Provider's stable id for THIS message — the dedupe key. */
  channelMessageId: string;
  /** Best-effort display handle/name from the provider. */
  displayHandle?: string | null;
  text?: string | null;
  media?: unknown | null;
  /** Provider's thread id, if any. */
  externalThreadId?: string | null;
  /** When the client sent it (ISO). Defaults to now. */
  sentAt?: string | null;
  /**
   * "in" = client → stylist (default). "out" = the stylist's OWN reply, echoed
   * back by the provider (e.g. they replied from the Instagram app, not Kasa) —
   * we record it so Kasa stays in sync with the real thread. For an echo,
   * externalUserId is the RECIPIENT (the client), not the sender.
   */
  direction?: "in" | "out";
};

export type NormalizeResult = {
  ok: boolean;
  deduped?: boolean;
  conversation_id?: string;
  client_id?: string;
  message_id?: string;
  reason?: string;
};

// deno-lint-ignore no-explicit-any
type Admin = any; // supabase-js service-role client

function windowExpiry(channel: ChannelType, fromIso: string): string | null {
  const hours = WINDOW_HOURS[channel];
  if (!hours) return null; // no window (SMS) → null
  return new Date(new Date(fromIso).getTime() + hours * 3600_000).toISOString();
}

/**
 * Resolve the owning stylist. Single-tenant today (one stylist row). When the
 * product is multi-tenant, the channel connection (channels.external_account_id)
 * will map the inbound account → stylist; that lookup slots in here.
 */
async function resolveStylistId(admin: Admin, _msg: InboundMessage): Promise<string | null> {
  // TODO(multi-tenant): map msg → channels row → stylist_id.
  const { data } = await admin.from("stylists").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function normalizeInbound(
  admin: Admin,
  msg: InboundMessage,
  opts: { signatureVerified: boolean; provider: string; rawPayload: unknown },
): Promise<NormalizeResult> {
  // sentAt = when the CLIENT sent it (provider clock) — for display only.
  // receivedAt = when WE received it (server clock) — anchors the reply window
  // and inbox ordering, which must not depend on a provider's (possibly skewed
  // or spoofed) timestamp. The reply-window gate is security-relevant.
  const receivedAt = new Date().toISOString();
  const sentAt = msg.sentAt ?? receivedAt;

  // 0) Persist raw payload for debugging (never trust it beyond this record).
  try {
    await admin.from("webhook_events").insert({
      provider: opts.provider,
      signature_verified: opts.signatureVerified,
      payload: opts.rawPayload,
    });
  } catch (err) {
    console.error("[inbound] webhook_events insert failed:", (err as Error).name);
    // non-fatal — keep going; debugging record is best-effort
  }

  // 1) DEDUPE on provider message id. A redelivery returns early, no new row.
  if (msg.channelMessageId) {
    const { data: existing } = await admin
      .from("messages")
      .select("id, conversation_id")
      .eq("channel_message_id", msg.channelMessageId)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        deduped: true,
        message_id: existing.id,
        conversation_id: existing.conversation_id,
      };
    }
  }

  const stylistId = await resolveStylistId(admin, msg);
  if (!stylistId) return { ok: false, reason: "stylist_not_found" };

  // 2) IDENTITY — match client_identities (channel + external user id), else create.
  let clientId: string | null = null;
  {
    const { data: ident } = await admin
      .from("client_identities")
      .select("client_id")
      .eq("channel_type", msg.channel)
      .eq("external_user_id", msg.externalUserId)
      .maybeSingle();

    if (ident?.client_id) {
      clientId = ident.client_id;
    } else {
      const handle = msg.displayHandle?.trim() || null;
      const { data: newClient, error: clientErr } = await admin
        .from("clients")
        .insert({
          stylist_id: stylistId,
          name: handle || "New client",
          value: "new",
          // Store the IG handle on the client so the profile's tappable
          // Instagram tag works. (handle is like "@username".)
          instagram_handle: msg.channel === "instagram" ? handle : null,
        })
        .select("id")
        .single();
      if (clientErr || !newClient) {
        return { ok: false, reason: "client_create_failed" };
      }
      clientId = newClient.id;

      // Create the identity. Unique (channel_type, external_user_id) guards a
      // race; on conflict, re-read the winner and drop our just-made client.
      const { error: identErr } = await admin
        .from("client_identities")
        .insert({
          client_id: clientId,
          channel_type: msg.channel,
          external_user_id: msg.externalUserId,
          display_handle: msg.displayHandle ?? null,
        });
      if (identErr) {
        const { data: winner } = await admin
          .from("client_identities")
          .select("client_id")
          .eq("channel_type", msg.channel)
          .eq("external_user_id", msg.externalUserId)
          .maybeSingle();
        if (winner?.client_id) {
          await admin.from("clients").delete().eq("id", clientId);
          clientId = winner.client_id;
        }
      }
    }
  }

  // 3) CONVERSATION — one per client per channel. Upsert sets/refreshes the
  //    reply window + unread + last_message_at on every inbound.
  let conversationId: string | null = null;
  {
    const { data: convo } = await admin
      .from("conversations")
      .select("id")
      .eq("client_id", clientId)
      .eq("channel_type", msg.channel)
      .maybeSingle();

    const isOut = msg.direction === "out";
    // An inbound (client) message refreshes the reply window + marks unread. An
    // echo (our own reply from the IG app) does NOT reopen the window or mark
    // unread — it's our message — but it does advance last_message_at and, like
    // sending from Kasa, clears unread.
    const fields: Record<string, unknown> = {
      stylist_id: stylistId,
      client_id: clientId,
      channel_type: msg.channel,
      external_thread_id: msg.externalThreadId ?? null,
      last_message_at: receivedAt,
      unread: isOut ? false : true,
    };
    if (!isOut) fields.window_expires_at = windowExpiry(msg.channel, receivedAt);

    if (convo?.id) {
      conversationId = convo.id;
      await admin.from("conversations").update(fields).eq("id", convo.id);
    } else {
      const { data: created, error: convoErr } = await admin
        .from("conversations")
        .insert(fields)
        .select("id")
        .single();
      if (convoErr || !created) return { ok: false, reason: "conversation_create_failed" };
      conversationId = created.id;
    }
  }

  // 3b) ECHO DEDUPE — when the stylist sends from Kasa, send-message already
  //     wrote an outbound row, then Instagram echoes that same message back via
  //     this webhook. The provider's send-response id and the echo's mid don't
  //     always match, so step-1's id dedupe can miss → a duplicate bubble. Guard
  //     it: if this is an echo and a matching recent outbound row already exists
  //     in this conversation (same body, last ~2 min), treat it as a duplicate.
  if (msg.direction === "out" && conversationId) {
    const since = new Date(new Date(receivedAt).getTime() - 120_000).toISOString();
    const { data: recent } = await admin
      .from("messages")
      .select("id, body")
      .eq("conversation_id", conversationId)
      .eq("direction", "out")
      .gte("sent_at", since);
    const dup = (recent ?? []).find((r: { body: string | null }) =>
      (r.body ?? "") === (msg.text ?? "")
    );
    if (dup) {
      // Backfill the provider id on the existing row so future redeliveries
      // hit the fast id-dedupe in step 1.
      if (msg.channelMessageId) {
        await admin.from("messages")
          .update({ channel_message_id: msg.channelMessageId })
          .eq("id", dup.id);
      }
      return { ok: true, deduped: true, message_id: dup.id, conversation_id: conversationId };
    }
  }

  // 4) MESSAGE — insert inbound row. Unique index on channel_message_id is the
  //    final dedupe backstop against a race past step 1.
  let messageId: string | null = null;
  {
    const { data: inserted, error: msgErr } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        direction: msg.direction === "out" ? "out" : "in",
        body: msg.text ?? null,
        media: msg.media ?? null,
        channel_message_id: msg.channelMessageId || null,
        status: msg.direction === "out" ? "sent" : "delivered",
        sent_at: sentAt,
      })
      .select("id")
      .single();
    if (msgErr) {
      // Likely the unique channel_message_id backstop firing on a race → treat
      // as deduped, not an error.
      return { ok: true, deduped: true, conversation_id: conversationId! };
    }
    messageId = inserted.id;
  }

  // 5) ENRICH — message is safely stored; now call parse-intent. NON-BLOCKING
  //    and fail-safe: any error here must not affect the stored message.
  if (msg.text && msg.text.trim()) {
    enrich(conversationId!, msg.text).catch((err) =>
      console.error("[inbound] enrich failed (message kept):", (err as Error).name)
    );
  }

  return {
    ok: true,
    deduped: false,
    conversation_id: conversationId!,
    client_id: clientId!,
    message_id: messageId!,
  };
}

/** Fire parse-intent for a conversation. Best-effort; never throws to caller. */
async function enrich(conversationId: string, text: string): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return;
  await fetch(`${url}/functions/v1/parse-intent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ conversation_id: conversationId, message: text }),
  });
}
