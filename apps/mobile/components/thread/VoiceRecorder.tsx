// VoiceRecorder — a small modal overlay for recording a voice memo to send.
// Starts recording on open, shows an elapsed timer + pulsing dot, and lets the
// stylist Cancel (discard) or Send (stop → hand the local file up to be uploaded
// + sent). Uses expo-audio.
import { useEffect, useRef, useState } from "react";
import { Modal, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useAudioRecorder, useAudioRecorderState, RecordingPresets,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from "expo-audio";
import { Text } from "@/components/ui/Text";
import { Icon } from "@/components/ui/Icon";
import { TypingDots } from "@/components/ui/TypingDots";
import { colors } from "@/theme/colors";

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceRecorder({
  visible,
  onCancel,
  onSend,
}: {
  visible: boolean;
  onCancel: () => void;
  onSend: (uri: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);
  const [denied, setDenied] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!visible) { started.current = false; return; }
    (async () => {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { setDenied(true); return; }
      setDenied(false);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      started.current = true;
    })();
  }, [visible]);

  async function stopAndSend() {
    if (!started.current) { onCancel(); return; }
    await recorder.stop();
    const uri = recorder.uri;
    if (uri) onSend(uri); else onCancel();
  }
  async function cancel() {
    if (started.current) { try { await recorder.stop(); } catch { /* ignore */ } }
    onCancel();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={cancel} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,16,12,0.4)" }}>
        <View className="rounded-t-card bg-surface px-gutter pt-5" style={{ paddingBottom: insets.bottom + 16 }}>
          {denied ? (
            <View className="items-center" style={{ gap: 12, paddingVertical: 12 }}>
              <Icon name="alert" size={28} color={colors.warnInk} />
              <Text className="text-center text-ink-2" style={{ fontSize: 14 }}>
                Microphone access is off. Enable it in Settings to record voice messages.
              </Text>
              <Pressable onPress={cancel} className="mt-1 rounded-control-lg border border-line-2 px-5 py-2.5">
                <Text style={{ fontSize: 14.5, fontFamily: "Inter_600SemiBold", color: colors.ink }}>Close</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View className="items-center" style={{ gap: 10, paddingVertical: 8 }}>
                <View className="flex-row items-center" style={{ gap: 9 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.err }} />
                  <Text tabular style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: colors.ink }}>
                    {fmt(state.durationMillis ?? 0)}
                  </Text>
                </View>
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <Text className="text-ink-3" style={{ fontSize: 12.5 }}>Recording</Text>
                  <TypingDots color={colors.ink4} size={4} />
                </View>
              </View>

              <View className="mt-5 flex-row" style={{ gap: 10 }}>
                <Pressable onPress={cancel} accessibilityRole="button"
                  className="flex-1 items-center justify-center rounded-control-lg border border-line-2 bg-surface" style={{ height: 52 }}>
                  <Text style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold", color: colors.ink }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={stopAndSend} accessibilityRole="button"
                  className="flex-1 flex-row items-center justify-center rounded-control-lg bg-accent-strong" style={{ height: 52, gap: 8 }}>
                  <Icon name="send" size={17} color="#fff" />
                  <Text className="text-white" style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold" }}>Send</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
