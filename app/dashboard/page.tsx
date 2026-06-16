"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { CopyButton } from "@/components/CopyButton";
import { QuickReplyCard } from "@/components/QuickReplyCard";
import { QUICK_REPLIES } from "@/lib/mock-data";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type RealBooking = {
  id: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string | null;
  square_booking_id: string | null;
};

/** Real provider status from /api/stylist/status. */
type StylistStatus = {
  hasStylistRow: boolean;
  squareConnected: boolean;
  squareTokenStale: boolean;
  name: string | null;
  slug: string | null;
  businessName: string | null;
  locationName: string | null;
  teamMemberName: string | null;
  lastSyncedAt: string | null;
  syncedServicesCount: number;
  squareEnvironment?: "production" | "sandbox";
  bookingMode?: "live" | "test" | "legacy";
};

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-200 bg-cream-50 p-6 text-center text-sm text-ink-500">
      {text}
    </div>
  );
}

function SquareConnectionCard({ status }: { status: StylistStatus | null }) {
  const connected = Boolean(status?.squareConnected);
  const stale = Boolean(status?.squareTokenStale);

  // Status pill: reconnect (stale) > connected > not connected.
  const pill = !connected ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-cream-200 px-2.5 py-1 text-[11px] font-medium text-ink-500">
      <span className="h-1.5 w-1.5 rounded-full bg-ink-400" />
      Not connected
    </span>
  ) : stale ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-2.5 py-1 text-[11px] font-medium text-yellow-800">
      <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
      Reconnect needed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      Connected
    </span>
  );

  const businessName =
    status?.businessName ?? status?.locationName ?? "Your studio";

  return (
    <section className="rounded-3xl border border-ink-100 bg-cream-50 p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-xs uppercase tracking-[0.16em] text-ink-500">Square</h2>
        {pill}
      </div>

      {connected ? (
        <>
          <div className="mt-3 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-900 font-display text-base text-cream-50">◼</div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium leading-tight text-ink-900">{businessName}</p>
              {status?.locationName && (
                <p className="mt-0.5 text-sm text-ink-500">{status.locationName}</p>
              )}
              {status?.teamMemberName && (
                <p className="mt-0.5 text-sm text-ink-500">{status.teamMemberName}</p>
              )}
            </div>
          </div>
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Synced services</dt>
              <dd className="font-medium text-ink-900">{status?.syncedServicesCount ?? 0}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Last synced</dt>
              <dd className="font-medium text-ink-900">{formatSyncTime(status?.lastSyncedAt ?? null)}</dd>
            </div>
          </dl>
          {(status?.syncedServicesCount ?? 0) === 0 && (
            <p className="mt-3 rounded-xl bg-cream-100 px-3 py-2 text-xs leading-relaxed text-ink-500">
              No services synced yet. Re-open setup to pull your Square catalog.
            </p>
          )}
          {stale && (
            <a
              href="/api/square/connect"
              className="mt-4 inline-flex rounded-full bg-ink-900 px-4 py-2 text-xs font-medium text-cream-50 hover:bg-ink-800"
            >
              Reconnect Square
            </a>
          )}
        </>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-ink-600">
            Connect your Square account to sync your services and availability.
          </p>
          <a
            href="/api/square/connect"
            className="mt-4 inline-flex rounded-full bg-ink-900 px-4 py-2 text-xs font-medium text-cream-50 hover:bg-ink-800"
          >
            Connect Square
          </a>
        </>
      )}
    </section>
  );
}

