import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "react-native";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";

// Thread — STUB. Full thread (bubbles, nudge, Instagram-style composer) is the
// next sub-step. This stands so Inbox navigation works and the build is valid.
export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center border-b border-line px-3 py-2" style={{ minHeight: 54, gap: 8 }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="items-center justify-center rounded-full"
          style={{ width: 42, height: 42 }}
        >
          <Icon name="back" size={22} color={colors.ink} />
        </Pressable>
        <Text variant="section">Thread</Text>
      </View>
      <View className="flex-1 items-center justify-center px-gutter">
        <Text variant="body" className="text-ink-3">Thread {id} — coming next.</Text>
      </View>
    </View>
  );
}
