"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";

/**
 * "Questions clients asked" — provider insight + approve/edit answers.
 *
 * Phase 2 (this pass): visibility into what clients ask, where the assistant
 * struggled, and which moments needed the provider — plus the ability to write
 * a canonical, approved answer per question. The assistant does NOT yet reuse
 * these answers; this is knowledge capture, not serving.
 *
 * All data is the authed provider's own (the APIs are auth-gated + scoped).
 */

type MostAsked = {
  questionNorm: string;
  example: string;
  count: number;
  lastAnswer: string | null;
  sourceLogId: string | null;
  intent: string | null;
  questionType: string | null;
  approved: boolean;
};
type Struggled = {
  id: string;
  question: string;
  questionNorm: string;
  answer: string | null;
  confidence: number | null;
  source: string | null;
  approved: boolean;
};
type NeedsShen = {
  id: string;
  question: string;
  questionNorm: string;
  answer: string | null;
  approved: boolean;
};
type Insights = {
  totalLogged: number;
  mostAsked: MostAsked[];
  struggled: Struggled[];
  needsShen: NeedsShen[];
};

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-display text-xl font-medium text-ink-900">{title}</h2>
      <p className="mt-0.5 text-sm text-ink-500">{hint}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-200 bg-cream-50 p-6 text-center text-sm text-ink-500">
      {text}
    </div>
  );
}

/** Inline approve/edit editor for one question. Saves to provider_qa. */
function AnswerEditor({
  questionNorm,
  defaultQuestion,
  defaultAnswer,
  sourceLogId,
  approved,
  onSaved,
}: {
  questionNorm: string;
  defaultQuestion: string;
  defaultAnswer: string;
  sourceLogId: string | null;
  approved: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(defaultQuestion);
  const [answer, setAnswer] = useState(defaultAnswer);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionNorm,
          questionDisplay: question,
          answer,
          sourceLogId,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Could not save");
        return;
      }
      setOpen(false);
      onSaved();
    } catch {
      setError("Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await fetch(
        `/api/dashboard/qa?questionNorm=${encodeURIComponent(questionNorm)}`,
        { method: "DELETE" }
      );
      setOpen(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex min-h-[36px] items-center rounded-full bg-cream-100 px-3 text-xs font-medium text-ink-700 hover:bg-cream-200"
      >
        {approved ? "Edit approved answer" : "Approve / edit answer"}
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-ink-100 bg-cream-50 p-3">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-400">
        Question
      </label>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
      />
      <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-400">
        Your approved answer
      </label>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={4}
        placeholder="Write the answer you'd want a client to get."
        className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !question.trim() || !answer.trim()}
          className="inline-flex min-h-[36px] items-center rounded-full bg-ink-900 px-4 text-xs font-medium text-cream-50 hover:bg-ink-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save answer"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-[36px] items-center rounded-full px-3 text-xs text-ink-500 hover:text-ink-900"
        >
          Cancel
        </button>
        {approved && (
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            className="ml-auto inline-flex min-h-[36px] items-center rounded-full px-3 text-xs text-red-500 hover:text-red-700"
          >
            Remove
          </button>
        )}
      </div>
      <p className="text-[11px] text-ink-400">
        Saved for your records. The assistant doesn’t use approved answers
        automatically yet — that comes next.
      </p>
    </div>
  );
}

function ApprovedPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
      Approved
    </span>
  );
}

