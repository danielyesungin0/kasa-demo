import { useMemo, useState } from "react";
import { View, FlatList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { SearchBar } from "@/components/ui/SearchBar";
import { InboxRow } from "@/components/inbox/InboxRow";
import { FilterSheet, type StatusKey, type ChannelKey } from "@/components/inbox/FilterSheet";
import { useConversations } from "@/lib/useConversations";
import { supabase } from "@/lib/supabase";
import { colors, channels } from "@/theme/colors";
import type { InboxItem } from "@/lib/types";

const channelLabel = (c: InboxItem["channel_type"]) =>
  channels[c as keyof typeof channels]?.label ?? c;

// Status filters live as quick-tap pills; channel filter lives in the sheet.
const STATUS_PILLS: { key: StatusKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "booking", label: "Booking requests" },
];

const TAB_BAR_HEIGHT = 60;

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items, loading, reload } = useConversations();
  const [status, setStatus] = useState<StatusKey>("all");
  const [channel, setChannel] = useState<ChannelKey>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  async function onRefresh() { setRefreshing(true); await reload(); setRefreshing(false); }

  // Channels actually present in the inbox (so the filter only offers real ones).
  const presentChannels = useMemo(
    () => Array.from(new Set(items.map((i) => i.channel_type))),
    [items],
  );
  const list = useMemo(() => {
    let l = items;
    if (status === "unread") l = l.filter((i) => i.unread);
    else if (status === "booking") l = l.filter((i) => i.hasBooking);
    if (channel !== "all") l = l.filter((i) => i.channel_type === channel);
    const q = query.trim().toLowerCase();
    if (q) {
      l = l.filter(
        (i) =>
          (i.client?.name ?? "").toLowerCase().includes(q) ||
          (i.snippet ?? "").toLowerCase().includes(q),
      );
    }
    return l;
  }, [items, status, channel, query]);

  async function markRead(item: InboxItem) {
    await supabase.from("conversations").update({ unread: false }).eq("id", item.id);
    void reload();
  }
  async function archive(item: InboxItem) {
    await supabase.from("conversations").update({ archived: true }).eq("id", item.id);
    void reload();
  }
  function openThread(item: InboxItem) {
    router.push(`/thread/${item.id}`);
  }

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {/* header */}
      <View className="px-gutter pb-2.5 pt-3">
        <View className="mb-3 flex-row items-center justify-between" style={{ minHeight: 40 }}>
          <Text variant="title">Inbox</Text>
          {/* channel filter → bottom sheet, in the header. Only shown with >1
              channel (ready for more channels); highlights when a channel is active. */}
          {presentChannels.length > 1 ? (
            <Pressable
              onPress={() => setFilterOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Filter by channel"
              className={`flex-row items-center rounded-pill border px-3 ${channel !== "all" ? "border-ink bg-ink" : "border-line-2 bg-surface"}`}
              style={{ minHeight: 36, gap: 6 }}
            >
              <Icon name="merge" size={14} color={channel !== "all" ? "#fff" : colors.ink2} />
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: channel !== "all" ? "#fff" : colors.ink2 }}>
                {channel === "all" ? "Channel" : channelLabel(channel)}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* search — filters by client name or message text */}
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search messages" />

        {/* status pills (quick taps) */}
        <View className="mt-3 flex-row items-center" style={{ gap: 8 }}>
          {STATUS_PILLS.map((p) => {
            const on = status === p.key;
            return (
              <Pressable
                key={p.key}
                onPress={() => setStatus(p.key)}
                accessibilityRole="button"
                accessibilityState={on ? { selected: true } : {}}
                className={`rounded-pill border px-4 ${on ? "border-ink bg-ink" : "border-line-2 bg-surface"}`}
                style={{ paddingVertical: 8, minHeight: 36 }}
              >
                <Text className={on ? "text-white" : "text-ink-2"} style={{ fontSize: 13.5, fontFamily: "Inter_500Medium" }}>
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* list (virtualized) */}
      {loading ? (
        <View className="bg-surface" style={{ paddingTop: 6 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} className="flex-row items-center" style={{ paddingVertical: 14, paddingLeft: 20, paddingRight: 18, gap: 12, minHeight: 72 }}>
              <Skeleton width={48} height={48} radius={24} />
              <View style={{ flex: 1, gap: 7 }}>
                <Skeleton width={"45%"} height={14} radius={7} />
                <Skeleton width={"80%"} height={12} radius={6} />
              </View>
            </View>
          ))}
        </View>
      ) : list.length === 0 ? (
        <View className="flex-1 items-center justify-center" style={{ gap: 11, padding: 30 }}>
          <Icon name="checkCircle" size={28} color={colors.ok} />
          <Text variant="body" className="text-ink-3">Nothing here.</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(i) => i.id}
          className="bg-surface"
          contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink4} />}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={9}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <InboxRow
              item={item}
              onOpen={() => openThread(item)}
              onRead={() => markRead(item)}
              onArchive={() => archive(item)}
              showDivider={index < list.length - 1}
            />
          )}
        />
      )}

      <FilterSheet
        visible={filterOpen}
        channel={channel}
        presentChannels={presentChannels}
        onChannel={setChannel}
        onClose={() => setFilterOpen(false)}
      />
    </View>
  );
}
