/**
 * Single source of truth for the Square API base URL.
 *
 * Driven by SQUARE_ENVIRONMENT (default: "sandbox"). This centralizes what
 * used to be ~8 hardcoded `https://connect.squareupsandbox.com` literals so
 * the eventual production switch is a single env var, not a code change.
 *
 * IMPORTANT: default stays sandbox. Do NOT set SQUARE_ENVIRONMENT=production
 * until a real production Square OAuth app + credentials are configured and
 * the team has decided to let real bookings hit live calendars.
 */

export type SquareEnvironment = "sandbox" | "production";

export function getSquareEnvironment(): SquareEnvironment {
  return process.env.SQUARE_ENVIRONMENT === "production"
    ? "production"
    : "sandbox";
}

/**
 * Base origin for all Square REST + OAuth calls. Use as `${SQUARE_BASE}/v2/...`
 * or `${SQUARE_BASE}/oauth2/...`.
 */
export const SQUARE_BASE: string =
  getSquareEnvironment() === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