export default function QuestionsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  function load() {
    fetch("/api/dashboard/insights")
      .then((r) => {
        if (r.status === 401) {
          setUnauthorized(true);
          return null;
        }
        return r.json();
      })
      .then((d: Insights | null) => d && setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const headerRight = (
    <nav className="flex items-center gap-0.5 text-sm sm:gap-1">
      <Link
        href="/dashboard"
        className="inline-flex min-h-[44px] items-center rounded-full px-3 text-sm text-ink-700 hover:bg-cream-100"
      >
        ← Dashboard
      </Link>
    </nav>
  );

  return (
    <PageShell variant="stylist" headerRight={headerRight}>
      <div className="mb-8">
        <p className="font-display text-sm uppercase tracking-[0.18em] text-ink-400">
          Knowledge
        </p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink-900 sm:text-4xl">
          Questions clients asked
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-600">
          What people actually ask your assistant — so you can see what to
          explain better and approve answers in your own words.
        </p>
      </div>

      {unauthorized ? (
        <Empty text="Please sign in to your dashboard to view this." />
      ) : loading ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : !data || data.totalLogged === 0 ? (
        <Empty text="No questions logged yet. Once clients chat with your assistant, what they ask will show up here." />
      ) : (
        <div className="space-y-10">
          {/* MOST ASKED */}
          <section>
            <SectionHeader
              title="Most asked"
              hint="Group these into approved answers — highest frequency first."
            />
            {data.mostAsked.length === 0 ? (
              <Empty text="Nothing yet." />
            ) : (
              <div className="space-y-3">
                {data.mostAsked.map((q) => (
                  <div
                    key={q.questionNorm}
                    className="rounded-2xl border border-ink-100 bg-cream-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[15px] font-medium text-ink-900">
                        “{q.example}”
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        {q.approved && <ApprovedPill />}
                        <span className="rounded-full bg-cream-200 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                          {q.count}×
                        </span>
                      </div>
                    </div>
                    {q.lastAnswer && (
                      <p className="mt-1 text-sm leading-relaxed text-ink-500">
                        Assistant said: {q.lastAnswer}
                      </p>
                    )}
                    <AnswerEditor
                      questionNorm={q.questionNorm}
                      defaultQuestion={q.example}
                      defaultAnswer={q.lastAnswer ?? ""}
                      sourceLogId={q.sourceLogId}
                      approved={q.approved}
                      onSaved={load}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* WHERE IT STRUGGLED */}
          <section>
            <SectionHeader
              title="Where it struggled"
              hint="Low confidence or a fallback — good candidates to approve a clear answer."
            />
            {data.struggled.length === 0 ? (
              <Empty text="Nothing flagged — the assistant felt confident on what it was asked." />
            ) : (
              <div className="space-y-3">
                {data.struggled.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-2xl border border-yellow-200 bg-yellow-50/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[15px] font-medium text-ink-900">
                        “{q.question}”
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        {q.approved && <ApprovedPill />}
                        {typeof q.confidence === "number" && (
                          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800">
                            {Math.round(q.confidence * 100)}%
                          </span>
                        )}
                      </div>
                    </div>
                    {q.answer && (
                      <p className="mt-1 text-sm leading-relaxed text-ink-500">
                        Assistant said: {q.answer}
                      </p>
                    )}
                    <AnswerEditor
                      questionNorm={q.questionNorm}
                      defaultQuestion={q.question}
                      defaultAnswer={q.answer ?? ""}
                      sourceLogId={q.id}
                      approved={q.approved}
                      onSaved={load}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* NEEDED YOU */}
          <section>
            <SectionHeader
              title="Needed you"
              hint="Moments the assistant flagged as wanting a real answer from you."
            />
            {data.needsShen.length === 0 ? (
              <Empty text="No escalation moments yet." />
            ) : (
              <div className="space-y-3">
                {data.needsShen.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-2xl border border-ink-100 bg-cream-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[15px] font-medium text-ink-900">
                        “{q.question}”
                      </p>
                      {q.approved && <ApprovedPill />}
                    </div>
                    {q.answer && (
                      <p className="mt-1 text-sm leading-relaxed text-ink-500">
                        Assistant said: {q.answer}
                      </p>
                    )}
                    <AnswerEditor
                      questionNorm={q.questionNorm}
                      defaultQuestion={q.question}
                      defaultAnswer={q.answer ?? ""}
                      sourceLogId={q.id}
                      approved={q.approved}
                      onSaved={load}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
