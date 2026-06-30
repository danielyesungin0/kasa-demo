import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, ScrollView, Animated } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { AppointmentSheet } from "@/components/calendar/AppointmentSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { takePendingBooking } from "@/lib/bookingResult";
import { DayGrid } from "@/components/calendar/DayGrid";
import { WeekGrid } from "@/components/calendar/WeekGrid";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { MonthCalendar } from "@/components/ui/MonthCalendar";
import { useAppointments, dayKeyOf, type Appointment } from "@/lib/useAppointments";
import { cancelBooking } from "@/lib/booking";
import {
  todayKey, weekStrip, weekStart, parseKey, addDaysKey,
  dayHeaderLabel, monthLabel,
} from "@/lib/calendar";
import { colors } from "@/theme/colors";

type View3 = "day" | "week" | "month";
const TAB_BAR_HEIGHT = 60;

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items, loading, reload } = useAppointments();
  const toast = useToast();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Refresh whenever the Calendar gains focus (e.g. right after booking) so a
  // just-created appointment shows without waiting on the Realtime event. Also
  // consume a pending booking made from the calendar (toast + highlight).
  useFocusEffect(useCallback(() => {
    reload();
    const pending = takePendingBooking();
    if (pending && !pending.conversationId) {
      toast.show(pending.toast);
      setDayKey(pending.dayKey);
      setView("day");
      if (pending.appointmentId) {
        setHighlightId(pending.appointmentId);
        setTimeout(() => setHighlightId(null), 2600); // brief highlight, then fade
      }
    }
  }, [reload]));

  const [view, setView] = useState<View3>("day");
  const [dayKey, setDayKey] = useState(todayKey());
  const [weekKey, setWeekKey] = useState(weekStart(todayKey()));
  const [monthIdx, setMonthIdx] = useState(new Date().getMonth());
  const [miniOpen, setMiniOpen] = useState(false);
  const year = new Date().getFullYear();

  function goToToday() {
    const tk = todayKey();
    setDayKey(tk); setWeekKey(weekStart(tk)); setMonthIdx(parseKey(tk).mo - 1);
    setMiniOpen(false);
  }
  // Days that have at least one appointment → booking dots in the mini month.
  const bookedDays = useMemo(() => new Set(items.map((a) => dayKeyOf(a.starts_at))), [items]);

  // When navigated with ?day=YYYY-MM-DD (e.g. right after booking, or from a
  // client's upcoming card), jump to that day in Day view; ?highlight=<id>
  // briefly rings that appointment.
  const params = useLocalSearchParams<{ day?: string; highlight?: string }>();
  useEffect(() => {
    if (params.day) {
      setDayKey(params.day);
      setView("day");
    }
    if (params.highlight) {
      setHighlightId(params.highlight);
      const t = setTimeout(() => setHighlightId(null), 2600);
      return () => clearTimeout(t);
    }
  }, [params.day, params.highlight]);

  const weeks = useMemo(() => weekStrip(todayKey()), []); // used only for the week period label

  const periodLabel =
    view === "day" ? dayHeaderLabel(dayKey)
    : view === "week" ? (weeks.find((w) => w.startKey === weekKey)?.label ?? "")
    : monthLabel(monthIdx, year);

  // Tap an appointment → the event-detail sheet (Google Calendar pattern).
  const [sheetAppt, setSheetAppt] = useState<Appointment | null>(null);
  function openAppt(a: Appointment) { setSheetAppt(a); }

  // Cancel confirmation uses our custom ConfirmDialog (not the bare iOS Alert).
  const [cancelAppt, setCancelAppt] = useState<Appointment | null>(null);
  const [canceling, setCanceling] = useState(false);
  function confirmCancel(a: Appointment) { setCancelAppt(a); }
  async function doCancel() {
    const a = cancelAppt;
    if (!a || canceling) return;
    setCanceling(true);
    const res = await cancelBooking(a.id);
    setCanceling(false);
    setCancelAppt(null);
    if (res.ok) { reload(); toast.show("Appointment canceled", { icon: "trash", tone: "info" }); }
    else toast.show(res.error ?? "Couldn't cancel — try again", { icon: "alert", tone: "info" });
  }

  // Reschedule: open Book prefilled with the SAME client + service + day, in
  // reschedule mode. Book cancels the old booking only AFTER the new one
  // succeeds — so backing out never loses the original appointment. Instant:
  // no awaiting a cancel here.
  function rescheduleAppt(a: Appointment) {
    if (!a.client_id) { toast.show("This appointment has no client on file", { icon: "alert", tone: "info" }); return; }
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
      {/* header — Google Calendar pattern: a tappable period title that expands
          a mini month-grid; the view switcher; a Today shortcut. */}
      <View className="border-b border-line px-gutter pb-2.5 pt-3">
        <View className="mb-3 flex-row items-center justify-between" style={{ minHeight: 40 }}>
          <Pressable onPress={() => setMiniOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: miniOpen }} className="flex-row items-center" style={{ gap: 6 }} hitSlop={6}>
            <Text variant="title">{periodLabel}</Text>
            <Icon name={miniOpen ? "chevD" : "chevR"} size={16} color={colors.ink3} />
          </Pressable>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Pressable onPress={goToToday} accessibilityRole="button" className="rounded-pill border border-line-2 bg-surface px-3 py-1.5">
              <Text style={{ fontSize: 12.5, fontFamily: "Inter_600SemiBold", color: colors.ink2 }}>Today</Text>
            </Pressable>
            <View className="flex-row items-center rounded-pill bg-ok-soft px-2.5 py-1.5" style={{ gap: 5 }}>
              <Icon name="link" size={12} color={colors.okInk} />
              <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.okInk }}>Square</Text>
            </View>
          </View>
        </View>

        {/* segmented control */}
        <View className="flex-row rounded-control bg-bg-warm p-[3px]" style={{ gap: 2 }}>
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

        {/* mini month-grid dropdown — tap a date to jump there (sets the day in
            Day view, the containing week in Week view, the month in Month view),
            then collapses. Booking dots mark days with appointments. */}
        {miniOpen ? (
          <View className="mt-3">
            <MonthCalendar
              selectedKey={view === "day" ? dayKey : view === "week" ? weekKey : `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`}
              allowPast
              markedDays={bookedDays}
              onSelect={(k) => {
                if (view === "day") setDayKey(k);
                else if (view === "week") setWeekKey(weekStart(k));
                else setMonthIdx(parseKey(k).mo - 1);
                setMiniOpen(false);
              }}
            />
          </View>
        ) : null}
      </View>

      {/* active grid */}
      {loading ? (
        <View className="flex-1 bg-surface px-gutter" style={{ paddingTop: 16, gap: 14 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} className="flex-row items-center" style={{ gap: 12 }}>
              <Skeleton width={52} height={13} radius={6} />
              <View className="flex-1"><Skeleton width={"100%"} height={56} radius={14} /></View>
            </View>
          ))}
        </View>
      ) : (
        <GestureDetector gesture={swipe}>
          <ScrollView className="flex-1 bg-surface" contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 16 }} showsVerticalScrollIndicator={false}>
            <Animated.View style={{ transform: [{ translateX: slideX }] }}>
              {view === "day" && <DayGrid dayKey={dayKey} appts={items} onOpen={openAppt} highlightId={highlightId} />}
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

      <AppointmentSheet
        appt={sheetAppt}
        onClose={() => setSheetAppt(null)}
        onViewClient={(a) => { setSheetAppt(null); if (a.client_id) router.push(`/client/${a.client_id}`); }}
        onEdit={(a) => { setSheetAppt(null); rescheduleAppt(a); }}
        onDelete={(a) => { setSheetAppt(null); confirmCancel(a); }}
      />

      <ConfirmDialog
        visible={!!cancelAppt}
        title="Cancel appointment?"
        message={cancelAppt ? `${cancelAppt.clientName} · ${cancelAppt.serviceName ?? "Appointment"}. This cancels it in Square too.` : undefined}
        confirmLabel={canceling ? "Canceling…" : "Cancel appointment"}
        cancelLabel="Keep it"
        destructive
        onConfirm={doCancel}
        onCancel={() => { if (!canceling) setCancelAppt(null); }}
      />
    </View>
  );
}
