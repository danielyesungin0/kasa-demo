// ConfirmDialog — a centered confirm modal in the Kasa design language,
// replacing the bare iOS Alert so destructive confirmations match the rest of
// the app (custom ActionSheet / AppointmentSheet). Scrim + scale-in; a cancel
// button and a primary button (destructive styling optional).
import { useEffect, useRef } from "react";
import { Modal, View, Pressable, Animated, Easing } from "react-native";
import { Text } from "./Text";
import { colors } from "@/theme/colors";

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const scale = useRef(new Animated.Value(0.95)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scale.setValue(0.95); fade.setValue(0);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(20,16,12,0.45)", opacity: fade, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Pressable className="absolute inset-0" onPress={onCancel} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <Animated.View
          style={{ width: "100%", maxWidth: 340, transform: [{ scale }] }}
          className="overflow-hidden rounded-card bg-surface"
        >
          <View className="px-5 pt-5 pb-4">
            <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: colors.ink, textAlign: "center" }}>{title}</Text>
            {message ? (
              <Text className="text-ink-3" style={{ fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 }}>{message}</Text>
            ) : null}
          </View>
          <View className="flex-row border-t border-line">
            <Pressable onPress={onCancel} accessibilityRole="button" className="flex-1 items-center justify-center active:bg-surface-2" style={{ height: 52 }}>
              <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.ink2 }}>{cancelLabel}</Text>
            </Pressable>
            <View className="w-px bg-line" />
            <Pressable onPress={onConfirm} accessibilityRole="button" className="flex-1 items-center justify-center active:bg-surface-2" style={{ height: 52 }}>
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: destructive ? colors.errInk : colors.plumStrong }}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
