import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/api/origin-check";
import { ensureFreshSquareToken } from "@/lib/square/ensure-fresh-token";
import { sendBookingConfirmation } from "@/lib/email";
import { SQUARE_BASE } from "@/lib/square/config";
import { resolveStylist } from "@/lib/stylists/resolve";
import { resolveBookingMode, isSquareReady } from "@/lib/bookings/mode";

export async function GET() {
  // Authenticated stylist only — this endpoint returns customer PII (names,
  // phones) for the dashboard. Anonymous callers must not be able to read it.
  const userClient = createServerSupabaseClient();
  const { data: authData } = await userClient.auth.getUser();
  if (!authData?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleSupabaseClient();

  // Find the stylist row owned by this auth user, then return only that
  // stylist's bookings. Today there's a single stylist; this still scales
  // to multi-stylist tomorrow without an endpoint change.
  const { data: stylist } = await admin
    .from("stylists")
    .select("id")
    .eq("user_id", authData.user.id)
    .single();

  if (!stylist) return NextResponse.json({ bookings: [] });

  const { data, error } = await admin
    .from("bookings")
    .select("id, customer_name, customer_phone, service_name, starts_at, ends_at, status, notes, square_booking_id")
    .eq("stylist_id", stylist.id)
    .gte("starts_at", new Date().toISOString())
    .eq("status", "confirmed")
    .order("starts_at", { ascending: true })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bookings: data ?? [] });
}

