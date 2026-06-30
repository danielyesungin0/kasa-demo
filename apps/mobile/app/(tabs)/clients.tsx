import { useMemo, useState } from "react";
import { View, Pressable, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/Text";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { SearchBar } from "@/components/ui/SearchBar";
import { useClients, type ClientRow } from "@/lib/useClients";
import { colors } from "@/theme/colors";

// Clients — same treatment as Inbox: bg page, a contrasting surface list,
// shared SearchBar, skeleton rows. VIP star; tap → profile. Plain View (not
// Screen/ScrollView) so the FlatList is the only scroller.
const TAB_BAR_HEIGHT = 60;

export default function ClientsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, loading } = useClients();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? items.filter((c) => c.name.toLowerCase().includes(needle) || (c.instagram_handle ?? "").toLowerCase().includes(needle))
      : items;
  }, [items, q]);

  function lastVisitLabel(c: ClientRow): string {
    if (!c.last_appt_at) return "New client";
    const d = new Date(c.last_appt_at);
    return "Last visit " + d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  }

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {/* header */}
      <View className="px-gutter pb-2.5 pt-3">
        <View className="mb-3 flex-row items-center" style={{ gap: 8, minHeight: 40 }}>
          <Text variant="title">Clients</Text>
          <View className="rounded-pill bg-bg-warm px-2 py-0.5">
            <Text tabular style={{ fontSize: 12.5, fontFamily: "Inter_700Bold", color: colors.ink3 }}>{items.length}</Text>
          </View>
        </View>
        <SearchBar value={q} onChangeText={setQ} placeholder="Search clients" />
      </View>

      {loading ? (
        <View className="bg-surface" style={{ paddingTop: 6 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} className="flex-row items-center" style={{ paddingVertical: 14, paddingLeft: 20, paddingRight: 18, gap: 12, minHeight: 68 }}>
              <Skeleton width={44} height={44} radius={22} />
              <View style={{ flex: 1, gap: 7 }}>
                <Skeleton width={"45%"} height={14} radius={7} />
                <Skeleton width={"30%"} height={12} radius={6} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          className="bg-surface"
          contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 12 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<View className="px-gutter py-8"><Text className="text-ink-3" style={{ fontSize: 13.5 }}>No clients found.</Text></View>}
          renderItem={({ item: c }) => (
            <Pressable
              onPress={() => router.push(`/client/${c.id}`)}
              accessibilityRole="button"
              className="flex-row items-center bg-surface active:bg-surface-2"
              style={{ paddingVertical: 12, paddingLeft: 20, paddingRight: 18, gap: 12, minHeight: 68 }}
            >
              <Avatar name={c.name} size={44} />
              <View className="flex-1" style={{ minWidth: 0 }}>
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{c.name}</Text>
                  {c.value === "high" ? (
                    <View className="items-center justify-center rounded-full bg-accent-soft" style={{ width: 18, height: 18 }}>
                      <Icon name="star" size={11} color={colors.accent} />
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} className="text-ink-3" style={{ fontSize: 13, marginTop: 2 }}>{lastVisitLabel(c)}</Text>
              </View>
              <Icon name="chevR" size={16} color={colors.ink4} />
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 76 }} />}
        />
      )}
    </View>
  );
}
