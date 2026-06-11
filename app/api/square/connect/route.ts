import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SQUARE_BASE } from "@/lib/square/config";

export async function GET(request: NextRequest) {
  // Read the auth user from the session — never trust a UID passed in the
  // URL query, which is forgeable. The state param echoed to Square's OAuth
  // is what the callback later uses to know whose row to write tokens to,
  // so it MUST come from server-side session, not user input.
  const userClient = createServerSupabaseClient();
  const { data: authData } = await userClient.auth.getUser();
  if (!authData?.user) {
    // Fall back to the request's own origin (never hardcoded localhost) so
    // the error redirect lands on the same host the user is on, even when
    // NEXT_PUBLIC_APP_URL isn't set in the deployed build.
    const base = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
    return NextResponse.redirect(new URL("/setup?square_error=not_authed", base));
  }

  const base = `${SQUARE_BASE}/oauth2/authorize`;
  const params = new URLSearchParams({
    client_id: process.env.SQUARE_APPLICATION_ID!,
    response_type: "code",
    redirect_uri: process.env.SQUARE_REDIRECT_URL!,
    scope: [
      "MERCHANT_PROFILE_READ",
      "APPOINTMENTS_READ",
      "APPOINTMENTS_WRITE",
      "APPOINTMENTS_ALL_READ",
      "APPOINTMENTS_ALL_WRITE",
      "ITEMS_READ",
      "CUSTOMERS_READ",
      "CUSTOMERS_WRITE",
    ].join(" "),
    state: authData.user.id,
  });

  return NextResponse.redirect(`${base}?${params.toString()}`);
}
