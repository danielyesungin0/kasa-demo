import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { ChannelsScreen } from "@/components/onboarding/ChannelsScreen";
import { colors } from "@/theme/colors";

// Settings → Channels — the SAME connect-accounts component as onboarding, but
// UNGATED (no Enter-Kasa gate). Reachable any time to add/reconnect channels.
export default function SettingsChannels() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg">
      <View className="flex-row items-center border-b border-line px-3.5" style={{ minHeight: 54, gap: 8, paddingTop: insets.top + 4, paddingBottom: 9 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" className="items-center justify-center rounded-full" style={{ width: 42, height: 42 }}>
          <Icon name="back" size={22} color={colors.ink} />
        </Pressable>
        <Text variant="section">Channels & Square</Text>
      </View>
      <ChannelsScreen gated={false} />
    </View>
  );
}
