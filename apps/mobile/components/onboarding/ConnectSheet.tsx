// Per-platform connect sheets (Square / Instagram / WeChat) — the realistic
// flows from design/onboarding-reference.html, incl. the help branches:
// "I don't have a Professional account" (IG) and "I don't have a Service
// Account" (WeChat). The actual external OAuth/QR is a TODO(oauth) seam; the
// final "Allow / I've authorized" button calls the seed-connect action.
import { useState } from "react";
import { View, Pressable, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { colors, channels } from "@/theme/colors";

type Provider = "square" | "instagram" | "wechat";

function Requirement({ text }: { text: React.ReactNode }) {
  return (
    <View className="flex-row items-start border-b border-line py-3" style={{ gap: 11 }}>
      <View className="items-center justify-center rounded-full border-2 border-ok" style={{ width: 22, height: 22 }}>
        <Icon name="check" size={12} color={colors.ok} strokeWidth={3} />
      </View>
      <Text className="flex-1 text-ink-2" style={{ fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

function Step({ n, text }: { n: number; text: React.ReactNode }) {
  return (
    <View className="flex-row items-start border-b border-line py-3" style={{ gap: 11 }}>
      <View className="items-center justify-center rounded-full border-2 border-ink-4" style={{ width: 22, height: 22 }}>
        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: colors.ink4 }}>{n}</Text>
      </View>
      <Text className="flex-1 text-ink-2" style={{ fontSize: 14, lineHeight: 20 }}>{text}</Text>
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
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <Pressable className="flex-1 bg-black/40" onPress={close} />
      <View
        className="rounded-t-sheet bg-surface"
        style={{ paddingBottom: insets.bottom + 16, maxHeight: "86%" }}
      >
        <View className="items-center pt-2.5 pb-1">
          <View className="rounded-full bg-line-2" style={{ width: 38, height: 5 }} />
        </View>
        <View className="px-6 pt-2">
          {provider === "square" && <SquareBody step={step} setStep={setStep} finish={finish} close={close} />}
          {provider === "instagram" && <IGBody step={step} setStep={setStep} finish={finish} close={close} />}
          {provider === "wechat" && <WeChatBody step={step} setStep={setStep} finish={finish} close={close} />}
        </View>
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
        <PrimaryBtn label="Continue with Facebook" onPress={() => setStep(1)} />
        <Pressable onPress={() => setStep(99)} className="mt-3 items-center"><Text className="text-accent-ink" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>I don't have a Professional account</Text></Pressable>
      </View>
    );
  }
  return (
    <View>
      <Text variant="title">Choose account</Text>
      <View className="mt-2 rounded-card border border-line-2 bg-surface p-4">
        <View className="flex-row items-center border-b border-line pb-3" style={{ gap: 8 }}>
          <Icon name="link" size={12} color={colors.ink4} />
          <Text className="text-ink-3" style={{ fontSize: 12, fontFamily: "Inter_600SemiBold" }}>facebook.com</Text>
        </View>
        <Pressable onPress={finish} className="mt-3 flex-row items-center rounded-control border border-line-2 p-3" style={{ gap: 11 }}>
          <View className="items-center justify-center rounded-control" style={{ width: 38, height: 38, backgroundColor: colors.accentSoft }}>
            <Icon name="user" size={18} color={colors.accent} />
          </View>
          <View className="flex-1">
            <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.ink }}>@shen.hair</Text>
            <Text className="text-ink-3" style={{ fontSize: 12.5 }}>Shen's Studio · Page linked</Text>
          </View>
          <Icon name="chevR" size={16} color={colors.ink4} />
        </Pressable>
        <Pressable onPress={close} className="mt-3 items-center"><Text className="text-accent-ink" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>Cancel</Text></Pressable>
      </View>
      <Text className="mt-3 text-center text-ink-4" style={{ fontSize: 12.5, lineHeight: 18 }}>
        {/* TODO(oauth): real Meta permission screen, gated on App Review. */}
        In production this is Meta's permission screen — gated on Meta App Review.
      </Text>
    </View>
  );
}

function WeChatBody({ step, setStep, finish, close }: any) {
  if (step === 99) {
    return (
      <View>
        <Text variant="title">Getting a Service Account</Text>
        <Text variant="body" className="mt-2 text-ink-3">This one's heavier — especially outside mainland China:</Text>
        <View className="mt-3">
          <Step n={1} text={<>Register an <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Official Account</Text> (Service Account)</>} />
          <Step n={2} text={<>Complete <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>business verification</Text> (documents + annual fee)</>} />
          <Step n={3} text="Come back and authorize Kasa" />
        </View>
        <PrimaryBtn label="← Back" onPress={() => setStep(0)} bg={colors.bgWarm} />
      </View>
    );
  }
  if (step === 0) {
    return (
      <View>
        <Text variant="title">Connect WeChat</Text>
        <Text variant="body" className="mt-2 text-ink-3">Kasa connects to your WeChat Official Account to read and reply to client messages.</Text>
        <View className="mt-3">
          <Requirement text={<><Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Service Account</Text> type (not Subscription)</>} />
          <Requirement text={<><Text style={{ fontFamily: "Inter_600SemiBold", color: colors.ink }}>Verified</Text> — clients must message you first</>} />
        </View>
        <View className="mt-3.5 flex-row rounded-control bg-warn-soft p-3" style={{ gap: 9 }}>
          <Icon name="clock" size={15} color={colors.warnInk} />
          <Text className="flex-1 text-warn-ink" style={{ fontSize: 12.5, lineHeight: 18 }}>
            Reply window is 48 hours from the client's last message.
          </Text>
        </View>
        <PrimaryBtn label="Authorize with WeChat" onPress={() => setStep(1)} bg={channels.wechat.dot} />
        <Pressable onPress={() => setStep(99)} className="mt-3 items-center"><Text className="text-accent-ink" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>I don't have a Service Account</Text></Pressable>
      </View>
    );
  }
  return (
    <View>
      <Text variant="title">Scan to authorize</Text>
      <Text variant="body" className="mt-2 text-ink-3">Open WeChat on the phone with your Official Account and scan:</Text>
      {/* QR placeholder (TODO(oauth): real WeChat authorization QR in Phase 4) */}
      <View className="my-4 self-center items-center justify-center rounded-card border border-line-2 bg-surface-2" style={{ width: 158, height: 158 }}>
        <Icon name="image" size={40} color={colors.ink4} />
      </View>
      <PrimaryBtn label="I've scanned & authorized" onPress={finish} bg={channels.wechat.dot} />
      <Pressable onPress={close} className="mt-2.5 items-center"><Text className="text-accent-ink" style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold" }}>Cancel</Text></Pressable>
    </View>
  );
}