/** "Just now" / "2h ago" / date — never crashes on null. */
function formatSyncTime(iso: string | null): string {
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

function BookingCard({ b, compact }: { b: RealBooking; compact?: boolean }) {
  const d = new Date(b.starts_at);
  const opts = { timeZone: "America/New_York" } as const;
  const dayStr = d.toLocaleDateString("en-US", { ...opts, weekday: "short" });
  const dateNum = d.toLocaleDateString("en-US", { ...opts, day: "numeric" });
  const month = d.toLocaleDateString("en-US", { ...opts, month: "short" });
  const time = d.toLocaleTimeString("en-US", { ...opts, hour: "numeric", minute: "2-digit" });

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-ink-100 bg-cream-50 p-4">
      <div className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-accent-soft/60 py-2 text-center">
        <span className="text-[10px] font-medium uppercase tracking-wider text-accent-dark">{dayStr}</span>
        <span className="font-display text-lg font-medium leading-tight text-ink-900">{dateNum}</span>
        {!compact && <span className="text-[10px] text-ink-400">{month}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-ink-900">{b.customer_name}</p>
        <p className="mt-0.5 text-sm text-ink-500">{b.service_name} · {time}</p>
        {b.notes && <p className="mt-1 text-xs italic text-ink-400">{b.notes}</p>}
      </div>
      {b.square_booking_id && <span className="shrink-0 text-[10px] text-ink-400">Square ✓</span>}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<RealBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StylistStatus | null>(null);

  useEffect(() => {
    fetch("/api/bookings")
      .then((r) => r.json())
      .then(({ bookings: data }) => setBookings(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Real provider status: name, slug, Square connection + sync state.
    fetch("/api/stylist/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: StylistStatus | null) => setStatus(d))
      .catch(() => {});
  }, []);

  const preview = bookings.slice(0, 3);
  const squareTokenStale = Boolean(status?.squareTokenStale);

  // Real name + booking link, with neutral fallbacks (never mock "Shen").
  const displayName = status?.name ?? "there";
  const bookingUrl =
    status?.slug && typeof window !== "undefined"
      ? `${window.location.origin}/book/${status.slug}`
      : status?.slug
      ? `/book/${status.slug}`
      : null;

  const headerRight = (
    <nav className="flex items-center gap-0.5 text-sm sm:gap-1">
      <Link href="/dashboard/services" className="inline-flex min-h-[44px] items-center rounded-full px-3 text-sm text-ink-700 hover:bg-cream-100">
        Settings
      </Link>
      <a
        href={status?.slug ? `/book/${status.slug}` : "/shen"}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[44px] items-center rounded-full bg-cream-100 px-3 text-sm text-ink-700 hover:bg-cream-200"
      >
        Preview ↗
      </a>
      <button
        type="button"
        onClick={async () => { await supabase.auth.signOut(); router.replace("/"); }}
        className="inline-flex min-h-[44px] items-center rounded-full px-3 text-sm text-ink-500 hover:bg-cream-100 hover:text-ink-900"
      >
        Sign out
      </button>
    </nav>
  );

  return (
    <PageShell variant="stylist" headerRight={headerRight}>
      <div className="mb-10">
        <p className="font-display text-sm uppercase tracking-[0.18em] text-ink-400">Hi, {displayName}</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink-900 sm:text-4xl">
          Your booking dashboard
        </h1>
      </div>

      {/* Booking-mode banner — makes it unambiguous whether client bookings
          hit Shen's real Square calendar or are in safe test mode. */}
      {status?.bookingMode === "live" && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-success/40 bg-success-soft px-4 py-3 text-sm text-success"
        >
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="font-medium">Live bookings on.</span>
          <span className="text-ink-700">
            Client bookings create real appointments in your Square calendar.
          </span>
        </div>
      )}
      {status?.bookingMode === "test" && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900"
        >
          <span className="h-2 w-2 rounded-full bg-yellow-500" />
          <span className="font-medium">Safe test mode.</span>
          <span>
            Bookings are recorded but do NOT create Square appointments. Turn on
            live bookings before going live with clients.
          </span>
        </div>
      )}

      {squareTokenStale && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900"
        >
          <span>
            Your Square connection is about to expire. Reconnect to keep
            bookings syncing.
          </span>
          <a
            href="/api/square/connect"
            className="rounded-full bg-ink-900 px-4 py-1.5 text-xs font-medium text-cream-50 hover:bg-ink-800"
          >
            Reconnect Square
          </a>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* LEFT */}
        <div className="space-y-8">
          {/* Booking link */}
          <div className="overflow-hidden rounded-3xl border border-ink-100 bg-cream-50 shadow-card">
            <div className="bg-gradient-to-br from-accent-soft/70 to-cream-50 p-6 sm:p-8">
              <p className="font-display text-xs uppercase tracking-[0.18em] text-accent-dark">Your booking link</p>
              {bookingUrl ? (
                <>
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                    <p className="break-all font-display text-2xl font-medium tracking-tight text-ink-900 sm:text-[32px]">
                      {bookingUrl.replace(/^https?:\/\//, "")}
                    </p>
                    <CopyButton value={bookingUrl} variant="primary" label="Copy link" copiedLabel="Link copied" />
                  </div>
                  <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-600">
                    Share in your bio or paste into any DM — clients book instantly, no login needed.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm leading-relaxed text-ink-600">
                  Finish setup to get your booking link.
                </p>
              )}
            </div>
          </div>

          {/* Upcoming appointments */}
          <section>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-xl font-medium text-ink-900">Upcoming appointments</h2>
              {bookings.length > 3 && (
                <Link href="/dashboard/schedule" className="text-sm text-ink-500 hover:text-ink-900">
                  View all ({bookings.length}) →
                </Link>
              )}
            </div>
            {loading ? (
              <p className="text-sm text-ink-400">Loading…</p>
            ) : bookings.length === 0 ? (
              <EmptyState text="No upcoming appointments booked via link yet." />
            ) : (
              <div className="space-y-2">
                {preview.map((b) => <BookingCard key={b.id} b={b} compact />)}
                {bookings.length > 3 && (
                  <Link
                    href="/dashboard/schedule"
                    className="block rounded-2xl border border-dashed border-ink-200 py-3 text-center text-sm text-ink-500 transition hover:border-ink-300 hover:text-ink-700"
                  >
                    +{bookings.length - 3} more appointments
                  </Link>
                )}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT */}
        <div className="space-y-6">
          <SquareConnectionCard status={status} />
          <section>
            <h2 className="mb-3 font-display text-xl font-medium text-ink-900">Quick replies</h2>
            <p className="mb-3 text-sm text-ink-500">Tap copy, then paste into any DM.</p>
            <div className="space-y-2">
              {QUICK_REPLIES.map((qr) => {
                // Replace the placeholder URL with this provider's REAL link.
                // Keep the full https:// prefix so messaging apps (iMessage,
                // WhatsApp, Instagram, etc.) auto-linkify it when pasted — a
                // bare domain often isn't turned into a tappable link.
                const fullLink = bookingUrl
                  ? bookingUrl.startsWith("http")
                    ? bookingUrl
                    : `https://${bookingUrl}`
                  : null;
                const body = fullLink
                  ? qr.body.replace(/book\.kasa\.app\/shen/g, fullLink)
                  : qr.body;
                return (
                  <QuickReplyCard key={qr.id} reply={{ ...qr, body }} />
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
