import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Screen, ScreenHeader } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { useAuth } from "@/lib/auth";
import { colors } from "@/theme/colors";

// More — entry to Settings. Channels reuses the SAME connect-accounts component
// as onboarding (ungated here). Profile/Square detail come with later screens.
export default function MoreScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const email = session?.user?.email ?? "Signed in";

  const rows = [
    { icon: "link" as const, label: "Channels", sub: "Connect Instagram, WeChat, Square", go: () => router.push("/settings/channels") },
  ];

  return (
    <Screen>
      <ScreenHeader title="More" />
      <View className="mx-gutter mb-5 flex-row items-center rounded-card border border-line bg-surface p-4" style={{ gap: 14 }}>
        <Avatar name="Shen Lee" size={56} />
        <View>
          <Text style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: colors.ink }}>Shen Lee</Text>
          <Text className="text-ink-3" style={{ fontSize: 13, marginTop: 2 }}>{email}</Text>
        </View>
      </View>

      <View className="mx-gutter overflow-hidden rounded-card border border-line bg-surface">
        {rows.map((r, i) => (
          <Pressable
            key={r.label}
            onPress={r.go}
            accessibilityRole="button"
            className={`flex-row items-center px-4 py-4 active:bg-surface-2 ${i < rows.length - 1 ? "border-b border-line" : ""}`}
            style={{ gap: 14, minHeight: 44 }}
          >
            <View className="items-center justify-center rounded-control bg-bg-warm" style={{ width: 38, height: 38 }}>
              <Icon name={r.icon} size={18} color={colors.ink2} />
            </View>
            <View className="flex-1">
              <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{r.label}</Text>
              <Text className="text-ink-3" style={{ fontSize: 13, marginTop: 1 }}>{r.sub}</Text>
            </View>
            <Icon name="chevR" size={18} color={colors.ink4} />
          </Pressable>
        ))}
      </View>

      <Pressable onPress={signOut} accessibilityRole="button" className="mx-gutter mt-5" style={{ minHeight: 44, justifyContent: "center" }}>
        <Text className="text-accent-ink" style={{ fontSize: 14, fontFamily: "Inter_600SemiBold" }}>Sign out</Text>
      </Pressable>
    </Screen>
  );
}
