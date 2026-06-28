import { NextResponse } from "next/server";
import { snapshotAIMetrics } from "@/lib/ai/metrics";

/**
 * GET /api/ai-metrics
 *
 * Beta usage telemetry for the AI layer: total requests, rate-limit
 * occurrences, average latency. Lets us see whether free-tier usage is growing
 * enough to justify upgrading the AI infra (and folding that cost into the
 * business model) — without paying for anything now.
 *
 * Caveat: counters are in-memory and process-local. They reset on deploy and
 * are NOT aggregated across serverless instances, so treat these as a
 * directional signal during a small beta, not exact analytics.
 */
export async function GET() {
  return NextResponse.json({
    ...snapshotAIMetrics(),
    // Honesty note: this snapshot reflects only THIS serverless instance's
    // memory and resets on deploy. For real aggregate beta numbers, grep the
    // Vercel logs for "[ai-metric]" (one JSON line per AI call).
    note: "Per-instance only. For aggregate usage, grep Vercel logs for '[ai-metric]'.",
  });
}
