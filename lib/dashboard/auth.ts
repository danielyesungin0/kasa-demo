import {
  createServerSupabaseClient,
  createServiceRoleSupabaseClient,
} from "@/lib/supabase/server";

/**
 * Resolve the currently-authed provider's stylist id.
 *
 * Mirrors the pattern in /api/stylist/status: read the user from the session
 * cookie, then look up their own stylist row via the service role. Returns
 * null when anonymous or no stylist row exists — callers turn that into a 401.
 *
 * Use this for any provider-scoped dashboard read/write so everything stays
 * scoped to the requester's own data.
 */
export async function getAuthedStylistId(): Promise<string | null> {
  const userClient = createServerSupabaseClient();
  const { data: authData } = await userClient.auth.getUser();
  if (!authData?.user) return null;

  const admin = createServiceRoleSupabaseClient();
  const { data: stylist } = await admin
    .from("stylists")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  return stylist?.id ?? null;
}
