// Reusable connect-accounts screen. ONE component, two entries:
//   - onboarding (gated=true): shows progress + the "Enter Kasa" gate button
//     (Square + >=1 channel), enforces the gate.
//   - Settings → Channels (gated=false): same rows + sheets, no gate button.
// Backed by the real channels table + stylist Square fields (useChannels).
import { useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { ChannelDot } from "@/components/ui/ChannelDot";
import { ConnectSheet } from "./ConnectSheet";
import { useChannels, type ConnState, type ProviderId } from "@/lib/useChannels";
import { colors } from "@/theme/colors";

const PROVIDERS: { id: ProviderId; name: string; sub: string; required?: boolean; channel?: boolean }[] = [
  { id: "square", name: "Square", sub: "Your calendar & bookings", required: true },
  { id: "instagram", name: "Instagram", sub: "Client DMs", channel: true },
  { id: "wechat", name: "WeChat", sub: "Client messages", channel: true },
];
const LATER = [
  { id: "sms", name: "SMS", sub: "Text messages" },
  { id: "kakao", name: "KakaoTalk", sub: "Client messages" },
] as const;

function StatePill({ state }: { state: ConnState }) {
  if (state === "connected")
    return <View className="rounded-pill bg-ok-soft px-2.5 py-1.5"><Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.okInk }}>Connected</Text></View>;
  if (state === "action_needed")
    return <View className="rounded-pill bg-warn-soft px-2.5 py-1.5"><Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.warnInk }}>Reconnect</Text></View>;
  return null;
}

