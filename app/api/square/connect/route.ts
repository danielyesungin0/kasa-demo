import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  // Read the auth user from the session — never trust a UID passed in the
  // URL query, which is forgeable. The state param echoed to Square's OAuth
  // is what the callback later uses to know whose row to write tokens to,
  // so it MUST come from server-side session, not user input.
  const userClient = createServerSupabaseClient();
  const { data: authData } = await userClient.auth.getUser();
  if (!authData?.user) {
    return NextResponse.redirect(
      new URL("/setup?square_error=not_authed", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")
    );
  }

  const base = "https://connect.squareupsandbox.com/oauth2/authorize";
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
