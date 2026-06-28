import { Screen, ScreenHeader } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { View } from "react-native";

// Inbox — placeholder; full screen built in a later step.
export default function InboxScreen() {
  return (
    <Screen>
      <ScreenHeader title="Inbox" />
      <View className="px-gutter">
        <Text variant="body">Inbox screen — coming next.</Text>
      </View>
    </Screen>
  );
}