export function ChannelsScreen({
  gated,
  onReady,
}: {
  gated: boolean;
  onReady?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { loading, conn, connectSquare, connectChannel, disconnect } = useChannels();
  const [sheet, setSheet] = useState<ProviderId | null>(null);

  const channelsConnected =
    (conn.instagram.state === "connected" ? 1 : 0) + (conn.wechat.state === "connected" ? 1 : 0);
  const squareConnected = conn.square.state === "connected";
  const ready = squareConnected && channelsConnected >= 1;
  const done = (squareConnected ? 1 : 0) + channelsConnected;

  function onConnectFromSheet(p: ProviderId) {
    if (p === "square") void connectSquare();
    else void connectChannel(p);
  }

  function ConnRow({ id }: { id: ProviderId }) {
    const meta = PROVIDERS.find((p) => p.id === id)!;
    const info = conn[id];
    const isChannel = !!meta.channel;
    return (
      <View className="flex-row items-center border-b border-line px-4 py-4" style={{ gap: 13 }}>
        {isChannel ? (
          <ChannelDot ch={id as "instagram" | "wechat"} size={42} />
        ) : (
          <View className="items-center justify-center rounded-control" style={{ width: 42, height: 42, backgroundColor: colors.plumSoft }}>
            <Icon name="calendar" size={20} color={colors.plum} />
          </View>
        )}
        <View className="flex-1" style={{ minWidth: 0 }}>
          <View className="flex-row items-center" style={{ gap: 7 }}>
            <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{meta.name}</Text>
            {meta.required ? (
              <View className="rounded-pill bg-plum-soft px-2 py-0.5"><Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.plumInk }}>Required</Text></View>
            ) : null}
          </View>
          <Text numberOfLines={1} className="text-ink-3" style={{ fontSize: 12.5, marginTop: 2 }}>
            {info.state === "connected" ? info.label ?? "Connected" : meta.sub}
          </Text>
        </View>
        {info.state === "connected" ? (
          <Pressable onPress={() => disconnect(id)} accessibilityRole="button" accessibilityLabel={`Disconnect ${meta.name}`} style={{ minHeight: 44, justifyContent: "center" }}>
            <StatePill state="connected" />
          </Pressable>
        ) : info.state === "connecting" ? (
          <View className="flex-row items-center rounded-control bg-bg-warm px-3.5" style={{ height: 36 }}>
            <ActivityIndicator size="small" color={colors.ink3} />
          </View>
        ) : (
          <Pressable
            onPress={() => setSheet(id)}
            accessibilityRole="button"
            accessibilityLabel={`Connect ${meta.name}`}
            className="items-center justify-center rounded-control bg-ink px-4"
            style={{ minHeight: 44 }}
          >
            <Text className="text-white" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>
              {info.state === "action_needed" ? "Reconnect" : "Connect"}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg" style={{ paddingTop: insets.top }}>
        <ActivityIndicator color={colors.ink4} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + (gated ? 140 : 40) }} showsVerticalScrollIndicator={false}>
        {gated ? (
          <>
            <Text variant="eyebrow" className="text-ink-4">Step 2 of 2</Text>
            <Text variant="display" className="mt-2">Connect your accounts</Text>
            <Text variant="body" className="mt-2 text-ink-3">
              Kasa needs your booking calendar and at least one message channel to get going.
            </Text>
            <View className="mt-5 flex-row items-center rounded-card border border-line bg-surface p-4" style={{ gap: 12 }}>
              <View className="h-[7px] flex-1 overflow-hidden rounded-pill bg-bg-warm">
                <View className="h-full rounded-pill bg-plum" style={{ width: `${(done / 3) * 100}%` }} />
              </View>
              <Text tabular style={{ fontSize: 12.5, fontFamily: "Inter_700Bold", color: colors.ink2 }}>{done}/3</Text>
            </View>
          </>
        ) : (
          <Text variant="title-lg">Channels</Text>
        )}

        <Text className="mt-5 mb-2.5 px-1 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>BOOKING</Text>
        <View className="overflow-hidden rounded-card border border-line bg-surface">
          <ConnRow id="square" />
        </View>

        <Text className="mt-5 mb-2.5 px-1 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>MESSAGE CHANNELS · MVP</Text>
        <View className="overflow-hidden rounded-card border border-line bg-surface">
          <ConnRow id="instagram" />
          <ConnRow id="wechat" />
        </View>

        <Text className="mt-5 mb-2.5 px-1 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>MORE CHANNELS</Text>
        <View className="overflow-hidden rounded-card border border-line bg-surface">
          {LATER.map((p, i) => (
            <View key={p.id} className={`flex-row items-center px-4 py-4 ${i === 0 ? "border-b border-line" : ""}`} style={{ gap: 13, opacity: 0.62 }}>
              <ChannelDot ch={p.id} size={42} />
              <View className="flex-1">
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{p.name}</Text>
                <Text className="text-ink-3" style={{ fontSize: 12.5, marginTop: 2 }}>{p.sub}</Text>
              </View>
              <View className="rounded-pill bg-bg-warm px-2.5 py-1.5"><Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.ink4 }}>After launch</Text></View>
            </View>
          ))}
        </View>
      </ScrollView>

      {gated ? (
        <View
          className="absolute inset-x-0 bottom-0 bg-bg px-5 pt-3.5"
          style={{ paddingBottom: insets.bottom + 18 }}
        >
          <Pressable
            onPress={onReady}
            disabled={!ready}
            accessibilityRole="button"
            className={`items-center justify-center rounded-control-lg ${ready ? "bg-plum-strong" : "bg-bg-warm"}`}
            style={{ height: 52 }}
          >
            <Text style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold", color: ready ? "#fff" : colors.ink2 }}>
              {ready ? "Enter Kasa →" : "Connect Square + 1 channel"}
            </Text>
          </Pressable>
          <Text className="mt-2.5 text-center text-ink-4" style={{ fontSize: 12.5, lineHeight: 18 }}>
            {ready
              ? "You can add more channels later in Settings."
              : "Instagram needs a Professional account; WeChat needs a verified Service Account."}
          </Text>
        </View>
      ) : null}

      <ConnectSheet provider={sheet} onClose={() => setSheet(null)} onConnect={onConnectFromSheet} />
    </View>
  );
}
