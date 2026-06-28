// The onboarding gate, computed from the REAL channels table (+ the stylist's
// Square connection), never local state — so it survives restarts and matches
// Settings. Gate to enter the app (ONBOARDING.md):
//   Square connected  AND  at least one message channel connected.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export type GateState = {
  loading: boolean;
  squareConnected: boolean;
  channelConnected: boolean;
  ready: boolean;
  refresh: () => void;
};

export function useOnboardingGate(enabled: boolean): GateState {
  const [loading, setLoading] = useState(true);
  const [squareConnected, setSquare] = useState(false);
  const [channelConnected, setChannel] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    // Square: the stylist row carries the Square connection (merchant + token).
    const { data: stylist } = await supabase
      .from("stylists")
      .select("square_merchant_id")
      .limit(1)
      .maybeSingle();
    setSquare(!!stylist?.square_merchant_id);

    // Channels: at least one connected message channel (RLS-scoped to her rows).
    const { data: chans } = await supabase
      .from("channels")
      .select("type, connected")
      .eq("connected", true);
    setChannel((chans ?? []).length > 0);

    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    loading,
    squareConnected,
    channelConnected,
    ready: squareConnected && channelConnected,
    refresh,
  };
}