type BookingRequest = {
  serviceId: string;
  serviceName: string;
  slotStartAt: string;  // ISO UTC timestamp
  durationMinutes: number;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  notes?: string;
  /** Provider slug. When present, the booking is attributed strictly to that
   *  provider; when absent (legacy /shen), falls back to the first stylist. */
  slug?: string;
};

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: BookingRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { serviceId, serviceName, slotStartAt, durationMinutes, clientName, clientEmail, notes } = body;
  // Normalize phone to digits only before storing. The /shen UI now formats
  // numbers as the user types (e.g. "(444) 234-5678"), so we strip the
  // formatting characters here. Lookup expects digits-only equality matches
  // — without this normalization, formatted bookings would be unfindable.
  const rawPhone = body.clientPhone ?? "";
  const clientPhone = rawPhone.replace(/\D/g, "");

  if (!serviceId || !slotStartAt || !clientName || !clientPhone || !durationMinutes) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const admin = createServiceRoleSupabaseClient();

  // Resolve the provider STRICTLY by slug when one is sent (every /book/[slug]
  // booking includes it). Only the legacy slug-less /shen path falls back to
  // the first stylist row. This guarantees /book/<provider> books into that
  // provider — never into Shen via the old first-row default.
  const resolved = await resolveStylist(body.slug);
  if (!resolved) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  // Fetch the secret + Square columns by id (the shared resolver deliberately
  // doesn't select secrets). This is the same pattern used in
  // app/api/square/services/route.ts.
  const { data: stylist } = await admin
    .from("stylists")
    .select(
      "id, display_name, square_team_member_name, square_business_name, square_access_token, square_location_id, square_team_member_id, service_catalog"
    )
    .eq("id", resolved.id)
    .single();

  if (!stylist) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  const startsAt = new Date(slotStartAt);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

  // Booking mode (SQUARE_BOOKING_ENABLED):
  //   "true"   → LIVE: a Square Appointments booking is REQUIRED. If Square
  //              can't create it, the booking FAILS (no confirmed Supabase
  //              row, clear error to the client). No silent Supabase-only.
  //   "false"  → SAFE TEST: skip Square entirely, save to Supabase only.
  //              Zero calendar risk while testing the flow.
  //   unset    → LEGACY: try Square, fall back to Supabase (pre-production
  //              behavior, so current sandbox/dev testing is unaffected).
  const bookingMode = resolveBookingMode(process.env.SQUARE_BOOKING_ENABLED);

  let squareBookingId: string | null = null;

  // ── Resolve Square readiness (token + location + team member + variation) ──
  const catalog = (stylist.service_catalog ?? {}) as Record<string, any>;
  const svcEntry = catalog[serviceId];
  const tokenResult = await ensureFreshSquareToken(stylist.id);
  const accessToken = tokenResult.ok ? tokenResult.accessToken : null;
  const squareReady = isSquareReady({
    accessToken,
    locationId: stylist.square_location_id,
    teamMemberId: stylist.square_team_member_id,
    serviceVariationId: svcEntry?.squareVariationId,
  });

  // ── LIVE mode: Square is mandatory ─────────────────────────────────────────
  if (bookingMode === "live") {
    // Missing creds → cannot create a real appointment. Error BEFORE saving
    // any confirmed row, so the client never thinks they booked.
    if (!squareReady) {
      console.error("Live booking: Square not ready (missing creds)", {
        hasToken: Boolean(accessToken),
        hasLocation: Boolean(stylist.square_location_id),
        hasTeamMember: Boolean(stylist.square_team_member_id),
        hasVariation: Boolean(svcEntry?.squareVariationId),
      });
      return NextResponse.json(
        { error: "square_not_ready" },
        { status: 502 }
      );
    }

    try {
      squareBookingId = await createSquareBooking({
        accessToken: accessToken!,
        locationId: stylist.square_location_id!,
        teamMemberId: stylist.square_team_member_id!,
        serviceVariationId: svcEntry.squareVariationId,
        durationMinutes,
        startsAt,
        clientName,
        clientPhone,
        clientEmail: clientEmail ?? null,
        notes: notes ?? null,
      });
    } catch (err) {
      console.error("Live booking: Square CreateBooking failed:", err);
      squareBookingId = null;
    }

    // Square failed → do NOT confirm. Write a clearly-marked diagnostic row
    // (status='failed'), which availability ignores (it only blocks
    // confirmed/pending), then return an error so the client shows a clear
    // failure instead of a fake confirmation.
    if (!squareBookingId) {
      await admin.from("bookings").insert({
        stylist_id: stylist.id,
        square_booking_id: null,
        customer_name: clientName,
        customer_phone: clientPhone,
        customer_email: clientEmail ?? null,
        service_id: serviceId,
        service_name: serviceName,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: "failed",
        notes: notes ?? null,
      });
      return NextResponse.json(
        { error: "square_booking_failed" },
        { status: 502 }
      );
    }
    // Square succeeded — fall through to save the confirmed Supabase reference.
  }

  // ── LEGACY mode: try Square, fall back to Supabase (pre-production) ────────
  if (bookingMode === "legacy" && squareReady) {
    try {
      squareBookingId = await createSquareBooking({
        accessToken: accessToken!,
        locationId: stylist.square_location_id!,
        teamMemberId: stylist.square_team_member_id!,
        serviceVariationId: svcEntry.squareVariationId,
        durationMinutes,
        startsAt,
        clientName,
        clientPhone,
        clientEmail: clientEmail ?? null,
        notes: notes ?? null,
      });
    } catch (err) {
      console.error("Legacy booking: Square CreateBooking failed (Supabase-only):", err);
    }
  }

  // ── TEST mode: no Square call at all (Supabase-only, zero calendar risk) ───
  // (squareBookingId stays null; we just save the Supabase record below.)

  // Save the confirmed booking to Supabase. In live mode we only reach here
  // after Square succeeded (squareBookingId is non-null).
  const { data: booking, error: insertErr } = await admin
    .from("bookings")
    .insert({
      stylist_id: stylist.id,
      square_booking_id: squareBookingId,
      customer_name: clientName,
      customer_phone: clientPhone,
      customer_email: clientEmail ?? null,
      service_id: serviceId,
      service_name: serviceName,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "confirmed",
      notes: notes ?? null,
    })
    .select("id")
    .single();

  if (insertErr || !booking) {
    console.error("Supabase booking insert failed:", insertErr);
    return NextResponse.json({ error: "booking_save_failed" }, { status: 500 });
  }

  // Fire-and-forget email confirmation. Never await — booking succeeded
  // even if email fails. Skipped silently when no client email or no
  // RESEND_API_KEY configured.
  if (clientEmail) {
    const stylistName =
      stylist.display_name ??
      stylist.square_team_member_name ??
      stylist.square_business_name ??
      "your stylist";
    const slotLabel = formatSlotLabel(startsAt);
    void sendBookingConfirmation({
      to: clientEmail,
      clientName,
      serviceName,
      slotLabel,
      stylistName,
    });
  }

  return NextResponse.json({
    bookingId: booking.id,
    squareBookingId,
    status: "confirmed",
    // "square" = on Shen's calendar; "test_no_square" = safe-test mode,
    // intentionally not on the calendar; "supabase_only" = legacy fallback.
    source: squareBookingId
      ? "square"
      : bookingMode === "test"
        ? "test_no_square"
        : "supabase_only",
  });
}

