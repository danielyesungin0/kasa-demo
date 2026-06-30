import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator, Alert, Animated } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { ActionSheet } from "@/components/ui/ActionSheet";
import { DayGrid } from "@/components/calendar/DayGrid";
import { WeekGrid } from "@/components/calendar/WeekGrid";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { useAppointments, type Appointment } from "@/lib/useAppointments";
import { cancelBooking } from "@/lib/booking";
import {
  todayKey, dayStrip, weekStrip, monthStrip, weekStart, parseKey, addDaysKey,
  dayHeaderLabel, monthLabel,
} from "@/lib/calendar";
import { colors } from "@/theme/colors";

type View3 = "day" | "week" | "month";
const TAB_BAR_HEIGHT = 60;

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items, loading, reload } = useAppointments();
  // Refresh whenever the Calendar gains focus (e.g. right after booking) so a
  // just-created appointment shows without waiting on the Realtime event.
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const [view, setView] = useState<View3>("day");
  const [dayKey, setDayKey] = useState(todayKey());
  const [weekKey, setWeekKey] = useState(weekStart(todayKey()));
  const [monthIdx, setMonthIdx] = useState(new Date().getMonth());
  const year = new Date().getFullYear();

  // When navigated with ?day=YYYY-MM-DD (e.g. right after booking), jump to that
  // day in Day view so the new appointment is visible.
  const params = useLocalSearchParams<{ day?: string }>();
  useEffect(() => {
    if (params.day) {
      setDayKey(params.day);
      setView("day");
    }
  }, [params.day]);

  const days = useMemo(() => dayStrip(weekStart(todayKey()), 14), []); // 2 weeks of day pills
  const weeks = useMemo(() => weekStrip(todayKey()), []);
  const months = useMemo(() => monthStrip(), []);

  const periodLabel =
    view === "day" ? dayHeaderLabel(dayKey)
    : view === "week" ? (weeks.find((w) => w.startKey === weekKey)?.label ?? "")
    : monthLabel(monthIdx, year);

  // Tap an appointment → our own ActionSheet (View / Reschedule / Cancel).
  const [sheetAppt, setSheetAppt] = useState<Appointment | null>(null);
  function openAppt(a: Appointment) { setSheetAppt(a); }

  function confirmCancel(a: Appointment) {
    Alert.alert(
      "Cancel appointment?",
      `${a.clientName} · ${a.serviceName ?? "Appointment"}. This cancels it in Square too.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel appointment", style: "destructive",
          onPress: async () => {
            const res = await cancelBooking(a.id);
            if (res.ok) reload();
            else Alert.alert("Couldn't cancel", res.error ?? "Try again.");
          },
        },
      ],
    );
  }

  // Reschedule: open Book prefilled with the SAME client + service + day, in
  // reschedule mode. Book cancels the old booking only AFTER the new one
  // succeeds — so backing out never loses the original appointment. Instant:
  // no awaiting a cancel here.
  function rescheduleAppt(a: Appointment) {
    if (!a.client_id) { Alert.alert("Can't reschedule", "This appointment has no client on file."); return; }
    const day = a.starts_at.slice(0, 10);
    const url =
      `/book?client=${a.client_id}&day=${day}` +
      (a.service_id ? `&service=${a.service_id}` : "") +
      `&reschedule=${a.id}`;
    router.push(url as any);
  }

  // Swipe left/right to move between days (Day view) or weeks (Week view).
  function navigate(dir: -1 | 1) {
    if (view === "day") setDayKey((k) => addDaysKey(k, dir));
    else if (view === "week") setWeekKey((k) => addDaysKey(k, dir * 7));
    else setMonthIdx((m) => Math.min(11, Math.max(0, m + dir)));
  }

  // Slide animation when navigating: grid slides out in the swipe direction,
  // content swaps, then slides in from the other side. Light + native-driven.
  const slideX = useRef(new Animated.Value(0)).current;
  function animatedNavigate(dir: -1 | 1) {
    const W = 380;
    Animated.timing(slideX, { toValue: -dir * W * 0.25, duration: 110, useNativeDriver: true }).start(() => {
      navigate(dir);
      slideX.setValue(dir * W * 0.25);
      Animated.timing(slideX, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    });
  }
  const swipe = Gesture.Pan()
    .activeOffsetX([-20, 20]) // horizontal intent only; lets vertical scroll win
    .failOffsetY([-12, 12])
    .onEnd((e) => {
      if (e.translationX <= -50) runOnJS(animatedNavigate)(1);
      else if (e.translationX >= 50) runOnJS(animatedNavigate)(-1);
    });

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {/* header */}
      <View className="border-b border-line px-gutter pb-2.5 pt-3">
        <View className="mb-3 flex-row items-center justify-between" style={{ minHeight: 40 }}>
          <Text variant="title">{periodLabel}</Text>
          <View className="flex-row items-center rounded-pill bg-ok-soft px-2.5 py-1.5" style={{ gap: 5 }}>
            <Icon name="link" size={12} color={colors.okInk} />
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.okInk }}>Square</Text>
          </View>
        </View>

        {/* segmented control */}
        <View className="mb-3 flex-row rounded-control bg-bg-warm p-[3px]" style={{ gap: 2 }}>
          {(["day", "week", "month"] as View3[]).map((v) => (
            <Pressable
              key={v}
              onPress={() => setView(v)}
              accessibilityRole="button"
              accessibilityState={view === v ? { selected: true } : {}}
              className={`flex-1 items-center rounded-[9px] ${view === v ? "bg-surface" : ""}`}
              style={{ paddingVertical: 8 }}
            >
              <Text style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold", color: view === v ? colors.ink : colors.ink3 }}>
                {v[0].toUpperCase() + v.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* unit-matched pill strip (fixed-height pills) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingVertical: 2 }} style={{ marginHorizontal: -20, paddingHorizontal: 20 }}>
          {view === "day" && days.map((d) => {
            const on = d.key === dayKey;
            return (
              <Pressable key={d.key} onPress={() => setDayKey(d.key)} accessibilityRole="button"
                className={`items-center justify-center rounded-[15px] border ${on ? "border-ink bg-ink" : "border-line-2 bg-surface"}`}
                style={{ width: 50, height: 54, gap: 3 }}>
                <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: on ? "#fff" : d.isToday ? colors.accent : colors.ink4 }}>{d.dow}</Text>
                <Text tabular style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: on ? "#fff" : colors.ink2 }}>{d.n}</Text>
              </Pressable>
            );
          })}
          {view === "week" && weeks.map((w) => {
            const on = w.startKey === weekKey;
            return (
              <Pressable key={w.startKey} onPress={() => setWeekKey(w.startKey)} accessibilityRole="button"
                className={`items-center justify-center rounded-[15px] border ${on ? "border-ink bg-ink" : "border-line-2 bg-surface"}`}
                style={{ minWidth: 56, height: 54, paddingHorizontal: 12, gap: 3 }}>
                <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: on ? "#fff" : w.isCurrent ? colors.accent : colors.ink4 }}>{w.top}</Text>
                <Text tabular style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: on ? "#fff" : colors.ink2 }}>{w.range}</Text>
              </Pressable>
            );
          })}
          {view === "month" && months.map((m) => {
            const on = m.idx === monthIdx;
            return (
              <Pressable key={m.idx} onPress={() => setMonthIdx(m.idx)} accessibilityRole="button"
                className={`items-center justify-center rounded-[15px] border ${on ? "border-ink bg-ink" : "border-line-2 bg-surface"}`}
                style={{ width: 54, height: 54 }}>
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: on ? "#fff" : m.isCurrent ? colors.accentStrong : colors.ink2 }}>{m.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* active grid */}
      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.ink4} /></View>
      ) : (
        <GestureDetector gesture={swipe}>
          <ScrollView className="flex-1 bg-surface" contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 16 }} showsVerticalScrollIndicator={false}>
            <Animated.View style={{ transform: [{ translateX: slideX }] }}>
              {view === "day" && <DayGrid dayKey={dayKey} appts={items} onOpen={openAppt} />}
              {view === "week" && <WeekGrid weekStartKey={weekKey} appts={items} onPickDay={(k) => { setDayKey(k); setView("day"); }} onOpen={openAppt} />}
              {view === "month" && <MonthGrid year={year} monthIdx={monthIdx} appts={items} onPickDay={(k) => { setDayKey(k); setView("day"); }} />}
            </Animated.View>
          </ScrollView>
        </GestureDetector>
      )}

      {/* FAB → Book sheet */}
      <Pressable
        onPress={() => router.push(`/book?day=${dayKey}`)}
        accessibilityRole="button"
        accessibilityLabel="New appointment"
        className="absolute items-center justify-center rounded-[18px] bg-plum-strong"
        style={{ right: 18, bottom: TAB_BAR_HEIGHT + insets.bottom + 4, width: 56, height: 56, shadowColor: colors.plumStrong, shadowOpacity: 0.42, shadowRadius: 20, shadowOffset: { width: 0, height: 6 } }}
      >
        <Icon name="plus" size={26} color="#fff" />
      </Pressable>

      <ActionSheet
        visible={!!sheetAppt}
        title={sheetAppt ? sheetAppt.clientName : undefined}
        subtitle={sheetAppt ? sheetAppt.serviceName ?? "Appointment" : undefined}
        onClose={() => setSheetAppt(null)}
        actions={
          sheetAppt
            ? [
                { label: "View client", icon: "user", onPress: () => sheetAppt.client_id && router.push(`/client/${sheetAppt.client_id}`) },
                { label: "Reschedule", icon: "clock", onPress: () => rescheduleAppt(sheetAppt) },
                { label: "Cancel appointment", icon: "x", destructive: true, onPress: () => confirmCancel(sheetAppt) },
              ]
            : []
        }
      />
    </View>
  );
}
