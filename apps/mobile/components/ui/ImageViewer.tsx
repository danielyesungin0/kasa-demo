// Fullscreen image viewer — tap a chat photo to open it full-bleed on a dark
// backdrop; tap anywhere or the close button to dismiss. expo-image for fast
// cached decode.
import { Modal, View, Pressable, Dimensions } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./Icon";

export function ImageViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get("window");
  return (
    <Modal visible={!!url} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable className="flex-1" style={{ backgroundColor: "rgba(0,0,0,0.94)" }} onPress={onClose}>
        {url ? (
          <Image
            source={{ uri: url }}
            style={{ width, height: height - insets.top - insets.bottom, marginTop: insets.top }}
            contentFit="contain"
            transition={150}
          />
        ) : null}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          style={{ position: "absolute", top: insets.top + 10, right: 18, width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="x" size={20} color="#fff" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
