import { type NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/api/origin-check";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getAuthedStylist } from "@/lib/stylists/owner";

/**
 * Provider settings — handoff email.
 *
 * GET   → return the authed provider's handoff_email + handoff_email_enabled
 *         and their booking slug (for the /book/<slug> link display).
 * PATCH → update handoff_email and/or handoff_email_enabled.
 *
 * Auth: session-scoped via getAuthedStylist(); update filtered by stylist id.
 */

export async function GET() {
  const owner = await getAuthedStylist();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin
    .from("stylists")
    .select("handoff_email, handoff_email_enabled")
    .eq("id", owner.stylistId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    handoff_email: data.handoff_email ?? null,
    handoff_email_enabled: data.handoff_email_enabled ?? false,
    slug: owner.slug,
  });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const owner = await getAuthedStylist();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { handoff_email?: string | null; handoff_email_enabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (body.handoff_email !== undefined) {
    const email =
      typeof body.handoff_email === "string"
        ? body.handoff_email.trim().slice(0, 200)
        : "";
    if (email.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    update.handoff_email = email.length === 0 ? null : email;
  }

  if (typeof body.handoff_email_enabled === "boolean") {
    update.handoff_email_enabled = body.handoff_email_enabled;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const admin = createServiceRoleSupabaseClient();
  const { error } = await admin
    .from("stylists")
    .update(update)
    .eq("id", owner.stylistId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ updated: update });
}
