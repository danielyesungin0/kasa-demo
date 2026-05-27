import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/api/origin-check";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * Server-side last-4 verification for cancel / reschedule flows.
 *
 * Client sends { bookingId, last4 }, server compares against the stored
 * customer_phone and returns ok|fail. The phone number itself never
 * leaves the server, which prevents enumeration of customer PII.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const rate = checkRateLimit(request, "bookings-verify");
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } }
    );
  }

  let body: { bookingId?: string; last4?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const bookingId = body.bookingId?.trim();
  const last4 = body.last4?.replace(/\D/g, "").slice(-4) ?? "";

  if (!bookingId || last4.length !== 4) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const admin = createServiceRoleSupabaseClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("customer_phone")
    .eq("id", bookingId)
    .single();

  // Constant message regardless of whether the booking exists — don't leak
  // booking-existence as an oracle.
  if (!booking?.customer_phone) {
    return NextResponse.json({ ok: false });
  }

  const expected = booking.customer_phone.replace(/\D/g, "").slice(-4);
  return NextResponse.json({ ok: last4 === expected });
}
