import { useMemo, useState } from "react";
import { View, Pressable, ScrollView, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { ChannelDot } from "@/components/ui/ChannelDot";
import { useConversations } from "@/lib/useConversations";
import { useAppointments, dayKeyOf, hourOf } from "@/lib/useAppointments";
import { todayKey, fmtHour } from "@/lib/calendar";
import { inboxTime } from "@/lib/time";
import { colors } from "@/theme/colors";

// Today — the home screen. Fraunces greeting, today's schedule (same source as
// Calendar: real appointments), and new (unread) messages. Both blocks link
// into the live screens. No fabricated counts — everything reads real data.
const TAB_BAR_HEIGHT = 60;

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items: convos, loading: convosLoading, reload: reloadConvos } = useConversations();
  const { items: appts, loading: apptsLoading, reload: reloadAppts } = useAppointments();
  const [refreshing, setRefreshing] = useState(false);
  const firstLoading = convosLoading || apptsLoading;
  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([reloadConvos(), reloadAppts()]);
    setRefreshing(false);
  }

  const tKey = todayKey();
  const todays = useMemo(
    () => appts.filter((a) => dayKeyOf(a.starts_at) === tKey).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [appts, tKey],
  );
  const unread = useMemo(() => convos.filter((c) => c.unread).slice(0, 5), [convos]);
  const unreadCount = convos.filter((c) => c.unread).length;

  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });
  const hr = now.getHours();
  const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";

  return (
    <Screen scroll={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink4} />}
      >
        {/* hero */}
        <View className="px-gutter pt-2">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text variant="eyebrow" className="mb-1 text-accent">{dateLabel}</Text>
              <Text variant="display-lg">{greeting},{"\n"}Shen</Text>
            </View>
            <Pressable onPress={() => router.push("/(tabs)/more")} accessibilityRole="button" accessibilityLabel="Profile">
              <Avatar name="Shen Lee" size={44} />
            </Pressable>
          </View>
          <Text variant="body" className="mt-3 text-ink-3">
            {unreadCount} new {unreadCount === 1 ? "message" : "messages"} · {todays.length} appointment{todays.length === 1 ? "" : "s"} today
          </Text>
        </View>

        {/* Today's schedule */}
        <View className="mt-6 px-gutter">
          <View className="mb-2.5 flex-row items-center justify-between">
            <Text variant="section">Today's schedule</Text>
            <Pressable onPress={() => router.push("/(tabs)/calendar")} accessibilityRole="button" hitSlop={8}>
              <Text className="text-accent-ink" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>Calendar</Text>
            </Pressable>
          </View>
          <View className="overflow-hidden rounded-card border border-line bg-surface">
            {firstLoading ? (
              <View className="px-4 py-4" style={{ gap: 14 }}>
                {[0, 1].map((i) => (
                  <View key={i} className="flex-row items-center" style={{ gap: 12 }}>
                    <Skeleton width={56} height={13} radius={6} />
                    <View style={{ flex: 1, gap: 6 }}>
                      <Skeleton width={"60%"} height={14} radius={7} />
                      <Skeleton width={"40%"} height={11} radius={6} />
                    </View>
                  </View>
                ))}
              </View>
            ) : todays.length === 0 ? (
              <View className="px-4 py-5"><Text className="text-ink-3" style={{ fontSize: 13.5 }}>No appointments today.</Text></View>
            ) : (
              todays.map((a, i) => (
                <Pressable
                  key={a.id}
                  onPress={() => a.client_id && router.push(`/client/${a.client_id}`)}
                  disabled={!a.client_id}
                  accessibilityRole="button"
                  className={`flex-row items-center px-4 py-3.5 ${i > 0 ? "border-t border-line" : ""}`}
                  style={{ gap: 12, minHeight: 44 }}
                >
                  <Text tabular className="text-ink-2" style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", width: 62 }}>
                    {fmtHour(hourOf(a.starts_at))}
                  </Text>
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{a.clientName}</Text>
                    <Text numberOfLines={1} className="text-ink-3" style={{ fontSize: 12.5, marginTop: 1 }}>{a.serviceName ?? "Appointment"}</Text>
                  </View>
                  {a.isNew ? (
                    <View className="rounded-[5px] bg-plum-strong px-1.5 py-0.5"><Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" }}>New</Text></View>
                  ) : null}
                  {a.client_id ? <Icon name="chevR" size={16} color={colors.ink4} /> : null}
                </Pressable>
              ))
            )}
          </View>
        </View>

        {/* New messages */}
        <View className="mt-6 px-gutter">
          <View className="mb-2.5 flex-row items-center justify-between">
            <Text variant="section">New messages</Text>
            <Pressable onPress={() => router.push("/(tabs)/inbox")} accessibilityRole="button" hitSlop={8}>
              <Text className="text-accent-ink" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>Inbox</Text>
            </Pressable>
          </View>
          <View className="overflow-hidden rounded-card border border-line bg-surface">
            {firstLoading ? (
              <View className="px-4 py-4" style={{ gap: 14 }}>
                {[0, 1, 2].map((i) => (
                  <View key={i} className="flex-row items-center" style={{ gap: 12 }}>
                    <Skeleton width={40} height={40} radius={20} />
                    <View style={{ flex: 1, gap: 6 }}>
                      <Skeleton width={"50%"} height={13} radius={6} />
                      <Skeleton width={"75%"} height={11} radius={6} />
                    </View>
                  </View>
                ))}
              </View>
            ) : unread.length === 0 ? (
              <View className="flex-row items-center px-4 py-5" style={{ gap: 8 }}>
                <Icon name="checkCircle" size={17} color={colors.ok} />
                <Text className="text-ink-3" style={{ fontSize: 13.5 }}>You're all caught up.</Text>
              </View>
            ) : (
              unread.map((co, i) => (
                <Pressable
                  key={co.id}
                  onPress={() => router.push(`/thread/${co.id}`)}
                  accessibilityRole="button"
                  className={`flex-row items-center px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}
                  style={{ gap: 12, minHeight: 44 }}
                >
                  <View>
                    <Avatar name={co.client?.name ?? "Client"} size={40} />
                    <View className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface" style={{ padding: 1.5 }}>
                      <ChannelDot ch={co.channel_type} size={16} />
                    </View>
                  </View>
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    <View className="flex-row items-center justify-between">
                      <Text numberOfLines={1} style={{ fontSize: 14.5, fontFamily: "Inter_600SemiBold", color: colors.ink, flex: 1 }}>{co.client?.name ?? "Client"}</Text>
                      <Text className="text-ink-4" style={{ fontSize: 12, marginLeft: 8 }}>{inboxTime(co.last_message_at)}</Text>
                    </View>
                    <Text numberOfLines={1} className="text-ink-3" style={{ fontSize: 13, marginTop: 1 }}>{co.snippet}</Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
