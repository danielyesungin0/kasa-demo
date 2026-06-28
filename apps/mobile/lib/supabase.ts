// Supabase client for the app. Public anon key + URL only (safe on a client);
// RLS scopes every read to the signed-in stylist. Business logic (availability,
// booking, intent) lives in Edge Functions — the app calls those, never the
// service-role key.
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

// Pulled from app config `extra` (set via app.config or EXPO_PUBLIC_* env).
const SUPABASE_URL = extra.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  extra.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Base URL for Edge Function calls (square-availability, send-message, etc.). */
export const FUNCTIONS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "";
