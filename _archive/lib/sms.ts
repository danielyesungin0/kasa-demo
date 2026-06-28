/**
 * Transactional SMS via Twilio. Fire-and-forget — callers never await this on
 * a booking-critical path. Failures log and continue; a booking is never
 * blocked or rolled back because a text didn't send.
 *
 * GATED + TEST-SAFE by design:
 *   - SMS_ENABLED must be exactly "true" to send anything. Default OFF, so
 *     nothing is ever texted until you explicitly turn it on (mirrors the
 *     SQUARE_BOOKING_ENABLED kill-switch). No flag → no-op, zero cost.
 *   - Missing Twilio creds → no-op (so a misconfigured deploy can't error).
 *   - In Twilio TRIAL mode, Twilio itself only delivers to verified numbers and
 *     prefixes a trial notice — so testing against your own verified phone costs
 *     ~$0 (trial credit) and can't message real clients by accident.
 *
 * Env vars (all optional — absence = no-op):
 *   SMS_ENABLED=true            master switch (default off)
 *   TWILIO_ACCOUNT_SID=AC...
 *   TWILIO_AUTH_TOKEN=...
 *   TWILIO_FROM_NUMBER=+1...    your Twilio number (or messaging service SID)
 *
 * PRODUCTION NOTE: sending to real US clients requires A2P 10DLC brand +
 * campaign registration in the Twilio console FIRST. Building/testing now does
 * not — keep SMS_ENABLED off (or texting only your verified trial number) until
 * registration clears.
 */

type SmsResult =
  | { ok: true }
  | { ok: false; reason: "disabled" | "not_configured" | "error" };

/**
 * Low-level send. Returns a structured result (no throw). Most callers should
 * use the typed helpers below and ignore the result (fire-and-forget).
 */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (process.env.SMS_ENABLED !== "true") {
    return { ok: false, reason: "disabled" };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    console.error("[sms] SMS_ENABLED but Twilio creds missing — skipping send");
    return { ok: false, reason: "not_configured" };
  }

  const toDigits = normalizePhone(to);
  if (!toDigits) {
    console.error("[sms] unsendable recipient number — skipping");
    return { ok: false, reason: "error" };
  }

  try {
    const params = new URLSearchParams({ To: toDigits, From: from, Body: body });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );
    if (!res.ok) {
      // Log status only — never the body (may echo the phone number).
      console.error(`[sms] Twilio send failed: ${res.status}`);
      return { ok: false, reason: "error" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[sms] Twilio send threw:", err instanceof Error ? err.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

/** Confirmation text sent right after a booking is created. */
export function sendBookingConfirmationSms(input: {
  to: string;
  clientName: string;
  serviceName: string;
  slotLabel: string; // "Tue, Jun 23 · 1:30 PM"
  stylistName: string;
}): void {
  const { to, serviceName, slotLabel, stylistName } = input;
  const body = `You're booked with ${stylistName}! ${serviceName} — ${slotLabel}. Reply to this text or use your booking link to reschedule. 💛`;
  void sendSms(to, body);
}

/** Reminder text sent before an upcoming appointment. */
export function sendReminderSms(input: {
  to: string;
  serviceName: string;
  slotLabel: string;
  stylistName: string;
  bookingUrl?: string | null;
}): void {
  const { to, serviceName, slotLabel, stylistName, bookingUrl } = input;
  const tail = bookingUrl ? ` Need to change it? ${bookingUrl}` : "";
  const body = `Reminder: ${serviceName} with ${stylistName} ${slotLabel}.${tail}`;
  void sendSms(to, body);
}

/** Normalize to E.164-ish. Returns null if there clearly aren't enough digits. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits.length >= 11 ? digits : null;
  if (digits.length === 10) return `+1${digits}`; // assume US for bare 10-digit
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

/** Whether SMS is actually live (flag on + creds present). For status/debug. */
export function smsConfigured(): boolean {
  return (
    process.env.SMS_ENABLED === "true" &&
    Boolean(process.env.TWILIO_ACCOUNT_SID) &&
    Boolean(process.env.TWILIO_AUTH_TOKEN) &&
    Boolean(process.env.TWILIO_FROM_NUMBER)
  );
}
