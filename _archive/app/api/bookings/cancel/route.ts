import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/api/origin-check";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { ensureFreshSquareToken } from "@/lib/square/ensure-fresh-token";
import { SQUARE_BASE } from "@/lib/square/config";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rate = checkRateLimit(request, "bookings-cancel");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } }
    );
  }

  let body: { bookingId?: string; last4?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const bookingId = body.bookingId?.trim();
  const last4 = body.last4?.replace(/\D/g, "").slice(-4) ?? "";

  if (!bookingId) {
    return NextResponse.json({ error: "bookingId required" }, { status: 400 });
  }

  // Last-4 verification is required for any cancel. Without it, anyone who
  // knows or guesses a booking ID can cancel someone else's appointment.
  if (last4.length !== 4) {
    return NextResponse.json({ error: "last4_required" }, { status: 400 });
  }

  const admin = createServiceRoleSupabaseClient();

  // Load the booking row + customer phone for verification
  const { data: booking } = await admin
    .from("bookings")
    .select("id, square_booking_id, stylist_id, customer_phone")
    .eq("id", bookingId)
    .single();

  if (!booking) {
    // Not a Supabase booking (e.g. mock store ID) — nothing to do
    return NextResponse.json({ status: "not_found" });
  }

  // Verify last-4 server-side. Constant-ish response timing isn't critical
  // here; preventing the mass-cancel attack is.
  const expectedLast4 = booking.customer_phone?.replace(/\D/g, "").slice(-4) ?? "";
  if (!expectedLast4 || expectedLast4 !== last4) {
    return NextResponse.json({ error: "verification_failed" }, { status: 403 });
  }

  // Cancel in Supabase
  await admin
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);

  // Cancel in Square if we have a Square booking ID
  if (booking.square_booking_id) {
    try {
      // ensureFreshSquareToken refreshes the OAuth token if it's near
      // expiry. If refresh fails, we skip the Square cancel — Supabase has
      // already been updated, so the client sees a successful cancel.
      const tokenResult = await ensureFreshSquareToken(booking.stylist_id);
      const accessToken = tokenResult.ok ? tokenResult.accessToken : null;
      if (accessToken) {
        // Square requires the booking version — fetch it first
        const getRes = await fetch(
          `${SQUARE_BASE}/v2/bookings/${booking.square_booking_id}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Square-Version": "2024-01-18",
            },
          }
        );
        if (getRes.ok) {
          const getData = await getRes.json();
          const version = getData.booking?.version ?? 0;

          await fetch(
            `${SQUARE_BASE}/v2/bookings/${booking.square_booking_id}/cancel`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Square-Version": "2024-01-18",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                idempotency_key: `cancel-${bookingId}-${Date.now()}`,
                booking_version: version,
              }),
            }
          );
        }
      }
    } catch (err) {
      console.error("Square cancel failed (Supabase already updated):", err);
    }
  }

  return NextResponse.json({ status: "cancelled" });
}
