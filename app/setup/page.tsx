"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { ProgressSteps } from "@/components/ProgressSteps";
import { CopyButton } from "@/components/CopyButton";
import { QuickReplyCard } from "@/components/QuickReplyCard";
import {
  SERVICES,
  DEFAULT_AVAILABILITY,
  QUICK_REPLIES,
  STYLIST,
} from "@/lib/mock-data";
import type { Service, ServiceCategory, Availability } from "@/lib/types";
import {
  type AssistantServiceStatus,
  type ServiceOverlay,
  type AssistantConfig,
  type BookingStyle,
  type CustomRequestHandling,
  type AssistantTone,
  DEFAULT_ASSISTANT_CONFIG,
  buildDefaultOverlays,
} from "@/lib/setup-config";
import { cn } from "@/lib/cn";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

const STEP_LABELS = [
  "Connect",
  "Services",
  "Availability",
  "Assistant",
  "Share",
];
const CATEGORIES: ServiceCategory[] = [
  "Haircut",
  "Treatment",
  "Perm",
  "Color",
];

const supabase = createClient();

function formatDurationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

// Next.js 14 requires components that call useSearchParams() to be wrapped
// in a Suspense boundary so static export can bail out cleanly. Without
// this the /setup route fails `next build` prerender on Vercel.
export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <SetupPageInner />
    </Suspense>
  );
}

