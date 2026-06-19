import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { sendReminderSms, smsConfigured } from "@/lib/sms";

/**
 * Reminder sender (SCAFFOLD — scheduler wired later).
 *
 * Finds confirmed bookings starting within a lookahead window and texts the
 * client a reminder. Designed to be called by a scheduled job (Vercel Cron /
 * Supabase cron) at a regular cadence, but is also safe to trigger manually
 * for testing via /api/cron/reminders.
 *
 * IMPORTANT (dedup): the bookings table has no `reminder_sent_at` column yet,
 * so this scaffold uses a TIGHT window (default: appointments starting between
 * +23h and +24h from now) so that an hourly job sends each booking's reminder
 * roughly once. That's good enough to build + test against. Before going live
 * with a real scheduler, add a `reminder_sent_at timestamptz` column and mark
 * rows after sending — that's the correct dedup and is noted as TODO below.
 *
 * Fully gated: if SMS isn't configured/enabled, this is a no-op that reports
 * what it WOULD have sent (dryRun-style), so you can verify targeting safely.
 */

export type ReminderRunResult = {
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  candidates: number;
  sent: number;
  skipped: number;
};

export async function sendDueReminders(opts?: {
  lookaheadHours?: number; // center of the window (default 24h before appt)
  windowMinutes?: number; // width of the window (default 60min)
}): Promise<ReminderRunResult> {
  const lookaheadHours = opts?.lookaheadHours ?? 24;
  const windowMinutes = opts?.windowMinutes ?? 60;

  const now = Date.now();
  const windowStart = new Date(now + (lookaheadHours * 60 - windowMinutes) * 60_000);
  const windowEnd = new Date(now + lookaheadHours * 60 * 60_000);

  const admin = createServiceRoleSupabaseClient();
  const { data: rows, error } = await admin
    .from("bookings")
    .select(
      "id, customer_name, customer_phone, service_name, starts_at, status, stylist_id"
    )
    .eq("status", "confirmed")
    .gte("starts_at", windowStart.toISOString())
    .lte("starts_at", windowEnd.toISOString());

  const result: ReminderRunResult = {
    enabled: smsConfigured(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    candidates: rows?.length ?? 0,
    sent: 0,
    skipped: 0,
  };

  if (error || !rows || rows.length === 0) return result;

  // Resolve stylist display names in one pass (for the reminder copy).
  const stylistIds = Array.from(
    new Set(rows.map((r: { stylist_id: string | null }) => r.stylist_id).filter(Boolean))
  );
  const nameById = new Map<string, string>();
  if (stylistIds.length > 0) {
    const { data: stylists } = await admin
      .from("stylists")
      .select("id, display_name, square_team_member_name, square_business_name")
      .in("id", stylistIds as string[]);
    for (const s of stylists ?? []) {
      nameById.set(
        s.id,
        s.display_name ?? s.square_team_member_name ?? s.square_business_name ?? "your provider"
      );
    }
  }

  for (const r of rows) {
    if (!r.customer_phone) {
      result.skipped++;
      continue;
    }
    // TODO(production dedup): once a `reminder_sent_at` column exists, skip rows
    // where it's already set, and stamp it after a successful send.
    sendReminderSms({
      to: r.customer_phone,
      serviceName: r.service_name,
      slotLabel: formatSlot(r.starts_at),
      stylistName: nameById.get(r.stylist_id as string) ?? "your provider",
    });
    result.sent++;
  }

  return result;
}

function formatSlot(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}
