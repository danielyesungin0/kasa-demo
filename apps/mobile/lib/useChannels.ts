// Connection state for the connect-accounts screen, backed by the REAL tables
// (not local state) so connections survive restarts and match Settings:
//   - Square  → the stylist row's square_merchant_id / square_location_name
//   - channels→ rows in `channels` (type, connected, status)
//
// Square uses REAL OAuth (square-oauth-start → Square authorize → callback
// stores encrypted tokens). Instagram/WeChat OAuth is still a TODO(oauth) seam
// and seeds a row for now. All state reads the real tables, never local guesses.
import { useCallback, useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { supabase, FUNCTIONS_URL } from "./supabase";

export type ConnState = "idle" | "connecting" | "connected" | "action_needed";

export type ProviderId = "square" | "instagram" | "wechat";

export type ConnInfo = {
  state: ConnState;
  label?: string; // connected detail line (merchant / handle / OA name)
};

export type ChannelsData = {
  loading: boolean;
  conn: Record<ProviderId, ConnInfo>;
  refresh: () => Promise<void>;
  connectSquare: () => Promise<void>;
  connectChannel: (id: "instagram" | "wechat") => Promise<void>;
  disconnect: (id: ProviderId) => Promise<void>;
};

async function getStylistId(): Promise<string | null> {
  const { data } = await supabase.from("stylists").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

export function useChannels(): ChannelsData {
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState<Record<ProviderId, ConnInfo>>({
    square: { state: "idle" },
    instagram: { state: "idle" },
    wechat: { state: "idle" },
  });

  const refresh = useCallback(async () => {
    const { data: stylist } = await supabase
      .from("stylists")
      .select("square_merchant_id, square_location_name, square_business_name")
      .limit(1)
      .maybeSingle();
    const { data: chans } = await supabase
      .from("channels")
      .select("type, connected, status, external_account_id");

    const byType = new Map((chans ?? []).map((c: any) => [c.type, c]));
    const channelInfo = (t: "instagram" | "wechat"): ConnInfo => {
      const row: any = byType.get(t);
      if (!row) return { state: "idle" };
      if (row.status === "action_needed") return { state: "action_needed", label: "Reconnect needed" };
      if (row.connected) return { state: "connected", label: row.external_account_id ?? undefined };
      return { state: "idle" };
    };

    setConn({
      square: stylist?.square_merchant_id
        ? {
            state: "connected",
            label:
              stylist.square_location_name ??
              stylist.square_business_name ??
              "Sandbox · connected",
          }
        : { state: "idle" },
      instagram: channelInfo("instagram"),
      wechat: channelInfo("wechat"),
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setState = (id: ProviderId, info: ConnInfo) =>
    setConn((c) => ({ ...c, [id]: info }));

  // ── connect actions ──
  // Square: REAL OAuth. Ask square-oauth-start for the authorize URL (it needs
  // the stylist's session JWT), open it in a browser, and let the callback store
  // the encrypted tokens + return to the app via kasa://square-connected. On
  // return we refresh from the stylists row (the source of truth).
  const connectSquare = useCallback(async () => {
    setState("square", { state: "connecting" });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return setState("square", { state: "idle" });

      const res = await fetch(`${FUNCTIONS_URL}/square-oauth-start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok || !json.authorize_url) {
        return setState("square", { state: "idle" });
      }

      const result = await WebBrowser.openAuthSessionAsync(
        json.authorize_url,
        "kasa://square-connected",
      );
      // Whether success/dismiss, re-read the real state — the callback persists
      // independently of how the browser closes.
      if (result.type === "success") {
        await refresh();
      } else {
        setState("square", { state: "idle" });
      }
    } catch {
      setState("square", { state: "idle" });
    }
  }, [refresh]);

  const connectChannel = useCallback(async (id: "instagram" | "wechat") => {
    setState(id, { state: "connecting" });
    const stylistId = await getStylistId();
    if (!stylistId) return setState(id, { state: "idle" });
    const label = id === "instagram" ? "@shen.hair · pro account" : "Shen Hair Studio 公众号";
    await supabase.from("channels").upsert(
      {
        stylist_id: stylistId,
        type: id,
        connected: true,
        status: "connected",
        external_account_id: label,
      },
      { onConflict: "stylist_id,type" },
    );
    await refresh();
  }, [refresh]);

  const disconnect = useCallback(async (id: ProviderId) => {
    const stylistId = await getStylistId();
    if (!stylistId) return;
    if (id === "square") {
      await supabase
        .from("stylists")
        .update({ square_merchant_id: null, square_location_name: null })
        .eq("id", stylistId);
    } else {
      await supabase.from("channels").delete().eq("stylist_id", stylistId).eq("type", id);
    }
    await refresh();
  }, [refresh]);

  return { loading, conn, refresh, connectSquare, connectChannel, disconnect };
}
