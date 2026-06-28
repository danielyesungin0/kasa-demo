import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { resolveStylist } from "@/lib/stylists/resolve";

/**
 * Internal analytics ingestion. Accepts a single { event, props } payload
 * and writes one row to analytics_events. No auth required because:
 *
 *   1. Events contain no PII (enforced by client-side track() conventions
 *      and a defensive sanitization below).
 *   2. The endpoint is write-only — there's no read path to leak data.
 *   3. Rate-limiting is omitted intentionally; if it becomes a problem we
 *      can add it without changing the shape.
 *
 * If you find yourself wanting to track names / phones / emails here,
 * stop and rethink — that data belongs in bookings, not analytics.
 */

// Allow-list of fields we'll accept in `props`. Anything else is dropped
// before it hits the DB. This is the last line of defense against
// accidentally logging PII.
const ALLOWED_PROP_KEYS = new Set([
  "serviceId",
  "serviceName",
  "category",
  "weekShift",
  "source",     // "entry" | "assistant" | "category" | "usual"
  "reason",     // failure reason like "token_expired"
]);

const PII_HINT_KEYS = new Set([
  "name", "clientName", "customerName", "fullName",
  "phone", "clientPhone", "customerPhone",
  "email", "clientEmail", "customerEmail",
  "address", "ip", "userAgent",
]);

function sanitizeProps(input: unknown): Record<string, string | number | boolean> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (PII_HINT_KEYS.has(key)) continue;
    if (!ALLOWED_PROP_KEYS.has(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      // Truncate strings defensively — analytics props should be short
      out[key] = typeof value === "string" ? value.slice(0, 120) : value;
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  let body: { event?: string; props?: unknown; slug?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const event = typeof body.event === "string" ? body.event.slice(0, 64) : "";
  if (!event) return NextResponse.json({ ok: false }, { status: 400 });

  const props = sanitizeProps(body.props);

  try {
    const admin = createServiceRoleSupabaseClient();

    // Best-effort stylist attribution: strict slug resolution when present,
    // first-row fallback on the legacy slug-less path.
    const stylist = await resolveStylist(
      typeof body.slug === "string" ? body.slug : undefined
    );

    await admin.from("analytics_events").insert({
      event,
      props,
      stylist_id: stylist?.id ?? null,
    });
  } catch (err) {
    // Never let analytics break a user flow — log and ack.
    console.error("analytics insert failed:", err);
  }

  return NextResponse.json({ ok: true });
}
