import { View, Pressable, Linking } from "react-native";
import { useRouter } from "expo-router";
import { Screen, ScreenHeader } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { useAuth } from "@/lib/auth";
import { FUNCTIONS_URL } from "@/lib/supabase";
import { colors } from "@/theme/colors";

// More / Settings. Profile header, settings rows, legal links, and a standard
// destructive Sign-out row at the bottom.
export default function MoreScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const email = session?.user?.email ?? "Signed in";

  const Row = ({ icon, label, sub, onPress, last }: {
    icon: "link" | "ext"; label: string; sub?: string; onPress: () => void; last?: boolean;
  }) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`flex-row items-center px-4 py-3.5 active:bg-surface-2 ${last ? "" : "border-b border-line"}`}
      style={{ gap: 14, minHeight: 52 }}
    >
      <View className="items-center justify-center rounded-control bg-bg-warm" style={{ width: 38, height: 38 }}>
        <Icon name={icon} size={18} color={colors.ink2} />
      </View>
      <View className="flex-1">
        <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{label}</Text>
        {sub ? <Text className="text-ink-3" style={{ fontSize: 13, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      <Icon name="chevR" size={18} color={colors.ink4} />
    </Pressable>
  );

  return (
    <Screen>
      <ScreenHeader title="More" />

      {/* profile header */}
      <View className="mx-gutter mb-5 flex-row items-center rounded-card border border-line bg-surface p-4" style={{ gap: 14 }}>
        <Avatar name="Shen Lee" size={56} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: colors.ink }}>Shen Lee</Text>
          <Text numberOfLines={1} className="text-ink-3" style={{ fontSize: 13, marginTop: 2 }}>{email}</Text>
        </View>
      </View>

      {/* settings */}
      <Text className="mx-gutter mb-2 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>SETTINGS</Text>
      <View className="mx-gutter overflow-hidden rounded-card border border-line bg-surface">
        <Row icon="link" label="Channels" sub="Instagram, WeChat, Square" onPress={() => router.push("/settings/channels")} last />
      </View>

      {/* legal */}
      <Text className="mx-gutter mb-2 mt-6 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>ABOUT</Text>
      <View className="mx-gutter overflow-hidden rounded-card border border-line bg-surface">
        <Row icon="ext" label="Privacy Policy" onPress={() => Linking.openURL(`${FUNCTIONS_URL}/privacy`)} />
        <Row icon="ext" label="Terms of Service" onPress={() => Linking.openURL(`${FUNCTIONS_URL}/terms`)} last />
      </View>

      {/* sign out — standard destructive row in its own card */}
      <View className="mx-gutter mt-6 overflow-hidden rounded-card border border-line bg-surface">
        <Pressable
          onPress={signOut}
          accessibilityRole="button"
          className="items-center justify-center py-3.5 active:bg-surface-2"
          style={{ minHeight: 52 }}
        >
          <Text className="text-err-ink" style={{ fontSize: 15, fontFamily: "Inter_600SemiBold" }}>Sign out</Text>
        </Pressable>
      </View>

      <Text className="mx-gutter mt-5 text-center text-ink-4" style={{ fontSize: 12 }}>Kasa · v0.1.0</Text>
    </Screen>
  );
}
