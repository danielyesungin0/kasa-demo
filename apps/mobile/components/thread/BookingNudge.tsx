// Booking nudge (DESIGN.md §7, AI_BEHAVIOR.md). Dismissible plum card shown
// ONLY when conversations.intent='booking' AND intent_payload has a concrete
// service or time. Reads real data; fails quiet (renders nothing otherwise).
// Tapping "Book" opens the Book sheet pre-filled — wired to a placeholder until
// the sheet exists (later in the build order). Copy never claims the AI booked.
import { View, Pressable } from "react-native";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";
import type { IntentPayload } from "@/lib/types";

/** The label the nudge leads with: prefer a concrete time, else the service. */
function nudgeLabel(p: IntentPayload): string | null {
  if (p.candidate_times && p.candidate_times.length > 0) return p.candidate_times[0];
  if (p.preferred) return p.preferred;
  if (p.service_guess) return p.service_guess;
  return null;
}

/** True only when there's something concrete to act on. */
export function shouldShowNudge(
  intent: string,
  payload: IntentPayload | null,
): payload is IntentPayload {
  if (intent !== "booking" || !payload) return false;
  const hasService = !!payload.service_guess;
  const hasTime =
    !!payload.preferred || (payload.candidate_times?.length ?? 0) > 0;
  return hasService || hasTime;
}

export function BookingNudge({
  payload,
  firstName,
  onBook,
  onDismiss,
}: {
  payload: IntentPayload;
  firstName: string;
  onBook: () => void;
  onDismiss: () => void;
}) {
  const label = nudgeLabel(payload);
  if (!label) return null;
  return (
    <View
      className="mb-2 flex-row items-center rounded-[14px] bg-plum-soft px-3.5 py-3"
      style={{ gap: 10, marginHorizontal: 14 }}
    >
      <View className="items-center justify-center rounded-[9px] bg-plum-strong" style={{ width: 28, height: 28 }}>
        <Icon name="calendar" size={15} color="#fff" />
      </View>
      <Text className="flex-1" style={{ fontSize: 12.5, lineHeight: 17, color: colors.plumInk }}>
        Sounds like <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.plumInk }}>{label}</Text> could work — book {firstName} in?
      </Text>
      <Pressable
        onPress={onBook}
        accessibilityRole="button"
        accessibilityLabel={`Book ${firstName}`}
        className="rounded-[10px] bg-plum-strong px-4 py-2"
      >
        <Text className="text-white" style={{ fontSize: 13, fontFamily: "Inter_600SemiBold" }}>Book</Text>
      </Pressable>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss suggestion"
        className="items-center justify-center rounded-full"
        style={{ width: 24, height: 24, backgroundColor: "rgba(126,100,136,0.14)" }}
      >
        <Icon name="x" size={14} color={colors.plum} />
      </Pressable>
    </View>
  );
}
