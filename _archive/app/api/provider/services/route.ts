import { type NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/api/origin-check";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getAuthedStylist } from "@/lib/stylists/owner";

/**
 * Provider settings — synced services (provider_services).
 *
 * GET   → list the authed provider's services.
 * PATCH → update ONE service row (visible_in_chat / behavior / aliases /
 *         chat_description). The row id must belong to the authed provider;
 *         the update is filtered by both id AND stylist_id so a provider can
 *         never edit another provider's row even if they guess an id.
 *
 * Auth: session-scoped via getAuthedStylist(). No client-supplied stylist id
 * is ever trusted.
 */

const VALID_BEHAVIORS = ["book", "consultation", "handoff", "hidden"] as const;
type Behavior = (typeof VALID_BEHAVIORS)[number];

export async function GET() {
  const owner = await getAuthedStylist();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin
    .from("provider_services")
    .select(
      "id, name, category, price_cents, duration_minutes, visible_in_chat, behavior, aliases, chat_description"
    )
    .eq("stylist_id", owner.stylistId)
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ services: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const owner = await getAuthedStylist();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    id?: string;
    visible_in_chat?: boolean;
    behavior?: string;
    aliases?: string[] | string;
    chat_description?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "id_required" }, { status: 400 });
  }

  // Build the update payload from only the fields provided, validating each.
  const update: Record<string, unknown> = {};

  if (typeof body.visible_in_chat === "boolean") {
    update.visible_in_chat = body.visible_in_chat;
  }

  if (body.behavior !== undefined) {
    if (!VALID_BEHAVIORS.includes(body.behavior as Behavior)) {
      return NextResponse.json({ error: "invalid_behavior" }, { status: 400 });
    }
    update.behavior = body.behavior;
  }

  if (body.aliases !== undefined) {
    // Accept an array or a comma-separated string. Sanitize: trim, drop
    // empties, lowercase, cap count + length to prevent abuse / UI breakage.
    const raw = Array.isArray(body.aliases)
      ? body.aliases
      : String(body.aliases).split(",");
    const cleaned = raw
      .map((a) => String(a).trim().toLowerCase())
      .filter((a) => a.length > 0 && a.length <= 40)
      .slice(0, 20);
    update.aliases = cleaned;
  }

  if (body.chat_description !== undefined) {
    const desc =
      typeof body.chat_description === "string"
        ? body.chat_description.trim().slice(0, 300)
        : "";
    update.chat_description = desc.length === 0 ? null : desc;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const admin = createServiceRoleSupabaseClient();
  // Filter by id AND stylist_id — ownership enforced in the query even though
  // service-role bypasses RLS.
  const { data, error } = await admin
    .from("provider_services")
    .update(update)
    .eq("id", body.id)
    .eq("stylist_id", owner.stylistId)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    // No row matched → either bad id or not owned by this provider.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ id: data.id, updated: update });
}
