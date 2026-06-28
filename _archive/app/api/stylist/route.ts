import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/api/origin-check";
import { resolveStylist } from "@/lib/stylists/resolve";

/**
 * GET — public-ish: returns a provider's display info for the booking page.
 * Anonymous callers can hit this because the booking page is anonymous. We
 * deliberately do NOT return email, phone, location_id, tokens, or any other
 * sensitive field.
 *
 * Resolves strictly by ?slug= when present; first-row fallback only on the
 * legacy slug-less path. Also returns `published` so callers can gate.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");

  const data = await resolveStylist(slug);
  if (!data) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  // Stylist-set display_name wins. If they haven't set one, fall through
  // to Square data; final fallback is the demo default "Shen" (NOT the email
  // prefix — emailing the world your email username is bad UX and PII).
  const name =
    data.display_name ??
    data.square_team_member_name ??
    data.square_business_name ??
    "Shen";

  const location =
    [data.square_business_name, data.square_location_name]
      .filter(Boolean)
      .join(" · ") || null;

  return NextResponse.json({ name, location, published: data.published });
}

/**
 * PATCH — authed stylist updates their own display_name. Anyone trying to
 * change another stylist's row is blocked because we filter on user_id.
 */
export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const userClient = createServerSupabaseClient();
  const { data: authData } = await userClient.auth.getUser();
  if (!authData?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const trimmed = body.displayName?.trim() ?? "";
  // Allow clearing (empty string → null) so they can revert to Square data.
  // Reject absurdly long inputs to prevent abuse / UI breakage.
  if (trimmed.length > 80) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }
  const value = trimmed.length === 0 ? null : trimmed;

  const admin = createServiceRoleSupabaseClient();
  const { error: updateErr } = await admin
    .from("stylists")
    .update({ display_name: value })
    .eq("user_id", authData.user.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ displayName: value });
}
