// SearchBar — one consistent search input used across Inbox, Clients, and Book.
// Has a visible resting border (so it reads as an input, not blended into the
// page) and a clear FOCUS state (accent border + ring + tinted glyph) for
// accessibility. Forwards extra TextInput props (onFocus, autoFocus, etc.).
import { useState } from "react";
import { View, TextInput, Pressable, type TextInputProps } from "react-native";
import { Icon } from "./Icon";
import { colors } from "@/theme/colors";

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search",
  onFocus,
  onBlur,
  ...rest
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
} & Omit<TextInputProps, "value" | "onChangeText" | "placeholder">) {
  const [focused, setFocused] = useState(false);

  return (
    <View
      className="flex-row items-center rounded-control-lg bg-surface"
      style={{
        height: 46,
        gap: 9,
        paddingHorizontal: 13,
        borderWidth: focused ? 2 : 1,
        // -1 horizontal nudge keeps content from shifting when the border grows.
        marginHorizontal: focused ? -1 : 0,
        borderColor: focused ? colors.accent : colors.line2,
        // subtle focus ring
        shadowColor: colors.accent,
        shadowOpacity: focused ? 0.16 : 0,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <Icon name="search" size={17} color={focused ? colors.accent : colors.ink4} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.ink4}
        autoCapitalize="none"
        autoCorrect={false}
        selectionColor={colors.accent}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        className="flex-1 text-body text-ink"
        style={{ fontFamily: "Inter_400Regular", padding: 0 }}
        {...rest}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search"
          className="items-center justify-center rounded-full bg-bg-warm" style={{ width: 20, height: 20 }}>
          <Icon name="x" size={13} color={colors.ink3} />
        </Pressable>
      ) : null}
    </View>
  );
}
