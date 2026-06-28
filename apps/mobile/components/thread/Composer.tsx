// Instagram-style composer (DESIGN.md §7). A rounded bar with:
//   - Book button inside-left (plum) — ALWAYS present, even on closed channels
//   - the text field
//   - a send button that appears ONLY when there's text
// Closed reply window → the field is replaced by "Reply on {Channel}" (Book
// stays). Keyboard handling (rise above keyboard + bottom safe-area when down)
// is owned by the parent's KeyboardAvoidingView; this component just lays out
// the bar and pads the bottom inset.
import { useState } from "react";
import { View, Pressable, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";
import type { ChannelState } from "@/lib/channelState";

export function Composer({
  state,
  onSend,
  onBook,
  onOpenExternal,
}: {
  state: ChannelState;
  onSend: (text: string) => void;
  onBook: () => void;
  onOpenExternal: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const hasText = text.trim().length > 0;

  function handleSend() {
    const t = text.trim();
    if (!t) return;
    setText("");
    onSend(t);
  }

  return (
    <View
      className="border-t border-line bg-surface px-4 pt-2.5"
      style={{ paddingBottom: Math.max(12, insets.bottom) }}
    >
      <View
        className="flex-row items-center rounded-[24px] border border-line bg-bg p-1.5"
        style={{ gap: 7, minHeight: 50 }}
      >
        {/* Book — always present (plum soft circle), >=40pt */}
        <Pressable
          onPress={onBook}
          accessibilityRole="button"
          accessibilityLabel="Book appointment"
          className="items-center justify-center rounded-full bg-plum-soft"
          style={{ width: 40, height: 40 }}
        >
          <Icon name="calendar" size={19} color={colors.plumStrong} />
        </Pressable>

        {state.canSend ? (
          <>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message…"
              placeholderTextColor={colors.ink4}
              multiline
              className="flex-1 text-body text-ink"
              style={{ fontFamily: "Inter_400Regular", maxHeight: 96, paddingHorizontal: 6, paddingVertical: 9 }}
            />
            {hasText ? (
              <Pressable
                onPress={handleSend}
                accessibilityRole="button"
                accessibilityLabel="Send"
                className="items-center justify-center rounded-full bg-accent-strong"
                style={{ width: 40, height: 40 }}
              >
                <Icon name="send" size={18} color="#fff" />
              </Pressable>
            ) : null}
          </>
        ) : (
          // Closed window: swap the field for the honest open-externally CTA.
          <Pressable
            onPress={onOpenExternal}
            accessibilityRole="button"
            accessibilityLabel={state.openLabel}
            className="flex-1 flex-row items-center justify-center rounded-[20px] bg-ink"
            style={{ gap: 7, padding: 11 }}
          >
            <Icon name="ext" size={16} color="#fff" />
            <Text className="text-white" style={{ fontSize: 14, fontFamily: "Inter_600SemiBold" }}>
              {state.openLabel}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
