// Client wrapper for the send-message Edge Function. Returns an HONEST result:
//   - { ok: true }                → message written server-side (locally "sent";
//                                    NOT "delivered" — real channel delivery is
//                                    the Phase-4 TODO(send) stub)
//   - { ok: false, blocked: true }→ reply window closed; caller shows the honest
//                                    "Reply on {Channel}" state, no fake bubble
//   - { ok: false }               → error; caller shows failed/retry
import { supabase, FUNCTIONS_URL } from "./supabase";

export type SendResult =
  | { ok: true; messageId?: string }
  | { ok: false; blocked: true; channel?: string }
  | { ok: false; blocked?: false; error: string };

export type OutboundMedia = { type: "image" | "video" | "audio"; url: string };

export async function sendMessage(
  conversationId: string,
  text: string,
  media?: OutboundMedia | null,
): Promise<SendResult> {
  try {
    // TODO(auth): send-message has verify_jwt=true. There is no sign-in screen
    // yet, so we pass the anon key as a TEMPORARY testing seam. When the auth
    // screens land (next Phase-3 chunk), this must use the authenticated
    // stylist's session token (supabase.auth.getSession()) instead — that's the
    // real close for the auth gap. Do not ship anon access to this function.
    const { data: sessionData } = await supabase.auth.getSession();
    const token =
      sessionData.session?.access_token ??
      (supabase as any).supabaseKey; // anon fallback — temporary, see TODO(auth)

    const res = await fetch(`${FUNCTIONS_URL}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ conversation_id: conversationId, text, media: media ?? null }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data?.ok) return { ok: true, messageId: data.message_id };
    if (data?.blocked) return { ok: false, blocked: true, channel: data.channel };
    return { ok: false, error: data?.error ?? `http_${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).name };
  }
}
