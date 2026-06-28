import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getAuthedStylistId } from "@/lib/dashboard/auth";

/**
 * Provider insights for the "Questions Clients Asked" dashboard.
 *
 * Pure READS over consultation_logs (007), grouped/shaped in-app, with each
 * "most asked" row annotated by whether the provider has already approved an
 * answer (provider_qa, 008). Auth-gated + scoped to the requester's own rows.
 *
 * Returns three lists:
 *   - mostAsked: frequency-grouped questions (the main list)
 *   - struggled: low confidence / non-ai source (where it needs help)
 *   - needsShen: turns flagged needs_handoff (escalation opportunities)
 *
 * No customer-facing change; this is provider-side visibility only.
 */

const RECENT_LIMIT = 600; // cap rows pulled so grouping stays cheap

type LogRow = {
  id: string;
  question: string;
  question_norm: string;
  intent: string | null;
  question_type: string | null;
  answer: string | null;
  confidence: number | null;
  needs_handoff: boolean | null;
  source: string | null;
  created_at: string;
};

export async function GET() {
  const stylistId = await getAuthedStylistId();
  if (!stylistId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleSupabaseClient();

  // Pull recent logs once; shape everything from this in-app. The table may not
  // exist yet (migration not run) — degrade to empty lists, never error.
  let logs: LogRow[] = [];
  try {
    const { data } = await admin
      .from("consultation_logs")
      .select(
        "id, question, question_norm, intent, question_type, answer, confidence, needs_handoff, source, created_at"
      )
      .eq("stylist_id", stylistId)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT);
    logs = (data as LogRow[]) ?? [];
  } catch {
    logs = [];
  }

  // Which questions already have a provider-approved answer.
  const approved = new Set<string>();
  try {
    const { data } = await admin
      .from("provider_qa")
      .select("question_norm")
      .eq("stylist_id", stylistId);
    for (const r of (data as { question_norm: string }[]) ?? []) {
      approved.add(r.question_norm);
    }
  } catch {
    // provider_qa migration not run yet → nothing approved.
  }

  // mostAsked: group by question_norm, keep an example + the most recent answer.
  const groups = new Map<
    string,
    {
      questionNorm: string;
      example: string;
      count: number;
      lastAnswer: string | null;
      lastSourceLogId: string;
      lastAt: string;
      intent: string | null;
      questionType: string | null;
    }
  >();
  for (const r of logs) {
    const key = r.question_norm;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        questionNorm: key,
        example: r.question,
        count: 1,
        lastAnswer: r.answer,
        lastSourceLogId: r.id,
        lastAt: r.created_at,
        intent: r.intent,
        questionType: r.question_type,
      });
    } else {
      g.count += 1;
      // logs are newest-first, so the first row we saw is already the latest.
    }
  }

  const mostAsked = Array.from(groups.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 50)
    .map((g) => ({
      questionNorm: g.questionNorm,
      example: g.example,
      count: g.count,
      lastAnswer: g.lastAnswer,
      sourceLogId: g.lastSourceLogId,
      intent: g.intent,
      questionType: g.questionType,
      approved: approved.has(g.questionNorm),
    }));

  // struggled: low confidence OR the assistant fell back (non-ai source).
  const struggled = logs
    .filter(
      (r) =>
        (typeof r.confidence === "number" && r.confidence < 0.5) ||
        (r.source != null && r.source !== "ai")
    )
    .slice(0, 30)
    .map((r) => ({
      id: r.id,
      question: r.question,
      questionNorm: r.question_norm,
      answer: r.answer,
      confidence: r.confidence,
      source: r.source,
      createdAt: r.created_at,
      approved: approved.has(r.question_norm),
    }));

  // needsShen: explicit escalation opportunities.
  const needsShen = logs
    .filter((r) => r.needs_handoff === true)
    .slice(0, 30)
    .map((r) => ({
      id: r.id,
      question: r.question,
      questionNorm: r.question_norm,
      answer: r.answer,
      createdAt: r.created_at,
      approved: approved.has(r.question_norm),
    }));

  return NextResponse.json({
    totalLogged: logs.length,
    mostAsked,
    struggled,
    needsShen,
  });
}
