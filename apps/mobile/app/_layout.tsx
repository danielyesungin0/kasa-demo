import "../global.css";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  Fraunces_500Medium,
  Fraunces_600SemiBold,
} from "@expo-google-fonts/fraunces";
import * as SplashScreen from "expo-splash-screen";
import { colors } from "@/theme/colors";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useOnboardingGate } from "@/lib/useOnboardingGate";

SplashScreen.preventAutoHideAsync();

// Route guard — the single place that decides where you land:
//   not signed in            → (auth)
//   signed in, gate unmet     → (onboarding)/connect   (Square + 1 channel)
//   signed in, gate met       → (tabs)
// Connect screen is BOTH the onboarding gate and a Settings destination; the
// onboarding entry enforces the gate (here), the Settings entry won't.
function Guard({ children }: { children: React.ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const gate = useOnboardingGate(!!session);
  const segments = useSegments();
  const router = useRouter();

  // Re-check the gate whenever navigation changes (e.g. tapping "Enter Kasa"
  // after connecting a channel). Without this the gate was computed once on
  // mount and went stale, so the guard bounced the user back to onboarding.
  const group = segments[0];
  useEffect(() => {
    if (session) gate.refresh();
  }, [group, session]);

  useEffect(() => {
    if (authLoading || (session && gate.loading)) return;

    const inAuth = group === "(auth)";
    const inOnboarding = group === "(onboarding)";

    if (!session) {
      if (!inAuth) router.replace("/(auth)/sign-in");
    } else if (!gate.ready) {
      if (!inOnboarding) router.replace("/(onboarding)/connect");
    } else {
      // Signed in + ready: keep them out of auth/onboarding entry screens.
      if (inAuth || inOnboarding) router.replace("/(tabs)");
    }
  }, [session, authLoading, gate.ready, gate.loading, group, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthProvider>
          <Guard>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="thread/[id]" />
              <Stack.Screen name="client/[id]" />
              <Stack.Screen name="settings/channels" />
              <Stack.Screen
                name="book"
                options={{ presentation: "modal" }}
              />
            </Stack>
          </Guard>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
