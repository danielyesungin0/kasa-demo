// Message row — left/right bubbles per DESIGN.md §7:
//   incoming = surface + hairline, ink text; outgoing = accent-strong, white.
//   note = centered dashed pill (internal note, never sent).
// Honest send state: outgoing shows "Sending…" while optimistic and "Failed —
// tap to retry" on failure. NO delivered/read (real delivery is a Phase-4 stub).
import { View, Pressable } from "react-native";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";
import type { ThreadMessage } from "@/lib/useThread";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MessageBubble({
  msg,
  onRetry,
}: {
  msg: ThreadMessage;
  onRetry?: (msg: ThreadMessage) => void;
}) {
  if (msg.direction === "note") {
    return (
      <View className="my-1.5 flex-row items-center self-center rounded-control border border-dashed border-line-2 bg-surface-2 px-3 py-1.5" style={{ gap: 6 }}>
        <Icon name="edit" size={12} color={colors.ink3} />
        <Text className="text-caption italic text-ink-3">{msg.body}</Text>
      </View>
    );
  }

  const out = msg.direction === "out";
  const failed = msg._local === "failed";
  const sending = msg._local === "sending";

  return (
    <View className={`mb-1.5 w-full ${out ? "items-end" : "items-start"}`}>
      <View style={{ maxWidth: "80%" }}>
        {/* photos (media refs render as placeholder tiles, matching prototype) */}
        {Array.isArray(msg.media) && msg.media.length > 0 ? (
          <View className="mb-1.5 flex-row flex-wrap" style={{ gap: 5 }}>
            {msg.media.map((_: unknown, i: number) => (
              <View
                key={i}
                className="items-center justify-center rounded-control"
                style={{ width: 70, height: 70, backgroundColor: out ? "rgba(255,255,255,0.22)" : colors.bgWarm }}
              >
                <Icon name="image" size={18} color={colors.ink4} />
              </View>
            ))}
          </View>
        ) : null}

        {msg.body ? (
          <View
            className={out ? "bg-accent-strong" : "border border-line bg-surface"}
            style={{
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderRadius: 20,
              borderBottomRightRadius: out ? 6 : 20,
              borderBottomLeftRadius: out ? 20 : 6,
            }}
          >
            <Text style={{ fontSize: 15, lineHeight: 22, color: out ? "#fff" : colors.ink, fontFamily: "Inter_400Regular" }}>
              {msg.body}
            </Text>
          </View>
        ) : null}

        {/* meta line: time + honest local state (no delivered/read) */}
        <View className={`mt-1 flex-row items-center ${out ? "justify-end" : ""}`} style={{ gap: 5, marginHorizontal: 6 }}>
          {failed ? (
            <Pressable onPress={() => onRetry?.(msg)} accessibilityRole="button" accessibilityLabel="Retry send" className="flex-row items-center" style={{ gap: 4 }}>
              <Icon name="alert" size={11} color={colors.err} />
              <Text style={{ fontSize: 10.5, color: colors.err, fontFamily: "Inter_500Medium" }}>Failed — tap to retry</Text>
            </Pressable>
          ) : (
            <Text tabular style={{ fontSize: 10.5, color: colors.ink4 }}>
              {sending ? "Sending…" : timeLabel(msg.sent_at)}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
