// Connection state for the connect-accounts screen, backed by the REAL tables
// (not local state) so connections survive restarts and match Settings:
//   - Square  → the stylist row's square_merchant_id / square_location_name
//   - channels→ rows in `channels` (type, connected, status)
//
// External OAuth is a Phase-4 TODO(oauth) seam. For now, "connect" SEEDS a real
// row (channels) / sets the stylist's Square fields so the gate + downstream UI
// are exercised end-to-end. Real status vocabulary incl. action-needed.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

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
  // TODO(oauth): replace each of these with the real platform OAuth (Square
  // authorize / Meta Login / WeChat QR) in Phase 4. For now they seed a real
  // connected row so the gate + Settings reflect a true persisted connection.
  const connectSquare = useCallback(async () => {
    setState("square", { state: "connecting" });
    const id = await getStylistId();
    if (!id) return setState("square", { state: "idle" });
    await supabase
      .from("stylists")
      .update({
        // Sandbox placeholder identifiers (no real token; Phase-4 OAuth fills these).
        square_merchant_id: "SANDBOX_MERCHANT",
        square_location_name: "Greene St Studio (sandbox)",
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", id);
    await refresh();
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
