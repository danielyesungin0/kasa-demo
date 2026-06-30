// A tiny cross-screen hand-off for the post-booking flow. When Book finishes,
// it dismisses back to the screen underneath (the original chat thread, or the
// calendar) rather than pushing a NEW route — which previously created a
// duplicate thread instance (empty on swipe-back). The receiving screen reads
// this pending result on focus and clears it.
//
// Nothing here triggers a send — the draft is only seeded into the composer for
// the stylist to review (the never-auto-send guardrail).

export type PendingBooking = {
  conversationId: string | null; // chat to return to, if booked from a chat
  draft: string | null;          // confirmation message to seed (review only)
  dayKey: string;                // calendar day to highlight
  appointmentId?: string;        // the new appointment (for calendar highlight)
  toast: string;                 // e.g. "Appointment confirmed"
};

let pending: PendingBooking | null = null;

export function setPendingBooking(p: PendingBooking) { pending = p; }

/** Read + clear (one-shot). Returns null if nothing is pending. */
export function takePendingBooking(): PendingBooking | null {
  const p = pending;
  pending = null;
  return p;
}

/** Peek without clearing (used to decide whether to react on focus). */
export function peekPendingBooking(): PendingBooking | null {
  return pending;
}
