import { useMemo, useState } from "react";
import { View, TextInput, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/Text";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { useClients, type ClientRow } from "@/lib/useClients";
import { colors } from "@/theme/colors";

// Clients — searchable list of the real clients table. VIP star on high-value
// clients; tap → profile. Uses a plain View (not Screen/ScrollView) so the
// FlatList is the only scroller (no nested-VirtualizedList warning).
export default function ClientsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, loading } = useClients();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? items.filter((c) => c.name.toLowerCase().includes(needle) || (c.instagram_handle ?? "").toLowerCase().includes(needle))
      : items;
    return list;
  }, [items, q]);

  function lastVisitLabel(c: ClientRow): string {
    if (!c.last_appt_at) return "New client";
    const d = new Date(c.last_appt_at);
    return "Last visit " + d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  }

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {/* header */}
      <View className="flex-row items-center px-gutter pb-2 pt-1" style={{ gap: 8 }}>
        <Text variant="title">Clients</Text>
        <View className="rounded-pill bg-bg-warm px-2 py-0.5">
          <Text tabular style={{ fontSize: 12.5, fontFamily: "Inter_700Bold", color: colors.ink3 }}>{items.length}</Text>
        </View>
      </View>

      {/* search */}
      <View className="mx-gutter mb-2 flex-row items-center rounded-control-lg border border-line-2 bg-surface px-3.5" style={{ height: 44, gap: 8 }}>
        <Icon name="search" size={16} color={colors.ink4} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search clients"
          placeholderTextColor={colors.ink4}
          autoCapitalize="none"
          className="flex-1 text-body text-ink"
          style={{ fontFamily: "Inter_400Regular", padding: 0 }}
        />
        {q ? (
          <Pressable onPress={() => setQ("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="x" size={16} color={colors.ink4} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.ink4} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 76 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<View className="px-1 py-8"><Text className="text-ink-3" style={{ fontSize: 13.5 }}>No clients found.</Text></View>}
          renderItem={({ item: c }) => (
            <Pressable
              onPress={() => router.push(`/client/${c.id}`)}
              accessibilityRole="button"
              className="flex-row items-center border-b border-line py-3"
              style={{ gap: 13, minHeight: 44 }}
            >
              <Avatar name={c.name} size={42} />
              <View className="flex-1" style={{ minWidth: 0 }}>
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{c.name}</Text>
                  {c.value === "high" ? (
                    <View className="items-center justify-center rounded-full bg-accent-soft" style={{ width: 18, height: 18 }}>
                      <Icon name="star" size={11} color={colors.accent} />
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} className="text-ink-3" style={{ fontSize: 12.5, marginTop: 1 }}>{lastVisitLabel(c)}</Text>
              </View>
              <Icon name="chevR" size={16} color={colors.ink4} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
