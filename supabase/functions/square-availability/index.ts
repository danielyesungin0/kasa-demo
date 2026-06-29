// ============================================================
// square-availability — duration-aware, conflict-aware open slots.
//
// Ported from app/api/availability/route.ts + lib/availability.ts, adapted to
// the new schema (bookings -> appointments) and the new app's real service ids.
//
// Source of truth for what's open = the stylist's own data:
//   stylist_availability (day windows) − appointments (booked/pending)
//   − blocked_times, with duration + min-notice applied (see _shared/availability.ts).
//
// SQUARE SEAM (not wired yet — no Square connection exists):
//   Once the stylist's Square account is linked, this function should also call
//   Square Bookings `SearchAvailability` and INTERSECT it with the slots below,
//   so we never offer a time Square would reject. That call needs a fresh
//   Square token (see lib/square/ensure-fresh-token.ts → to be ported to
//   _shared when square-create-booking is built). Until then, our own
//   availability/appointments/blocked_times ARE the truth. Marked clearly so
//   it's added deliberately, not deployed blind. (DECISIONS.md #11.)
//
// NOT DEPLOYED until the Square sandbox is linked.
//
// Request (POST): { stylist_id?: string, service_id?: string,
//                   duration_minutes?: number, week_shift?: number,
//                   week_count?: number }
//   - service_id: a public.services / provider_services row id (preferred —
//     duration resolved from it). If absent, duration_minutes is used; else 60.
// Response: { slots: TimeSlot[], durationMinutes: number }
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import {
  type BlockedTimeRow,
  generateSlots,
  type StylistAvailabilityRow,
  type TimeSlot,
} from "../_shared/availability.ts";
import { ensureFreshSquareToken, SQUARE_BASE } from "../_shared/square-token.ts";

const DEFAULT_DURATION_MIN = 60;
const WEEK_COUNT_DEFAULT = 3;
const SQUARE_VERSION = "2024-01-18";
const TZ = "America/New_York";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Format a UTC instant into the TimeSlot shape the app expects, in NY wall time.
function squareSlotFromIso(iso: string): TimeSlot {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const y = get("year"), mo = get("month"), day = get("day");
  let hh = parseInt(get("hour"), 10); const mm = get("minute");
  const dateKey = `${y}-${mo}-${day}`;
  const dow = new Date(Date.UTC(+y, +mo - 1, +day)).getUTCDay();
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const timeLabel = `${h12}:${mm} ${ampm}`;
  const monthName = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+mo - 1];
  return {
    id: `sq-${iso}`,
    dayLabel: DOW[dow],
    dateLabel: `${monthName} ${+day}`,
    timeLabel,
    fullLabel: `${DOW[dow]} ${timeLabel}`,
    dateKey,
    dayOfMonth: +day,
    hour24: hh,
    isoTime: `${String(hh).padStart(2, "0")}:${mm}`,
    startsAtIso: d.toISOString(),
  };
}

