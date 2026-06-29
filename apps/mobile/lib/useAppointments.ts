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
  isNew?: boolean; // "New" marker for an appt booked this session
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
    const { data } = await supabase
      .from("appointments")
      .select(
        "id, client_id, service_id, starts_at, ends_at, status, source, " +
          "client:clients(name), service:provider_services(name)",
      )
      .neq("status", "canceled")
      .order("starts_at", { ascending: true });
    const mapped: Appointment[] = (data ?? []).map((a: any) => ({
      id: a.id,
      client_id: a.client_id,
      service_id: a.service_id,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      status: a.status,
      source: a.source,
      clientName: a.client?.name ?? "Client",
      serviceName: a.service?.name ?? null,
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
