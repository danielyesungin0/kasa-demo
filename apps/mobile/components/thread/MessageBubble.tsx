// Message row — left/right bubbles per DESIGN.md §7:
//   incoming = surface + hairline, ink text; outgoing = accent-strong, white.
//   note = centered dashed pill (internal note, never sent).
// Honest send state: outgoing shows "Sending…" while optimistic and "Failed —
// tap to retry" on failure. NO delivered/read (real delivery is a Phase-4 stub).
import { View, Pressable } from "react-native";
import { Image } from "expo-image";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";
import { parseMedia } from "@/lib/media";
import type { ThreadMessage } from "@/lib/useThread";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function MessageBubble({
  msg,
  onRetry,
  onOpenImage,
}: {
  msg: ThreadMessage;
  onRetry?: (msg: ThreadMessage) => void;
  onOpenImage?: (url: string) => void;
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
        {/* media — real images render as tappable thumbnails (→ fullscreen);
            video shows a poster with a play badge; other files show a chip. */}
        {(() => {
          const media = parseMedia(msg.media);
          if (media.length === 0) return null;
          return (
            <View className={`mb-1.5 flex-row flex-wrap ${out ? "justify-end" : ""}`} style={{ gap: 5 }}>
              {media.map((m, i) => {
                if (m.type === "image") {
                  return (
                    <Pressable key={i} onPress={() => onOpenImage?.(m.url)} accessibilityRole="imagebutton" accessibilityLabel="Photo">
                      <Image
                        source={{ uri: m.url }}
                        style={{ width: 168, height: 168, borderRadius: 16, backgroundColor: colors.bgWarm }}
                        contentFit="cover"
                        transition={120}
                      />
                    </Pressable>
                  );
                }
                if (m.type === "video") {
                  return (
                    <Pressable key={i} onPress={() => onOpenImage?.(m.url)} accessibilityRole="button" accessibilityLabel="Video"
                      className="items-center justify-center rounded-2xl" style={{ width: 168, height: 168, backgroundColor: "#000" }}>
                      <View className="items-center justify-center rounded-full" style={{ width: 46, height: 46, backgroundColor: "rgba(255,255,255,0.85)" }}>
                        <Icon name="send" size={20} color={colors.ink} />
                      </View>
                    </Pressable>
                  );
                }
                return (
                  <View key={i} className="flex-row items-center rounded-control bg-surface-2 px-3 py-2" style={{ gap: 7 }}>
                    <Icon name="ext" size={15} color={colors.ink3} />
                    <Text className="text-ink-2" style={{ fontSize: 13 }}>Attachment</Text>
                  </View>
                );
              })}
            </View>
          );
        })()}

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
