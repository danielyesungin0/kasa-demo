// TypingDots — three dots that pulse in sequence (the iMessage "…" rhythm).
// Used on an outgoing bubble while it's optimistically sending, so the send
// reads as live rather than a static "Sending…". Honest: it only shows while a
// real network send is in flight. Reduce-motion aware (falls back to static).
import { useEffect, useRef } from "react";
import { View, Animated, AccessibilityInfo } from "react-native";

export function TypingDots({ color, size = 4 }: { color: string; size?: number }) {
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];
  const reduce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((r) => { reduce.current = r; });
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay((2 - i) * 150),
        ]),
      ),
    );
    if (!reduce.current) loops.forEach((l) => !cancelled && l.start());
    return () => { cancelled = true; loops.forEach((l) => l.stop()); };
  }, []);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: size - 1 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: d }} />
      ))}
    </View>
  );
}
