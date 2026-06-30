// FilterSheet — the inbox "Filter by channel" bottom sheet (in Kasa's design
// language). Status filters live as quick-tap pills in the header; the channel
// filter (the occasional one) lives here: All channels + each connected channel
// as rows with a right-side radio that fills when selected.
import { useEffect, useRef } from "react";
import { Modal, View, Pressable, Animated, Easing, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/Text";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ChannelDot } from "@/components/ui/ChannelDot";
import { colors, channels } from "@/theme/colors";
import type { InboxItem } from "@/lib/types";

// StatusKey stays here so the inbox can import both filter types from one place.
export type StatusKey = "all" | "unread" | "booking";
export type ChannelKey = "all" | InboxItem["channel_type"];

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
  channel,
  presentChannels,
  onChannel,
  onClose,
}: {
  visible: boolean;
  channel: ChannelKey;
  presentChannels: InboxItem["channel_type"][];
  onChannel: (c: ChannelKey) => void;
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

  // Selecting a channel applies + closes (single-tap, like a picker).
  const pick = (c: ChannelKey) => { onChannel(c); onClose(); };

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
          <View className="px-gutter pb-2 pt-1.5">
            <Text variant="title">Filter by channel</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ height: 4 }} />
            <Row icon="inbox" label="All channels" on={channel === "all"} onPress={() => pick("all")} />
            {presentChannels.map((c) => (
              <Row key={c} dot={c} label={channels[c as keyof typeof channels]?.label ?? c} on={channel === c} onPress={() => pick(c)} />
            ))}
            <View style={{ height: 8 }} />
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}
