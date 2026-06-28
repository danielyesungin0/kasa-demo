import { View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";

// Client profile — STUB. Full profile is a later Phase-3 step.
export default function ClientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center border-b border-line px-3.5" style={{ minHeight: 54, gap: 8, paddingVertical: 9 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" className="items-center justify-center rounded-full" style={{ width: 42, height: 42 }}>
          <Icon name="back" size={22} color={colors.ink} />
        </Pressable>
        <Text variant="section">Client</Text>
      </View>
      <View className="flex-1 items-center justify-center px-gutter">
        <Text variant="body" className="text-ink-3">Profile {id} — coming later.</Text>
      </View>
    </View>
  );
}
