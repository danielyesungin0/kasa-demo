import { type NextRequest, NextResponse } from "next/server";
import { sendDueReminders } from "@/lib/reminders";

/**
 * Reminder cron endpoint (SCAFFOLD).
 *
 * Sends reminders for appointments in the lookahead window. Intended to be
 * called by a scheduler later (Vercel Cron via vercel.json, or Supabase cron),
 * but is manually triggerable now for testing:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<domain>/api/cron/reminders
 *
 * Protection: requires CRON_SECRET via Authorization: Bearer, OR Vercel's own
 * cron header (x-vercel-cron) when wired to Vercel Cron. If no CRON_SECRET is
 * set, the route refuses to run (so it can't be triggered before you intend).
 *
 * Returns a JSON summary of what it sent / would have sent — safe to call even
 * with SMS disabled (it reports candidates without sending).
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const isVercelCron = request.headers.get("x-vercel-cron") !== null;

  // Must be Vercel's scheduler OR carry the shared secret. No secret configured
  // → locked (refuse), so this can never run unintentionally.
  const authorized =
    isVercelCron || (Boolean(secret) && auth === `Bearer ${secret}`);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendDueReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/reminders] failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "reminder_run_failed" }, { status: 500 });
  }
}
