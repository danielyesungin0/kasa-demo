import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * Square OAuth tokens expire after 30 days. If we don't refresh them, every
 * stylist's connection silently breaks ~1 month after they connect. This
 * helper checks the stored expiration and refreshes if we're within 48 hours
 * of expiry (so we never hand a near-dead token to an API call).
 *
 * Returns the decrypted access token (refreshed if needed), or null if the
 * stylist has no Square connection or the refresh failed. Callers should
 * treat `null` as "Square is unreachable" and fall back to Supabase-only
 * behavior or surface a clear error.
 */

const SQUARE_BASE = "https://connect.squareupsandbox.com";
const REFRESH_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

export type FreshTokenResult =
  | { ok: true; accessToken: string; refreshed: boolean }
  | { ok: false; reason: "no_token" | "refresh_failed" | "no_stylist" };

export async function ensureFreshSquareToken(
  stylistId: string
): Promise<FreshTokenResult> {
  const admin = createServiceRoleSupabaseClient();

  const { data: stylist } = await admin
    .from("stylists")
    .select(
      "id, square_access_token, square_refresh_token, square_token_expires_at"
    )
    .eq("id", stylistId)
    .single();

  if (!stylist) return { ok: false, reason: "no_stylist" };

  const currentAccess = decryptSecret(stylist.square_access_token);
  const currentRefresh = decryptSecret(stylist.square_refresh_token);
  if (!currentAccess) return { ok: false, reason: "no_token" };

  // No expiration recorded — refresh defensively if we have a refresh token,
  // otherwise return the current token and hope for the best (legacy rows).
  const expiresAt = stylist.square_token_expires_at
    ? new Date(stylist.square_token_expires_at).getTime()
    : null;
  const now = Date.now();
  const needsRefresh =
    expiresAt === null
      ? Boolean(currentRefresh) // only refresh legacy rows if we have a refresh token
      : expiresAt - now < REFRESH_THRESHOLD_MS;

  if (!needsRefresh) {
    return { ok: true, accessToken: currentAccess, refreshed: false };
  }

  if (!currentRefresh) {
    // We need a refresh but have no refresh token — treat as expired.
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
        client_id: process.env.SQUARE_APPLICATION_ID,
        client_secret: process.env.SQUARE_APPLICATION_SECRET,
        refresh_token: currentRefresh,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("Square token refresh failed:", res.status, body);
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

    // Persist the new tokens encrypted at rest. We update even if the new
    // refresh_token wasn't returned (Square may rotate or keep the same one).
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
      // We still return the new token to the caller — the request can succeed
      // even if persistence failed. Next call will refresh again.
      console.error("Square token persist failed:", updateErr);
    }

    return { ok: true, accessToken: data.access_token, refreshed: true };
  } catch (err) {
    console.error("Square token refresh error:", err);
    return { ok: false, reason: "refresh_failed" };
  }
}
