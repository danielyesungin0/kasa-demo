import { type NextRequest } from "next/server";

/**
 * In-memory rate limiter, sliding-window.
 *
 * Keyed by IP + bucket name so different endpoints get independent
 * counters. Maintained as a Map of arrays of timestamps; old entries
 * are pruned on every check.
 *
 * Limitations:
 * - Process-local: a multi-instance deployment (e.g. Vercel scale-out)
 *   will undercount. Acceptable for this prototype; switch to
 *   Upstash/Redis-backed limiting for production.
 * - Memory: bounded by activeKeys * maxRequests. With 1000 IPs and a
 *   60-request window, that's ~60k Date numbers — trivial.
 */

type Bucket = {
  requests: number;
  windowMs: number;
};

const BUCKETS: Record<string, Bucket> = {
  // Lookup is the highest-risk endpoint: would otherwise allow PII enumeration.
  "bookings-lookup": { requests: 10, windowMs: 60_000 },
  // Verify is the brute-force surface for guessing last-4 digits.
  // 10 attempts/min = practically impossible to brute-force a 10000-space.
  "bookings-verify": { requests: 10, windowMs: 60_000 },
  // Cancel — same protection as verify since it does its own last-4 check.
  "bookings-cancel": { requests: 10, windowMs: 60_000 },
  // Chat (Ask Shen) — limits AI provider calls per client so a single user
  // can't burn through Groq's per-minute quota for everyone. 15/min is
  // generous for normal use, restrictive enough to catch a runaway tab.
  "chat": { requests: 15, windowMs: 60_000 },
  // Handoff submission — slow path; one client should never need to send
  // more than a few in a short period.
  "handoff": { requests: 5, windowMs: 60_000 },
};

const store = new Map<string, number[]>();

function getClientKey(request: NextRequest): string {
  // Behind a proxy/Vercel, the real IP is in x-forwarded-for. Fall through
  // to x-real-ip, then to a constant — last case means "we can't identify
  // the caller; rate-limit them the same as everyone else."
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

/**
 * Returns { allowed: boolean, retryAfterSec?: number }.
 * Call once per request; the caller decides how to respond on deny.
 */
export function checkRateLimit(
  request: NextRequest,
  bucket: keyof typeof BUCKETS
): { allowed: boolean; retryAfterSec?: number } {
  const config = BUCKETS[bucket];
  if (!config) return { allowed: true };

  const ip = getClientKey(request);
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const cutoff = now - config.windowMs;

  const timestamps = store.get(key) ?? [];
  // Drop entries outside the window
  const fresh = timestamps.filter((t) => t > cutoff);

  if (fresh.length >= config.requests) {
    const oldest = fresh[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000));
    store.set(key, fresh); // store the pruned list so future requests get the same answer
    return { allowed: false, retryAfterSec };
  }

  fresh.push(now);
  store.set(key, fresh);
  return { allowed: true };
}
