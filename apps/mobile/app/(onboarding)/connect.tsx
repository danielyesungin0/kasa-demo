import { View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/Text";
import { useAuth } from "@/lib/auth";
import { colors } from "@/theme/colors";

// Connect accounts — placeholder for the auth checkpoint. The full screen
// (Square + IG/WeChat rows, real channels-table state, per-platform sheets,
// the ready gate) is the NEXT sub-step. This stands so the route guard's
// "signed-in but gate-unmet" target exists and is demonstrable.
export default function ConnectScreen() {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 14, paddingHorizontal: 20 }}>
      <Text variant="eyebrow" className="text-ink-4">Step 2 of 2</Text>
      <Text variant="display" className="mt-2">Connect your accounts</Text>
      <Text variant="body" className="mt-2 text-ink-3">
        Kasa needs your booking calendar and at least one message channel to get going.
      </Text>
      <View className="mt-6 rounded-card border border-line bg-surface p-4">
        <Text variant="body" className="text-ink-3">
          Connect-accounts checklist — coming next (the full Square / Instagram /
          WeChat flow wired to the channels table).
        </Text>
      </View>
      <Pressable onPress={signOut} accessibilityRole="button" className="mt-6 self-start">
        <Text className="text-accent-ink" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>
          Sign out
        </Text>
      </Pressable>
    </View>
  );
}
