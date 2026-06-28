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
} from "../_shared/availability.ts";

const DEFAULT_DURATION_MIN = 60;
const WEEK_COUNT_DEFAULT = 3;

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

  // Resolve duration: from the services row if a service_id is given, else the
  // passed duration_minutes, else default. (No stale svc-* fallback map — that
  // was old-catalog cruft.)
  let durationMinutes = body.duration_minutes ?? DEFAULT_DURATION_MIN;
  if (body.service_id) {
    const { data: svc } = await admin
      .from("services")
      .select("duration_minutes")
      .eq("id", body.service_id)
      .maybeSingle();
    if (svc?.duration_minutes) durationMinutes = svc.duration_minutes;
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

  const slots = generateSlots({
    availability: (availRows ?? []) as StylistAvailabilityRow[],
    blockedTimes,
    durationMinutes,
    weekShift,
    weekCount,
  });

  // TODO(square): once linked, intersect `slots` with Square SearchAvailability.

  return jsonResponse({ slots, durationMinutes });
});
