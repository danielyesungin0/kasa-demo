// ============================================================
// square-create-booking — the ONLY path that writes a booking to Square.
//
// Ported from app/api/bookings/route.ts (POST) + the token/crypto plumbing.
// NOT DEPLOYED until the Square sandbox is linked and the owner signs off; it
// makes a real CreateBooking call.
//
// ── Correctness rules baked in (per owner direction) ──
// 1. IDEMPOTENCY (#1 requirement): the Square idempotency_key is DETERMINISTIC,
//    derived from stylist + service variation + start instant + client phone.
//    A retry or a double-tap therefore reuses the SAME key, and Square returns
//    the SAME booking instead of creating a duplicate. (The old code used
//    `Date.now()+random` — non-idempotent; that was the duplicate-booking bug
//    this design fixes.) Same treatment for find-or-create customer.
// 2. ORDER OF WRITES: call Square FIRST; only on success mirror it into the
//    `appointments` row. Square fails → write NOTHING locally, return an honest
//    "couldn't reach Square". Square succeeds but the local insert fails → DO
//    NOT roll back the Square booking (it's real now); log it and let the
//    Square booking.created webhook reconcile later (Phase 4). Never write
//    appointments first.
// 3. SECRETS: ENCRYPTION_KEY in function secrets (name only in .env.example).
//    Never log decrypted tokens. Refuse to run if ENCRYPTION_KEY is missing
//    (assertEncryptionKey) rather than handle OAuth tokens in plaintext.
// 4. BOUNDARY: only this function writes bookings to Square. Availability is
//    read-only.
//
// Request (POST): {
//   stylist_id?, client_id?, service_id?, service_variation_id?,
//   starts_at (ISO), duration_minutes, client_name, client_phone,
//   client_email?, notes?, origin_conversation_id?
// }
// Response: { ok, square_booking_id, appointment_id?, mirrored, source }
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { assertEncryptionKey } from "../_shared/crypto.ts";
import { ensureFreshSquareToken, SQUARE_BASE } from "../_shared/square-token.ts";

const SQUARE_VERSION = "2024-01-18";

/** Stable digest → deterministic idempotency key (SHA-256, hex). Same inputs
 *  always produce the same key, so retries/double-taps dedupe at Square. */
