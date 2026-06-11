import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Supabase magic-link callback (PKCE flow).
 *
 * The app uses @supabase/ssr, whose magic links carry a `?code=` that MUST be
 * exchanged for a session server-side. This route does that exchange and sets
 * the session cookie, then redirects to `next` (default /setup).
 *
 * Without this route the code is never exchanged, no session cookie is set,
 * and every server-side auth.getUser() returns null — which is why Square
 * connect kept bouncing to not_authed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/setup";

  if (!code) {
    return NextResponse.redirect(`${origin}/setup?auth_error=callback_failed`);
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/setup?auth_error=callback_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
