import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetFooter,
  BottomSheetBackdrop,
  type BottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { Avatar } from "@/components/ui/Avatar";
import { useAppointments } from "@/lib/useAppointments";
import { listServices, fetchAllSlots, availableSlots, createBooking, type Service, type Slot } from "@/lib/booking";
import { dayStrip, weekStart, todayKey } from "@/lib/calendar";
import { supabase } from "@/lib/supabase";
import { colors } from "@/theme/colors";

type Client = { id: string; name: string; phone: string | null };

// The Book sheet — built on @gorhom/bottom-sheet for a proper modal sheet:
//   • fixed title (doesn't scroll), • scrollable form body, • STICKY Confirm
//     footer (BottomSheetFooter), • drag-down / backdrop-tap to dismiss.
// This is the standard bottom-sheet pattern (Material/iOS): the CTA stays put
// while content scrolls. Guardrails: nothing books without the explicit Confirm
// tap; copy never claims the AI booked it; honest success/failure.
export default function BookScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string; conversation?: string; client?: string }>();
  const { items: appts } = useAppointments();
  const sheetRef = useRef<BottomSheet>(null);

  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const [client, setClient] = useState<Client | null>(null);
  const [fixedClient, setFixedClient] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clientFocused, setClientFocused] = useState(false);
  const [svc, setSvc] = useState<Service | null>(null);
  const [pickSvc, setPickSvc] = useState(false);
  const [dayKey, setDayKey] = useState(params.day ?? todayKey());
  const [slot, setSlot] = useState<Slot | null>(null);
  const [originConvo, setOriginConvo] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const days = useMemo(() => dayStrip(weekStart(todayKey()), 14), []);

  const clientMatches = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    const base = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
    return base.slice(0, 20);
  }, [clients, clientQuery]);

  // Dismiss = close the sheet, then pop the route (gorhom animates down first).
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    (async () => {
      const [svcs, { data: cl }] = await Promise.all([
        listServices(),
        supabase.from("clients").select("id, name, phone").order("name").limit(500),
      ]);
      setServices(svcs);
      setClients((cl ?? []) as Client[]);

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
        const guess = String(payload?.service_guess ?? payload?.service ?? "").toLowerCase().trim();
        if (guess) {
          const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
          const gWords = guess.replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
          const match =
            svcs.find((s) => norm(s.name) === norm(guess) || s.service_key === guess) ||
            svcs.find((s) => {
              const n = s.name.toLowerCase();
              return gWords.some((w) => n.includes(w)) || guess.includes(s.service_key);
            });
          if (match) setSvc(match);
        }
      } else if (params.client) {
        const c = (cl ?? []).find((x: any) => x.id === params.client) as Client | undefined;
        if (c) { setClient(c); setFixedClient(true); }
      }
      setLoading(false);
    })();
  }, [params.conversation, params.client]);

  const [slotsByDay, setSlotsByDay] = useState<Record<string, Slot[]>>({});
  const [slotsLoading, setSlotsLoading] = useState(false);
  useEffect(() => {
    let active = true;
    if (!svc) { setSlotsByDay({}); return; }
    setSlotsLoading(true);
    fetchAllSlots(svc).then((byDay) => {
      if (active) { setSlotsByDay(byDay); setSlotsLoading(false); }
    });
    return () => { active = false; };
  }, [svc]);
  const slots = useMemo<Slot[]>(() => {
    if (!svc) return [];
    const fromSquare = slotsByDay[dayKey];
    if (fromSquare && fromSquare.length) return fromSquare;
    if (Object.keys(slotsByDay).length === 0) return availableSlots(dayKey, svc.duration_minutes, appts);
    return [];
  }, [svc, dayKey, slotsByDay, appts]);
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

  // Sticky footer — stays pinned above the keyboard/safe-area while body scrolls.
  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => {
      if (loading || result) return null;
      return (
        <BottomSheetFooter {...props} bottomInset={insets.bottom}>
          <View className="border-t border-line bg-bg px-5 pt-3 pb-3">
            <Text className={ready ? "text-ink-2" : "text-ink-4"} style={{ fontSize: 13, marginBottom: 8, textAlign: "center" }}>
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
            <Text className="mt-2 text-center text-ink-4" style={{ fontSize: 11.5, lineHeight: 15 }}>
              Reviewed by you — created in Square only when you confirm
            </Text>
          </View>
        </BottomSheetFooter>
      );
    },
    [loading, result, ready, svc, slot, client, dayKey, days, submitting],
  );

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />,
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={["92%"]}
      enablePanDownToClose
      onClose={close}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: colors.line2, width: 38 }}
      backgroundStyle={{ backgroundColor: colors.bg }}
      footerComponent={renderFooter}
    >
      {result ? (
        <ResultView
          result={result} client={client} svc={svc} slot={slot} dayKey={dayKey}
          onClose={() => {
            if (!result.ok) { close(); return; }
            // Booked from a conversation → return to that thread with a
            // pre-filled confirmation DRAFT (stylist reviews + sends; never
            // auto-sent). Otherwise show it on the calendar.
            if (originConvo && client && svc && slot) {
              const d = days.find((x) => x.key === dayKey);
              const when = d ? `${d.dow} the ${d.n}` : "your appointment";
              const draft = `Hi ${client.name.split(" ")[0].replace(/^@/, "")}! You're booked for a ${svc.name} on ${when} at ${slot.label}. See you then! 🤍`;
              router.replace(`/thread/${originConvo}?draft=${encodeURIComponent(draft)}&booked=1`);
            } else {
              router.replace(`/(tabs)/calendar?day=${dayKey}`);
            }
          }}
          onRetry={() => setResult(null)}
        />
      ) : loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.ink4} /></View>
      ) : (
        <BottomSheetScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: 220 }} keyboardShouldPersistTaps="handled">
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
                <View>
                  <View className="flex-row items-center rounded-control-lg border border-line-2 bg-surface px-3.5" style={{ height: 48, gap: 8 }}>
                    <Icon name="search" size={16} color={colors.ink4} />
                    <BottomSheetTextInput
                      value={clientQuery}
                      onChangeText={setClientQuery}
                      onFocus={() => setClientFocused(true)}
                      placeholder="Search clients"
                      placeholderTextColor={colors.ink4}
                      autoCapitalize="none"
                      style={{ flex: 1, fontFamily: "Inter_400Regular", fontSize: 16, color: colors.ink, padding: 0 }}
                    />
                    {clientQuery ? (
                      <Pressable onPress={() => setClientQuery("")} hitSlop={8} accessibilityLabel="Clear"><Icon name="x" size={15} color={colors.ink4} /></Pressable>
                    ) : null}
                  </View>
                  {(clientFocused || clientQuery) ? (
                    <View className="mt-2 overflow-hidden rounded-control-lg border border-line-2 bg-surface">
                      {clientMatches.length === 0 ? (
                        <View className="px-4 py-3"><Text className="text-ink-4" style={{ fontSize: 13.5 }}>No matches.</Text></View>
                      ) : (
                        clientMatches.map((c, i) => (
                          <Pressable key={c.id} onPress={() => { setClient(c); setClientQuery(""); setClientFocused(false); }} accessibilityRole="button"
                            className={`flex-row items-center px-3 py-2.5 ${i > 0 ? "border-t border-line" : ""}`} style={{ gap: 10, minHeight: 48 }}>
                            <Avatar name={c.name} size={34} />
                            <Text numberOfLines={1} className="text-ink" style={{ fontSize: 14.5, fontFamily: "Inter_500Medium" }}>{c.name}</Text>
                          </Pressable>
                        ))
                      )}
                    </View>
                  ) : null}
                </View>
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
            ) : slotsLoading ? (
              <View>
                {["Morning", "Afternoon"].map((label) => (
                  <View key={label} className="mb-3">
                    <View className="mb-2 rounded bg-bg-warm" style={{ width: 72, height: 12 }} />
                    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <View key={i} className="rounded-control bg-bg-warm" style={{ width: 92, height: 44, opacity: 0.6 }} />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ) : slots.length === 0 ? (
              <Text className="text-ink-3 py-2" style={{ fontSize: 13.5, lineHeight: 19 }}>
                No openings this day. Try another day above.
              </Text>
            ) : (
              groups
                .filter(([, gslots]) => gslots.length > 0)
                .map(([label, gslots]) => (
                  <View key={label} className="mb-3">
                    <Text className="mb-1.5 text-ink-3" style={{ fontSize: 12.5, fontFamily: "Inter_600SemiBold" }}>{label}</Text>
                    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                      {gslots.map((s) => {
                        const on = slot?.startHour === s.startHour;
                        return (
                          <Pressable key={`${label}-${s.startHour}-${s.label}`} onPress={() => setSlot(s)} accessibilityRole="button" accessibilityState={on ? { selected: true } : {}}
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
        </BottomSheetScrollView>
      )}
    </BottomSheet>
  );
}

function ResultView({
  result, client, svc, slot, onClose, onRetry,
}: {
  result: { ok: boolean; error?: string };
  client: Client | null; svc: Service | null; slot: Slot | null; dayKey: string;
  onClose: () => void; onRetry: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center px-gutter" style={{ paddingVertical: 40 }}>
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
