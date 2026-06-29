// Skeleton — a softly-pulsing placeholder block for loading states. Respects
// reduce-motion (no pulse) for accessibility.
import { useEffect, useRef } from "react";
import { Animated, Easing, View, AccessibilityInfo } from "react-native";
import { useState } from "react";
import { colors } from "@/theme/colors";

export function Skeleton({
  width,
  height,
  radius = 8,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: object;
}) {
  const pulse = useRef(new Animated.Value(0.5)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion]);

  return (
    <Animated.View
      style={[
        { width: width as any, height, borderRadius: radius, backgroundColor: colors.bgWarm, opacity: reduceMotion ? 0.6 : pulse },
        style,
      ]}
    />
  );
}

// A chat-thread skeleton: alternating inbound/outbound bubble placeholders.
export function ThreadSkeleton() {
  const rows: ("in" | "out")[] = ["in", "out", "in", "in", "out", "in"];
  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16, gap: 14 }}>
      {rows.map((side, i) => (
        <View key={i} style={{ alignItems: side === "out" ? "flex-end" : "flex-start" }}>
          <Skeleton width={`${55 + ((i * 7) % 30)}%` as `${number}%`} height={side === "out" ? 38 : 48} radius={16} />
        </View>
      ))}
    </View>
  );
}
