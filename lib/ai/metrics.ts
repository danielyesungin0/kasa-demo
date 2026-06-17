/**
 * Lightweight in-memory AI usage metrics.
 *
 * Purpose: gather real beta usage data (request volume, how often we hit the
 * Groq free-tier rate limit, latency) WITHOUT adding infra or cost. This is
 * intentionally process-local and best-effort — it resets on deploy and is not
 * shared across serverless instances. It exists to answer one question during
 * beta: "is usage outgrowing the free tier yet?"
 *
 * It also records the LAST call outcome so the chat route can show a friendly,
 * accurate message (e.g. "the assistant is busy" on a rate limit vs. a generic
 * fallback) without changing the provider's return signature.
 */

export type AIOutcome = "success" | "rate_limited" | "error" | "timeout";

type AIMetrics = {
  totalRequests: number;
  rateLimited: number;
  errors: number;
  timeouts: number;
  successes: number;
  totalLatencyMs: number; // sum over completed requests, for averaging
  lastOutcome: AIOutcome | null;
  lastRateLimitAt: number | null; // epoch ms of most recent 429
};

const metrics: AIMetrics = {
  totalRequests: 0,
  rateLimited: 0,
  errors: 0,
  timeouts: 0,
  successes: 0,
  totalLatencyMs: 0,
  lastOutcome: null,
  lastRateLimitAt: null,
};

export function recordAIRequest(): void {
  metrics.totalRequests += 1;
}

export function recordAIOutcome(outcome: AIOutcome, latencyMs: number): void {
  metrics.lastOutcome = outcome;
  metrics.totalLatencyMs += latencyMs;
  switch (outcome) {
    case "success":
      metrics.successes += 1;
      break;
    case "rate_limited":
      metrics.rateLimited += 1;
      metrics.lastRateLimitAt = Date.now();
      break;
    case "timeout":
      metrics.timeouts += 1;
      break;
    case "error":
      metrics.errors += 1;
      break;
  }

  // Structured per-call log line. On Vercel each serverless instance has its own
  // memory, so in-process counters can't be aggregated across instances — but
  // stdout IS captured. Emitting one parseable line per call lets us reconstruct
  // real usage (volume, rate-limit rate, latency) from Vercel logs during beta.
  // Prefix "[ai-metric]" so it's greppable in the log dashboard.
  console.log(
    `[ai-metric] ${JSON.stringify({ outcome, latencyMs, ts: new Date().toISOString() })}`
  );
}

/** Was the most recent AI call a rate-limit failure? Used by the chat route to
 *  choose a "busy, try again" message instead of a generic fallback. */
export function lastCallWasRateLimited(): boolean {
  return metrics.lastOutcome === "rate_limited";
}

export function snapshotAIMetrics() {
  const completed =
    metrics.successes + metrics.rateLimited + metrics.errors + metrics.timeouts;
  return {
    totalRequests: metrics.totalRequests,
    successes: metrics.successes,
    rateLimited: metrics.rateLimited,
    errors: metrics.errors,
    timeouts: metrics.timeouts,
    avgLatencyMs: completed > 0 ? Math.round(metrics.totalLatencyMs / completed) : 0,
    rateLimitRate:
      completed > 0 ? Number((metrics.rateLimited / completed).toFixed(3)) : 0,
    lastOutcome: metrics.lastOutcome,
    lastRateLimitAt: metrics.lastRateLimitAt,
  };
}
