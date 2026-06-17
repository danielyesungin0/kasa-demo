import { type NextRequest, NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  createServiceRoleSupabaseClient,
} from "@/lib/supabase/server";
import { writeAvailability, type AvailabilityInput } from "@/lib/stylists/availability-seed";

/**
 * POST /api/provider/availability
 *
 * Persists the onboarding availability step into stylist_availability for the
 * AUTHED provider's own row. Replaces existing windows (delete + insert).
 *
 * Auth-gated and self-scoped: resolves the stylist row by the requester's
 * user_id — a provider can only ever write their own availability, never
 * another's. This is the write path; the reader (/api/availability, AI
 * working-days) is unchanged and keeps consuming the same table.
 *
 * Body: { days: string[], startLabel: string, endLabel: string }
 *   days        — abbreviations like ["Tue","Thu","Fri","Sat","Sun"]
 *   startLabel  — "10:00 AM"
 *   endLabel    — "7:30 PM"
 */
export async function POST(request: NextRequest) {
  const userClient = createServerSupabaseClient();
  const { data: authData } = await userClient.auth.getUser();
  if (!authData?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Partial<AvailabilityInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (
    !Array.isArray(body.days) ||
    typeof body.startLabel !== "string" ||
    typeof body.endLabel !== "string"
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const admin = createServiceRoleSupabaseClient();
  const { data: stylist } = await admin
    .from("stylists")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (!stylist) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  try {
    const written = await writeAvailability(stylist.id, {
      days: body.days,
      startLabel: body.startLabel,
      endLabel: body.endLabel,
    });
    return NextResponse.json({ ok: true, daysWritten: written });
  } catch (err) {
    console.error("Availability write failed:", err);
    return NextResponse.json({ error: "availability_write_failed" }, { status: 500 });
  }
}
