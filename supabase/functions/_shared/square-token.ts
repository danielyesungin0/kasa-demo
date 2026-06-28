// ============================================================
// square-token — FAITHFUL Deno port of lib/square/ensure-fresh-token.ts.
// DO NOT redesign the refresh logic. Behavior preserved exactly:
//   - decrypt stored access/refresh tokens
//   - refresh if within 48h of expiry (or, for legacy rows with no recorded
//     expiry, if a refresh token exists)
//   - persist rotated tokens encrypted at rest; still return the new token even
//     if persistence fails
//   - never log decrypted tokens
// ============================================================

import { decryptSecret, encryptSecret } from "./crypto.ts";

const SQUARE_BASE = Deno.env.get("SQUARE_ENVIRONMENT") === "production"
  ? "https://connect.squareup.com"
  : "https://connect.squareupsandbox.com";

const REFRESH_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

export type FreshTokenResult =
  | { ok: true; accessToken: string; refreshed: boolean }
  | { ok: false; reason: "no_token" | "refresh_failed" | "no_stylist" };

// deno-lint-ignore no-explicit-any
export async function ensureFreshSquareToken(
  admin: any, // supabase-js client (service role)
  stylistId: string,
): Promise<FreshTokenResult> {
  const { data: stylist } = await admin
    .from("stylists")
    .select(
      "id, square_access_token, square_refresh_token, square_token_expires_at",
    )
    .eq("id", stylistId)
    .single();

  if (!stylist) return { ok: false, reason: "no_stylist" };

  const currentAccess = decryptSecret(stylist.square_access_token);
  const currentRefresh = decryptSecret(stylist.square_refresh_token);
  if (!currentAccess) return { ok: false, reason: "no_token" };

  const expiresAt = stylist.square_token_expires_at
    ? new Date(stylist.square_token_expires_at).getTime()
    : null;
  const now = Date.now();
  const needsRefresh = expiresAt === null
    ? Boolean(currentRefresh)
    : expiresAt - now < REFRESH_THRESHOLD_MS;

  if (!needsRefresh) {
    return { ok: true, accessToken: currentAccess, refreshed: false };
  }

  if (!currentRefresh) {
    return { ok: false, reason: "refresh_failed" };
  }

  try {
    const res = await fetch(`${SQUARE_BASE}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Square-Version": "2024-01-18",
      },
      body: JSON.stringify({
        client_id: Deno.env.get("SQUARE_APPLICATION_ID"),
        client_secret: Deno.env.get("SQUARE_APPLICATION_SECRET"),
        refresh_token: currentRefresh,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      // Never log the body verbatim — it can echo token material. Status only.
      console.error("Square token refresh failed:", res.status);
      return { ok: false, reason: "refresh_failed" };
    }

    const data: {
      access_token?: string;
      refresh_token?: string;
      expires_at?: string;
    } = await res.json();

    if (!data.access_token) {
      console.error("Square token refresh returned no access_token");
      return { ok: false, reason: "refresh_failed" };
    }

    const { error: updateErr } = await admin
      .from("stylists")
      .update({
        square_access_token: encryptSecret(data.access_token),
        square_refresh_token: data.refresh_token
          ? encryptSecret(data.refresh_token)
          : stylist.square_refresh_token,
        square_token_expires_at: data.expires_at ?? null,
      })
      .eq("id", stylistId);

    if (updateErr) {
      // Still return the new token — the request can succeed even if persist
      // failed; the next call refreshes again. (No token in the log.)
      console.error("Square token persist failed:", updateErr.message);
    }

    return { ok: true, accessToken: data.access_token, refreshed: true };
  } catch (err) {
    console.error("Square token refresh error:", (err as Error).name);
    return { ok: false, reason: "refresh_failed" };
  }
}

export { SQUARE_BASE };
