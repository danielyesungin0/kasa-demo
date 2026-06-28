import { Tabs } from "expo-router";
import { View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Sun,
  Inbox as InboxIcon,
  Calendar,
  Users,
  Menu,
  type LucideIcon,
} from "lucide-react-native";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";

const TABS: { name: string; label: string; icon: LucideIcon }[] = [
  { name: "index", label: "Today", icon: Sun },
  { name: "inbox", label: "Inbox", icon: InboxIcon },
  { name: "calendar", label: "Calendar", icon: Calendar },
  { name: "clients", label: "Clients", icon: Users },
  { name: "more", label: "More", icon: Menu },
];

// Custom tab bar matching the prototype: white bar, top hairline, active tab in
// accent-strong, ≥44pt targets, padded by the bottom safe-area inset (§5).
function TabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="absolute inset-x-0 bottom-0 z-10 flex-row border-t border-line bg-surface"
      style={{ paddingBottom: insets.bottom }}
    >
      {state.routes.map((route: any, index: number) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const focused = state.index === index;
        const Icon = tab.icon;
        const tint = focused ? colors.accentStrong : colors.ink4;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={tab.label}
            onPress={() => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
            // ≥44pt tap target (min height) per DESIGN.md §5.
            className="flex-1 items-center justify-center gap-1 pt-2.5 pb-2"
            style={{ minHeight: 44 }}
          >
            <Icon size={22} color={tint} strokeWidth={1.8} />
            <Text
              variant="label"
              maxScale={1.2}
              className="text-[10.5px] normal-case tracking-normal"
              style={{ color: tint, fontFamily: "Inter_600SemiBold" }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="calendar" />
      <Tabs.Screen name="clients" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}
