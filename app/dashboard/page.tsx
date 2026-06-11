"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { CopyButton } from "@/components/CopyButton";
import { QuickReplyCard } from "@/components/QuickReplyCard";
import { STYLIST, QUICK_REPLIES } from "@/lib/mock-data";
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

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-200 bg-cream-50 p-6 text-center text-sm text-ink-500">
      {text}
    </div>
  );
}

function SquareConnectionCard() {
  const businessName = STYLIST.location.split("·")[0].trim();
  return (
    <section className="rounded-3xl border border-ink-100 bg-cream-50 p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-xs uppercase tracking-[0.16em] text-ink-500">Square</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-medium text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Connected
        </span>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-900 font-display text-base text-cream-50">◼</div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-tight text-ink-900">{businessName}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">Services and availability sync from Square automatically.</p>
        </div>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-ink-400">
        To update your hours or services, make changes in Square — they&apos;ll reflect here automatically.
      </p>
    </section>
  );
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
  const [squareTokenStale, setSquareTokenStale] = useState(false);

  useEffect(() => {
    fetch("/api/bookings")
      .then((r) => r.json())
      .then(({ bookings: data }) => setBookings(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Check token freshness so we can prompt the stylist to reconnect
    // before bookings start silently failing.
    fetch("/api/stylist/status")
      .then((r) => r.json())
      .then((d) => setSquareTokenStale(Boolean(d?.squareTokenStale)))
      .catch(() => {});
  }, []);

  const preview = bookings.slice(0, 3);

  const headerRight = (
    <nav className="flex items-center gap-1 text-sm">
      <Link href="/dashboard/services" className="inline-flex min-h-[40px] items-center rounded-full px-3.5 py-2 text-sm text-ink-700 hover:bg-cream-100">
        Settings
      </Link>
      <a href="/shen" className="inline-flex min-h-[40px] items-center rounded-full bg-cream-100 px-3.5 py-2 text-sm text-ink-700 hover:bg-cream-200">
        Preview ↗
      </a>
      <button
        type="button"
        onClick={async () => { await supabase.auth.signOut(); router.replace("/"); }}
        className="inline-flex min-h-[40px] items-center rounded-full px-3.5 py-2 text-sm text-ink-500 hover:bg-cream-100 hover:text-ink-900"
      >
        Sign out
      </button>
    </nav>
  );

  return (
    <PageShell variant="stylist" headerRight={headerRight}>
      <div className="mb-10">
        <p className="font-display text-sm uppercase tracking-[0.18em] text-ink-400">Hi, {STYLIST.name}</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink-900 sm:text-4xl">
          Your booking dashboard
        </h1>
      </div>

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
              <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                <p className="font-display text-3xl font-medium tracking-tight text-ink-900 sm:text-[36px]">
                  {STYLIST.bookingUrl}
                </p>
                <CopyButton value={STYLIST.bookingUrl} variant="primary" label="Copy link" copiedLabel="Link copied" />
              </div>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-600">
                Share in your bio or paste into any DM — clients book instantly, no login needed.
              </p>
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
          <SquareConnectionCard />
          <section>
            <h2 className="mb-3 font-display text-xl font-medium text-ink-900">Quick replies</h2>
            <p className="mb-3 text-sm text-ink-500">Tap copy, then paste into any DM.</p>
            <div className="space-y-2">
              {QUICK_REPLIES.map((qr) => <QuickReplyCard key={qr.id} reply={qr} />)}
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
