"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { CopyButton } from "@/components/CopyButton";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

const supabase = createClient();

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type Behavior = "book" | "consultation" | "handoff" | "hidden";

type ProviderService = {
  id: string;
  name: string;
  category: string | null;
  price_cents: number | null;
  duration_minutes: number | null;
  visible_in_chat: boolean;
  behavior: Behavior;
  aliases: string[];
  chat_description: string | null;
};

type UnsupportedRule = {
  id: string;
  trigger_term: string;
  response_type: "not_offered" | "handoff" | "consultation" | "custom";
  custom_response: string | null;
};

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function ServicesSettingsPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setSignedIn(Boolean(data.user));
      setAuthChecked(true);
    });
  }, []);

  if (!authChecked) {
    return (
      <PageShell variant="stylist">
        <p className="mt-12 text-center text-sm text-ink-500">Loading…</p>
      </PageShell>
    );
  }

  if (!signedIn) {
    return (
      <PageShell variant="stylist">
        <div className="mx-auto mt-16 max-w-md px-6 text-center">
          <h1 className="font-display text-xl text-ink-900">Sign in required</h1>
          <p className="mt-2 text-sm text-ink-600">
            This page manages your booking helper settings.{" "}
            <Link href="/setup" className="underline">
              Sign in
            </Link>
            .
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell variant="stylist">
      <div className="mx-auto max-w-2xl px-4 pb-24 sm:px-6">
        <header className="mt-4 mb-1">
          <Link
            href="/dashboard"
            className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-sm text-ink-500 hover:text-ink-900"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-1 font-display text-2xl text-ink-900">
            Booking helper settings
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Manage what your booking helper says and does.
          </p>
        </header>

        <SquareStatusSection />
        <BookingLinkSection />
        <ServicesSection />
        <UnsupportedSection />
        <HandoffEmailSection />
      </div>
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Square status                                                               */
/* -------------------------------------------------------------------------- */

type StylistStatus = {
  squareConnected: boolean;
  squareTokenStale: boolean;
  businessName: string | null;
  locationName: string | null;
  teamMemberName: string | null;
  lastSyncedAt: string | null;
  syncedServicesCount: number;
};

function SquareStatusSection() {
  const [status, setStatus] = useState<StylistStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stylist/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Section title="Square">
        <p className="text-sm text-ink-500">Loading…</p>
      </Section>
    );
  }

  const connected = Boolean(status?.squareConnected);

  return (
    <Section title="Square">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink-900">
            {connected
              ? status?.businessName ?? status?.locationName ?? "Connected"
              : "Not connected"}
          </p>
          {connected && status?.teamMemberName && (
            <p className="text-sm text-ink-500">{status.teamMemberName}</p>
          )}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
            !connected
              ? "bg-cream-200 text-ink-500"
              : status?.squareTokenStale
              ? "bg-yellow-100 text-yellow-800"
              : "bg-success-soft text-success"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              !connected
                ? "bg-ink-400"
                : status?.squareTokenStale
                ? "bg-yellow-500"
                : "bg-success"
            )}
          />
          {!connected
            ? "Not connected"
            : status?.squareTokenStale
            ? "Reconnect"
            : "Connected"}
        </span>
      </div>

      {connected ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-ink-500">Synced services</dt>
            <dd className="font-medium text-ink-900">
              {status?.syncedServicesCount ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-ink-500">Last synced</dt>
            <dd className="font-medium text-ink-900">
              {fmtSync(status?.lastSyncedAt ?? null)}
            </dd>
          </div>
        </dl>
      ) : (
        <a
          href="/api/square/connect"
          className="mt-3 inline-flex min-h-[44px] items-center rounded-full bg-ink-900 px-5 text-sm font-medium text-cream-50"
        >
          Connect Square
        </a>
      )}

      {connected && (status?.syncedServicesCount ?? 0) === 0 && (
        <p className="mt-3 rounded-xl bg-cream-100 px-3 py-2 text-xs leading-relaxed text-ink-500">
          No services synced yet. Re-open{" "}
          <Link href="/setup?continue=true" className="underline">
            setup
          </Link>{" "}
          to pull your Square catalog.
        </p>
      )}
    </Section>
  );
}

