import { View, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { Avatar } from "@/components/ui/Avatar";
import { ChannelDot } from "@/components/ui/ChannelDot";
import { useClientProfile } from "@/lib/useClients";
import { inboxTime } from "@/lib/time";
import { colors, channels as chanMeta } from "@/theme/colors";

// Caution words that flip the Notes card to a "Heads up" treatment.
const CAUTION = /(allerg|sensitiv|patch test|react|careful|avoid|do not|don't|no\s)/i;

export default function ClientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client: c, convos, channels, loading } = useClientProfile(id);

  if (loading || !c) {
    return (
      <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
        <Header onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center">
          {loading ? <ActivityIndicator color={colors.ink4} /> : <Text className="text-ink-3">Client not found.</Text>}
        </View>
      </View>
    );
  }

  const statusLabel = c.value === "high" ? "VIP" : c.value === "regular" ? "Regular" : "New";
  const caution = !!c.notes && CAUTION.test(c.notes);
  const lastVisit = c.last_appt_at
    ? new Date(c.last_appt_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
    : "—";
  const sinceLabel = c.since ? `'${String(c.since).slice(2)}` : "—";

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <Header onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
        {/* head */}
        <View className="items-center px-gutter pt-5">
          <Avatar name={c.name} size={76} />
          <Text variant="title-lg" className="mt-3">{c.name}</Text>
          <View className="mt-2 flex-row items-center rounded-pill px-2.5 py-1" style={{ gap: 4, backgroundColor: c.value === "high" ? colors.accentSoft : colors.bgWarm }}>
            {c.value === "high" ? <Icon name="star" size={11} color={colors.accent} /> : null}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.value === "high" ? colors.accentInk : colors.ink3 }}>{statusLabel} client</Text>
          </View>

          {/* channel badges */}
          {channels.length ? (
            <View className="mt-3 flex-row flex-wrap justify-center" style={{ gap: 7 }}>
              {channels.map((ch) => (
                <View key={ch} className="flex-row items-center rounded-pill px-2.5 py-1" style={{ gap: 6, backgroundColor: chanMeta[ch].soft }}>
                  <ChannelDot ch={ch} size={15} />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: chanMeta[ch].text }}>{chanMeta[ch].label}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Book */}
          <Pressable
            onPress={() => router.push(`/book?client=${c.id}`)}
            accessibilityRole="button"
            className="mt-4 flex-row items-center justify-center self-stretch rounded-control-lg bg-plum-strong"
            style={{ height: 50, gap: 8 }}
          >
            <Icon name="calendar" size={16} color="#fff" />
            <Text className="text-white" style={{ fontSize: 15, fontFamily: "Inter_600SemiBold" }}>Book appointment</Text>
          </Pressable>
        </View>

        {/* stats */}
        <View className="mx-gutter mt-5 flex-row rounded-card border border-line bg-surface">
          <Stat n={String(c.visits ?? 0)} label="Visits" />
          <View className="w-px bg-line" />
          <Stat n={lastVisit} label="Last visit" />
          <View className="w-px bg-line" />
          <Stat n={sinceLabel} label="Since" />
        </View>

        {/* preferences */}
        {c.preferences ? (
          <Card label="Preferences" body={c.preferences} />
        ) : null}

        {/* notes / heads up */}
        {c.notes ? (
          <Card label={caution ? "Heads up" : "Notes"} body={c.notes} caution={caution} />
        ) : null}

        {/* tags */}
        {c.tags && c.tags.length ? (
          <View className="mx-gutter mt-4 rounded-card border border-line bg-surface p-4">
            <Text className="mb-2 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>TAGS</Text>
            <View className="flex-row flex-wrap" style={{ gap: 7 }}>
              {c.tags.map((t) => (
                <View key={t} className="rounded-pill bg-bg-warm px-2.5 py-1"><Text className="text-ink-2" style={{ fontSize: 12.5 }}>{t}</Text></View>
              ))}
            </View>
          </View>
        ) : null}

        {/* conversations */}
        <Text variant="section" className="mx-gutter mb-2 mt-6">Conversations</Text>
        <View className="mx-gutter overflow-hidden rounded-card border border-line bg-surface">
          {convos.length === 0 ? (
            <View className="px-4 py-5"><Text className="text-ink-3" style={{ fontSize: 13.5 }}>No conversations yet.</Text></View>
          ) : (
            convos.map((co, i) => (
              <Pressable
                key={co.id}
                onPress={() => router.replace(`/thread/${co.id}`)}
                accessibilityRole="button"
                className={`flex-row items-center px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}
                style={{ gap: 12, minHeight: 44 }}
              >
                <ChannelDot ch={co.channel_type} size={28} />
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <View className="flex-row items-center justify-between">
                    <Text style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{chanMeta[co.channel_type].label}</Text>
                    <Text className="text-ink-4" style={{ fontSize: 12 }}>{inboxTime(co.last_message_at)}</Text>
                  </View>
                  <Text numberOfLines={1} className="text-ink-3" style={{ fontSize: 13, marginTop: 1 }}>{co.preview ?? "—"}</Text>
                </View>
                <Icon name="chevR" size={16} color={colors.ink4} />
              </Pressable>
            ))
          )}
        </View>

        {/* contact */}
        <Text variant="section" className="mx-gutter mb-2 mt-6">Contact</Text>
        <View className="mx-gutter overflow-hidden rounded-card border border-line bg-surface">
          {!c.phone && !c.instagram_handle && !c.email ? (
            <View className="px-4 py-5"><Text className="text-ink-3" style={{ fontSize: 13.5 }}>No contact details saved.</Text></View>
          ) : (
            <>
              {c.phone ? <Contact icon="phone" value={c.phone} /> : null}
              {c.instagram_handle ? <Contact icon="user" value={c.instagram_handle} border={!!c.phone} /> : null}
              {c.email ? <Contact icon="mail" value={c.email} border={!!c.phone || !!c.instagram_handle} /> : null}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View className="flex-row items-center border-b border-line px-3.5" style={{ minHeight: 54, gap: 8, paddingVertical: 9 }}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" className="items-center justify-center rounded-full" style={{ width: 42, height: 42 }}>
        <Icon name="back" size={22} color={colors.ink} />
      </Pressable>
      <Text variant="section">Client</Text>
    </View>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <View className="flex-1 items-center py-3.5">
      <Text tabular style={{ fontSize: 18, fontFamily: "Fraunces_600SemiBold", color: colors.ink }}>{n}</Text>
      <Text className="text-ink-4" style={{ fontSize: 11.5, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function Card({ label, body, caution }: { label: string; body: string; caution?: boolean }) {
  return (
    <View className={`mx-gutter mt-4 rounded-card border p-4 ${caution ? "border-warn-soft bg-warn-soft" : "border-line bg-surface"}`}>
      <View className="mb-1.5 flex-row items-center" style={{ gap: 5 }}>
        {caution ? <Icon name="flag" size={12} color={colors.warnInk} /> : null}
        <Text className={caution ? "text-warn-ink" : "text-ink-4"} style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
      </View>
      <Text className={caution ? "text-warn-ink" : "text-ink-2"} style={{ fontSize: 14, lineHeight: 20 }}>{body}</Text>
    </View>
  );
}

function Contact({ icon, value, border }: { icon: "phone" | "user" | "mail"; value: string; border?: boolean }) {
  return (
    <View className={`flex-row items-center px-4 py-3.5 ${border ? "border-t border-line" : ""}`} style={{ gap: 12, minHeight: 44 }}>
      <View className="items-center justify-center rounded-control bg-bg-warm" style={{ width: 34, height: 34 }}>
        <Icon name={icon} size={15} color={colors.ink2} />
      </View>
      <Text className="text-ink" style={{ fontSize: 14.5 }}>{value}</Text>
    </View>
  );
}
