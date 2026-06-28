import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { resolveStylist } from "@/lib/stylists/resolve";
import { syncProviderServices } from "@/lib/square/sync-services";

/**
 * On-demand catalog re-sync (dashboard "re-sync" button / setup fallback).
 *
 * The actual fetch-and-persist logic lives in lib/square/sync-services.ts so
 * the Square OAuth callback can run the SAME sync automatically on connect.
 * This route just resolves the provider + decrypts their token, then delegates.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");

  const resolved = await resolveStylist(slug);
  if (!resolved) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  const admin = createServiceRoleSupabaseClient();
  const { data: tokenRow, error: tokenErr } = await admin
    .from("stylists")
    .select("square_access_token")
    .eq("id", resolved.id)
    .single();

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  const accessToken = decryptSecret(tokenRow.square_access_token);
  if (!accessToken) {
    return NextResponse.json({ error: "square_not_connected" }, { status: 400 });
  }

  const result = await syncProviderServices(resolved.id, accessToken);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    services: result.services,
    catalog: result.catalog,
  });
}
