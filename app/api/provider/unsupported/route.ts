import { type NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/api/origin-check";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getAuthedStylist } from "@/lib/stylists/owner";

/**
 * Provider settings — unsupported_rules.
 *
 * GET    → list the authed provider's rules.
 * POST   → add a rule { trigger_term, response_type, custom_response? }.
 * DELETE → remove a rule by ?id= (scoped to the authed provider).
 *
 * Auth: session-scoped via getAuthedStylist(). All writes filtered by
 * stylist_id so a provider can only touch their own rules.
 */

const VALID_RESPONSE_TYPES = [
  "not_offered",
  "handoff",
  "consultation",
  "custom",
] as const;
type ResponseType = (typeof VALID_RESPONSE_TYPES)[number];

export async function GET() {
  const owner = await getAuthedStylist();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin
    .from("unsupported_rules")
    .select("id, trigger_term, response_type, custom_response")
    .eq("stylist_id", owner.stylistId)
    .order("trigger_term", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const owner = await getAuthedStylist();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    trigger_term?: string;
    response_type?: string;
    custom_response?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const term = (body.trigger_term ?? "").trim().toLowerCase();
  if (!term || term.length > 40) {
    return NextResponse.json({ error: "invalid_trigger_term" }, { status: 400 });
  }

  const responseType: ResponseType = VALID_RESPONSE_TYPES.includes(
    body.response_type as ResponseType
  )
    ? (body.response_type as ResponseType)
    : "handoff";

  const customResponse =
    responseType === "custom" && typeof body.custom_response === "string"
      ? body.custom_response.trim().slice(0, 300) || null
      : null;

  const admin = createServiceRoleSupabaseClient();

  // Prevent duplicate terms for the same provider.
  const { data: existing } = await admin
    .from("unsupported_rules")
    .select("id")
    .eq("stylist_id", owner.stylistId)
    .eq("trigger_term", term)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "duplicate_term" }, { status: 409 });
  }

  const { data, error } = await admin
    .from("unsupported_rules")
    .insert({
      stylist_id: owner.stylistId,
      trigger_term: term,
      response_type: responseType,
      custom_response: customResponse,
    })
    .select("id, trigger_term, response_type, custom_response")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const owner = await getAuthedStylist();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin
    .from("unsupported_rules")
    .delete()
    .eq("id", id)
    .eq("stylist_id", owner.stylistId)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ id: data.id, deleted: true });
}