// Query Square's real SearchAvailability (seller hours + staff + bookings).
async function searchSquareAvailability(args: {
  accessToken: string;
  locationId: string;
  teamMemberId: string;
  serviceVariationId: string;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<TimeSlot[]> {
  // Square caps the search window (~32 days); clamp to be safe.
  const end = new Date(Math.min(
    args.rangeEnd.getTime(),
    args.rangeStart.getTime() + 31 * 86400000,
  ));
  const res = await fetch(`${SQUARE_BASE}/v2/bookings/availability/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: {
        filter: {
          start_at_range: {
            start_at: args.rangeStart.toISOString(),
            end_at: end.toISOString(),
          },
          location_id: args.locationId,
          segment_filters: [{
            service_variation_id: args.serviceVariationId,
            team_member_id_filter: { any: [args.teamMemberId] },
          }],
        },
      },
    }),
  });
  if (!res.ok) {
    console.error("[availability] Square SearchAvailability", res.status);
    return [];
  }
  const data = await res.json();
  return (data.availabilities ?? []).map((a: any) => squareSlotFromIso(a.start_at));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: {
    stylist_id?: string;
    service_id?: string;
    duration_minutes?: number;
    week_shift?: number;
    week_count?: number;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const weekShift = Math.max(0, Math.floor(body.week_shift ?? 0));
  const weekCount = Math.max(1, Math.floor(body.week_count ?? WEEK_COUNT_DEFAULT));

  const admin = createAdminClient();

  // Resolve the stylist: explicit id, else the single owner row (single-tenant
  // today; multi-tenant will always pass stylist_id).
  let stylistId = body.stylist_id ?? null;
  if (!stylistId) {
    const { data: s } = await admin.from("stylists").select("id").limit(1)
      .maybeSingle();
    stylistId = s?.id ?? null;
  }
  if (!stylistId) return jsonResponse({ error: "stylist_not_found" }, 404);

  // Resolve duration + Square variation from provider_services (the live
  // catalog). Falls back to passed duration / default.
  let durationMinutes = body.duration_minutes ?? DEFAULT_DURATION_MIN;
  let serviceVariationId: string | null = body.service_variation_id ?? null;
  if (body.service_id) {
    const { data: svc } = await admin
      .from("provider_services")
      .select("duration_minutes, square_variation_id")
      .eq("id", body.service_id)
      .maybeSingle();
    if (svc?.duration_minutes) durationMinutes = svc.duration_minutes;
    if (svc?.square_variation_id) serviceVariationId = svc.square_variation_id;
  }

  // Day-of-week windows.
  const { data: availRows } = await admin
    .from("stylist_availability")
    .select("day_of_week, start_time, end_time, is_active")
    .eq("stylist_id", stylistId);

  // Relevant date range for blocked/booked reads.
  const now = new Date();
  const rangeStart = new Date(now.getTime() + weekShift * 7 * 86400000);
  const rangeEnd = new Date(rangeStart.getTime() + weekCount * 7 * 86400000);

  const { data: blockedRows } = await admin
    .from("blocked_times")
    .select("starts_at, ends_at")
    .eq("stylist_id", stylistId)
    .gte("starts_at", rangeStart.toISOString())
    .lte("ends_at", rangeEnd.toISOString());

  // Confirmed/pending appointments count as blocked (renamed from `bookings`;
  // new status vocabulary is 'booked'; keep 'pending'/'confirmed' tolerant).
  const { data: apptRows } = await admin
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("stylist_id", stylistId)
    .in("status", ["booked", "pending", "confirmed"])
    .gte("starts_at", rangeStart.toISOString())
    .lte("ends_at", rangeEnd.toISOString());

  const blockedTimes: BlockedTimeRow[] = [
    ...(blockedRows ?? []),
    ...(apptRows ?? []),
  ];

  const localSlots = generateSlots({
    availability: (availRows ?? []) as StylistAvailabilityRow[],
    blockedTimes,
    durationMinutes,
    weekShift,
    weekCount,
  });

  // When the seller is connected to Square AND we have a mapped variation, use
  // Square's REAL availability (its hours, staff schedule, existing bookings) as
  // the source of truth — that's what the seller manages in Square. We format
  // Square's slots into the same TimeSlot shape. Fall back to the local slots if
  // Square isn't connected or the call fails (honest degradation, never empty
  // when we have a usable local schedule).
  let slots = localSlots;
  let source: "square" | "local" = "local";
  try {
    const { data: stylist } = await admin
      .from("stylists")
      .select("square_location_id, square_team_member_id")
      .eq("id", stylistId)
      .maybeSingle();
    const tok = await ensureFreshSquareToken(admin, stylistId);
    if (
      tok.ok && serviceVariationId &&
      stylist?.square_location_id && stylist?.square_team_member_id
    ) {
      const squareSlots = await searchSquareAvailability({
        accessToken: tok.accessToken,
        locationId: stylist.square_location_id,
        teamMemberId: stylist.square_team_member_id,
        serviceVariationId,
        rangeStart,
        rangeEnd,
      });
      if (squareSlots.length) {
        slots = squareSlots;
        source = "square";
      }
    }
  } catch (e) {
    console.error("[availability] Square search failed, using local:", (e as Error).name);
  }

  return jsonResponse({ slots, durationMinutes, source });
});
