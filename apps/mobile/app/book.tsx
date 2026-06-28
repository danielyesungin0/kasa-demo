import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/Text";

// Book sheet — STUB. The real duration-aware Book sheet (the star) is built
// after the conversation core. The nudge + composer Book button route here for
// now so the flow is connected end-to-end. TODO(book-sheet).
export default function BookScreen() {
  const router = useRouter();
  return (
    <View className="flex-1 items-center justify-center bg-bg px-gutter" style={{ gap: 16 }}>
      <Text variant="title">Book sheet — coming soon</Text>
      <Text variant="body" className="text-ink-3 text-center">
        The duration-aware Book sheet is the next star screen. The nudge pre-fill
        will land here.
      </Text>
      <Pressable onPress={() => router.back()} accessibilityRole="button" className="rounded-control bg-bg-warm px-5 py-3">
        <Text style={{ fontFamily: "Inter_600SemiBold", color: "#534B41" }}>Close</Text>
      </Pressable>
    </View>
  );
}
