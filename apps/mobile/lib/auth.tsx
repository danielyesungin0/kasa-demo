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

  // Google via expo-auth-session → Supabase signInWithIdToken. The actual
  // provider redirect/config is a TODO(oauth): needs the Google client IDs +
  // Supabase Google provider enabled. Wired in Phase 4 alongside the other
  // external-OAuth seams. Until then this returns a clear not-configured error
  // rather than a fake success.
  async function signInWithGoogle(): Promise<AuthResult> {
    // TODO(oauth): implement the Google AuthSession flow + supabase
    // signInWithIdToken({ provider: 'google', token }). Requires GOOGLE_*
    // client IDs and the Supabase Google provider enabled.
    const _redirect = AuthSession.makeRedirectUri({ scheme: "kasa" });
    void _redirect;
    return { error: "Google sign-in isn't configured yet (Phase 4)." };
  }

  // Apple via expo-apple-authentication (native) → Supabase signInWithIdToken.
  // The native credential request works now; exchanging it needs the Supabase
  // Apple provider enabled — TODO(oauth). Honest error until then.
  async function signInWithApple(): Promise<AuthResult> {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) return { error: "No Apple identity token." };
      // TODO(oauth): supabase.auth.signInWithIdToken({ provider: 'apple',
      // token: credential.identityToken }) once the Apple provider is enabled.
      return { error: "Apple sign-in isn't configured yet (Phase 4)." };
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
