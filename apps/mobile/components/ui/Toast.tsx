// Toast — a brief, non-blocking confirmation that slides down from the top and
// auto-dismisses. App-wide via a context provider so any screen can call
// useToast().show("…"). Used for "Appointment confirmed" after booking.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";
import { colors } from "@/theme/colors";

type ToastOpts = { icon?: IconName; tone?: "ok" | "info" };
type ToastCtx = { show: (message: string, opts?: ToastOpts) => void };

const Ctx = createContext<ToastCtx>({ show: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<string | null>(null);
  const [opts, setOpts] = useState<ToastOpts>({});
  const y = useRef(new Animated.Value(-80)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(y, { toValue: -80, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => setMsg(null));
  }, [y]);

  const show = useCallback((message: string, o: ToastOpts = {}) => {
    if (timer.current) clearTimeout(timer.current);
    setMsg(message); setOpts(o);
    y.setValue(-80);
    Animated.timing(y, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    timer.current = setTimeout(hide, 2400);
  }, [y, hide]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {msg ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: insets.top + 6, alignItems: "center", transform: [{ translateY: y }] }}
        >
          <View
            className="flex-row items-center rounded-pill bg-ink px-4"
            style={{ gap: 8, minHeight: 44, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } }}
          >
            <Icon name={opts.icon ?? "checkCircle"} size={17} color={opts.tone === "info" ? colors.accent : colors.ok} />
            <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" }}>{msg}</Text>
          </View>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}
