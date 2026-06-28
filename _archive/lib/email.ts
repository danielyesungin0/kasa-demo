/**
 * Transactional email via Resend. Designed to be fire-and-forget — callers
 * should never await the result on a booking-critical path. If the API key
 * is missing or Resend is down, we log and continue rather than failing the
 * booking.
 *
 * Required env vars (both optional — if missing, sending is a no-op):
 *   RESEND_API_KEY        — get one at https://resend.com (free tier 100/day)
 *   RESEND_FROM_EMAIL     — e.g. "Kasa <bookings@yourdomain.com>", or use
 *                           "onboarding@resend.dev" for testing without a
 *                           verified domain.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type BookingConfirmationFields = {
  to: string;
  clientName: string;
  serviceName: string;
  slotLabel: string; // e.g. "Tue, May 19 · 2:30 PM"
  stylistName: string;
};

export async function sendBookingConfirmation(
  fields: BookingConfirmationFields
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM_EMAIL ?? "Kasa <onboarding@resend.dev>";
  if (!apiKey) return; // no key = no-op, don't crash

  const { to, clientName, serviceName, slotLabel, stylistName } = fields;

  const subject = `Your appointment with ${stylistName} is confirmed`;
  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h1 style="font-size: 22px; font-weight: 500; margin: 0 0 16px;">You're booked</h1>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px;">
        Hi ${escapeHtml(clientName)}, your appointment with
        ${escapeHtml(stylistName)} is confirmed:
      </p>
      <div style="border: 1px solid #e5e5e5; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0; font-weight: 500;">${escapeHtml(serviceName)}</p>
        <p style="margin: 6px 0 0; color: #666; font-size: 14px;">${escapeHtml(slotLabel)}</p>
      </div>
      <p style="font-size: 13px; color: #666; line-height: 1.5; margin: 16px 0 0;">
        Need to make a change? Reply to this email or visit the booking link
        ${escapeHtml(stylistName)} shared with you.
      </p>
    </div>
  `;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("Resend send failed:", res.status, body);
    }
  } catch (err) {
    console.error("Resend send error:", err);
  }
}

export type HandoffNotificationFields = {
  to: string; // stylist's handoff_email
  stylistName: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string | null;
  summary: string; // AI/edited summary the client reviewed
  sourceMessage: string | null; // the original client message
};

/**
 * Notify the stylist that a client wants to reach them directly. Sent after
 * the handoff_request row is durably saved, so this is best-effort: a failure
 * here never affects whether the handoff was recorded. No-op when RESEND_API_KEY
 * is missing (same contract as sendBookingConfirmation). Never throws.
 */
export async function sendHandoffNotification(
  fields: HandoffNotificationFields
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM_EMAIL ?? "Kasa <onboarding@resend.dev>";
  if (!apiKey) return; // no key = no-op, don't crash

  const {
    to,
    stylistName,
    clientName,
    clientPhone,
    clientEmail,
    summary,
    sourceMessage,
  } = fields;

  const subject = `New client message for ${stylistName}`;
  const contactLine = [
    clientPhone ? `Phone: ${escapeHtml(clientPhone)}` : null,
    clientEmail ? `Email: ${escapeHtml(clientEmail)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h1 style="font-size: 22px; font-weight: 500; margin: 0 0 16px;">New client message</h1>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px;">
        A client reached out through your booking helper and would like you to
        follow up.
      </p>
      <div style="border: 1px solid #e5e5e5; border-radius: 12px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0; font-weight: 500;">${escapeHtml(clientName)}</p>
        ${contactLine ? `<p style="margin: 6px 0 0; color: #666; font-size: 14px;">${contactLine}</p>` : ""}
        <p style="margin: 12px 0 0; font-size: 14px; line-height: 1.5;">${escapeHtml(summary)}</p>
        ${
          sourceMessage
            ? `<p style="margin: 12px 0 0; color: #888; font-size: 13px; line-height: 1.5;">Original message: "${escapeHtml(sourceMessage)}"</p>`
            : ""
        }
      </div>
      <p style="font-size: 13px; color: #666; line-height: 1.5; margin: 16px 0 0;">
        This request is also saved in your Kasa dashboard inbox.
      </p>
    </div>
  `;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("Resend handoff send failed:", res.status, body);
    }
  } catch (err) {
    console.error("Resend handoff send error:", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
