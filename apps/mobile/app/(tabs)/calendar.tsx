import { Screen, ScreenHeader } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { View } from "react-native";

// Calendar — placeholder; full screen built in a later step.
export default function CalendarScreen() {
  return (
    <Screen>
      <ScreenHeader title="Calendar" />
      <View className="px-gutter">
        <Text variant="body">Calendar screen — coming next.</Text>
      </View>
    </Screen>
  );
}
