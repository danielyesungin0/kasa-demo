import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Consultation instrumentation (Phase 2 foundation).
 *
 * Logs question-shaped chat turns so the validation period produces learning:
 * what clients ask most, where the assistant struggles, what should become
 * provider-approved answers, and which moments needed a "Send to Shen" escape.
 *
 * Principles (privacy-first, never disrupt the customer experience):
 *   - Fire-and-forget. NEVER awaited on the response path; failures are
 *     swallowed so a logging hiccup can't affect a reply.
 *   - Flag-gated by CONSULTATION_LOGGING_ENABLED (default ON for beta; set to
 *     "false" to disable). No flag set → logs.
 *   - NO PII: we never store who asked (no phone/email/name/IP), no session
 *     thread — just the question + how the assistant handled it.
 *   - Only question-shaped turns are logged (the caller decides via shouldLog).
 *   - Text is truncated so a pasted wall can't bloat the table.
 */

const MAX_LEN = 1000;

/** Should this turn be logged? Only question-shaped intents, or any handoff
 *  (the escalation-opportunity signal). Bookings/confirmations/etc. are noise. */
export function shouldLogConsultation(input: {
  intent: string | null | undefined;
  needsHandoff: boolean;
}): boolean {
  if (process.env.CONSULTATION_LOGGING_ENABLED === "false") return false;
  if (input.needsHandoff) return true;
  return (
    input.intent === "consultation" ||
    input.intent === "service_guidance" ||
    input.intent === "faq"
  );
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
}

/**
 * Log one consultation turn. Fire-and-forget — call without awaiting.
 */
export function logConsultation(input: {
  stylistId: string | null;
  question: string;
  answer: string | null;
  intent: string | null;
  questionType: string | null;
  confidence: number | null;
  needsHandoff: boolean;
  source: string | null;
}): void {
  // Run async, never block; swallow all errors.
  void (async () => {
    try {
      if (!input.stylistId) return; // can't scope it → don't log
      const question = input.question.trim().slice(0, MAX_LEN);
      if (!question) return;
      const admin = createServiceRoleSupabaseClient();
      await admin.from("consultation_logs").insert({
        stylist_id: input.stylistId,
        question,
        question_norm: normalizeQuestion(input.question),
        intent: input.intent,
        question_type: input.questionType,
        answer: input.answer ? input.answer.slice(0, MAX_LEN) : null,
        confidence: input.confidence,
        needs_handoff: input.needsHandoff,
        source: input.source,
      });
    } catch {
      // Instrumentation must never affect the user. Silently ignore.
    }
  })();
}
