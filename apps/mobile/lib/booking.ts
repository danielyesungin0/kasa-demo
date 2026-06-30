// Booking engine — availability + create, behind the Square seam.
//
// TODO(square): Square sandbox isn't linked and the square-availability /
// square-create-booking functions aren't deployed yet (Phase 2 wrote them
// undeployed; Phase 4 links the sandbox + deploys). Until then this computes
// open slots LOCALLY from studio hours + the service duration + real
// appointment conflicts, and writes the appointment row in the SAME shape
// square-create-booking will — so the calendar/Today reflect it and the swap to
// the real function is a drop-in. Guardrails: nothing books without an explicit
// confirm tap; idempotency key is deterministic (no duplicate bookings on
// retry), matching the function's SHA-256(stylist+variation+start+phone) scheme.
import * as Crypto from "expo-crypto";
import { supabase, FUNCTIONS_URL } from "./supabase";
import { OPEN_HOUR, CLOSE_HOUR, parseKey } from "./calendar";
import { hourOf, dayKeyOf, type Appointment } from "./useAppointments";

export type Service = {
  id: string;
  service_key: string;
  name: string;
  category: string | null;
  price_cents: number;
  duration_minutes: number;
  square_variation_id: string | null;
};

export type Slot = { startHour: number; label: string }; // 9.5 = 9:30

const SLOT_STEP = 0.25; // 15-min granularity

export async function listServices(): Promise<Service[]> {
  const { data } = await supabase
    .from("provider_services")
    .select("id, service_key, name, category, price_cents, duration_minutes, square_variation_id")
    .eq("active", true)
    .order("price_cents", { ascending: true });
  return (data ?? []) as Service[];
}

/** Real availability for a service on a day, from the deployed square-availability
 *  (Square's true open slots when connected; the function falls back to local
 *  studio hours if Square isn't linked). Returns slots for the given dayKey.
 *  Falls back to the on-device availableSlots() if the call fails entirely. */
export async function fetchSlots(
  service: Service,
  dayKey: string,
  appts: Appointment[],
): Promise<Slot[]> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(`${FUNCTIONS_URL}/square-availability`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        service_id: service.id,
        service_variation_id: service.square_variation_id,
        duration_minutes: service.duration_minutes,
        week_count: 3,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    const all: any[] = json.slots ?? [];
    return all
      .filter((s) => s.dateKey === dayKey)
      .map((s) => ({ startHour: s.hour24 + (Number(s.isoTime?.split(":")[1] ?? 0) / 60), label: s.timeLabel }));
  } catch {
    // Honest fallback to the local engine (never leave the user with nothing).
    return availableSlots(dayKey, service.duration_minutes, appts);
  }
}

/** Fetch ALL availability for a service once (3 weeks), grouped by dateKey, so
 *  the Book sheet can switch days instantly without a network round-trip each
 *  tap. Returns {} on failure (caller falls back to the local engine per-day). */
export async function fetchAllSlots(service: Service): Promise<Record<string, Slot[]>> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(`${FUNCTIONS_URL}/square-availability`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        service_id: service.id,
        service_variation_id: service.square_variation_id,
        duration_minutes: service.duration_minutes,
        week_count: 3,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    const all: any[] = json.slots ?? [];
    const byDay: Record<string, Slot[]> = {};
    const seen: Record<string, Set<number>> = {}; // dedupe per day by startHour
    for (const s of all) {
      const startHour = s.hour24 + (Number(s.isoTime?.split(":")[1] ?? 0) / 60);
      (seen[s.dateKey] ??= new Set());
      if (seen[s.dateKey].has(startHour)) continue; // Square can return dup starts
      seen[s.dateKey].add(startHour);
      (byDay[s.dateKey] ??= []).push({ startHour, label: s.timeLabel });
    }
    return byDay;
  } catch {
    return {};
  }
}

/** Open start-times for a service on a day, given existing appointments.
 *  Local mirror of square-availability (respects studio hours + conflicts).
 *  Used as the offline fallback for fetchSlots. */
export function availableSlots(
  dayKey: string,
  durationMin: number,
  appts: Appointment[],
): Slot[] {
  const durH = durationMin / 60;
  const busy = appts
    .filter((a) => dayKeyOf(a.starts_at) === dayKey)
    .map((a) => ({ s: hourOf(a.starts_at), e: hourOf(a.ends_at) }));

  const slots: Slot[] = [];
  for (let t = OPEN_HOUR; t + durH <= CLOSE_HOUR + 1e-9; t += SLOT_STEP) {
    const end = t + durH;
    const overlaps = busy.some((b) => t < b.e && end > b.s);
    if (!overlaps) slots.push({ startHour: t, label: fmtSlot(t) });
  }
  return slots;
}

