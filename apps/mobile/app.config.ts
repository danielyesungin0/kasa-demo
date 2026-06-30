// Single Expo config. Static app settings + dynamic `extra` injecting the
// Supabase URL + anon key (public, safe on a client) from EXPO_PUBLIC_* env,
// read by lib/supabase.ts. Real values live in apps/mobile/.env (gitignored);
// names are documented at the repo-root .env.example.
import type { ExpoConfig } from "expo/config";

// Apple Sign-In entitlement (from expo-apple-authentication) is left in place —
// the paid Apple Developer team (JFKTQFD4M3) can provision it. (Previously
// stripped because free Personal teams can't; that plugin was removed once the
// account went paid.)

const baseConfig: ExpoConfig = {
  name: "Kasa",
  slug: "kasa",
  scheme: "kasa",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.danielyesung.kasa",
  },
  android: { package: "com.danielyesung.kasa" },
  web: { bundler: "metro", output: "single" },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-video", // still needed to RENDER videos clients send us (inbound)
    [
      "expo-image-picker",
      {
        photosPermission: "Kasa needs access to your photos so you can send images to clients.",
        cameraPermission: "Kasa needs access to your camera so you can take and send photos to clients.",
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  },
};

export default baseConfig;
