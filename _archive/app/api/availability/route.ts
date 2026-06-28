import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { resolveStylist } from "@/lib/stylists/resolve";
import {
  generateSlots,
  type StylistAvailabilityRow,
  type BlockedTimeRow,
} from "@/lib/availability";

// Duration fallback per service ID (minutes) — used when service_catalog has no entry
const DURATION_FALLBACK: Record<string, number> = {
  "svc-short-cut":           60,
  "svc-medium-long-cut":     75,
  "svc-head-spa":            60,
  "svc-keratin":             150,
  "svc-milbon":              60,
  "svc-cut-down-perm":       90,
  "svc-mens-perm-cut":       120,
  "svc-bang-perm":           60,
  "svc-womens-regular-perm": 180,
  "svc-womens-digital-perm": 240,
  "svc-straightening-perm":  240,
  "svc-root-touchup":        90,
  "svc-full-color":          120,
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const serviceId = searchParams.get("serviceId");
  const slug = searchParams.get("slug");
  const weekShift = Math.max(0, parseInt(searchParams.get("weekShift") ?? "0", 10));

  if (!serviceId) {
    return NextResponse.json({ error: "serviceId required" }, { status: 400 });
  }

  // Resolve provider strictly by slug when present; fall back to first row
  // only on the legacy slug-less path.
  const stylist = await resolveStylist(slug);
  if (!stylist) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  // service_catalog is part of the resolved row; admin client is still used
  // below for the stylist-scoped availability / blocked-time / booking reads.
  const admin = createServiceRoleSupabaseClient();

  // Resolve duration from service_catalog, then fallback map
  const catalog = (stylist.service_catalog ?? {}) as Record<string, { durationMinutes?: number }>;
  const durationMinutes =
    catalog[serviceId]?.durationMinutes ??
    DURATION_FALLBACK[serviceId] ??
    60;

  // Load availability windows
  const { data: availRows } = await admin
    .from("stylist_availability")
    .select("day_of_week, start_time, end_time, is_active")
    .eq("stylist_id", stylist.id);

  // Load blocked times — only fetch the relevant date range (3 weeks out)
  const now = new Date();
  const rangeStart = new Date(now.getTime() + weekShift * 7 * 24 * 3600 * 1000);
  const rangeEnd = new Date(rangeStart.getTime() + 21 * 24 * 3600 * 1000);

  const { data: blockedRows } = await admin
    .from("blocked_times")
    .select("starts_at, ends_at")
    .eq("stylist_id", stylist.id)
    .gte("starts_at", rangeStart.toISOString())
    .lte("ends_at", rangeEnd.toISOString());

  // Also load from bookings table (confirmed appointments count as blocked)
  const { data: bookingRows } = await admin
    .from("bookings")
    .select("starts_at, ends_at")
    .eq("stylist_id", stylist.id)
    .in("status", ["confirmed", "pending"])
    .gte("starts_at", rangeStart.toISOString())
    .lte("ends_at", rangeEnd.toISOString());

  const allBlocked: BlockedTimeRow[] = [
    ...(blockedRows ?? []),
    ...(bookingRows ?? []),
  ];

  const slots = generateSlots({
    availability: (availRows ?? []) as StylistAvailabilityRow[],
    blockedTimes: allBlocked,
    durationMinutes,
    weekShift,
    weekCount: 3,
  });

  return NextResponse.json({ slots });
}