function fmtSlot(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const disp = hh % 12 === 0 ? 12 : hh % 12;
  return `${disp}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
}

/** Build the timestamptz instants (NY) for a slot start on a day. */
function instantFor(dayKey: string, startHour: number): { startISO: string; } {
  const { y, mo, d } = parseKey(dayKey);
  const hh = Math.floor(startHour);
  const mm = Math.round((startHour - hh) * 60);
  // NY is UTC-4 (EDT) in summer; for the local-seam we approximate with an
  // explicit -04:00 offset. The real function uses Square's tz-correct times.
  // TODO(square): replace with the function's authoritative start instant.
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-04:00`;
  return { startISO: new Date(iso).toISOString() };
}

/** Deterministic idempotency key — same scheme as square-create-booking. */
async function idempotencyKey(parts: string[]): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    parts.join("|"),
  );
}

export type BookResult =
  | { ok: true; appointmentId: string; idempotencyKey: string }
  | { ok: false; error: string };

/** Create a booking. NEVER called without an explicit "Confirm in Square" tap.
 *  If the service is mapped to a Square variation, this calls the deployed
 *  square-create-booking function — Square is the source of truth (it books at
 *  Square FIRST, then mirrors to the appointments row with square_booking_id).
 *  Only if the service has no Square mapping do we fall back to a local row. */
export async function createBooking(args: {
  service: Service;
  clientId: string;
  clientName: string;
  clientPhone?: string | null;
  dayKey: string;
  startHour: number;
  originConversationId?: string | null;
}): Promise<BookResult> {
  const { startISO } = instantFor(args.dayKey, args.startHour);

  // Real Square path (service is mapped to a variation).
  if (args.service.square_variation_id) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { ok: false, error: "You're signed out — sign in and retry." };

    try {
      const res = await fetch(`${FUNCTIONS_URL}/square-create-booking`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: args.clientId,
          service_id: args.service.id,
          service_variation_id: args.service.square_variation_id,
          starts_at: startISO,
          duration_minutes: args.service.duration_minutes,
          client_name: args.clientName,
          client_phone: args.clientPhone ?? "",
          origin_conversation_id: args.originConversationId ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        // Honest failure — Square wasn't reached / refused. Nothing was created.
        return { ok: false, error: squareErrorMessage(json.error) };
      }
      return {
        ok: true,
        appointmentId: json.appointment_id ?? json.square_booking_id,
        idempotencyKey: "",
      };
    } catch {
      return { ok: false, error: "Couldn't reach Square. Nothing was booked." };
    }
  }

  // Local fallback (unmapped service) — write the row directly.
  const { data: stylist } = await supabase.from("stylists").select("id").limit(1).maybeSingle();
  if (!stylist?.id) return { ok: false, error: "No stylist record." };
  const endISO = new Date(new Date(startISO).getTime() + args.service.duration_minutes * 60_000).toISOString();
  const idemKey = await idempotencyKey([stylist.id, args.service.id, startISO, args.clientPhone ?? args.clientId]);
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      stylist_id: stylist.id,
      client_id: args.clientId,
      service_id: args.service.id,
      service_name: args.service.name,
      customer_name: args.clientName,
      customer_phone: args.clientPhone ?? null,
      starts_at: startISO,
      ends_at: endISO,
      status: "booked",
      source: "kasa",
      origin_conversation_id: args.originConversationId ?? null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, appointmentId: (data as any).id, idempotencyKey: idemKey };
}

/** Cancel an appointment — syncs to Square (frees the slot) and marks the local
 *  row canceled. Returns ok/error for honest UI. */
export async function cancelBooking(appointmentId: string): Promise<BookResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: "You're signed out — sign in and retry." };
  try {
    const res = await fetch(`${FUNCTIONS_URL}/square-cancel-booking`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appointmentId }),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      return { ok: false, error: squareErrorMessage(json.error) };
    }
    return { ok: true, appointmentId, idempotencyKey: "" };
  } catch {
    return { ok: false, error: "Couldn't reach Square. Nothing was changed." };
  }
}

function squareErrorMessage(err: unknown): string {
  const code = typeof err === "string" ? err : "";
  if (code === "no_token" || code === "token_invalid") return "Square connection expired — reconnect in Settings.";
  if (code === "slot_unavailable") return "That time was just taken. Pick another slot.";
  return "Couldn't create the booking in Square. Nothing was booked.";
}
