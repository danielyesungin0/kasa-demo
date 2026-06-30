// SearchBar — one consistent search input used across Inbox, Clients, and Book,
// so they stop drifting apart visually. Surface-2 fill, rounded, search glyph,
// clear button. Forwards extra TextInput props (onFocus, autoFocus, etc.).
import { View, TextInput, Pressable, type TextInputProps } from "react-native";
import { Icon } from "./Icon";
import { colors } from "@/theme/colors";

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search",
  ...rest
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
} & Omit<TextInputProps, "value" | "onChangeText" | "placeholder">) {
  return (
    <View
      className="flex-row items-center rounded-control-lg bg-surface-2 px-3.5"
      style={{ height: 44, gap: 9 }}
    >
      <Icon name="search" size={16} color={colors.ink4} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.ink4}
        autoCapitalize="none"
        autoCorrect={false}
        className="flex-1 text-body text-ink"
        style={{ fontFamily: "Inter_400Regular", padding: 0 }}
        {...rest}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="x" size={16} color={colors.ink4} />
        </Pressable>
      ) : null}
    </View>
  );
}
