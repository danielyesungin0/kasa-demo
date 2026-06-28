import { Screen, ScreenHeader } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { View } from "react-native";

// More — placeholder; full screen built in a later step.
export default function MoreScreen() {
  return (
    <Screen>
      <ScreenHeader title="More" />
      <View className="px-gutter">
        <Text variant="body">More screen — coming next.</Text>
      </View>
    </Screen>
  );
}
