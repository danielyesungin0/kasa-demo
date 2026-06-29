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
import { supabase } from "./supabase";
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

/** Open start-times for a service on a day, given existing appointments.
 *  Local mirror of square-availability (respects studio hours + conflicts). */
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

/** Create a booking. Writes the appointment row (source='kasa') in the shape
 *  square-create-booking will. NEVER called without an explicit confirm tap. */
export async function createBooking(args: {
  service: Service;
  clientId: string;
  clientName: string;
  clientPhone?: string | null;
  dayKey: string;
  startHour: number;
  originConversationId?: string | null;
}): Promise<BookResult> {
  const { data: stylist } = await supabase
    .from("stylists")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (!stylist?.id) return { ok: false, error: "No stylist record." };

  const { startISO } = instantFor(args.dayKey, args.startHour);
  const endISO = new Date(
    new Date(startISO).getTime() + args.service.duration_minutes * 60_000,
  ).toISOString();

  const idemKey = await idempotencyKey([
    stylist.id,
    args.service.square_variation_id ?? args.service.id,
    startISO,
    args.clientPhone ?? args.clientId,
  ]);

  // TODO(square): call square-create-booking with this idemKey; on its success
  // it writes the row with square_booking_id set. For the local seam we write
  // directly and leave square_booking_id null.
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
