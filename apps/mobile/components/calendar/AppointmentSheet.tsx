// AppointmentSheet — the event-detail sheet (Google Calendar pattern). Tapping
// an appointment opens this: client (tappable → profile), service, date/time,
// source. Actions: Edit (→ reschedule) and Delete (→ cancel, with confirm).
// Replaces the old iOS action sheet + alert. Slide-up + scrim, no extra deps.
import { useEffect, useRef } from "react";
import { Modal, View, Pressable, Animated, Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/Text";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { colors } from "@/theme/colors";
import type { Appointment } from "@/lib/useAppointments";

function whenLabel(iso: string, endIso: string): string {
  const d = new Date(iso);
  const e = new Date(endIso);
  const opts = { timeZone: "America/New_York" } as const;
  const date = d.toLocaleDateString("en-US", { ...opts, weekday: "long", month: "long", day: "numeric" });
  const t = (x: Date) => x.toLocaleTimeString("en-US", { ...opts, hour: "numeric", minute: "2-digit", hour12: true });
  return `${date} · ${t(d)} – ${t(e)}`;
}

export function AppointmentSheet({
  appt,
  onClose,
  onViewClient,
  onEdit,
  onDelete,
}: {
  appt: Appointment | null;
  onClose: () => void;
  onViewClient: (a: Appointment) => void;
  onEdit: (a: Appointment) => void;
  onDelete: (a: Appointment) => void;
}) {
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(40)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const visible = !!appt;

  useEffect(() => {
    if (visible) {
      y.setValue(40);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(20,16,12,0.42)", opacity: fade }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" />
      </Animated.View>
      <Animated.View
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, transform: [{ translateY: y }] }}
      >
        <View className="rounded-t-card bg-surface" style={{ paddingBottom: insets.bottom + 12 }}>
          {/* grabber */}
          <View className="items-center pt-2.5 pb-1">
            <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: colors.line2 }} />
          </View>

          {appt ? (
            <View className="px-gutter pt-2">
              {/* service + time */}
              <Text variant="title" style={{ marginBottom: 4 }}>{appt.serviceName ?? "Appointment"}</Text>
              <View className="flex-row items-center" style={{ gap: 7, marginBottom: 16 }}>
                <Icon name="clock" size={14} color={colors.ink3} />
                <Text className="text-ink-2" style={{ fontSize: 13.5 }}>{whenLabel(appt.starts_at, appt.ends_at)}</Text>
              </View>

              {/* client → profile */}
              <Pressable
                onPress={() => onViewClient(appt)}
                disabled={!appt.client_id}
                accessibilityRole="button"
                className="flex-row items-center rounded-control-lg border border-line bg-bg px-3.5 active:bg-surface-2"
                style={{ gap: 12, minHeight: 60 }}
              >
                <Avatar name={appt.clientName} size={40} />
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{appt.clientName}</Text>
                  <Text className="text-ink-3" style={{ fontSize: 12.5, marginTop: 1 }}>
                    {appt.source === "kasa" ? "Booked in Kasa" : "From Square"}
                  </Text>
                </View>
                {appt.client_id ? <Icon name="chevR" size={16} color={colors.ink4} /> : null}
              </Pressable>

              {/* actions */}
              <View className="flex-row" style={{ gap: 10, marginTop: 16 }}>
                <Pressable
                  onPress={() => onEdit(appt)}
                  accessibilityRole="button"
                  className="flex-1 flex-row items-center justify-center rounded-control-lg border border-line-2 bg-surface active:bg-surface-2"
                  style={{ height: 50, gap: 8 }}
                >
                  <Icon name="clock" size={17} color={colors.ink} />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.ink }}>Reschedule</Text>
                </Pressable>
                <Pressable
                  onPress={() => onDelete(appt)}
                  accessibilityRole="button"
                  className="flex-1 flex-row items-center justify-center rounded-control-lg active:opacity-80"
                  style={{ height: 50, gap: 8, backgroundColor: colors.errSoft }}
                >
                  <Icon name="trash" size={17} color={colors.errInk} />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.errInk }}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Modal>
  );
}
