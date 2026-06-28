// Avatar — initials on a deterministic color. Algorithm + palette ported
// verbatim from design/reference.html (avColor). Sizes 28/34/40/56/72 (§6).
import { View } from "react-native";
import { Text } from "./Text";

const AVCOL = [
  "#C56B5C", "#876D8B", "#5B7FA6", "#5E9B73", "#BC8A3E",
  "#A86B6B", "#6B8A8A", "#9B6BA8", "#B07A52", "#5C7C9B",
];

function avColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVCOL[Math.abs(h) % AVCOL.length];
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const FONT_FOR: Record<number, number> = {
  28: 11, 34: 12, 40: 14, 56: 18, 72: 24,
};

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: avColor(name),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        className="text-white"
        maxScale={1.1}
        style={{ fontFamily: "Inter_600SemiBold", fontSize: FONT_FOR[size] ?? 14 }}
      >
        {initials(name)}
      </Text>
    </View>
  );
}
