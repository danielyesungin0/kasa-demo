import { useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import * as AppleAuthentication from "expo-apple-authentication";
import { Text } from "@/components/ui/Text";
import { useAuth } from "@/lib/auth";
import { colors } from "@/theme/colors";

// Official multicolor Google "G".
const GOOGLE_G =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 9.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 3.18 29.93 1 24 1 15.4 1 7.96 5.93 4.34 13.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const {
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInWithApple,
    appleAvailable,
  } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signup = mode === "signup";

  async function submitEmail() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    const { error } = signup
      ? await signUpWithEmail(email.trim(), password)
      : await signInWithEmail(email.trim(), password);
    setBusy(false);
    if (error) setError(error);
    // On success the auth listener flips session → the guard routes onward.
  }

  async function google() {
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) setError(error);
  }
  async function apple() {
    setError(null);
    const { error } = await signInWithApple();
    if (error) setError(error);
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* logo + heading */}
        <View className="items-center" style={{ gap: 14, marginTop: 10 }}>
          <View
            className="items-center justify-center rounded-[20px]"
            style={{ width: 62, height: 62, backgroundColor: colors.accentStrong }}
          >
            <Text style={{ fontFamily: "Fraunces_600SemiBold", color: "#fff", fontSize: 34, lineHeight: 38 }}>K</Text>
          </View>
          <View className="items-center px-gutter">
            <Text variant="display" className="text-center">{signup ? "Create your Kasa" : "Welcome back"}</Text>
            <Text variant="body" className="mt-1.5 text-center text-ink-3" style={{ maxWidth: 280 }}>
              One calm inbox for every client message — and your books.
            </Text>
          </View>
        </View>

        <View className="px-gutter" style={{ marginTop: 26 }}>
          <Text className="mt-4 text-ink-2" style={{ fontSize: 12.5, fontFamily: "Inter_600SemiBold" }}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="shen@studio.com"
            placeholderTextColor={colors.ink4}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            className="mt-2 rounded-control-lg border border-line-2 bg-surface px-4 text-body text-ink"
            style={{ height: 52, fontFamily: "Inter_400Regular" }}
          />
          <Text className="mt-4 text-ink-2" style={{ fontSize: 12.5, fontFamily: "Inter_600SemiBold" }}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.ink4}
            secureTextEntry
            autoComplete={signup ? "new-password" : "current-password"}
            className="mt-2 rounded-control-lg border border-line-2 bg-surface px-4 text-body text-ink"
            style={{ height: 52, fontFamily: "Inter_400Regular" }}
          />

          {error ? (
            <Text className="mt-3 text-err-ink" style={{ fontSize: 13 }}>{error}</Text>
          ) : null}

          {/* primary */}
          <Pressable
            onPress={submitEmail}
            disabled={busy}
            accessibilityRole="button"
            className="mt-5 flex-row items-center justify-center rounded-control-lg bg-accent-strong"
            style={{ height: 52, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white" style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold" }}>
                {signup ? "Create account" : "Sign in"}
              </Text>
            )}
          </Pressable>

          {/* divider */}
          <View className="my-5 flex-row items-center" style={{ gap: 12 }}>
            <View className="h-px flex-1 bg-line-2" />
            <Text className="text-ink-4" style={{ fontSize: 12, fontFamily: "Inter_600SemiBold" }}>OR</Text>
            <View className="h-px flex-1 bg-line-2" />
          </View>

          {/* Google (official mark) */}
          <Pressable
            onPress={google}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            className="mb-3 flex-row items-center justify-center rounded-control-lg border border-line-2 bg-surface"
            style={{ height: 52, gap: 10 }}
          >
            <SvgXml xml={GOOGLE_G} width={18} height={18} />
            <Text className="text-ink" style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold" }}>
              Continue with Google
            </Text>
          </Pressable>

          {/* Apple (official native button; required on iOS since we offer Google) */}
          {Platform.OS === "ios" && appleAvailable ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={14}
              style={{ height: 52, width: "100%" }}
              onPress={apple}
            />
          ) : null}

          {/* toggle */}
          <View className="mt-5 flex-row items-center justify-center">
            <Text className="text-ink-3" style={{ fontSize: 13 }}>
              {signup ? "Already have an account? " : "New to Kasa? "}
            </Text>
            <Pressable onPress={() => { setMode(signup ? "signin" : "signup"); setError(null); }} accessibilityRole="button">
              <Text className="text-accent-ink" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>
                {signup ? "Sign in" : "Create one"}
              </Text>
            </Pressable>
          </View>

          {/* the two-logins helper (from the prototype) */}
          <Text className="mt-5 text-center text-ink-4" style={{ fontSize: 12.5, lineHeight: 18 }}>
            Sign-in is handled by Supabase Auth.{"\n"}
            Connecting Instagram / WhatsApp / Square comes next — that's separate from logging in.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
