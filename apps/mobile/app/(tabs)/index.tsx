import { View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";

// Today — placeholder. Full screen (Fraunces greeting, Today's schedule from the
// same source as Calendar, New messages) is built after the conversation core.
export default function TodayScreen() {
  return (
    <Screen>
      <View className="px-gutter pt-2">
        <Text variant="eyebrow" className="text-accent mb-2">
          Friday · June 27
        </Text>
        <Text variant="display-lg">Good morning,{"\n"}Shen</Text>
        <Text variant="body" className="mt-3">
          Today screen — coming next.
        </Text>
      </View>
    </Screen>
  );
}
