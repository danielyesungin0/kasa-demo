import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getAuthedStylistId } from "@/lib/dashboard/auth";

/**
 * Provider-approved answers (provider_qa, 008).
 *
 *   GET    → list this provider's approved answers
 *   POST   → upsert one approved answer (approve/edit)
 *   DELETE → remove one (un-approve)
 *
 * Auth-gated; every operation is scoped to the requester's own stylist_id, so a
 * provider can never read or touch another provider's knowledge base. Writes go
 * through the service role AFTER the auth check (the table also has RLS).
 *
 * The assistant does NOT yet read this table — approve/edit only this pass.
 */

const MAX_Q = 1000;
const MAX_A = 4000;

function normalize(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim().slice(0, MAX_Q);
}

export async function GET() {
  const stylistId = await getAuthedStylistId();
  if (!stylistId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createServiceRoleSupabaseClient();
  let rows: unknown[] = [];
  try {
    const { data } = await admin
      .from("provider_qa")
      .select("id, question_norm, question_display, answer, updated_at")
      .eq("stylist_id", stylistId)
      .order("updated_at", { ascending: false });
    rows = data ?? [];
  } catch {
    rows = [];
  }
  return NextResponse.json({ answers: rows });
}

export async function POST(req: Request) {
  const stylistId = await getAuthedStylistId();
  if (!stylistId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    questionDisplay?: string;
    answer?: string;
    questionNorm?: string;
    sourceLogId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const questionDisplay = (body.questionDisplay ?? "").trim().slice(0, MAX_Q);
  const answer = (body.answer ?? "").trim().slice(0, MAX_A);
  if (!questionDisplay || !answer) {
    return NextResponse.json(
      { error: "question and answer are required" },
      { status: 400 }
    );
  }
  // Group key: explicit normalized key if provided (from an insights row),
  // otherwise derive from the display question.
  const questionNorm = body.questionNorm
    ? normalize(body.questionNorm)
    : normalize(questionDisplay);

  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin
    .from("provider_qa")
    .upsert(
      {
        stylist_id: stylistId,
        question_norm: questionNorm,
        question_display: questionDisplay,
        answer,
        source_log_id: body.sourceLogId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stylist_id,question_norm" }
    )
    .select("id, question_norm, question_display, answer, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "could not save" }, { status: 500 });
  }
  return NextResponse.json({ answer: data });
}

export async function DELETE(req: Request) {
  const stylistId = await getAuthedStylistId();
  if (!stylistId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const questionNorm = searchParams.get("questionNorm");
  if (!questionNorm) {
    return NextResponse.json({ error: "questionNorm required" }, { status: 400 });
  }
  const admin = createServiceRoleSupabaseClient();
  const { error } = await admin
    .from("provider_qa")
    .delete()
    .eq("stylist_id", stylistId)
    .eq("question_norm", normalize(questionNorm));
  if (error) {
    return NextResponse.json({ error: "could not delete" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
