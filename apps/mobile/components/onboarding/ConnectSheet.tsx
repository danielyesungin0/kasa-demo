// Per-platform connect sheets (Square / Instagram) — the realistic flows from
// design/onboarding-reference.html, incl. the help branch "I don't have a
// Professional account" (IG). The actual external OAuth is a TODO(oauth) seam;
// the final "Allow / Continue" button calls the connect action.
import { useEffect, useRef, useState } from "react";
import { View, Pressable, Modal, ScrollView, Animated, Easing, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";

// SMS / WhatsApp / Messenger are included for type-consistency with ProviderId;
// they never open this sheet today (gated to "Coming soon" until a provider is
// set up).
type Provider = "square" | "instagram" | "whatsapp" | "messenger" | "sms";

function Requirement({ text }: { text: React.ReactNode }) {
  return (
    <View className="flex-row border-b border-line py-3" style={{ gap: 12 }}>
      <View className="items-center justify-center rounded-full" style={{ width: 24, height: 24, marginTop: 1, backgroundColor: colors.okSoft }}>
        <Icon name="check" size={13} color={colors.okInk} strokeWidth={3} />
      </View>
      <Text className="flex-1 text-ink-2" style={{ fontSize: 14, lineHeight: 21 }}>{text}</Text>
    </View>
  );
}

function Step({ n, text }: { n: number; text: React.ReactNode }) {
  return (
    <View className="flex-row border-b border-line py-3" style={{ gap: 12 }}>
      <View
        className="items-center justify-center rounded-full"
        style={{ width: 24, height: 24, marginTop: 1, backgroundColor: colors.plumStrong }}
      >
        <Text style={{ fontSize: 12, lineHeight: 24, textAlign: "center", fontFamily: "Inter_700Bold", color: "#fff" }}>{n}</Text>
      </View>
      <Text className="flex-1 text-ink-2" style={{ fontSize: 14, lineHeight: 21 }}>{text}</Text>
    </View>
  );
}

function PrimaryBtn({ label, onPress, bg = colors.accentStrong }: { label: string; onPress: () => void; bg?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="mt-4 items-center justify-center rounded-control-lg" style={{ height: 52, backgroundColor: bg }}>
      <Text className="text-white" style={{ fontSize: 15.5, fontFamily: "Inter_600SemiBold" }}>{label}</Text>
    </Pressable>
  );
}

export function ConnectSheet({
  provider,
  onClose,
  onConnect,
}: {
  provider: Provider | null;
  onClose: () => void;
  onConnect: (p: Provider) => void;
}) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<number>(0);

  if (!provider) return null;

  function finish() {
    onConnect(provider!);
    setStep(0);
    onClose();
  }
  function close() {
    setStep(0);
    onClose();
  }

  return (
    <SheetShell onClose={close} insets={insets}>
      {provider === "square" && <SquareBody step={step} setStep={setStep} finish={finish} close={close} />}
      {provider === "instagram" && <IGBody step={step} setStep={setStep} finish={finish} close={close} />}
    </SheetShell>
  );
}