function SetupPageInner() {
  const router = useRouter();
  // ── Auth state ────────────────────────────────────────────────────────────
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setAuthLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // If the stylist is already set up (Square connected), bounce them to
  // the dashboard. Honour ?continue=true so they can intentionally revisit
  // setup to change services/availability later.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("continue") === "true") return;
    if (params.get("connected") === "true") return; // just finished OAuth — let setup render
    fetch("/api/stylist/status")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.squareConnected) router.replace("/dashboard");
      })
      .catch(() => {});
  }, [user, router]);

  async function signInWithGoogle() {
    // Primary sign-in. Reuses the existing PKCE /auth/callback route, which
    // exchanges the code for a session cookie then forwards to /setup —
    // identical handling to magic-link, no new route needed.
    const redirectBase = window.location.origin;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${redirectBase}/auth/callback?next=/setup` },
    });
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    // Use the current origin so this works in dev (localhost), on a phone
    // hitting the LAN IP, or in production. The redirect URL must be
    // allow-listed in Supabase Auth → URL Configuration → Redirect URLs.
    const redirectBase = window.location.origin;
    await supabase.auth.signInWithOtp({
      email,
      // Point at the PKCE callback route, which exchanges the code for a
      // session cookie, then forwards to /setup. Linking straight to /setup
      // skipped the exchange and left the user without a session.
      options: { emailRedirectTo: `${redirectBase}/auth/callback?next=/setup` },
    });
    setSending(false);
    setSent(true);
  }

  // ── URL params (from Square OAuth callback) ───────────────────────────────
  const searchParams = useSearchParams();
  const squareError = searchParams.get("square_error");

  // ── Setup flow state ──────────────────────────────────────────────────────
  const [step, setStep] = useState(1);
  const [squareConnected] = useState(
    searchParams.get("connected") === "true"
  );

  // After Square connection, fetch real services; fall back to mock data.
  const [services, setServices] = useState<Service[]>(SERVICES);
  const [overlays, setOverlays] = useState<ServiceOverlay[]>(
    buildDefaultOverlays(SERVICES)
  );
  const [servicesFetched, setServicesFetched] = useState(false);

  useEffect(() => {
    if (!squareConnected || servicesFetched) return;
    setServicesFetched(true);
    fetch("/api/square/services")
      .then((r) => r.json())
      .then((data) => {
        if (data.services && Array.isArray(data.services)) {
          const imported: Service[] = data.services.map((s: any) => ({
            id: s.id,
            name: s.name,
            category: s.category,
            priceLabel: s.priceLabel,
            durationMinutes: s.durationMinutes,
            durationLabel: formatDurationLabel(s.durationMinutes),
            status: "online" as const,
          }));
          setServices(imported);
          setOverlays(buildDefaultOverlays(imported));
        }
      })
      .catch(() => { /* keep mock data on fetch failure */ });
  }, [squareConnected, servicesFetched]);
  const [availability, setAvailability] =
    useState<Availability>(DEFAULT_AVAILABILITY);
  const [assistantConfig, setAssistantConfig] = useState<AssistantConfig>(
    DEFAULT_ASSISTANT_CONFIG
  );

  function updateOverlay(id: string, patch: Partial<ServiceOverlay>) {
    setOverlays((prev) =>
      prev.map((o) => (o.serviceId === id ? { ...o, ...patch } : o))
    );
  }

  if (authLoading) {
    return (
      <PageShell variant="stylist">
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-sm text-ink-400">Loading…</p>
        </div>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell variant="stylist">
        <div className="mx-auto max-w-sm pt-16">
          <SignInScreen
            email={email}
            onEmailChange={setEmail}
            onSubmit={sendMagicLink}
            onGoogle={signInWithGoogle}
            sending={sending}
            sent={sent}
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell variant="stylist">
      <div className="mx-auto max-w-2xl">
        <div className="mb-10">
          <ProgressSteps steps={STEP_LABELS} currentStep={step} />
        </div>

        {step === 1 && (
          <StepConnect
            connected={squareConnected}
            squareError={squareError}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <StepServices
            services={services}
            overlays={overlays}
            onUpdateOverlay={updateOverlay}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <StepAvailability
            availability={availability}
            onChange={setAvailability}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
          />
        )}

        {step === 4 && (
          <StepAssistant
            config={assistantConfig}
            onChange={setAssistantConfig}
            onBack={() => setStep(3)}
            onNext={() => setStep(5)}
          />
        )}

        {step === 5 && <StepShare onBack={() => setStep(4)} />}
      </div>
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Sign-in screen                                                              */
/* -------------------------------------------------------------------------- */

function SignInScreen({
  email,
  onEmailChange,
  onSubmit,
  onGoogle,
  sending,
  sent,
}: {
  email: string;
  onEmailChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onGoogle: () => void;
  sending: boolean;
  sent: boolean;
}) {
  if (sent) {
    return (
      <div className="text-center">
        <p className="font-display text-2xl font-medium text-ink-900">
          Check your inbox
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-500">
          We sent a sign-in link to{" "}
          <span className="font-medium text-ink-900">{email}</span>.
          <br />
          Click it to continue setup.
        </p>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-8">
        <p className="font-display text-xs uppercase tracking-[0.18em] text-ink-400">
          Stylist setup
        </p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink-900">
          Sign in
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-600">
          Sign in with Google to continue — no password needed.
        </p>
      </header>

      {/* Primary: Continue with Google */}
      <button
        type="button"
        onClick={onGoogle}
        className="flex w-full items-center justify-center gap-2.5 rounded-full border border-ink-200 bg-cream-50 py-3 text-[15px] font-medium text-ink-900 transition hover:bg-cream-100"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
          />
          <path
            fill="#FBBC05"
            d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
          />
        </svg>
        Continue with Google
      </button>

      {/* Divider */}
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-ink-100" />
        <span className="text-xs uppercase tracking-wider text-ink-400">or</span>
        <span className="h-px flex-1 bg-ink-100" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-800">
            Email
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
            className="w-full rounded-xl border border-ink-200 bg-cream-50 px-3.5 py-2.5 text-[14.5px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </label>

        <button
          type="submit"
          disabled={sending || !email}
          className={cn(
            "w-full rounded-full py-3 text-[15px] font-medium transition",
            sending || !email
              ? "cursor-not-allowed bg-cream-200 text-ink-400"
              : "bg-ink-900 text-cream-50 hover:bg-ink-800"
          )}
        >
          {sending ? "Sending…" : "Email me a magic link instead"}
        </button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 1 — Connect Square                                                     */
/* -------------------------------------------------------------------------- */

function StepConnect({
  connected,
  squareError,
  onNext,
}: {
  connected: boolean;
  squareError: string | null;
  onNext: () => void;
}) {
  const errorMessages: Record<string, string> = {
    missing_code: "Square didn't return an authorization code. Please try again.",
    no_user: "Your session expired. Please sign in again.",
    token_exchange_failed: "Square token exchange failed. Check your app credentials and try again.",
    db_save_failed: "Connected to Square but couldn't save the data. Please try again.",
    access_denied: "Authorization was cancelled. Click Connect Square to try again.",
  };
  const errorText = squareError
    ? (errorMessages[squareError] ?? `Square error: ${squareError}`)
    : null;

  return (
    <div className="animate-fade-up">
      <StepHeader
        eyebrow="Step 1 of 5"
        title="Connect Square"
        subtitle="We'll import your services, availability, and booking settings from Square — no manual setup."
      />

      <div className="mt-6 space-y-3">
        {errorText && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorText}
          </p>
        )}

        {!connected ? (
          <a
            href="/api/square/connect"
            className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-cream-50 p-5 text-left transition hover:border-ink-300 hover:shadow-soft active:scale-[0.99]"
          >
            <div className="flex items-center gap-4">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ink-900 font-display text-lg text-cream-50"
                aria-hidden
              >
                ◼
              </div>
              <div>
                <p className="text-[15px] font-medium text-ink-900">
                  Connect Square
                </p>
                <p className="mt-0.5 text-sm text-ink-500">
                  We&rsquo;ll pull your services and hours
                </p>
              </div>
            </div>
            <span className="text-sm font-medium text-ink-900 group-hover:text-accent">
              Connect →
            </span>
          </a>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-success/30 bg-success-soft/40 p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-success-soft">
                  <svg
                    className="h-5 w-5 text-success"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 12.5L10 17.5L19 7.5" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-ink-900">
                    Connected to Square
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-600">
                    Imported{" "}
                    <span className="font-medium text-ink-900">
                      {SERVICES.length} services
                    </span>
                    ,{" "}
                    <span className="font-medium text-ink-900">
                      Tue–Sat hours
                    </span>
                    , and{" "}
                    <span className="font-medium text-ink-900">
                      booking buffers
                    </span>
                    .
                  </p>
                </div>
              </div>
            </div>
            <DisplayNameField />
          </div>
        )}

        <PrototypeNote
          text="In sandbox mode. Services, availability, and bookings use your Square sandbox account. Switch SQUARE_ENVIRONMENT=production before launch."
        />
      </div>

      <StepFooter
        primaryDisabled={!connected}
        primaryLabel="Review imports"
        onPrimary={onNext}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Display name override — lets the stylist set what shows on /shen           */
/* regardless of what Square stored on their behalf.                          */
/* -------------------------------------------------------------------------- */

function DisplayNameField() {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/stylist")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.name && data.name !== "Your stylist") setValue(data.name);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/stylist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: value }),
      });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-cream-50 p-5">
      <label htmlFor="display-name" className="block text-[13px] font-medium text-ink-900">
        Display name
      </label>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
        How clients see you on the booking page. Defaults to your Square business name.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          id="display-name"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          disabled={!loaded}
          placeholder="e.g. Shen Lee"
          className="min-w-0 flex-1 rounded-xl border border-ink-200 bg-cream-50 px-3 py-2 text-[15px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={save}
          disabled={!loaded || saving}
          className="shrink-0 rounded-xl bg-ink-900 px-4 py-2 text-sm font-medium text-cream-50 transition hover:bg-ink-800 active:scale-[0.97] disabled:opacity-50"
        >
          {saving ? "Saving…" : savedAt ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 2 — Imported services                                                  */
/* -------------------------------------------------------------------------- */

function StepServices({
  services,
  overlays,
  onUpdateOverlay,
  onBack,
  onNext,
}: {
  services: Service[];
  overlays: ServiceOverlay[];
  onUpdateOverlay: (id: string, patch: Partial<ServiceOverlay>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function getOverlay(id: string): ServiceOverlay {
    return overlays.find((o) => o.serviceId === id)!;
  }

  return (
    <div className="animate-fade-up">
      <StepHeader
        eyebrow="Step 2 of 5"
        title="Review your services"
        subtitle="These came from Square. You can change how they appear in your assistant without changing Square yet."
      />

      <div className="mt-8 space-y-8">
        {CATEGORIES.map((cat) => {
          const inCat = services.filter((s) => s.category === cat);
          if (inCat.length === 0) return null;
          return (
            <section key={cat}>
              <h3 className="mb-2 font-display text-xs uppercase tracking-[0.18em] text-ink-500">
                {cat}
              </h3>
              <div className="space-y-2">
                {inCat.map((svc) => (
                  <ImportedServiceRow
                    key={svc.id}
                    service={svc}
                    overlay={getOverlay(svc.id)}
                    expanded={expandedId === svc.id}
                    onToggle={() =>
                      setExpandedId(expandedId === svc.id ? null : svc.id)
                    }
                    onUpdate={(patch) => onUpdateOverlay(svc.id, patch)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <StepFooter
        onBack={onBack}
        primaryLabel="Continue"
        onPrimary={onNext}
      />
    </div>
  );
}

function ImportedServiceRow({
  service,
  overlay,
  expanded,
  onToggle,
  onUpdate,
}: {
  service: Service;
  overlay: ServiceOverlay;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<ServiceOverlay>) => void;
}) {
  const displayName = overlay.displayName ?? service.name;
  const isHidden = overlay.status === "hidden";

  return (
    <div
      className={cn(
        "rounded-2xl border bg-cream-50 transition",
        expanded
          ? "border-ink-300 shadow-soft"
          : "border-ink-100 hover:border-ink-200",
        isHidden && "opacity-60"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-[15px] font-medium text-ink-900">
              {displayName}
            </p>
            <SquareBadge />
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {service.priceLabel}
            <span className="px-1.5 text-ink-300">·</span>
            {service.durationLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={overlay.status} />
          <span
            className={cn(
              "text-ink-400 transition",
              expanded && "rotate-180"
            )}
            aria-hidden
          >
            ⌄
          </span>
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-ink-100 px-4 py-4">
          {/* Display name */}
          <Field label="Display name" hint="shown in your assistant">
            <input
              type="text"
              value={overlay.displayName ?? ""}
              placeholder={service.name}
              onChange={(e) => {
                const raw = e.target.value;
                onUpdate({
                  displayName: raw === "" ? null : raw,
                });
              }}
              className="w-full rounded-xl border border-ink-200 bg-cream-50 px-3.5 py-2.5 text-[14.5px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
            />
          </Field>

          {/* Read-only price + duration */}
          <div className="grid grid-cols-2 gap-3">
            <ReadOnlyField label="Price" value={service.priceLabel} />
            <ReadOnlyField label="Duration" value={service.durationLabel} />
          </div>
          <p className="-mt-1 text-xs text-ink-500">
            Price and duration are managed in Square.{" "}
            <a
              href="https://squareup.com"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-ink-900 underline-offset-2 hover:underline"
            >
              Edit in Square
            </a>
          </p>

          {/* Client-facing status */}
          <Field label="In your assistant">
            <StatusSelector
              value={overlay.status}
              onChange={(s) => onUpdate({ status: s })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function SquareBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-cream-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-600">
      <span
        className="h-1.5 w-1.5 rounded-sm bg-ink-700"
        aria-hidden
      />
      Imported from Square
    </span>
  );
}

function StatusPill({ status }: { status: AssistantServiceStatus }) {
  const map: Record<AssistantServiceStatus, { label: string; className: string }> = {
    instant: {
      label: "Book instantly",
      className: "bg-success-soft text-success",
    },
    clarify: {
      label: "Clarify first",
      className: "bg-cream-200 text-ink-700",
    },
    consult: {
      label: "Consultation",
      className: "bg-accent-soft text-accent-dark",
    },
    hidden: {
      label: "Hidden",
      className: "bg-ink-100 text-ink-500",
    },
  };
  const { label, className } = map[status];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
        className
      )}
    >
      {label}
    </span>
  );
}

function StatusSelector({
  value,
  onChange,
}: {
  value: AssistantServiceStatus;
  onChange: (s: AssistantServiceStatus) => void;
}) {
  const options: {
    key: AssistantServiceStatus;
    label: string;
    desc: string;
  }[] = [
    {
      key: "instant",
      label: "Book instantly",
      desc: "Assistant offers times right away",
    },
    {
      key: "clarify",
      label: "Clarify first",
      desc: "Assistant asks one question before booking",
    },
    {
      key: "consult",
      label: "Consultation recommended",
      desc: "Route to a quick consult slot",
    },
    {
      key: "hidden",
      label: "Hide from booking link",
      desc: "Won't show up in the assistant",
    },
  ];
  return (
    <div className="space-y-1.5">
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition",
              selected
                ? "border-ink-900 bg-cream-100"
                : "border-ink-100 bg-cream-50 hover:border-ink-200"
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                selected
                  ? "border-ink-900 bg-ink-900"
                  : "border-ink-300 bg-cream-50"
              )}
              aria-hidden
            >
              {selected && (
                <span className="h-1.5 w-1.5 rounded-full bg-cream-50" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-ink-900">
                {opt.label}
              </span>
              <span className="mt-0.5 block text-xs text-ink-500">
                {opt.desc}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 3 — Imported availability                                              */
/* -------------------------------------------------------------------------- */

function StepAvailability({
  availability,
  onChange,
  onBack,
  onNext,
}: {
  availability: Availability;
  onChange: (a: Availability) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const allDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  function toggleDay(day: string) {
    const has = availability.days.includes(day);
    const next = has
      ? availability.days.filter((d) => d !== day)
      : [...availability.days, day].sort(
          (a, b) => allDays.indexOf(a) - allDays.indexOf(b)
        );
    onChange({ ...availability, days: next });
  }

  return (
    <div className="animate-fade-up">
      <StepHeader
        eyebrow="Step 3 of 5"
        title="Review availability"
        subtitle="We found your Square booking hours and buffers. Confirm how your assistant should use them."
      />

      <div className="mt-6 rounded-2xl border border-ink-100 bg-cream-50 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-xs uppercase tracking-[0.16em] text-ink-500">
            Imported from Square
          </p>
          <SquareBadge />
        </div>

        <div className="mt-5 space-y-5">
          <Field label="Working days">
            <div className="flex flex-wrap gap-1.5">
              {allDays.map((d) => {
                const active = availability.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={cn(
                      "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                      active
                        ? "bg-ink-900 text-cream-50"
                        : "border border-ink-200 bg-cream-50 text-ink-700 hover:border-ink-300"
                    )}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Day starts">
              <input
                type="text"
                value={availability.startLabel}
                onChange={(e) =>
                  onChange({ ...availability, startLabel: e.target.value })
                }
                className="w-full rounded-xl border border-ink-200 bg-cream-50 px-3.5 py-2.5 text-[14.5px] text-ink-900 focus:border-ink-900 focus:outline-none"
              />
            </Field>
            <Field label="Day ends">
              <input
                type="text"
                value={availability.endLabel}
                onChange={(e) =>
                  onChange({ ...availability, endLabel: e.target.value })
                }
                className="w-full rounded-xl border border-ink-200 bg-cream-50 px-3.5 py-2.5 text-[14.5px] text-ink-900 focus:border-ink-900 focus:outline-none"
              />
            </Field>
          </div>

          <Field label="Buffer between appointments">
            <PillRow
              options={[0, 5, 15, 30]}
              value={availability.bufferMinutes}
              onChange={(n) =>
                onChange({ ...availability, bufferMinutes: n })
              }
              format={(n) => (n === 0 ? "None" : `${n} min`)}
            />
          </Field>

          <Field label="Minimum booking notice">
            <PillRow
              options={[2, 6, 12, 24]}
              value={availability.minNoticeHours}
              onChange={(n) =>
                onChange({ ...availability, minNoticeHours: n })
              }
              format={(n) => `${n} hr`}
            />
          </Field>
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-ink-100 bg-cream-100/60 px-4 py-3 text-xs leading-relaxed text-ink-600">
        Your real appointments will still come from Square so we don&rsquo;t
        double book.
      </p>

      <StepFooter onBack={onBack} primaryLabel="Continue" onPrimary={onNext} />
    </div>
  );
}

function PillRow<T extends number>({
  options,
  value,
  onChange,
  format,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
              active
                ? "bg-ink-900 text-cream-50"
                : "border border-ink-200 bg-cream-50 text-ink-700 hover:border-ink-300"
            )}
          >
            {format(opt)}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 4 — Customize your assistant                                           */
/* -------------------------------------------------------------------------- */

function StepAssistant({
  config,
  onChange,
  onBack,
  onNext,
}: {
  config: AssistantConfig;
  onChange: (c: AssistantConfig) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  function patch<K extends keyof AssistantConfig>(
    key: K,
    value: AssistantConfig[K]
  ) {
    onChange({ ...config, [key]: value });
  }

  return (
    <div className="animate-fade-up">
      <StepHeader
        eyebrow="Step 4 of 5"
        title="Customize your assistant"
        subtitle="Defaults work for most stylists. Tweak any of these or skip to the next step."
      />

      <p className="mt-4 rounded-xl border border-ink-100 bg-cream-100/60 px-4 py-3 text-xs leading-relaxed text-ink-600">
        Preview only — these settings will customize your assistant in
        production.
      </p>

      <div className="mt-6 space-y-6">
        <Field
          label="Assistant greeting"
          hint="first message clients see"
        >
          <textarea
            value={config.greeting}
            onChange={(e) => patch("greeting", e.target.value)}
            rows={3}
            className="w-full resize-none rounded-xl border border-ink-200 bg-cream-50 px-3.5 py-2.5 text-[14.5px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </Field>

        <Field label="When clients open the link">
          <RadioOptionGroup<BookingStyle>
            value={config.bookingStyle}
            onChange={(v) => patch("bookingStyle", v)}
            options={[
              {
                key: "best-times",
                label: "Show 3 best times first",
                desc: "Mix of times across the week",
              },
              {
                key: "earliest",
                label: "Show earliest available first",
                desc: "Whatever's soonest, in order",
              },
              {
                key: "ask-first",
                label: "Ask one clarifying question",
                desc: "Assistant asks what they want before showing times",
              },
            ]}
          />
        </Field>

        <Field label="When a request is custom or unusual">
          <RadioOptionGroup<CustomRequestHandling>
            value={config.customRequestHandling}
            onChange={(v) => patch("customRequestHandling", v)}
            options={[
              {
                key: "consult",
                label: "Send to consultation",
                desc: "Offer a quick free consult slot",
              },
              {
                key: "dm",
                label: "Tell client to DM you",
                desc: "Hand off to Instagram or text",
              },
              {
                key: "note",
                label: "Add a note to the booking",
                desc: "Book it with a flag for you to review",
              },
            ]}
          />
        </Field>

        <Field label="Tone">
          <SegmentedControl<AssistantTone>
            value={config.tone}
            onChange={(v) => patch("tone", v)}
            options={[
              { key: "warm", label: "Warm" },
              { key: "minimal", label: "Minimal" },
              { key: "professional", label: "Professional" },
            ]}
          />
        </Field>
      </div>

      <StepFooter onBack={onBack} primaryLabel="Continue" onPrimary={onNext} />
    </div>
  );
}

function RadioOptionGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; desc: string }[];
}) {
  return (
    <div className="space-y-1.5">
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition",
              selected
                ? "border-ink-900 bg-cream-100"
                : "border-ink-100 bg-cream-50 hover:border-ink-200"
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                selected
                  ? "border-ink-900 bg-ink-900"
                  : "border-ink-300 bg-cream-50"
              )}
              aria-hidden
            >
              {selected && (
                <span className="h-1.5 w-1.5 rounded-full bg-cream-50" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-ink-900">
                {opt.label}
              </span>
              <span className="mt-0.5 block text-xs text-ink-500">
                {opt.desc}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-full border border-ink-200 bg-cream-50 p-1">
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition",
              selected
                ? "bg-ink-900 text-cream-50 shadow-sm"
                : "text-ink-600 hover:text-ink-900"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 5 — Booking link + quick replies                                       */
/* -------------------------------------------------------------------------- */

function StepShare({ onBack }: { onBack: () => void }) {
  return (
    <div className="animate-fade-up">
      <StepHeader
        eyebrow="Step 5 of 5"
        title="Your booking link is ready"
        subtitle="Use this link anywhere — Instagram, WeChat, KakaoTalk, or text."
      />

      <div className="mt-6 overflow-hidden rounded-3xl border border-ink-100 bg-cream-50 shadow-card">
        <div className="bg-gradient-to-br from-accent-soft/70 to-cream-50 p-6 sm:p-7">
          <p className="font-display text-xs uppercase tracking-[0.18em] text-accent-dark">
            Your booking link
          </p>
          <p className="mt-3 break-all font-display text-[26px] font-medium leading-tight tracking-tight text-ink-900 sm:text-[30px]">
            {STYLIST.bookingUrl}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <CopyButton
              value={STYLIST.bookingUrl}
              variant="primary"
              label="Copy link"
              copiedLabel="Link copied"
            />
            <Link
              href="/shen"
              className="rounded-full border border-ink-200 bg-cream-50 px-5 py-2.5 text-sm font-medium text-ink-800 hover:border-ink-300"
            >
              Preview
            </Link>
          </div>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-2 font-display text-lg font-medium text-ink-900">
          Quick replies
        </h2>
        <p className="mb-3 text-sm text-ink-500">
          Tap copy and paste the right message + your link into any DM.
        </p>
        <div className="space-y-2">
          {QUICK_REPLIES.map((qr) => (
            <QuickReplyCard key={qr.id} reply={qr} />
          ))}
        </div>
      </section>

      <div className="mt-8 rounded-2xl border border-ink-100 bg-cream-100/60 p-5">
        <p className="font-display text-xs uppercase tracking-[0.16em] text-ink-500">
          Pro tip
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
          Pin your booking link in Instagram bio. New requests land directly in
          Square — you don&rsquo;t have to reply.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full px-4 py-2 text-sm text-ink-500 hover:text-ink-900"
        >
          ← Back
        </button>
        <Link
          href="/dashboard"
          className="rounded-full bg-ink-900 px-6 py-3 text-[15px] font-medium text-cream-50 hover:bg-ink-800"
        >
          Go to dashboard →
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared step UI                                                              */
/* -------------------------------------------------------------------------- */

function StepHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header>
      <p className="font-display text-xs uppercase tracking-[0.18em] text-ink-400">
        {eyebrow}
      </p>
      <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink-900 sm:text-[34px]">
        {title}
      </h1>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-600">
        {subtitle}
      </p>
    </header>
  );
}

function StepFooter({
  onBack,
  onPrimary,
  primaryLabel,
  primaryDisabled,
}: {
  onBack?: () => void;
  onPrimary: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
}) {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-full px-4 py-2 text-sm text-ink-500 hover:text-ink-900"
        >
          ← Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        className={cn(
          "rounded-full px-6 py-3 text-[15px] font-medium transition",
          primaryDisabled
            ? "cursor-not-allowed bg-cream-200 text-ink-400"
            : "bg-ink-900 text-cream-50 hover:bg-ink-800"
        )}
      >
        {primaryLabel} →
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink-800">{label}</span>
        {hint && <span className="text-xs text-ink-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink-800">{label}</p>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-ink-100 bg-cream-100/60 px-3.5 py-2.5">
        <span className="text-[14.5px] text-ink-700">{value}</span>
        <span className="text-[10px] uppercase tracking-wider text-ink-400">
          Square
        </span>
      </div>
    </div>
  );
}

function PrototypeNote({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-200 bg-cream-100/40 px-4 py-3">
      <p className="text-xs leading-relaxed text-ink-500">
        <span className="font-medium text-ink-700">Prototype note:</span>{" "}
        {text}
      </p>
    </div>
  );
}
