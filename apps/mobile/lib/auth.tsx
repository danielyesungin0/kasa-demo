// Auth context — the app's single source of truth for "who is signed in".
// Wraps Supabase Auth; the SDK owns session storage (secure), refresh, and
// sign-out. We never hand-roll tokens. Exposes the session + the auth actions
// the screens call. The route guard (app/_layout) reads `session` from here.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import type { Session } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

type AuthResult = { error: string | null };

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signUpWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  signInWithApple: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
  appleAvailable: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
    }
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  }

  // Google via Supabase's hosted OAuth (browser flow). Reuses the Google
  // provider already enabled on the Supabase project — no app-specific Google
  // client IDs needed. Opens the consent page in a web browser and returns to
  // the app via the kasa:// deep link, then sets the session from the URL.
  // Requires the redirect (makeRedirectUri below) to be in the project's
  // Auth → URL Configuration → Redirect URLs.
  async function signInWithGoogle(): Promise<AuthResult> {
    try {
      const redirectTo = AuthSession.makeRedirectUri({ scheme: "kasa", path: "auth-callback" });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) return { error: error.message };
      if (!data?.url) return { error: "Couldn't start Google sign-in." };

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== "success" || !result.url) {
        return { error: null }; // user dismissed/cancelled
      }

      // Exchange the returned URL for a session. Supabase returns either a
      // PKCE ?code= or a #access_token fragment depending on flow.
      const url = result.url;
      const params = new URLSearchParams(url.split("#")[1] ?? "");
      const code = new URL(url).searchParams.get("code");
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        return { error: exErr?.message ?? null };
      }
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
        return { error: setErr?.message ?? null };
      }
      return { error: "Google sign-in didn't return a session." };
    } catch (e: any) {
      return { error: e?.message ?? "Google sign-in failed." };
    }
  }

  // Apple via expo-apple-authentication (native) → Supabase signInWithIdToken.
  // The native credential request works on the paid team; exchanging the
  // identity token needs the Supabase Apple provider enabled (dashboard). If
  // it's not enabled yet, Supabase returns a clear provider error (no fake
  // success).
  async function signInWithApple(): Promise<AuthResult> {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) return { error: "No Apple identity token." };
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });
      return { error: error?.message ?? null };
    } catch (e: any) {
      if (e?.code === "ERR_REQUEST_CANCELED") return { error: null };
      return { error: e?.message ?? "Apple sign-in failed." };
    }
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut(); // SDK clears the secure-stored session
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signInWithApple,
      signOut,
      appleAvailable,
    }),
    [session, loading, appleAvailable],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
