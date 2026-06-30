// ============================================================
// square-cancel-booking — cancels an appointment on Square AND in Kasa.
//
// Cancelling in Kasa must stay in sync with Square (frees the slot, triggers
// Square's own client notification per the seller's settings). Flow:
//   1. load the appointment + its square_booking_id (+ stylist).
//   2. fetch the booking's current version (Square requires it to cancel).
//   3. POST /v2/bookings/{id}/cancel.
//   4. mark the local appointments row status='canceled'.
// If the Square cancel fails, we do NOT mark it canceled locally (avoid drift) —
// return an honest error. verify_jwt=true (only the authenticated stylist).
//
// Request (POST): { appointment_id }
// Response: { ok } | { error }
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { ensureFreshSquareToken, SQUARE_BASE } from "../_shared/square-token.ts";

const SQUARE_VERSION = "2024-01-18";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { appointment_id?: string };
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid_json" }, 400); }
  if (!body.appointment_id) return jsonResponse({ error: "missing_appointment_id" }, 400);

  const admin = createAdminClient();

  const { data: appt } = await admin
    .from("appointments")
    .select("id, stylist_id, square_booking_id, status")
    .eq("id", body.appointment_id)
    .maybeSingle();
  if (!appt) return jsonResponse({ error: "appointment_not_found" }, 404);
  if (appt.status === "canceled") return jsonResponse({ ok: true }); // idempotent

  // If it has a Square booking, cancel it there FIRST (source of truth).
  if (appt.square_booking_id) {
    const tok = await ensureFreshSquareToken(admin, appt.stylist_id);
    if (!tok.ok) return jsonResponse({ error: "square_not_connected" }, 400);
    const H = {
      Authorization: `Bearer ${tok.accessToken}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    };
    try {
      // Square needs the booking's current version to cancel.
      const g = await fetch(`${SQUARE_BASE}/v2/bookings/${appt.square_booking_id}`, { headers: H });
      if (!g.ok) {
        // 404 = already gone on Square; allow local cancel to proceed.
        if (g.status !== 404) {
          console.error("[cancel] fetch booking", g.status);
          return jsonResponse({ error: "square_unreachable" }, 502);
        }
      } else {
        const version = (await g.json()).booking?.version;
        const c = await fetch(`${SQUARE_BASE}/v2/bookings/${appt.square_booking_id}/cancel`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({ booking_version: version }),
        });
        if (!c.ok) {
          const code = (await c.json().catch(() => ({})))?.errors?.[0]?.code ?? "unknown";
          console.error("[cancel] Square cancel", c.status, code);
          return jsonResponse({ error: "square_cancel_failed", square_code: code }, 502);
        }
      }
    } catch (e) {
      console.error("[cancel] threw", (e as Error).name);
      return jsonResponse({ error: "square_unreachable" }, 502);
    }
  }

  // Mark canceled locally (calendar/Today filter out canceled).
  const { error: updErr } = await admin
    .from("appointments")
    .update({ status: "canceled" })
    .eq("id", appt.id);
  if (updErr) return jsonResponse({ error: "local_update_failed" }, 500);

  return jsonResponse({ ok: true });
});
