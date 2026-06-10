import { type NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/api/origin-check";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { resolveStylist } from "@/lib/stylists/resolve";

/**
 * Handoff request submission.
 *
 * Writes a row to the handoff_requests table. The stylist's future dashboard
 * inbox will read from there (RLS-protected to her own rows). For the demo,
 * we just need durable storage — no SMS, no email yet.
 *
 * Phone is normalized to digits-only on the way in, matching the convention
 * used by bookings.customer_phone so a future "has this client booked before"
 * lookup can join cleanly.
 */

type HandoffBody = {
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  summary?: string;
  sourceMessage?: string;
  /** Provider slug. Strict resolution when present; first-row fallback on
   *  the legacy slug-less path. */
  slug?: string;
};

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rate = checkRateLimit(request, "handoff");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } }
    );
  }

  let body: HandoffBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const clientName = (body.clientName ?? "").trim().slice(0, 120);
  const clientPhoneRaw = body.clientPhone ?? "";
  const clientPhone = clientPhoneRaw.replace(/\D/g, "");
  const clientEmail = (body.clientEmail ?? "").trim().slice(0, 200) || null;
  const summary = (body.summary ?? "").trim().slice(0, 2000);
  const sourceMessage = (body.sourceMessage ?? "").trim().slice(0, 1000) || null;

  if (!clientName) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (clientPhone.length < 7) {
    return NextResponse.json({ error: "phone_required" }, { status: 400 });
  }
  if (!summary) {
    return NextResponse.json({ error: "summary_required" }, { status: 400 });
  }

  const admin = createServiceRoleSupabaseClient();

  // Stylist attribution — strict slug resolution when a slug is sent;
  // first-row fallback only on the legacy slug-less path.
  const stylist = await resolveStylist(body.slug);
  if (!stylist) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  const { data: inserted, error: insertErr } = await admin
    .from("handoff_requests")
    .insert({
      stylist_id: stylist.id,
      client_name: clientName,
      client_phone: clientPhone,
      client_email: clientEmail,
      summary,
      source_message: sourceMessage,
      // status defaults to 'pending' per the migration
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("handoff insert failed:", insertErr);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ id: inserted.id, status: "received" });
}
