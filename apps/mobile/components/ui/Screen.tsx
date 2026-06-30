// Screen scaffold: paper background, top safe-area inset, and bottom padding so
// content clears the floating tab bar (≈ tab height + bottom inset). DESIGN.md
// §5 — the tab bar must never cover content.
import { View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";

const TAB_BAR_HEIGHT = 60;

export function Screen({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const bottomPad = TAB_BAR_HEIGHT + insets.bottom + 12;

  if (!scroll) {
    return (
      <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

// Sticky-style screen title row (Inbox/Clients/etc.). Calendar/Today have
// bespoke headers; this is the common one.
export function ScreenHeader({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between px-gutter pb-3 pt-3">
      <Text variant="title">{title}</Text>
      {right}
    </View>
  );
}
