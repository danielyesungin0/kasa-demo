import { useRouter } from "expo-router";
import { ChannelsScreen } from "@/components/onboarding/ChannelsScreen";

// Onboarding entry — the GATED connect-accounts screen. Same component as
// Settings → Channels, but here it enforces the gate (Square + >=1 channel) and
// shows the "Enter Kasa" button. On ready, route to the app; the root guard's
// gate (real channels table) will then keep the stylist in (tabs).
export default function OnboardingConnect() {
  const router = useRouter();
  return <ChannelsScreen gated onReady={() => router.replace("/(tabs)")} />;
}
