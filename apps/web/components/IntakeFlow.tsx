"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Button, Chip, SelectCard, Field, TextInput, TextArea, Toggle, ProgressBar, StepTitle,
} from "./ui";
import {
  ARTIST, REQUEST_TYPES, STYLE_CHIPS, PLACEMENTS, SIZE_GUIDES, IMAGE_CATEGORIES,
} from "@/lib/mock";

type Img = { id: string; url: string; category: string | null };
type Form = {
  name: string; pronouns: string; over18: boolean; email: string; phone: string; instagram: string;
  requestType: string;
  concept: string; styles: string[]; meaning: string;
  placement: string; placementNotes: string;
  sizeMode: "guided" | "exact"; sizeGuide: string; sizeExact: string;
  images: Img[];
  dates: string; flexible: boolean; traveling: boolean;
  budget: string;
  ackDeposit: boolean; ackCancel: boolean;
};

const EMPTY: Form = {
  name: "", pronouns: "", over18: false, email: "", phone: "", instagram: "",
  requestType: "", concept: "", styles: [], meaning: "",
  placement: "", placementNotes: "",
  sizeMode: "guided", sizeGuide: "", sizeExact: "",
  images: [], dates: "", flexible: false, traveling: false,
  budget: "", ackDeposit: false, ackCancel: false,
};

const STEPS = ["Basics", "Type", "Concept", "Placement", "Size", "References", "Timing", "Budget", "Policies", "Review"] as const;

