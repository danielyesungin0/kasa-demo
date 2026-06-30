// ActionSheet — our own bottom-sheet menu, replacing the bare iOS ActionSheetIOS
// so menus match Kasa's design language. Backdrop scrim + slide-up animation,
// rounded card, optional title, destructive styling. No extra deps (Modal +
// Animated). Used for the appointment View/Reschedule/Cancel menu.
import { useEffect, useRef } from "react";
import { Modal, View, Pressable, Animated, Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { Icon, type IconName } from "./Icon";
import { colors } from "@/theme/colors";

export type SheetAction = {
  label: string;
  sub?: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
};

export function ActionSheet({
  visible,
  title,
  subtitle,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      y.setValue(40);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(20,16,12,0.42)", opacity: fade }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" />
      </Animated.View>
      <Animated.View
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          paddingHorizontal: 12, paddingBottom: insets.bottom + 10,
          transform: [{ translateY: y }],
        }}
      >
        <View className="overflow-hidden rounded-card bg-surface" style={{ marginBottom: 8 }}>
          {(title || subtitle) ? (
            <View className="border-b border-line px-4 py-3.5">
              {title ? <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.ink }}>{title}</Text> : null}
              {subtitle ? <Text className="text-ink-3" style={{ fontSize: 13, marginTop: 2 }}>{subtitle}</Text> : null}
            </View>
          ) : null}
          {actions.map((a, i) => (
            <Pressable
              key={a.label}
              onPress={() => { onClose(); a.onPress(); }}
              accessibilityRole="button"
              className={`flex-row items-center px-4 py-3.5 active:bg-surface-2 ${i > 0 || title || subtitle ? "border-t border-line" : ""}`}
              style={{ gap: 13, minHeight: 56 }}
            >
              {a.icon ? (
                <Icon name={a.icon} size={19} color={a.destructive ? colors.errInk : colors.ink2} />
              ) : null}
              <View className="flex-1">
                <Text style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold", color: a.destructive ? colors.errInk : colors.ink }}>{a.label}</Text>
                {a.sub ? <Text className="text-ink-3" style={{ fontSize: 12.5, marginTop: 1 }}>{a.sub}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          className="items-center justify-center rounded-card bg-surface active:bg-surface-2"
          style={{ minHeight: 54 }}
        >
          <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.ink }}>Cancel</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}