function formatSlotLabel(startsAt: Date): string {
  const tz = "America/New_York";
  const day = startsAt.toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = startsAt.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

// --------------------------------------------------------------------------
// Square CreateBooking helper
// --------------------------------------------------------------------------

type SquareBookingOptions = {
  accessToken: string;
  locationId: string;
  teamMemberId: string;
  serviceVariationId: string;
  durationMinutes: number;
  startsAt: Date;
  clientName: string;
  clientPhone: string;
  clientEmail: string | null;
  notes: string | null;
};

async function createSquareBooking(opts: SquareBookingOptions): Promise<string> {
  const {
    accessToken, locationId, teamMemberId, serviceVariationId,
    durationMinutes, startsAt, clientName, clientPhone, clientEmail, notes,
  } = opts;

  // Find or create Square customer
  const customerId = await findOrCreateSquareCustomer({
    accessToken,
    clientName,
    clientPhone,
    clientEmail,
  });

  const idempotencyKey = `booking-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const res = await fetch(`${SQUARE_BASE}/v2/bookings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": "2024-01-18",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      booking: {
        location_id: locationId,
        start_at: startsAt.toISOString(),
        customer_id: customerId,
        customer_note: notes ?? undefined,
        appointment_segments: [
          {
            duration_minutes: durationMinutes,
            service_variation_id: serviceVariationId,
            team_member_id: teamMemberId,
          },
        ],
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Square CreateBooking ${res.status}: ${body}`);
  }

  const data = await res.json();
  const bookingId = data.booking?.id;
  if (!bookingId) throw new Error("Square returned no booking id");
  return bookingId;
}

async function findOrCreateSquareCustomer(opts: {
  accessToken: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string | null;
}): Promise<string> {
  const { accessToken, clientName, clientPhone, clientEmail } = opts;

  // Search by phone first
  const searchRes = await fetch(`${SQUARE_BASE}/v2/customers/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": "2024-01-18",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: {
        filter: {
          phone_number: { exact: clientPhone },
        },
      },
      limit: 1,
    }),
  });

  if (searchRes.ok) {
    const searchData = await searchRes.json();
    const existing = searchData.customers?.[0];
    if (existing?.id) return existing.id;
  }

  // Create new customer
  const [givenName, ...rest] = clientName.trim().split(/\s+/);
  const familyName = rest.join(" ") || undefined;

  const createRes = await fetch(`${SQUARE_BASE}/v2/customers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": "2024-01-18",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: `customer-${clientPhone}-${Date.now()}`,
      given_name: givenName,
      family_name: familyName,
      phone_number: clientPhone,
      email_address: clientEmail ?? undefined,
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Square CreateCustomer ${createRes.status}: ${body}`);
  }

  const createData = await createRes.json();
  const customerId = createData.customer?.id;
  if (!customerId) throw new Error("Square returned no customer id");
  return customerId;
}
