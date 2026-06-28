// Supabase client for the app. Public anon key + URL only (safe on a client);
// RLS scopes every read to the signed-in stylist. Business logic (availability,
// booking, intent) lives in Edge Functions — the app calls those, never the
// service-role key.
//
// Session persistence: expo-secure-store (Keychain/Keystore), NOT AsyncStorage —
// the JWT is a credential. The Supabase SDK owns session + refresh + sign-out;
// we don't hand-roll any of it. SecureStore caps values at ~2KB, so we chunk.
import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const SUPABASE_URL = extra.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  extra.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

// SecureStore adapter with chunking (SecureStore values are capped ~2KB).
const CHUNK = 1800;
const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const countRaw = await SecureStore.getItemAsync(`${key}__n`);
    if (countRaw == null) return await SecureStore.getItemAsync(key); // unchunked legacy
    const n = parseInt(countRaw, 10);
    let out = "";
    for (let i = 0; i < n; i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`);
      if (part == null) return null;
      out += part;
    }
    return out;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value);
      await SecureStore.deleteItemAsync(`${key}__n`);
      return;
    }
    const parts = Math.ceil(value.length / CHUNK);
    await SecureStore.setItemAsync(`${key}__n`, String(parts));
    for (let i = 0; i < parts; i++) {
      await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    await SecureStore.deleteItemAsync(key);
  },
  async removeItem(key: string): Promise<void> {
    const countRaw = await SecureStore.getItemAsync(`${key}__n`);
    if (countRaw != null) {
      const n = parseInt(countRaw, 10);
      for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${key}__${i}`);
      await SecureStore.deleteItemAsync(`${key}__n`);
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // native; OAuth handled via expo-auth-session
  },
});

// Drive token auto-refresh by app foreground/background (SDK guidance).
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Base URL for Edge Function calls (square-availability, send-message, etc.). */
export const FUNCTIONS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "";