function fmtSync(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* -------------------------------------------------------------------------- */
/* Booking link                                                                */
/* -------------------------------------------------------------------------- */

function BookingLinkSection() {
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/provider/handoff-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.slug && setSlug(d.slug))
      .catch(() => {});
  }, []);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const link = slug ? `${origin}/book/${slug}` : null;

  return (
    <Section title="Your booking link">
      {link ? (
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded-lg bg-cream-100 px-3 py-2 text-sm text-ink-800">
            {link}
          </code>
          <CopyButton value={link} label="Copy link" copiedLabel="Copied" />
        </div>
      ) : (
        <p className="text-sm text-ink-500">
          No booking link yet — finish Square setup to get your slug.
        </p>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Services                                                                    */
/* -------------------------------------------------------------------------- */

function ServicesSection() {
  const [services, setServices] = useState<ProviderService[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/provider/services")
      .then((r) => (r.ok ? r.json() : { services: [] }))
      .then((d) => setServices(d.services ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Section title="Synced services">
      {loading ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : services.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-200 bg-cream-50 p-5 text-center">
          <p className="text-sm font-medium text-ink-700">No services synced yet</p>
          <p className="mt-1 text-sm text-ink-500">
            Connect Square and sync your catalog, then your services appear here
            to manage.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((svc) => (
            <ServiceRow key={svc.id} service={svc} />
          ))}
        </div>
      )}
    </Section>
  );
}

function ServiceRow({ service }: { service: ProviderService }) {
  const [visible, setVisible] = useState(service.visible_in_chat);
  const [behavior, setBehavior] = useState<Behavior>(service.behavior);
  const [aliases, setAliases] = useState(service.aliases.join(", "));
  const [desc, setDesc] = useState(service.chat_description ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await fetch("/api/provider/services", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: service.id,
          visible_in_chat: visible,
          behavior,
          aliases,
          chat_description: desc,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error ?? "save_failed");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setErr("network_error");
    } finally {
      setSaving(false);
    }
  }

  const priceLabel =
    service.price_cents != null
      ? `$${Math.round(service.price_cents / 100)}`
      : "—";
  const durLabel =
    service.duration_minutes != null ? `${service.duration_minutes} min` : "—";

  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-ink-100 bg-cream-50">
      {/* Compact header — always visible. Tap the row to expand the editor.
          The visible toggle is a separate tap target so it doesn't expand. */}
      <div className="flex items-center justify-between gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <span
            className={cn(
              "shrink-0 text-ink-400 transition-transform",
              expanded && "rotate-90"
            )}
            aria-hidden
          >
            ›
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink-900">
              {service.name}
            </span>
            <span className="block text-xs text-ink-500">
              {service.category ?? "—"} · {priceLabel} · {durLabel}
              {!visible && " · hidden"}
            </span>
          </span>
        </button>
        <Toggle checked={visible} onChange={setVisible} label="Visible" />
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-ink-100 px-4 pb-4 pt-3">
          <label className="block text-sm text-ink-700">
            Behavior
            <select
              value={behavior}
              onChange={(e) => setBehavior(e.target.value as Behavior)}
              className="mt-1 block min-h-[44px] w-full rounded-lg border border-ink-200 bg-white px-3 text-sm"
            >
              <option value="book">Book directly</option>
              <option value="consultation">Requires consultation</option>
              <option value="handoff">Hand off to me</option>
              <option value="hidden">Hidden from chat</option>
            </select>
          </label>

          <label className="mt-3 block text-sm text-ink-700">
            Aliases (comma-separated)
            <input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="treatment, scalp"
              className="mt-1 block min-h-[44px] w-full rounded-lg border border-ink-200 bg-white px-3 text-base sm:text-sm"
            />
          </label>

          <label className="mt-3 block text-sm text-ink-700">
            Chat description (optional)
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="How the chat should describe this service"
              className="mt-1 block min-h-[44px] w-full rounded-lg border border-ink-200 bg-white px-3 text-base sm:text-sm"
            />
          </label>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex min-h-[44px] items-center rounded-full bg-ink-900 px-5 text-sm font-medium text-cream-50 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-sm text-success">Saved ✓</span>}
            {err && <span className="text-sm text-red-600">Error: {err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Unsupported rules                                                           */
/* -------------------------------------------------------------------------- */

function UnsupportedSection() {
  const [rules, setRules] = useState<UnsupportedRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState("");
  const [responseType, setResponseType] =
    useState<UnsupportedRule["response_type"]>("handoff");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/provider/unsupported")
      .then((r) => (r.ok ? r.json() : { rules: [] }))
      .then((d) => setRules(d.rules ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function add() {
    if (!term.trim()) return;
    setAdding(true);
    setErr(null);
    try {
      const res = await fetch("/api/provider/unsupported", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger_term: term, response_type: responseType }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error ?? "add_failed");
      } else {
        setRules((prev) => [...prev, d.rule]);
        setTerm("");
      }
    } catch {
      setErr("network_error");
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/provider/unsupported?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) setRules((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <Section title="Unsupported services">
      <p className="mb-3 text-sm text-ink-500">
        Terms that should not book directly. Clients asking about these get a
        handoff instead. (Global protections like nails/extensions still apply
        unless overridden.)
      </p>

      {loading ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 bg-cream-50 pl-3"
            >
              <span className="text-sm text-ink-800">
                <code>{rule.trigger_term}</code> → {rule.response_type}
              </span>
              <button
                type="button"
                onClick={() => remove(rule.id)}
                className="inline-flex min-h-[44px] items-center px-3 text-sm font-medium text-red-600"
              >
                Remove
              </button>
            </div>
          ))}
          {rules.length === 0 && (
            <p className="text-sm text-ink-500">No rules yet.</p>
          )}
        </div>
      )}

      {/* Add form — stacks on mobile so inputs aren't cramped. */}
      <div className="mt-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1 text-sm text-ink-700">
            Term
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="bleach"
              className="mt-1 block min-h-[44px] w-full rounded-lg border border-ink-200 bg-white px-3 text-base sm:text-sm"
            />
          </label>
          <label className="block text-sm text-ink-700 sm:w-44">
            Response
            <select
              value={responseType}
              onChange={(e) =>
                setResponseType(e.target.value as UnsupportedRule["response_type"])
              }
              className="mt-1 block min-h-[44px] w-full rounded-lg border border-ink-200 bg-white px-3 text-sm"
            >
              <option value="handoff">Handoff</option>
              <option value="not_offered">Not offered</option>
              <option value="consultation">Consultation</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={add}
            disabled={adding}
            className="inline-flex min-h-[44px] items-center rounded-full bg-ink-900 px-5 text-sm font-medium text-cream-50 disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add rule"}
          </button>
          {err && <span className="text-sm text-red-600">Error: {err}</span>}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Handoff email                                                               */
/* -------------------------------------------------------------------------- */

function HandoffEmailSection() {
  const [email, setEmail] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/provider/handoff-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setEmail(d.handoff_email ?? "");
          setEnabled(Boolean(d.handoff_email_enabled));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await fetch("/api/provider/handoff-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handoff_email: email,
          handoff_email_enabled: enabled,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error ?? "save_failed");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setErr("network_error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Handoff email">
      <p className="mb-3 text-sm text-ink-500">
        When a client sends you a message through the chat, we save it to your
        inbox. Enable this to also get an email notification.
      </p>
      {loading ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm text-ink-700">
            Notification email
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 block min-h-[44px] w-full rounded-lg border border-ink-200 bg-white px-3 text-base sm:max-w-sm sm:text-sm"
            />
          </label>
          <Toggle
            checked={enabled}
            onChange={setEnabled}
            label="Send me an email for each handoff"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex min-h-[44px] items-center rounded-full bg-ink-900 px-5 text-sm font-medium text-cream-50 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-sm text-success">Saved ✓</span>}
            {err && <span className="text-sm text-red-600">Error: {err}</span>}
          </div>
        </div>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-ink-100 bg-white p-4 sm:mt-6 sm:rounded-3xl sm:p-6">
      <h2 className="mb-3 font-display text-xs uppercase tracking-[0.16em] text-ink-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Mobile-friendly toggle switch. 44px+ tap area, clear on/off — replaces the
 * tiny native checkbox that was hard to hit on a phone.
 */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-[44px] items-center gap-2 px-1"
    >
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-success" : "bg-ink-200"
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          )}
        />
      </span>
      <span className="text-sm text-ink-700">{label}</span>
    </button>
  );
}
