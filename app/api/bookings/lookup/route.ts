import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/api/rate-limit";
import type { Appointment } from "@/lib/types";

const TZ = "America/New_York";

function todayKeyNY(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

function formatTimeLabel(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

function formatDateKey(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString("en-CA", { timeZone: TZ });
}

function formatDayLabel(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
}

function formatDateLabel(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
}

function formatIsoTime(isoStr: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(isoStr));
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

function durationLabel(startsAt: string, endsAt: string): string {
  const mins = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

// IMPORTANT: clientPhone is intentionally omitted from the response.
// Returning phone numbers on a public lookup endpoint would let any
// caller enumerate the customer database. Verification happens server-
// side via POST /api/bookings/verify.
function toAppointment(row: any): Appointment {
  return {
    id: row.id,
    clientName: row.customer_name,
    clientPhone: "", // never returned to the client
    serviceId: row.service_id,
    serviceName: row.service_name,
    dayLabel: formatDayLabel(row.starts_at),
    dateLabel: formatDateLabel(row.starts_at),
    dateKey: formatDateKey(row.starts_at),
    isoTime: formatIsoTime(row.starts_at),
    timeLabel: formatTimeLabel(row.starts_at),
    durationLabel: durationLabel(row.starts_at, row.ends_at),
    channel: "Booking link" as const,
  };
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit(request, "bookings-lookup");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } }
    );
  }

  const phone = request.nextUrl.searchParams.get("phone");
  const name  = request.nextUrl.searchParams.get("name");
  // Opt-in flag: when ?includeContact=1 AND the lookup matches exactly ONE
  // upcoming row by phone, the response includes name + email so the
  // Book-My-Usual flow can prefill DetailsStage. Multiple-match results
  // never return contact details (signal that something unusual is going
  // on — fall back to manual entry). Without the flag the response is
  // exactly as it was (appointments[] with no PII), preserving the
  // manage-lookup contract.
  const includeContact = request.nextUrl.searchParams.get("includeContact") === "1";

  if (!phone && !name) return NextResponse.json({ appointments: [] });

  // Minimum name length — single-letter names like "a" would match thousands
  // of customers and turn this into a PII enumeration tool.
  if (name && name.trim().length < 2) {
    return NextResponse.json({ appointments: [] });
  }

  // Phone lookup must be the FULL phone number (exact match). Substring
  // searches would let an attacker enumerate via partial digits.
  if (phone && phone.replace(/\D/g, "").length < 7) {
    return NextResponse.json({ appointments: [] });
  }

  const admin = createServiceRoleSupabaseClient();
  const todayKey = todayKeyNY();

  let query = admin
    .from("bookings")
    .select("id, customer_name, customer_email, service_id, service_name, starts_at, ends_at, status")
    .in("status", ["confirmed", "pending"])
    .gte("starts_at", `${todayKey}T00:00:00Z`)
    .order("starts_at", { ascending: true })
    .limit(10); // ceiling on results

  if (phone) query = query.eq("customer_phone", phone);
  if (name)  query = query.ilike("customer_name", `%${name.trim()}%`);

  const { data: rows } = await query;
  if (!rows || rows.length === 0) return NextResponse.json({ appointments: [] });

  const appointments = rows.map(toAppointment);

  // Contact prefill payload: only when explicitly opted-in by phone AND
  // there's exactly one match. Same phone matching multiple bookings is
  // ambiguous — don't auto-fill, let the user type. Also requires phone
  // (not name) lookup; name-based callers never get contact prefill.
  if (includeContact && phone && rows.length === 1) {
    const row = rows[0];
    return NextResponse.json({
      appointments,
      contact: {
        name: row.customer_name ?? "",
        email: row.customer_email ?? "",
      },
    });
  }

  return NextResponse.json({ appointments });
}
