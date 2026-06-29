// Live appointments for the calendar (+ Today). Reads the REAL appointments
// table (the renamed bookings), joined to the client for display, live via
// Realtime so a confirmed booking appears immediately. The calendar derives
// Day/Week/Month from these rows — never a second hardcoded list (DESIGN.md §7:
// Today + Calendar share this one source).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export type Appointment = {
  id: string;
  client_id: string | null;
  service_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string | null;
  clientName: string;
  serviceName: string | null;
  /** "New" = booked through Kasa within the last 24h (a fresh-arrival signal
   *  that clears on its own), not just any Kasa booking forever. */
  isNew: boolean;
};

const TZ = "America/New_York";

/** "YYYY-MM-DD" (NY) for a row's start instant — the calendar groups by this. */
export function dayKeyOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}
/** Fractional hour-of-day (NY) for vertical placement, e.g. 14.5 = 2:30 PM. */
export function hourOf(iso: string): number {
  const s = new Date(iso).toLocaleTimeString("en-US", {
    timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit",
  });
  const [h, m] = s.split(":").map(Number);
  return h + m / 60;
}

export function useAppointments() {
  const { session } = useAuth();
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!session) return; // wait for auth; RLS returns nothing otherwise
    // NOTE: do NOT embed provider_services here — appointments.service_id is
    // text (legacy) with no FK to provider_services.id (uuid), so PostgREST
    // can't join it and the WHOLE query errors (PGRST200) → empty calendar.
    // Join only clients (real FK); resolve service names separately.
    const { data, error } = await supabase
      .from("appointments")
      .select("id, client_id, service_id, service_name, starts_at, ends_at, status, source, created_at, client:clients(name)")
      .neq("status", "canceled")
      .order("starts_at", { ascending: true });
    if (error) {
      console.error("[useAppointments] load failed:", error.message);
      setLoading(false);
      return;
    }
    const rows = data ?? [];

    // Map service_id (uuid stored as text) → name from provider_services.
    const svcIds = Array.from(new Set(rows.map((a: any) => a.service_id).filter(Boolean)));
    const svcName = new Map<string, string>();
    if (svcIds.length) {
      const { data: svcs } = await supabase
        .from("provider_services").select("id, name").in("id", svcIds);
      for (const s of (svcs ?? []) as any[]) svcName.set(s.id, s.name);
    }

    const mapped: Appointment[] = rows.map((a: any) => ({
      id: a.id,
      client_id: a.client_id,
      service_id: a.service_id,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      status: a.status,
      source: a.source,
      clientName: a.client?.name ?? "Client",
      // prefer the live catalog name, else the denormalized one stored at booking
      serviceName: (a.service_id && svcName.get(a.service_id)) || a.service_name || null,
      // "New": booked via Kasa in the last 24h — a fresh-arrival badge that
      // clears itself (was previously shown forever for any kasa booking).
      isNew: a.source === "kasa" && a.created_at != null &&
        (Date.now() - new Date(a.created_at).getTime()) < 24 * 60 * 60 * 1000,
    }));
    setItems(mapped);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (!session) return; // wait for auth; avoids empty fetch + channel re-sub
    void reload();
    const channel = supabase
      .channel(`appointments-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments" },
        () => void reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, reload]);

  return { items, loading, reload };
}