export function IntakeFlow({ handle }: { handle: string }) {
  const a = ARTIST;
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [f, setF] = useState<Form>(EMPTY);
  const set = (patch: Partial<Form>) => setF((p) => ({ ...p, ...patch }));

  const last = STEPS.length - 1;
  const progress = (step + 1) / STEPS.length;

  // Per-step "can continue" gate (light — guided, not nagging).
  const canNext = (): boolean => {
    switch (STEPS[step]) {
      case "Basics": return f.name.trim().length > 1 && f.over18 && /.+@.+\..+/.test(f.email);
      case "Type": return !!f.requestType;
      case "Concept": return f.concept.trim().length > 3;
      case "Placement": return !!f.placement;
      case "Size": return f.sizeMode === "guided" ? !!f.sizeGuide : f.sizeExact.trim().length > 0;
      case "References": return true; // optional
      case "Timing": return true;
      case "Budget": return !!f.budget;
      case "Policies": return f.ackDeposit && f.ackCancel;
      default: return true;
    }
  };

  function addImages(files: FileList | null) {
    if (!files) return;
    const next: Img[] = Array.from(files).slice(0, 8).map((file, i) => ({
      id: `${Date.now()}-${i}`,
      url: URL.createObjectURL(file), // local preview only (mock — no upload)
      category: null,
    }));
    set({ images: [...f.images, ...next].slice(0, 8) });
  }

  if (submitted) return <Success handle={handle} f={f} />;

  return (
    <main className="mx-auto flex min-h-screen max-w-phone flex-col px-gutter pb-28 pt-5">
      {/* top bar: back + progress */}
      <div className="mb-1 flex items-center gap-3">
        <button onClick={() => (step === 0 ? history.back() : setStep((s) => s - 1))}
          className="text-[14px] text-ink-3 hover:text-ink">← Back</button>
        <span className="ml-auto text-[12px] font-medium text-ink-4">{step + 1} / {STEPS.length}</span>
      </div>
      <ProgressBar value={progress} />

      <div className="mt-7 flex-1">
        {STEPS[step] === "Basics" && (
          <div>
            <StepTitle kicker={`Request to ${a.displayName}`} title="Let's start with you" />
            <div className="space-y-4">
              <Field label="Your name"><TextInput value={f.name} onChange={(v) => set({ name: v })} placeholder="First & last" /></Field>
              <Field label="Pronouns (optional)"><TextInput value={f.pronouns} onChange={(v) => set({ pronouns: v })} placeholder="they/them" /></Field>
              <Field label="Email"><TextInput value={f.email} onChange={(v) => set({ email: v })} placeholder="you@email.com" type="email" /></Field>
              <Field label="Phone (optional)"><TextInput value={f.phone} onChange={(v) => set({ phone: v })} placeholder="(optional)" /></Field>
              <Field label="Instagram"><TextInput value={f.instagram} onChange={(v) => set({ instagram: v })} placeholder="@yourhandle" /></Field>
              <Toggle on={f.over18} onChange={(v) => set({ over18: v })} label="I confirm I'm 18 or older" />
            </div>
          </div>
        )}

        {STEPS[step] === "Type" && (
          <div>
            <StepTitle kicker="Request" title="What kind of tattoo?" />
            <div className="space-y-3">
              {REQUEST_TYPES.map((t) => (
                <SelectCard key={t.id} label={t.label} sub={t.sub}
                  selected={f.requestType === t.id} onClick={() => set({ requestType: t.id })} />
              ))}
            </div>
          </div>
        )}

        {STEPS[step] === "Concept" && (
          <div>
            <StepTitle kicker="Your idea" title="Describe what you're imagining" />
            <div className="space-y-4">
              <Field label="The idea" hint="The more detail, the better the design.">
                <TextArea value={f.concept} onChange={(v) => set({ concept: v })} rows={5}
                  placeholder="e.g. A Korean-inspired tiger with pine, moon, and a traditional mask, wrapping the upper arm…" />
              </Field>
              <Field label="Style direction">
                <div className="flex flex-wrap gap-2">
                  {STYLE_CHIPS.map((s) => (
                    <Chip key={s} label={s} selected={f.styles.includes(s)}
                      onClick={() => set({ styles: f.styles.includes(s) ? f.styles.filter((x) => x !== s) : [...f.styles, s] })} />
                  ))}
                </div>
              </Field>
              <Field label="Meaning / mood (optional)">
                <TextArea value={f.meaning} onChange={(v) => set({ meaning: v })} rows={2}
                  placeholder="What it represents, the feeling you want…" />
              </Field>
            </div>
          </div>
        )}

        {STEPS[step] === "Placement" && (
          <div>
            <StepTitle kicker="Placement" title="Where on your body?" />
            <div className="flex flex-wrap gap-2">
              {PLACEMENTS.map((p) => (
                <Chip key={p} label={p} selected={f.placement === p} onClick={() => set({ placement: p })} />
              ))}
            </div>
            <div className="mt-4">
              <Field label="Placement notes (optional)">
                <TextInput value={f.placementNotes} onChange={(v) => set({ placementNotes: v })} placeholder="e.g. outer forearm, facing out" />
              </Field>
            </div>
          </div>
        )}

        {STEPS[step] === "Size" && (
          <div>
            <StepTitle kicker="Size" title="How big, roughly?" />
            <div className="mb-4 flex gap-2">
              <Chip label="Guided" selected={f.sizeMode === "guided"} onClick={() => set({ sizeMode: "guided" })} />
              <Chip label="Exact size" selected={f.sizeMode === "exact"} onClick={() => set({ sizeMode: "exact" })} />
            </div>
            {f.sizeMode === "guided" ? (
              <div className="grid grid-cols-2 gap-3">
                {SIZE_GUIDES.map((s) => (
                  <SelectCard key={s.id} label={s.label} sub={s.sub}
                    selected={f.sizeGuide === s.id} onClick={() => set({ sizeGuide: s.id })} />
                ))}
              </div>
            ) : (
              <Field label="Approximate dimensions"><TextInput value={f.sizeExact} onChange={(v) => set({ sizeExact: v })} placeholder="e.g. 48cm x 18cm" /></Field>
            )}
          </div>
        )}

        {STEPS[step] === "References" && (
          <div>
            <StepTitle kicker="References" title="Show me your inspiration" />
            <p className="mb-4 text-[14px] text-ink-3">Upload images and tag what each one is for. Optional but it helps a lot.</p>
            <label className="flex h-28 cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-line-2 bg-surface text-center hover:border-ink-4">
              <span className="text-[14px] font-semibold text-ink">+ Add images</span>
              <span className="mt-1 text-[12px] text-ink-4">up to 8</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
            </label>
            {f.images.length > 0 && (
              <div className="mt-4 space-y-3">
                {f.images.map((img) => (
                  <div key={img.id} className="flex gap-3 rounded-card border border-line bg-surface p-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="h-16 w-16 shrink-0 rounded-control object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-4">What is this?</div>
                      <div className="flex flex-wrap gap-1.5">
                        {IMAGE_CATEGORIES.map((c) => (
                          <button key={c.id} onClick={() => set({ images: f.images.map((x) => x.id === img.id ? { ...x, category: c.id } : x) })}
                            className={`rounded-full border px-2.5 py-1 text-[11.5px] ${img.category === c.id ? "border-ink bg-ink text-white" : "border-line-2 text-ink-3"}`}>
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button onClick={() => set({ images: f.images.filter((x) => x.id !== img.id) })}
                      className="self-start text-[12px] text-ink-4 hover:text-err">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {STEPS[step] === "Timing" && (
          <div>
            <StepTitle kicker="Timing" title="When works for you?" />
            <Field label="Preferred dates"><TextInput value={f.dates} onChange={(v) => set({ dates: v })} placeholder="e.g. Jan 5–7, or 'weekends in July'" /></Field>
            <div className="mt-4 space-y-3">
              <Toggle on={f.flexible} onChange={(v) => set({ flexible: v })} label="I'm flexible on timing" />
              <Toggle on={f.traveling} onChange={(v) => set({ traveling: v })} label="I'm traveling from out of town" />
            </div>
          </div>
        )}

        {STEPS[step] === "Budget" && (
          <div>
            <StepTitle kicker="Budget" title="What's your budget range?" />
            <div className="space-y-3">
              {a.budgetRanges.map((b) => (
                <SelectCard key={b} label={b} selected={f.budget === b} onClick={() => set({ budget: b })} />
              ))}
            </div>
          </div>
        )}

        {STEPS[step] === "Policies" && (
          <div>
            <StepTitle kicker="Almost there" title="A couple of things to confirm" />
            <div className="space-y-4">
              <div className="rounded-card border border-line bg-surface p-4">
                <p className="text-[13.5px] leading-relaxed text-ink-2">{a.depositText}</p>
              </div>
              <Toggle on={f.ackDeposit} onChange={(v) => set({ ackDeposit: v })} label="I understand the deposit policy" />
              <div className="rounded-card border border-line bg-surface p-4">
                <p className="text-[13.5px] leading-relaxed text-ink-2">{a.cancellationText}</p>
              </div>
              <Toggle on={f.ackCancel} onChange={(v) => set({ ackCancel: v })} label="I understand the rescheduling policy" />
            </div>
          </div>
        )}

        {STEPS[step] === "Review" && <Review f={f} onEdit={setStep} />}
      </div>

      {/* sticky footer CTA */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg/90 px-gutter py-3 backdrop-blur">
        <div className="mx-auto max-w-phone">
          {step < last ? (
            <Button full disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>Continue</Button>
          ) : (
            <Button full onClick={() => setSubmitted(true)}>Send request to {a.displayName}</Button>
          )}
        </div>
      </div>
    </main>
  );
}

// ── Review ──
function Review({ f, onEdit }: { f: Form; onEdit: (s: number) => void }) {
  const rows: [string, string, number][] = [
    ["For", f.name + (f.pronouns ? ` (${f.pronouns})` : ""), 0],
    ["Type", cap(f.requestType), 1],
    ["Concept", f.concept, 2],
    ["Style", f.styles.join(", ") || "—", 2],
    ["Placement", f.placement + (f.placementNotes ? ` — ${f.placementNotes}` : ""), 3],
    ["Size", f.sizeMode === "guided" ? guideLabel(f.sizeGuide) : f.sizeExact, 4],
    ["References", `${f.images.length} image${f.images.length === 1 ? "" : "s"}`, 5],
    ["Timing", f.dates || (f.flexible ? "Flexible" : "—"), 6],
    ["Budget", f.budget, 7],
  ];
  return (
    <div>
      <StepTitle kicker="Review" title="Look good?" />
      <div className="divide-y divide-line rounded-card border border-line bg-surface">
        {rows.map(([label, val, s]) => (
          <div key={label} className="flex items-start gap-3 p-3.5">
            <div className="w-20 shrink-0 text-[12px] font-bold uppercase tracking-wide text-ink-4">{label}</div>
            <div className="min-w-0 flex-1 text-[14px] text-ink">{val || "—"}</div>
            <button onClick={() => onEdit(s)} className="text-[12.5px] font-semibold text-accent-ink">Edit</button>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-[12.5px] text-ink-4">You'll get a copy by email. The artist reviews and replies directly.</p>
    </div>
  );
}

function Success({ handle, f }: { handle: string; f: Form }) {
  const a = ARTIST;
  return (
    <main className="mx-auto flex min-h-screen max-w-phone flex-col items-center justify-center px-gutter text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ok-soft text-ok-ink text-[28px]">✓</div>
      <h1 className="mt-5 font-serif text-[28px] text-ink">Your request has been sent</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
        {a.displayName} will review your idea and reply directly. {a.responseTime.toLowerCase()}.
      </p>
      <div className="mt-6 w-full rounded-card border border-line bg-surface p-4 text-left">
        <div className="text-[12px] font-bold uppercase tracking-wide text-ink-4">What happens next</div>
        <ol className="mt-2 space-y-1.5 text-[13.5px] text-ink-2">
          <li>1. {a.displayName} reviews your concept & references.</li>
          <li>2. They'll reply with availability and any questions.</li>
          <li>3. A deposit secures your design slot.</li>
        </ol>
      </div>
      <Link href={`/${handle}`} className="mt-6 text-[13.5px] font-semibold text-accent-ink">← Back to {a.displayName}'s page</Link>
    </main>
  );
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : "—");
const guideLabel = (id: string) => SIZE_GUIDES.find((g) => g.id === id)?.label ?? id;
