import { Screen, ScreenHeader } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { View } from "react-native";

// Clients — placeholder; full screen built in a later step.
export default function ClientsScreen() {
  return (
    <Screen>
      <ScreenHeader title="Clients" />
      <View className="px-gutter">
        <Text variant="body">Clients screen — coming next.</Text>
      </View>
    </Screen>
  );
}
