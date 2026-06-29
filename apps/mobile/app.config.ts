// Single Expo config. Static app settings + dynamic `extra` injecting the
// Supabase URL + anon key (public, safe on a client) from EXPO_PUBLIC_* env,
// read by lib/supabase.ts. Real values live in apps/mobile/.env (gitignored);
// names are documented at the repo-root .env.example.
import type { ExpoConfig } from "expo/config";
import { withEntitlementsPlist, type ConfigPlugin } from "expo/config-plugins";

// expo-apple-authentication auto-injects the "Sign In with Apple" entitlement,
// which FREE (Personal) Apple dev teams can't provision — it blocks device dev
// builds. We're not using Apple auth yet (it's a Phase-4 stub), so strip the
// entitlement during prebuild. Survives ios/ regeneration. When Apple Sign-In
// goes live on a paid team, remove this plugin.
const stripAppleSignIn: ConfigPlugin = (cfg) =>
  withEntitlementsPlist(cfg, (c) => {
    delete c.modResults["com.apple.developer.applesignin"];
    return c;
  });

const baseConfig: ExpoConfig = {
  name: "Kasa",
  slug: "kasa",
  scheme: "kasa",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  ios: { supportsTablet: false, bundleIdentifier: "com.danielyesung.kasa" },
  android: { package: "com.danielyesung.kasa" },
  web: { bundler: "metro", output: "single" },
  plugins: ["expo-router", "expo-font"],
  experiments: { typedRoutes: true },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  },
};

export default stripAppleSignIn(baseConfig);
