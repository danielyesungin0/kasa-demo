"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";

type RealBooking = {
  id: string;
  customer_name: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  square_booking_id: string | null;
};

type GroupedDay = {
  label: string;   // "Tue, May 7"
  dateKey: string;
  bookings: RealBooking[];
};

function groupByDay(bookings: RealBooking[]): GroupedDay[] {
  const map = new Map<string, RealBooking[]>();
  for (const b of bookings) {
    const key = new Date(b.starts_at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const arr = map.get(key) ?? [];
    arr.push(b);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, bookings]) => ({
      dateKey,
      label: new Date(bookings[0].starts_at).toLocaleDateString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      bookings,
    }));
}

export default function SchedulePage() {
  const [bookings, setBookings] = useState<RealBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/bookings")
      .then((r) => r.json())
      .then(({ bookings: data }) => setBookings(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const groups = groupByDay(bookings);

  return (
    <PageShell variant="stylist">
      <div className="mb-8 flex items-center gap-4">
        <Link href="/dashboard" className="text-sm text-ink-400 hover:text-ink-700">
          ← Dashboard
        </Link>
      </div>

      <h1 className="mb-8 font-display text-3xl font-medium tracking-tight text-ink-900">
        Upcoming schedule
      </h1>

      {loading ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-200 p-10 text-center text-sm text-ink-500">
          No upcoming appointments yet. Share your booking link to get started.
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.dateKey}>
              <p className="mb-3 font-display text-xs uppercase tracking-[0.16em] text-ink-500">
                {group.label}
              </p>
              <div className="space-y-2">
                {group.bookings.map((b) => {
                  const time = new Date(b.starts_at).toLocaleTimeString("en-US", {
                    timeZone: "America/New_York",
                    hour: "numeric",
                    minute: "2-digit",
                  });
                  const endTime = new Date(b.ends_at).toLocaleTimeString("en-US", {
                    timeZone: "America/New_York",
                    hour: "numeric",
                    minute: "2-digit",
                  });
                  return (
                    <div key={b.id} className="flex items-center gap-4 rounded-2xl border border-ink-100 bg-cream-50 p-4">
                      <div className="w-20 shrink-0 text-right">
                        <p className="text-sm font-medium text-ink-900">{time}</p>
                        <p className="text-xs text-ink-400">{endTime}</p>
                      </div>
                      <div className="h-8 w-px bg-ink-100" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-medium text-ink-900">{b.customer_name}</p>
                        <p className="mt-0.5 text-sm text-ink-500">{b.service_name}</p>
                        {b.notes && <p className="mt-1 text-xs italic text-ink-400">{b.notes}</p>}
                      </div>
                      {b.square_booking_id && <span className="shrink-0 text-[10px] text-ink-400">Square ✓</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
