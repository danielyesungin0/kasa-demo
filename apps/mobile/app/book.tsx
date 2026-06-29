import { useEffect, useMemo, useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { Avatar } from "@/components/ui/Avatar";
import { useAppointments } from "@/lib/useAppointments";
import { listServices, fetchSlots, createBooking, type Service, type Slot } from "@/lib/booking";
import { dayStrip, weekStart, todayKey, fmtHour } from "@/lib/calendar";
import { supabase } from "@/lib/supabase";
import { colors } from "@/theme/colors";

type Client = { id: string; name: string; phone: string | null };

// The Book sheet — the star. Client → Service → Day → Time → Confirm. Slots are
// real (availableSlots respects studio hours, service duration, and existing
// appointments). Guardrails: nothing books without the explicit "Confirm in
// Square" tap; copy never claims the AI booked it; honest success/failure.
export default function BookScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string; conversation?: string; client?: string }>();
  const { items: appts } = useAppointments();

  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const [client, setClient] = useState<Client | null>(null);
  const [fixedClient, setFixedClient] = useState(false); // came from a conversation
  const [svc, setSvc] = useState<Service | null>(null);
  const [pickSvc, setPickSvc] = useState(false);
  const [dayKey, setDayKey] = useState(params.day ?? todayKey());
  const [slot, setSlot] = useState<Slot | null>(null);
  const [originConvo, setOriginConvo] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const days = useMemo(() => dayStrip(weekStart(todayKey()), 14), []);

  useEffect(() => {
    (async () => {
      const [svcs, { data: cl }] = await Promise.all([
        listServices(),
        supabase.from("clients").select("id, name, phone").order("name").limit(20),
      ]);
      setServices(svcs);
      setClients((cl ?? []) as Client[]);

      // From a conversation: resolve + fix its client; prefill from intent_payload.
      if (params.conversation) {
        setOriginConvo(params.conversation);
        const { data: conv } = await supabase
          .from("conversations")
          .select("client_id, intent_payload, client:clients(id, name, phone)")
          .eq("id", params.conversation)
          .maybeSingle();
        const c = (conv as any)?.client;
        if (c) { setClient(c); setFixedClient(true); }
        const payload = (conv as any)?.intent_payload;
        if (payload?.service) {
          const match = svcs.find(
            (s) => s.name.toLowerCase() === String(payload.service).toLowerCase() ||
                   s.service_key === payload.service,
          );
          if (match) setSvc(match);
        }
      } else if (params.client) {
        const c = (cl ?? []).find((x: any) => x.id === params.client) as Client | undefined;
        if (c) { setClient(c); setFixedClient(true); }
      }
      setLoading(false);
    })();
  }, [params.conversation, params.client]);

  // Real availability from square-availability (Square's true open slots when
  // connected; local fallback otherwise). Re-fetched when service/day change.
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  useEffect(() => {
    let active = true;
    if (!svc) { setSlots([]); return; }
    setSlotsLoading(true);
    fetchSlots(svc, dayKey, appts).then((s) => {
      if (active) { setSlots(s); setSlotsLoading(false); }
    });
    return () => { active = false; };
  }, [svc, dayKey, appts]);
  useEffect(() => {
    if (slot && !slots.some((s) => s.startHour === slot.startHour)) setSlot(null);
  }, [slots]);

  const groups: [string, Slot[]][] = [
    ["Morning", slots.filter((s) => s.startHour < 12)],
    ["Afternoon", slots.filter((s) => s.startHour >= 12 && s.startHour < 17)],
    ["Evening", slots.filter((s) => s.startHour >= 17)],
  ];
  const ready = !!client && !!svc && !!slot;

  async function confirm() {
    if (!ready || !client || !svc || !slot) return;
    setSubmitting(true);
    const res = await createBooking({
      service: svc,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      dayKey,
      startHour: slot.startHour,
      originConversationId: originConvo,
    });
    setSubmitting(false);
    setResult(res.ok ? { ok: true } : { ok: false, error: res.error });
  }

  if (result) return <ResultView result={result} client={client} svc={svc} slot={slot} dayKey={dayKey} onClose={() => router.back()} onRetry={() => setResult(null)} />;

  return (
    <View className="flex-1 bg-bg">
      {/* grabber + close */}
      <View className="flex-row items-center justify-between px-4 pt-3" style={{ paddingTop: insets.top + 8 }}>
        <View style={{ width: 44 }} />
        <View className="rounded-full bg-line-2" style={{ width: 38, height: 5 }} />
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" className="items-center justify-center" style={{ width: 44, height: 44 }}>
          <Icon name="x" size={22} color={colors.ink3} />
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.ink4} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* header */}
          <View className="flex-row items-center self-start rounded-pill bg-plum-soft px-2.5 py-1.5" style={{ gap: 5 }}>
            <Icon name="calendar" size={13} color={colors.plumInk} />
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.plumInk }}>New appointment</Text>
          </View>
          <Text variant="display" className="mt-2.5">{client ? `Book ${client.name.split(" ")[0]}` : "New booking"}</Text>

          {/* For (client) */}
          {!fixedClient ? (
            <View className="mt-5">
              <Text className="mb-2 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>FOR</Text>
              {client ? (
                <Pressable onPress={() => setClient(null)} className="flex-row items-center self-start rounded-control border border-line-2 bg-surface py-2 pl-2 pr-3.5" style={{ gap: 9 }}>
                  <Avatar name={client.name} size={30} />
                  <Text style={{ fontSize: 14.5, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{client.name}</Text>
                  <Text className="text-accent-ink" style={{ fontSize: 13, fontFamily: "Inter_600SemiBold" }}>Change</Text>
                </Pressable>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {clients.map((c) => (
                    <Pressable key={c.id} onPress={() => setClient(c)} accessibilityRole="button" className="items-center" style={{ width: 60, gap: 5 }}>
                      <Avatar name={c.name} size={44} />
                      <Text numberOfLines={1} className="text-ink-2" style={{ fontSize: 12 }}>{c.name.split(" ")[0]}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          ) : null}

          {/* Service */}
          <View className="mt-5">
            <Text className="mb-2 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>SERVICE</Text>
            <Pressable onPress={() => setPickSvc((p) => !p)} accessibilityRole="button" accessibilityState={{ expanded: pickSvc }} className="flex-row items-center justify-between rounded-control-lg border border-line-2 bg-surface px-4" style={{ minHeight: 52 }}>
              {svc ? (
                <View className="flex-row items-baseline" style={{ gap: 8 }}>
                  <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{svc.name}</Text>
                  <Text className="text-ink-3" style={{ fontSize: 12.5 }}>{svc.duration_minutes}m · ${(svc.price_cents / 100).toFixed(0)}</Text>
                </View>
              ) : (
                <Text className="text-ink-4" style={{ fontSize: 15 }}>Choose a service</Text>
              )}
              <Icon name={pickSvc ? "chevD" : "chevR"} size={16} color={colors.ink4} />
            </Pressable>
            {pickSvc ? (
              <View className="mt-2 overflow-hidden rounded-control-lg border border-line-2 bg-surface">
                {services.map((s, i) => {
                  const on = svc?.id === s.id;
                  return (
                    <Pressable key={s.id} onPress={() => { setSvc(s); setPickSvc(false); }} accessibilityRole="button" className={`flex-row items-center justify-between px-4 py-3.5 ${i > 0 ? "border-t border-line" : ""} ${on ? "bg-plum-soft" : ""}`} style={{ minHeight: 44 }}>
                      <Text style={{ fontSize: 14.5, fontFamily: "Inter_600SemiBold", color: on ? colors.plumInk : colors.ink }}>{s.name}</Text>
                      <Text className="text-ink-3" style={{ fontSize: 12.5 }}>{s.duration_minutes}m · ${(s.price_cents / 100).toFixed(0)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>

          {/* Day */}
          <View className="mt-5">
            <Text className="mb-2 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>DAY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
              {days.map((d) => {
                const on = d.key === dayKey;
                return (
                  <Pressable key={d.key} onPress={() => { setDayKey(d.key); setSlot(null); }} accessibilityRole="button"
                    className={`items-center justify-center rounded-[15px] border ${on ? "border-ink bg-ink" : "border-line-2 bg-surface"}`} style={{ width: 50, height: 54, gap: 3 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: on ? "#fff" : d.isToday ? colors.accent : colors.ink4 }}>{d.dow}</Text>
                    <Text tabular style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: on ? "#fff" : colors.ink2 }}>{d.n}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Available times */}
          <View className="mt-5">
            <Text className="mb-2 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>
              AVAILABLE TIMES{svc ? ` · ${svc.duration_minutes}m` : ""}
            </Text>
            {!svc ? (
              <Text className="text-ink-3" style={{ fontSize: 13.5 }}>Pick a service first so times fit around your day.</Text>
            ) : (
              groups.map(([label, gslots]) => (
                <View key={label} className="mb-3">
                  <Text className="mb-1.5 text-ink-3" style={{ fontSize: 12.5, fontFamily: "Inter_600SemiBold" }}>
                    {label}{gslots.length === 0 ? " · none free" : ""}
                  </Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {gslots.map((s) => {
                      const on = slot?.startHour === s.startHour;
                      return (
                        <Pressable key={s.startHour} onPress={() => setSlot(s)} accessibilityRole="button" accessibilityState={on ? { selected: true } : {}}
                          className={`items-center justify-center rounded-control border ${on ? "border-plum-strong bg-plum-strong" : "border-line-2 bg-surface"}`} style={{ minHeight: 44, paddingHorizontal: 14 }}>
                          <Text style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold", color: on ? "#fff" : colors.ink }}>{s.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}

      {/* bottom bar */}
      {!loading ? (
        <View className="border-t border-line bg-bg px-5 pt-3" style={{ paddingBottom: insets.bottom + 14 }}>
          <Text className={ready ? "text-ink-2" : "text-ink-4"} style={{ fontSize: 13, marginBottom: 10 }}>
            {ready && svc && slot
              ? `${days.find((d) => d.key === dayKey)?.dow} ${days.find((d) => d.key === dayKey)?.n} · ${slot.label} · ${svc.name}`
              : client ? "Pick a service and a time" : "Pick a client, service and time"}
          </Text>
          <Pressable onPress={confirm} disabled={!ready || submitting} accessibilityRole="button"
            className="flex-row items-center justify-center rounded-control-lg" style={{ height: 52, backgroundColor: ready ? colors.plumStrong : colors.bgWarm, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <>
                <Icon name="check" size={16} color={ready ? "#fff" : colors.ink2} />
                <Text style={{ marginLeft: 8, fontSize: 15.5, fontFamily: "Inter_600SemiBold", color: ready ? "#fff" : colors.ink2 }}>Confirm in Square</Text>
              </>
            )}
          </Pressable>
          <View className="mt-2.5 flex-row items-center justify-center" style={{ gap: 6 }}>
            <Icon name="check" size={11} color={colors.ink4} />
            <Text className="text-ink-4" style={{ fontSize: 12 }}>Reviewed by you — created in Square only when you confirm</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ResultView({
  result, client, svc, slot, dayKey, onClose, onRetry,
}: {
  result: { ok: boolean; error?: string };
  client: Client | null; svc: Service | null; slot: Slot | null; dayKey: string;
  onClose: () => void; onRetry: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 items-center justify-center bg-bg px-gutter" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View className="items-center justify-center rounded-full" style={{ width: 72, height: 72, backgroundColor: result.ok ? colors.okSoft : colors.errSoft }}>
        <Icon name={result.ok ? "checkCircle" : "alert"} size={36} color={result.ok ? colors.okInk : colors.errInk} />
      </View>
      <Text variant="display" className="mt-5 text-center">
        {result.ok ? "Booked in Square" : "Couldn't reach Square"}
      </Text>
      {result.ok && client && svc && slot ? (
        <Text variant="body" className="mt-2 text-center text-ink-3">
          {client.name} · {svc.name} · {slot.label}. It's on your calendar.
        </Text>
      ) : (
        <Text variant="body" className="mt-2 text-center text-ink-3">
          {result.error ?? "Nothing was booked."} Nothing was created — you can retry.
        </Text>
      )}
      <View className="mt-7 w-full" style={{ gap: 10 }}>
        {!result.ok ? (
          <Pressable onPress={onRetry} accessibilityRole="button" className="items-center justify-center rounded-control-lg bg-plum-strong" style={{ height: 52 }}>
            <Text className="text-white" style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold" }}>Try again</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} accessibilityRole="button" className="items-center justify-center rounded-control-lg border border-line-2 bg-surface" style={{ height: 52 }}>
          <Text style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{result.ok ? "Done" : "Close"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