async function stableKey(prefix: string, parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join("|"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}-${hex.slice(0, 48)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // Refuse to handle Square OAuth tokens without an encryption key.
  try {
    assertEncryptionKey();
  } catch (err) {
    console.error("[create-booking]", (err as Error).message);
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  let body: {
    stylist_id?: string;
    client_id?: string;
    service_id?: string;
    service_variation_id?: string;
    starts_at?: string;
    duration_minutes?: number;
    client_name?: string;
    client_phone?: string;
    client_email?: string;
    notes?: string;
    origin_conversation_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const clientName = (body.client_name ?? "").trim();
  const clientPhone = (body.client_phone ?? "").replace(/\D/g, ""); // digits only
  const startsAtIso = body.starts_at ?? "";
  const durationMinutes = body.duration_minutes ?? 0;

  // Phone is optional — Instagram/WeChat clients often have none. Square's
  // customer create works with just a name.
  if (!startsAtIso || !clientName || !durationMinutes) {
    return jsonResponse({ error: "missing_required_fields" }, 400);
  }

  const admin = createAdminClient();

  // Resolve stylist (explicit id, else single owner row).
  let stylistId = body.stylist_id ?? null;
  if (!stylistId) {
    const { data: s } = await admin.from("stylists").select("id").limit(1)
      .maybeSingle();
    stylistId = s?.id ?? null;
  }
  if (!stylistId) return jsonResponse({ error: "stylist_not_found" }, 404);

  // Pull Square connection columns + resolve the service variation.
  const { data: stylist } = await admin
    .from("stylists")
    .select(
      "id, square_location_id, square_team_member_id, service_catalog",
    )
    .eq("id", stylistId)
    .single();
  if (!stylist) return jsonResponse({ error: "stylist_not_found" }, 404);

  // Service variation: explicit wins; else look it up from the service row /
  // service_catalog (kept compatible with how the old catalog stored it).
  let serviceVariationId = body.service_variation_id ?? null;
  if (!serviceVariationId && body.service_id) {
    const { data: svc } = await admin
      .from("provider_services")
      .select("square_variation_id")
      .eq("id", body.service_id)
      .maybeSingle();
    serviceVariationId = svc?.square_variation_id ?? null;
  }

  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

  // Fresh Square token (decrypt + refresh if near expiry).
  const tokenResult = await ensureFreshSquareToken(admin, stylistId);
  const accessToken = tokenResult.ok ? tokenResult.accessToken : null;

  const ready = Boolean(
    accessToken &&
      stylist.square_location_id &&
      stylist.square_team_member_id &&
      serviceVariationId,
  );
  if (!ready) {
    // Cannot create a real appointment — error BEFORE writing anything local,
    // so the client never thinks they booked. (Square is source of truth.)
    return jsonResponse({ error: "square_not_ready" }, 502);
  }

  // Square's CreateBooking requires the service variation's CURRENT catalog
  // version in the appointment segment. Fetch it (cheap, one GET). Without it
  // Square rejects the booking ("service_variation_version" required / stale).
  let serviceVariationVersion: number | undefined;
  try {
    const catRes = await fetch(
      `${SQUARE_BASE}/v2/catalog/object/${serviceVariationId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Square-Version": SQUARE_VERSION,
        },
      },
    );
    if (catRes.ok) {
      const catData = await catRes.json();
      serviceVariationVersion = catData.object?.version;
    }
  } catch {
    // non-fatal; we still try the booking (Square may infer the latest)
  }

  // ── 1) Square FIRST. Deterministic idempotency keys dedupe retries. ──
  let squareBookingId: string;
  try {
    const customerId = await findOrCreateCustomer(
      accessToken!,
      clientName,
      clientPhone,
      body.client_email ?? null,
    );

    const idempotencyKey = await stableKey("bk", [
      stylistId,
      serviceVariationId!,
      startsAt.toISOString(),
      clientPhone,
    ]);

    const res = await fetch(`${SQUARE_BASE}/v2/bookings`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        booking: {
          location_id: stylist.square_location_id,
          start_at: startsAt.toISOString(),
          customer_id: customerId,
          customer_note: body.notes ?? undefined,
          appointment_segments: [
            {
              duration_minutes: durationMinutes,
              service_variation_id: serviceVariationId,
              service_variation_version: serviceVariationVersion,
              team_member_id: stylist.square_team_member_id,
            },
          ],
        },
      }),
    });

    if (!res.ok) {
      // Capture Square's error CODE (safe — not token/customer material) so we
      // can diagnose. The detail field can be specific; status alone hid the
      // service_variation_version requirement before.
      let code = "unknown";
      try {
        const errBody = await res.json();
        code = errBody?.errors?.[0]?.code ?? "unknown";
        console.error("[create-booking] Square CreateBooking", res.status, code, errBody?.errors?.[0]?.detail ?? "");
      } catch {
        console.error("[create-booking] Square CreateBooking", res.status);
      }
      return jsonResponse({ error: "square_booking_failed", square_code: code }, 502);
    }
    const data = await res.json();
    squareBookingId = data.booking?.id;
    if (!squareBookingId) {
      console.error("[create-booking] Square returned no booking id");
      return jsonResponse({ error: "square_booking_failed" }, 502);
    }
  } catch (err) {
    console.error("[create-booking] Square call threw:", (err as Error).name);
    return jsonResponse({ error: "square_unreachable" }, 502);
  }

  // ── 2) Square succeeded → mirror into appointments. If THIS fails, do NOT
  //    roll back Square (it's a real booking); log + return ok so the client
  //    sees success, and the booking.created webhook reconciles the row later. ──
  let appointmentId: string | null = null;
  let mirrored = false;
  try {
    // Idempotent mirror without upsert: a duplicate can only happen on a retry
    // of the SAME Square booking (deterministic idempotency key dedupes at
    // Square), so if a row already exists for this square_booking_id, reuse it.
    const { data: existing } = await admin
      .from("appointments")
      .select("id")
      .eq("square_booking_id", squareBookingId)
      .maybeSingle();

    let appt: { id: string } | null = existing as { id: string } | null;
    let insertErr: { message: string } | null = null;
    if (!existing) {
      const ins = await admin
        .from("appointments")
        .insert({
          stylist_id: stylistId,
          client_id: body.client_id ?? null,
          service_id: body.service_id ?? null,
          square_booking_id: squareBookingId,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          status: "booked",
          source: "kasa",
          origin_conversation_id: body.origin_conversation_id ?? null,
        })
        .select("id")
        .maybeSingle();
      appt = ins.data as { id: string } | null;
      insertErr = ins.error;
    }
    if (insertErr) {
      console.error(
        "[create-booking] appointments mirror failed (Square booking stands):",
        insertErr.message,
      );
    } else {
      appointmentId = appt?.id ?? null;
      mirrored = true;
    }
  } catch (err) {
    console.error(
      "[create-booking] appointments mirror threw (Square booking stands):",
      (err as Error).name,
    );
  }

  return jsonResponse({
    ok: true,
    square_booking_id: squareBookingId,
    appointment_id: appointmentId,
    mirrored,
    source: "square",
  });
});

// --------------------------------------------------------------------------
// Square customer find-or-create (deterministic idempotency on create).
// --------------------------------------------------------------------------
async function findOrCreateCustomer(
  accessToken: string,
  clientName: string,
  clientPhone: string,
  clientEmail: string | null,
): Promise<string> {
  // Search by phone first when we have one (cheap dedupe). Many channels (IG/
  // WeChat) have no phone — skip the search then and create by name.
  if (clientPhone) {
    const searchRes = await fetch(`${SQUARE_BASE}/v2/customers/search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: { filter: { phone_number: { exact: clientPhone } } },
        limit: 1,
      }),
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const existing = searchData.customers?.[0];
      if (existing?.id) return existing.id;
    }
  }

  const [givenName, ...rest] = clientName.trim().split(/\s+/);
  const familyName = rest.join(" ") || undefined;

  // Deterministic key (no Date.now()) so a retry doesn't create a second
  // customer. Key on phone if present, else the name.
  const custKey = await stableKey("cust", [clientPhone || clientName]);

  const createRes = await fetch(`${SQUARE_BASE}/v2/customers`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: custKey,
      given_name: givenName,
      family_name: familyName,
      phone_number: clientPhone || undefined,
      email_address: clientEmail ?? undefined,
    }),
  });
  if (!createRes.ok) {
    console.error("[create-booking] Square CreateCustomer", createRes.status);
    throw new Error("square_create_customer_failed");
  }
  const createData = await createRes.json();
  const customerId = createData.customer?.id;
  if (!customerId) throw new Error("square_no_customer_id");
  return customerId;
}
