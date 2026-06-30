import { useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { ChannelDot } from "@/components/ui/ChannelDot";
import { Text } from "@/components/ui/Text";
import { Skeleton, ThreadSkeleton } from "@/components/ui/Skeleton";
import { Composer } from "@/components/thread/Composer";
import { MessageBubble } from "@/components/thread/MessageBubble";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { BookingNudge, shouldShowNudge } from "@/components/thread/BookingNudge";
import { useThread, type ThreadMessage } from "@/lib/useThread";
import { takePendingBooking } from "@/lib/bookingResult";
import { useToast } from "@/components/ui/Toast";
import { channelState } from "@/lib/channelState";
import { sendMessage } from "@/lib/sendMessage";
import { channels } from "@/theme/colors";
import { colors } from "@/theme/colors";

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const listRef = useRef<FlatList>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [seededDraft, setSeededDraft] = useState<string | null>(null);
  // Measure the real header height so KeyboardAvoidingView's offset is exact
  // (a hardcoded guess left a gap between the keyboard and the input).

  const { convo, messages, loading, appendOptimistic, reconcile, dropOptimistic } =
    useThread(id);
  // After booking we return here (the modal dismisses back to THIS thread — no
  // duplicate). On focus, consume the pending result: show the toast, seed the
  // confirmation draft for review, and dismiss the nudge (its job is done).
  const [dismissedNudge, setDismissedNudge] = useState(false);
  const [windowBanner, setWindowBanner] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const pending = takePendingBooking();
      if (pending && pending.conversationId === id) {
        toast.show(pending.toast);
        if (pending.draft) setSeededDraft(pending.draft);
        setDismissedNudge(true);
      }
    }, [id]),
  );

  const chState = useMemo(
    () => (convo ? channelState(convo.channel_type, convo.window_expires_at) : null),
    [convo],
  );

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  async function doSend(text: string) {
    const tempId = appendOptimistic(text);
    scrollToEnd();
    const result = await sendMessage(id, text);
    if (result.ok) {
      reconcile(tempId, "sent");
    } else if (result.blocked) {
      // Honest closed-window: remove the optimistic bubble, surface the state.
      dropOptimistic(tempId);
      const label = result.channel ? channels[result.channel as keyof typeof channels].label : "the channel";
      setWindowBanner(`Reply window closed — open ${label} to continue.`);
    } else {
      reconcile(tempId, "failed");
    }
  }

  function retry(msg: ThreadMessage) {
    if (!msg.body) return;
    dropOptimistic(msg._tempId ?? msg.id);
    void doSend(msg.body);
  }

  function openExternal() {
    // Open the client's conversation in the native channel app where we can.
    // Instagram: deep-link to the profile by handle. Others: no reliable public
    // deep link yet (Phase 4), so do nothing rather than open a blank page.
    const handle = convo?.client?.instagram_handle?.replace(/^@/, "");
    if (convo?.channel_type === "instagram" && handle) {
      const appUrl = `instagram://user?username=${handle}`;
      const webUrl = `https://instagram.com/${handle}`;
      Linking.canOpenURL(appUrl)
        .then((ok) => Linking.openURL(ok ? appUrl : webUrl))
        .catch(() => Linking.openURL(webUrl).catch(() => {}));
    }
  }

  if (loading || !convo) {
    return (
      <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
        {/* minimal header (back) + a chat skeleton instead of a blank screen */}
        <View className="flex-row items-center border-b border-line px-3.5" style={{ minHeight: 54, gap: 8, paddingVertical: 9 }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" className="items-center justify-center rounded-full active:bg-bg-warm" style={{ width: 42, height: 42 }}>
            <Icon name="back" size={22} color={colors.ink} />
          </Pressable>
          <Skeleton width={32} height={32} radius={16} />
          <Skeleton width={120} height={14} radius={7} />
        </View>
        <ThreadSkeleton />
      </View>
    );
  }

  const firstName = convo.client.name.split(" ")[0];
  const showNudge =
    !dismissedNudge &&
    chState?.canSend &&
    shouldShowNudge(convo.intent, convo.intent_payload);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg"
      style={{ paddingTop: insets.top }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* nav header: back · tappable name→profile · client-details */}
      <View className="flex-row items-center border-b border-line px-3.5" style={{ minHeight: 54, gap: 8, paddingVertical: 9 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" className="items-center justify-center rounded-full active:bg-bg-warm" style={{ width: 42, height: 42 }}>
          <Icon name="back" size={22} color={colors.ink} />
        </Pressable>
        <Pressable
          onPress={() => router.push(`/client/${convo.client_id}`)}
          accessibilityRole="button"
          accessibilityLabel={`${convo.client.name} profile`}
          className="flex-1 flex-row items-center"
          style={{ gap: 10, minWidth: 0 }}
        >
          <Avatar name={convo.client.name} size={32} />
          <View style={{ minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold", color: colors.ink }}>
              {convo.client.name}
            </Text>
            <View className="flex-row items-center" style={{ gap: 5 }}>
              <ChannelDot ch={convo.channel_type} size={12} />
              <Text className="text-ink-3" style={{ fontSize: 12 }}>
                {channels[convo.channel_type].label}
              </Text>
            </View>
          </View>
        </Pressable>
        <Pressable onPress={() => router.push(`/client/${convo.client_id}`)} accessibilityRole="button" accessibilityLabel="Client details" className="items-center justify-center rounded-full active:bg-bg-warm" style={{ width: 40, height: 40 }}>
          <Icon name="user" size={20} color={colors.ink2} />
        </Pressable>
      </View>

      <View className="flex-1">
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 14 }}
          renderItem={({ item }) => <MessageBubble msg={item} onRetry={retry} onOpenImage={setViewerUrl} />}
          onContentSizeChange={scrollToEnd}
          showsVerticalScrollIndicator={false}
        />

        {/* booking nudge — real intent only, dismissible */}
        {showNudge && convo.intent_payload ? (
          <BookingNudge
            payload={convo.intent_payload}
            firstName={firstName}
            onBook={() => router.push(`/book?conversation=${id}`)} // → Book sheet, prefilled from this conversation's client + intent
            onDismiss={() => setDismissedNudge(true)}
          />
        ) : null}

        {/* closed-window banner (honest) */}
        {!chState?.canSend && chState?.banner ? (
          <View
            className={`mb-2 flex-row rounded-[14px] px-3.5 py-3 ${chState.banner.kind === "err" ? "bg-err-soft" : "bg-warn-soft"}`}
            style={{ gap: 11, marginHorizontal: 14 }}
          >
            <Icon name="clock" size={15} color={chState.banner.kind === "err" ? colors.errInk : colors.warnInk} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 12.5, fontFamily: "Inter_600SemiBold", color: chState.banner.kind === "err" ? colors.errInk : colors.warnInk }}>
                {chState.banner.title}
              </Text>
              <Text style={{ fontSize: 12.5, lineHeight: 17, color: chState.banner.kind === "err" ? colors.errInk : colors.warnInk }}>
                {chState.banner.body}
              </Text>
            </View>
          </View>
        ) : null}

        {windowBanner ? (
          <View className="mb-2 rounded-[14px] bg-warn-soft px-3.5 py-2.5" style={{ marginHorizontal: 14 }}>
            <Text style={{ fontSize: 12.5, color: colors.warnInk }}>{windowBanner}</Text>
          </View>
        ) : null}

        <Composer
          state={chState ?? { canSend: true }}
          onSend={doSend}
          onBook={() => router.push(`/book?conversation=${id}`)} // → Book sheet
          onOpenExternal={openExternal}
          initialDraft={seededDraft}
        />
      </View>
      <ImageViewer url={viewerUrl} onClose={() => setViewerUrl(null)} />
    </KeyboardAvoidingView>
  );
}
