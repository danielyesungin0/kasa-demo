// Reusable connect-accounts screen. ONE component, two entries:
//   - onboarding (gated=true): shows progress + the "Enter Kasa" gate button
//     (Square + >=1 channel), enforces the gate.
//   - Settings → Channels (gated=false): same rows + sheets, no gate button.
// Backed by the real channels table + stylist Square fields (useChannels).
import { useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { ChannelDot } from "@/components/ui/ChannelDot";
import { ConnectSheet } from "./ConnectSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useChannels, type ConnState, type ProviderId } from "@/lib/useChannels";
import { SMS_LIVE, WHATSAPP_LIVE, MESSENGER_LIVE } from "@/lib/config";
import { colors } from "@/theme/colors";

// Square + Instagram connect now. WhatsApp, Messenger, and SMS are real channels
// being set up — they show "Coming soon" until their *_LIVE flag is on. Kakao
// remains post-launch.
const PROVIDERS: { id: ProviderId; name: string; sub: string; required?: boolean; channel?: boolean }[] = [
  { id: "square", name: "Square", sub: "Your calendar & bookings", required: true },
  { id: "instagram", name: "Instagram", sub: "Client DMs", channel: true },
  { id: "whatsapp", name: "WhatsApp", sub: "Client chats", channel: true },
  { id: "messenger", name: "Messenger", sub: "Client DMs", channel: true },
  { id: "sms", name: "SMS", sub: "Text messages", channel: true },
];
const LATER = [
  { id: "kakao", name: "KakaoTalk", sub: "Client messages" },
] as const;

function StatePill({ state }: { state: ConnState }) {
  if (state === "connected")
    return <View className="rounded-pill bg-ok-soft px-2.5 py-1.5"><Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.okInk }}>Connected</Text></View>;
  if (state === "action_needed")
    return <View className="rounded-pill bg-warn-soft px-2.5 py-1.5"><Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.warnInk }}>Reconnect</Text></View>;
  if (state === "pending")
    return <View className="rounded-pill bg-warn-soft px-2.5 py-1.5"><Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.warnInk }}>Pending</Text></View>;
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
  const { loading, conn, refresh, connectSquare, connectChannel, disconnect } = useChannels();
  const [refreshing, setRefreshing] = useState(false);
  async function onRefresh() { setRefreshing(true); await refresh(); setRefreshing(false); }
  const [sheet, setSheet] = useState<ProviderId | null>(null);
  const [disconnectId, setDisconnectId] = useState<ProviderId | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const disconnectMeta = disconnectId ? PROVIDERS.find((p) => p.id === disconnectId) : null;
  async function doDisconnect() {
    if (!disconnectId || disconnecting) return;
    setDisconnecting(true);
    await disconnect(disconnectId);
    setDisconnecting(false);
    setDisconnectId(null);
  }

  const channelsConnected = conn.instagram.state === "connected" ? 1 : 0;
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
          <ChannelDot ch={id as "instagram" | "whatsapp" | "messenger" | "sms"} size={42} />
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
            {info.state === "connected"
              ? info.label ?? "Connected"
              : info.state === "pending"
                ? "Awaiting verification — usually 7–15 days"
                : meta.sub}
          </Text>
        </View>
        {info.state === "pending" ? (
          // OA verification in review — no connect action yet, honest status.
          <StatePill state="pending" />
        ) : info.state === "connected" ? (
          <Pressable
            onPress={() => setDisconnectId(id)}
            accessibilityRole="button"
            accessibilityLabel={`Disconnect ${meta.name}`}
            className="flex-row items-center active:opacity-70"
            style={{ minHeight: 44, gap: 7 }}
          >
            <StatePill state="connected" />
            <Icon name="chevR" size={15} color={colors.ink4} />
          </Pressable>
        ) : info.state === "connecting" ? (
          <View className="flex-row items-center rounded-control bg-bg-warm px-3.5" style={{ height: 36 }}>
            <ActivityIndicator size="small" color={colors.ink3} />
          </View>
        ) : (id === "sms" && !SMS_LIVE) || (id === "whatsapp" && !WHATSAPP_LIVE) || (id === "messenger" && !MESSENGER_LIVE) ? (
          // Channel provider not set up yet — honest "Coming soon", no connect action.
          <View className="rounded-pill bg-bg-warm px-2.5 py-1.5"><Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.ink4 }}>Coming soon</Text></View>
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
    // Only inset the top in gated (onboarding) mode — in Settings the parent
    // screen already renders a header below the safe area, so adding the inset
    // here created the big empty gap at the top.
    <View className="flex-1 bg-bg" style={{ paddingTop: gated ? insets.top : 0 }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: gated ? 20 : 12, paddingBottom: insets.bottom + (gated ? 140 : 40) }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink4} />}
      >
        {gated ? (
          <>
            <Text variant="eyebrow" className="text-ink-4">Step 2 of 2</Text>
            <Text variant="display" className="mt-2">Connect your accounts</Text>
            <Text variant="body" className="mt-2 text-ink-3">
              Kasa needs your booking calendar and at least one message channel to get going.
            </Text>
            <View className="mt-5 flex-row items-center rounded-card border border-line bg-surface p-4" style={{ gap: 12 }}>
              <View className="h-[7px] flex-1 overflow-hidden rounded-pill bg-bg-warm">
                <View className="h-full rounded-pill bg-plum" style={{ width: `${(done / 2) * 100}%` }} />
              </View>
              <Text tabular style={{ fontSize: 12.5, fontFamily: "Inter_700Bold", color: colors.ink2 }}>{done}/2</Text>
            </View>
          </>
        ) : null}

        <Text className={`${gated ? "mt-5" : ""} mb-2.5 px-1 text-ink-4`} style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>BOOKING</Text>
        <View className="overflow-hidden rounded-card border border-line bg-surface">
          <ConnRow id="square" />
        </View>

        <Text className="mt-5 mb-2.5 px-1 text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.5 }}>MESSAGE CHANNELS</Text>
        <View className="overflow-hidden rounded-card border border-line bg-surface">
          <ConnRow id="instagram" />
          <ConnRow id="whatsapp" />
          <ConnRow id="messenger" />
          <ConnRow id="sms" />
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
              {ready ? "Enter Kasa →" : "Connect Square + Instagram"}
            </Text>
          </Pressable>
          <Text className="mt-2.5 text-center text-ink-4" style={{ fontSize: 12.5, lineHeight: 18 }}>
            {ready
              ? "More channels coming after launch."
              : "Instagram needs a Professional account linked to a Facebook Page."}
          </Text>
        </View>
      ) : null}

      <ConnectSheet provider={sheet} onClose={() => setSheet(null)} onConnect={onConnectFromSheet} />

      <ConfirmDialog
        visible={!!disconnectId}
        title={`Disconnect ${disconnectMeta?.name ?? ""}?`}
        message={
          disconnectId === "square"
            ? "Kasa won't be able to read availability or create bookings until you reconnect."
            : "You'll stop receiving new messages from this channel in Kasa until you reconnect."
        }
        confirmLabel={disconnecting ? "Disconnecting…" : "Disconnect"}
        cancelLabel="Keep connected"
        destructive
        onConfirm={doDisconnect}
        onCancel={() => { if (!disconnecting) setDisconnectId(null); }}
      />
    </View>
  );
}
