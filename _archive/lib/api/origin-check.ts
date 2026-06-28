import { type NextRequest } from "next/server";

/**
 * Returns true if the request's Origin header matches the host the server
 * is being served from. Used to block cross-site POSTs from malicious pages.
 *
 * Falls open in dev (no Origin header on tools like curl is fine), but
 * rejects requests that explicitly come from a different origin in prod.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Same-origin form posts and server-to-server requests don't always
    // send Origin. Treat as allowed to avoid false positives.
    return true;
  }
  const host = request.headers.get("host");
  if (!host) return false;

  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}
