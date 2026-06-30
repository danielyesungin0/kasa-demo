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
          style={{ width: "100%", maxWidth: 360, transform: [{ scale }] }}
          className="rounded-card bg-surface px-6 pt-7 pb-6"
        >
          {/* copy — generous breathing room */}
          <Text style={{ fontSize: 19, fontFamily: "Inter_700Bold", color: colors.ink, textAlign: "center" }}>{title}</Text>
          {message ? (
            <Text className="text-ink-3" style={{ fontSize: 14.5, lineHeight: 21, textAlign: "center", marginTop: 10 }}>{message}</Text>
          ) : null}

          {/* stacked full-width pill buttons (Instagram/modern pattern):
              primary action on top, cancel below — big tap targets, not cramped. */}
          <View style={{ gap: 10, marginTop: 24 }}>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              className="items-center justify-center rounded-pill active:opacity-90"
              style={{ height: 52, backgroundColor: destructive ? colors.err : colors.plumStrong }}
            >
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>{confirmLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              className="items-center justify-center rounded-pill bg-bg-warm active:bg-surface-2"
              style={{ height: 52 }}
            >
              <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.ink2 }}>{cancelLabel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