// Bottom-sheet shell: Modal with animationType="none" (RN's "slide" animates
// the WHOLE modal incl. the scrim — that's the bug). We fade the scrim and
// slide only the sheet via Animated translateY, like a native sheet.
function SheetShell({
  children,
  onClose,
  insets,
}: {
  children: React.ReactNode;
  onClose: () => void;
  insets: { bottom: number };
}) {
  const screenH = Dimensions.get("window").height;
  const translateY = useRef(new Animated.Value(screenH)).current;
  const scrim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrim, { toValue: 1, duration: 220, easing: Easing.linear, useNativeDriver: true }),
    ]).start();
  }, []);

  function animatedClose() {
    Animated.parallel([
      Animated.timing(translateY, { toValue: screenH, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrim, { toValue: 0, duration: 200, easing: Easing.linear, useNativeDriver: true }),
    ]).start(() => onClose());
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={animatedClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", opacity: scrim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }) }}>
          <Pressable style={{ flex: 1 }} onPress={animatedClose} accessibilityRole="button" accessibilityLabel="Dismiss" />
        </Animated.View>
        <Animated.View
          className="rounded-t-sheet bg-surface"
          style={{ paddingBottom: insets.bottom + 16, maxHeight: "88%", transform: [{ translateY }] }}
        >
          <View className="items-center pt-2.5 pb-1">
            <View className="rounded-full bg-line-2" style={{ width: 38, height: 5 }} />
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function SquareBody({ step, setStep, finish, close }: any) {
  if (step === 0) {
    return (
      <View>
        <Text variant="title">Connect Square</Text>
        <Text variant="body" className="mt-2 text-ink-3">
          Kasa books appointments into your Square calendar and reads your services. We use Square sandbox during setup — no real bookings yet.
        </Text>
        <View className="mt-3">
          <Requirement text={<><Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Square account</Text> — free at squareup.com</>} />
          <Requirement text={<>Kasa requests <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Bookings</Text> + <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Catalog</Text> access only</>} />
        </View>
        <PrimaryBtn label="Continue to Square" onPress={() => setStep(1)} bg={colors.plumStrong} />
      </View>
    );
  }
  return (
    <View>
      <Text variant="title">Authorize Kasa</Text>
      <View className="mt-2 rounded-card border border-line-2 bg-surface p-4">
        <View className="flex-row items-center border-b border-line pb-3" style={{ gap: 8 }}>
          <Icon name="link" size={12} color={colors.ink4} />
          <Text className="text-ink-3" style={{ fontSize: 12, fontFamily: "Inter_600SemiBold" }}>connect.squareup.com</Text>
        </View>
        <Text className="mt-3 text-ink-2" style={{ fontSize: 13, lineHeight: 20 }}>
          • View & manage bookings{"\n"}• Read your service catalog{"\n"}• Read your locations
        </Text>
        <PrimaryBtn label="Allow" onPress={finish} bg={colors.ink} />
        <Pressable onPress={close} className="mt-2.5 items-center"><Text className="text-accent-ink" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>Cancel</Text></Pressable>
      </View>
      <Text className="mt-3 text-center text-ink-4" style={{ fontSize: 12.5 }}>
        {/* TODO(oauth): real Square authorize screen (sandbox) in Phase 4. */}
        This is the real Square OAuth screen in production.
      </Text>
    </View>
  );
}

function IGBody({ step, setStep, finish, close }: any) {
  if (step === 99) {
    return (
      <View>
        <Text variant="title">Switch to Professional</Text>
        <Text variant="body" className="mt-2 text-ink-3">It's free and takes a minute, inside Instagram:</Text>
        <View className="mt-3">
          <Step n={1} text={<>Instagram → <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Settings</Text> → Account type → Switch to Professional</>} />
          <Step n={2} text={<>Choose <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Business</Text> (or Creator)</>} />
          <Step n={3} text={<>Connect it to your <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Facebook Page</Text></>} />
        </View>
        <PrimaryBtn label="← Back" onPress={() => setStep(0)} bg={colors.bgWarm} />
      </View>
    );
  }
  if (step === 0) {
    return (
      <View>
        <Text variant="title">Connect Instagram</Text>
        <Text variant="body" className="mt-2 text-ink-3">Kasa reads and sends your Instagram DMs through Meta's official API. A couple of one-time requirements:</Text>
        <View className="mt-3">
          <Requirement text={<><Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Instagram Professional account</Text> (Business or Creator)</>} />
          <Requirement text={<>Linked to a <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Facebook Page</Text></>} />
        </View>
        <View className="mt-3.5 flex-row rounded-control bg-warn-soft p-3" style={{ gap: 9 }}>
          <Icon name="clock" size={15} color={colors.warnInk} />
          <Text className="flex-1 text-warn-ink" style={{ fontSize: 12.5, lineHeight: 18 }}>
            You can only reply within 24 hours of a client's last message — Meta's rule, shown in each thread.
          </Text>
        </View>
        {/* Real Meta OAuth: finish() triggers connectChannel('instagram') which
            opens Meta's actual login/permission page in a browser and connects
            the account you pick there (e.g. indesign labs). No fake picker. */}
        <PrimaryBtn label="Continue with Facebook" onPress={finish} />
        <Pressable onPress={() => setStep(99)} className="mt-3 items-center"><Text className="text-accent-ink" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>I don't have a Professional account</Text></Pressable>
        <Text className="mt-3 text-center text-ink-4" style={{ fontSize: 12, lineHeight: 17 }}>
          Opens Instagram/Facebook to sign in and pick your account.
        </Text>
      </View>
    );
  }
  return (
    <View>
      <Text variant="title">Connecting…</Text>
      <Text variant="body" className="mt-2 text-ink-3">Finish signing in with Meta in the browser. You'll come right back.</Text>
    </View>
  );
}
