// Inbox row — matches the prototype .conv-row: leading unread dot, avatar with
// a filled channel dot, name (bold when unread), 1-line snippet, time, and a
// small plum calendar glyph when the thread has a booking. Swipe → Read /
// Archive (gesture-handler Swipeable). Row + actions use exact tokens.
import { View, Pressable } from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { ChannelDot } from "@/components/ui/ChannelDot";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";
import { inboxTime } from "@/lib/time";
import type { InboxItem } from "@/lib/types";

function RightActions({
  onRead,
  onArchive,
}: {
  onRead: () => void;
  onArchive: () => void;
}) {
  return (
    <View className="flex-row">
      <Pressable
        onPress={onRead}
        accessibilityRole="button"
        accessibilityLabel="Mark read"
        className="items-center justify-center gap-1 bg-blue"
        style={{ width: 74 }}
      >
        <Icon name="check" size={17} color="#fff" />
        <Text className="text-[11px] font-semibold text-white">Read</Text>
      </Pressable>
      <Pressable
        onPress={onArchive}
        accessibilityRole="button"
        accessibilityLabel="Archive"
        className="items-center justify-center gap-1 bg-ink-3"
        style={{ width: 74 }}
      >
        <Icon name="archive" size={17} color="#fff" />
        <Text className="text-[11px] font-semibold text-white">Archive</Text>
      </Pressable>
    </View>
  );
}

export function InboxRow({
  item,
  onOpen,
  onRead,
  onArchive,
  showDivider,
}: {
  item: InboxItem;
  onOpen: () => void;
  onRead: () => void;
  onArchive: () => void;
  showDivider: boolean;
}) {
  const unread = item.unread;
  return (
    <Swipeable
      renderRightActions={() => (
        <RightActions onRead={onRead} onArchive={onArchive} />
      )}
      overshootRight={false}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Conversation with ${item.client.name}`}
        className="flex-row items-center bg-surface active:bg-surface-2"
        style={{ paddingVertical: 14, paddingLeft: 12, paddingRight: 18, gap: 12, minHeight: 72 }}
      >
        {/* leading unread dot (fixed 10px gutter so the divider lines up) */}
        <View style={{ width: 10, alignItems: "center" }}>
          {unread ? (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />
          ) : null}
        </View>

        {/* avatar + channel dot bottom-right */}
        <View style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
          <Avatar name={item.client.name} size={46} />
          <View
            style={{
              position: "absolute",
              right: -2,
              bottom: -2,
              borderWidth: 2.5,
              borderColor: colors.surface,
              borderRadius: 999,
              backgroundColor: colors.surface,
            }}
          >
            <ChannelDot ch={item.channel_type} size={18} />
          </View>
        </View>

        {/* main */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <Text
              numberOfLines={1}
              className={unread ? "text-ink" : "text-ink"}
              style={{
                fontSize: 15,
                flexShrink: 1,
                fontFamily: unread ? "Inter_700Bold" : "Inter_500Medium",
              }}
            >
              {item.client.name}
            </Text>
            <View className="flex-row items-center" style={{ gap: 5 }}>
              {item.hasBooking ? (
                <Icon name="calendar" size={12} color={colors.plum} strokeWidth={2} />
              ) : null}
              <Text tabular className="text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_500Medium" }}>
                {inboxTime(item.last_message_at)}
              </Text>
            </View>
          </View>
          <Text numberOfLines={1} className="text-ink-3" style={{ fontSize: 13.5, marginTop: 3 }}>
            {item.snippet}
          </Text>
        </View>
      </Pressable>
      {showDivider ? (
        <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 82 }} />
      ) : null}
    </Swipeable>
  );
}
