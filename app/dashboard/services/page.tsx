"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { CopyButton } from "@/components/CopyButton";
import { createClient } from "@/lib/supabase/client";

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
      <div className="mx-auto max-w-3xl px-4 pb-24">
        <header className="mt-6 mb-2 flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl text-ink-900">
            Booking helper settings
          </h1>
          <Link
            href="/dashboard"
            className="text-sm text-ink-500 hover:text-ink-900"
          >
            ← Dashboard
          </Link>
        </header>

        <BookingLinkSection />
        <ServicesSection />
        <UnsupportedSection />
        <HandoffEmailSection />
      </div>
    </PageShell>
  );
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
        <p className="text-sm text-ink-500">
          No synced services yet. Connect Square and sync your catalog, then
          they&rsquo;ll appear here.
        </p>
      ) : (
        <div className="space-y-4">
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

  return (
    <div className="rounded-2xl border border-ink-100 bg-cream-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink-900">{service.name}</p>
          <p className="text-xs text-ink-500">
            {service.category ?? "—"} · {priceLabel} · {durLabel}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
          />
          Visible in chat
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-ink-700">
          Behavior
          <select
            value={behavior}
            onChange={(e) => setBehavior(e.target.value as Behavior)}
            className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
          >
            <option value="book">Book directly</option>
            <option value="consultation">Requires consultation</option>
            <option value="handoff">Hand off to me</option>
            <option value="hidden">Hidden from chat</option>
          </select>
        </label>
        <label className="text-sm text-ink-700">
          Aliases (comma-separated)
          <input
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="treatment, scalp"
            className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="mt-3 block text-sm text-ink-700">
        Chat description (optional)
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="How the chat should describe this service"
          className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-cream-50 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-success">Saved</span>}
        {err && <span className="text-sm text-red-600">Error: {err}</span>}
      </div>
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
              className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 bg-cream-50 px-3 py-2"
            >
              <span className="text-sm text-ink-800">
                <code>{rule.trigger_term}</code> → {rule.response_type}
              </span>
              <button
                type="button"
                onClick={() => remove(rule.id)}
                className="text-sm text-red-600 hover:underline"
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

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-sm text-ink-700">
          Term
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="bleach"
            className="mt-1 block rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm text-ink-700">
          Response
          <select
            value={responseType}
            onChange={(e) =>
              setResponseType(e.target.value as UnsupportedRule["response_type"])
            }
            className="mt-1 block rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
          >
            <option value="handoff">Handoff</option>
            <option value="not_offered">Not offered</option>
            <option value="consultation">Consultation</option>
          </select>
        </label>
        <button
          type="button"
          onClick={add}
          disabled={adding}
          className="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-cream-50 disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add rule"}
        </button>
        {err && <span className="text-sm text-red-600">Error: {err}</span>}
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full max-w-sm rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Send me an email for each handoff
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-cream-50 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-sm text-success">Saved</span>}
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
    <section className="mt-6 rounded-3xl border border-ink-100 bg-white p-6">
      <h2 className="mb-3 font-display text-xs uppercase tracking-[0.16em] text-ink-500">
        {title}
      </h2>
      {children}
    </section>
  );
}
