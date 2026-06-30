// FilterSheet — the inbox "Filters" bottom sheet (Instagram pattern, in Kasa's
// design language). Sectioned rows with an icon, label, and a right-side radio
// that fills when selected. Two groups: STATUS (All / Unread / Booking requests)
// and CHANNEL (All channels + each connected channel). Single-select within each
// group. A "Reset" action clears both back to "all".
import { useEffect, useRef } from "react";
import { Modal, View, Pressable, Animated, Easing, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/Text";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ChannelDot } from "@/components/ui/ChannelDot";
import { colors, channels } from "@/theme/colors";
import type { InboxItem } from "@/lib/types";

export type StatusKey = "all" | "unread" | "booking";
export type ChannelKey = "all" | InboxItem["channel_type"];

const STATUS_ROWS: { key: StatusKey; label: string; icon: IconName }[] = [
  { key: "all", label: "All messages", icon: "inbox" },
  { key: "unread", label: "Unread", icon: "mail" },
  { key: "booking", label: "Booking requests", icon: "calendar" },
];

function Radio({ on }: { on: boolean }) {
  return (
    <View
      className="items-center justify-center rounded-full border"
      style={{ width: 22, height: 22, borderWidth: 2, borderColor: on ? colors.plumStrong : colors.line2 }}
    >
      {on ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colors.plumStrong }} /> : null}
    </View>
  );
}

export function FilterSheet({
  visible,
  status,
  channel,
  presentChannels,
  onStatus,
  onChannel,
  onReset,
  onClose,
}: {
  visible: boolean;
  status: StatusKey;
  channel: ChannelKey;
  presentChannels: InboxItem["channel_type"][];
  onStatus: (s: StatusKey) => void;
  onChannel: (c: ChannelKey) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(40)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      y.setValue(40);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const Row = ({ icon, dot, label, on, onPress }: {
    icon?: IconName; dot?: InboxItem["channel_type"]; label: string; on: boolean; onPress: () => void;
  }) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      className="flex-row items-center px-gutter active:bg-surface-2" style={{ minHeight: 56, gap: 13 }}>
      {dot ? <ChannelDot ch={dot} size={26} /> : (
        <View className="items-center justify-center rounded-control bg-bg-warm" style={{ width: 30, height: 30 }}>
          <Icon name={icon!} size={16} color={colors.ink2} />
        </View>
      )}
      <Text className="flex-1" style={{ fontSize: 15.5, fontFamily: "Inter_500Medium", color: colors.ink }}>{label}</Text>
      <Radio on={on} />
    </Pressable>
  );

  const dirty = status !== "all" || channel !== "all";

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(20,16,12,0.42)", opacity: fade }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" />
      </Animated.View>
      <Animated.View style={{ position: "absolute", left: 0, right: 0, bottom: 0, transform: [{ translateY: y }] }}>
        <View className="rounded-t-card bg-surface" style={{ paddingBottom: insets.bottom + 10, maxHeight: 560 }}>
          {/* grabber + header */}
          <View className="items-center pt-2.5 pb-1">
            <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: colors.line2 }} />
          </View>
          <View className="flex-row items-center justify-between px-gutter pb-2 pt-1.5">
            <Text variant="title">Filters</Text>
            {dirty ? (
              <Pressable onPress={onReset} accessibilityRole="button" hitSlop={8}>
                <Text style={{ fontSize: 14.5, fontFamily: "Inter_600SemiBold", color: colors.plumStrong }}>Reset</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text className="mx-gutter mb-1 mt-3 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>STATUS</Text>
            {STATUS_ROWS.map((r) => (
              <Row key={r.key} icon={r.icon} label={r.label} on={status === r.key} onPress={() => onStatus(r.key)} />
            ))}

            {/* Channel group — only meaningful with more than one channel. */}
            {presentChannels.length > 1 ? (
              <>
                <Text className="mx-gutter mb-1 mt-4 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>CHANNEL</Text>
                <Row icon="inbox" label="All channels" on={channel === "all"} onPress={() => onChannel("all")} />
                {presentChannels.map((c) => (
                  <Row key={c} dot={c} label={channels[c as keyof typeof channels]?.label ?? c} on={channel === c} onPress={() => onChannel(c)} />
                ))}
              </>
            ) : null}

            <View style={{ height: 8 }} />
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}
