import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Resolve the stylist row owned by the currently-authenticated user.
 *
 * Used by every /api/provider/* settings route so a provider can only ever
 * read/write THEIR OWN data. Never resolves by slug or a client-supplied id —
 * the id comes from the verified session (auth.uid()), so it can't be forged.
 *
 * Returns { stylistId, slug } on success, or null when there's no session or
 * no stylist row for that user. Callers translate null into 401/404.
 */
export async function getAuthedStylist(): Promise<
  { stylistId: string; slug: string | null } | null
> {
  const userClient = createServerSupabaseClient();
  const { data: authData } = await userClient.auth.getUser();
  if (!authData?.user) return null;

  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin
    .from("stylists")
    .select("id, slug")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (error || !data) return null;
  return { stylistId: data.id, slug: data.slug };
}
