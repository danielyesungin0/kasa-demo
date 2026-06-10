import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/api/origin-check";
import { ensureFreshSquareToken } from "@/lib/square/ensure-fresh-token";
import { sendBookingConfirmation } from "@/lib/email";
import { SQUARE_BASE } from "@/lib/square/config";

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

  // Load stylist row
  const { data: stylist } = await admin
    .from("stylists")
    .select(
      "id, display_name, square_team_member_name, square_business_name, square_access_token, square_location_id, square_team_member_id, service_catalog"
    )
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (!stylist) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  const startsAt = new Date(slotStartAt);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

  // Attempt Square CreateBooking if fully connected.
  // Refreshes the token if within 48 hours of expiry so we never hand a
  // near-dead token to Square. If the refresh fails, we fall through to
  // Supabase-only (existing behavior) instead of failing the booking.
  let squareBookingId: string | null = null;

  const tokenResult = await ensureFreshSquareToken(stylist.id);
  const accessToken = tokenResult.ok ? tokenResult.accessToken : null;

  if (
    accessToken &&
    stylist.square_location_id &&
    stylist.square_team_member_id
  ) {
    const catalog = (stylist.service_catalog ?? {}) as Record<string, any>;
    const svcEntry = catalog[serviceId];

    if (svcEntry?.squareVariationId) {
      try {
        squareBookingId = await createSquareBooking({
          accessToken,
          locationId: stylist.square_location_id,
          teamMemberId: stylist.square_team_member_id,
          serviceVariationId: svcEntry.squareVariationId,
          durationMinutes,
          startsAt,
          clientName,
          clientPhone,
          clientEmail: clientEmail ?? null,
          notes: notes ?? null,
        });
      } catch (err) {
        // Log but don't fail — fall through to Supabase-only booking
        console.error("Square CreateBooking failed (saving to Supabase only):", err);
      }
    }
  }

  // Save to Supabase bookings table
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
    source: squareBookingId ? "square" : "supabase_only",
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
