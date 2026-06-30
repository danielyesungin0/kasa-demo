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
import * as Linking from "expo-linking";
import { supabase, FUNCTIONS_URL } from "./supabase";
import { WECHAT_LIVE, SMS_LIVE } from "./config";

export type ConnState = "idle" | "connecting" | "connected" | "action_needed" | "pending";

export type ProviderId = "square" | "instagram" | "wechat" | "sms";

export type ConnInfo = {
  state: ConnState;
  label?: string; // connected detail line (merchant / handle / OA name)
};

export type ChannelsData = {
  loading: boolean;
  conn: Record<ProviderId, ConnInfo>;
  refresh: () => Promise<void>;
  connectSquare: () => Promise<void>;
  connectChannel: (id: "instagram" | "wechat" | "sms") => Promise<void>;
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
    sms: { state: "idle" },
  });

  const refresh = useCallback(async () => {
    const { data: stylist } = await supabase
      .from("stylists")
      .select("square_merchant_id, square_location_name, square_business_name")
      .limit(1)
      .maybeSingle();
    const { data: chans } = await supabase
      .from("channels")
      .select("type, connected, status, external_account_id, sms_number, sms_registration");

    const byType = new Map((chans ?? []).map((c: any) => [c.type, c]));
    const channelInfo = (t: "instagram" | "wechat" | "sms"): ConnInfo => {
      // WeChat is not live until OA verification is approved + credentials set.
      if (t === "wechat" && !WECHAT_LIVE) {
        return { state: "pending", label: "Verification in review" };
      }
      // SMS is not live until a provider account + A2P registration + number
      // exist. Until then, reflect the registration lifecycle if a row exists,
      // else "idle" (not set up).
      if (t === "sms") {
        if (!SMS_LIVE) return { state: "idle", label: "Not set up yet" };
        const row: any = byType.get("sms");
        const reg = row?.sms_registration;
        if (reg === "provisioning") return { state: "connecting", label: "Setting up your number…" };
        if (reg === "pending_review") return { state: "pending", label: "Carrier registration in review" };
        if (reg === "rejected") return { state: "action_needed", label: "Registration needs attention" };
        if (row?.connected && row.sms_number) return { state: "connected", label: row.sms_number };
        return { state: "idle" };
      }
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
      sms: channelInfo("sms"),
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setState = (id: ProviderId, info: ConnInfo) =>
    setConn((c) => ({ ...c, [id]: info }));

  // ── connect actions ──
  // Square: REAL OAuth. Get the authorize URL (needs the stylist JWT), open it
  // in a normal in-app browser tab (openBrowserAsync — handles Square's
  // cross-domain redirects + cookies/JS, unlike the auth-session sandbox which
  // rendered blank), and listen for the kasa://square-connected deep link from
  // the callback. On return we dismiss the browser and refresh from the
  // stylists row (the callback persists tokens server-side).
  const connectSquare = useCallback(async () => {
    setState("square", { state: "connecting" });
    let sub: { remove: () => void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // If a token was already stored (e.g. linked out-of-band in sandbox),
      // don't launch OAuth — just reflect the real connected state.
      const { data: pre } = await supabase
        .from("stylists").select("square_merchant_id").limit(1).maybeSingle();
      if (pre?.square_merchant_id) { await refresh(); return; }

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

      // Resolve when the callback deep-links back into the app.
      const returned = new Promise<string>((resolve) => {
        sub = Linking.addEventListener("url", ({ url }) => {
          if (url.includes("square-connected")) resolve(url);
        });
      });

      // openAuthSessionAsync ties the browser lifecycle to the kasa:// redirect
      // and closes itself — so there's no manual dismiss to crash on. Falls back
      // to the deep-link race + a timeout so we never hang on the connecting
      // state (Square SANDBOX OAuth can't always complete in-app; production is
      // fine — see square-sandbox-setup memory).
      await Promise.race([
        WebBrowser.openAuthSessionAsync(json.authorize_url, "kasa://square-connected"),
        returned,
        new Promise<string>((r) => { timer = setTimeout(() => r(""), 60_000); }),
      ]);
      await refresh(); // re-read truth; idle stays idle if it didn't connect
    } catch {
      setState("square", { state: "idle" });
    } finally {
      sub?.remove();
      if (timer) clearTimeout(timer);
    }
  }, [refresh]);

  const connectChannel = useCallback(async (id: "instagram" | "wechat" | "sms") => {
    setState(id, { state: "connecting" });

    // Instagram: REAL Meta OAuth (instagram-oauth-start → Meta dialog → callback
    // stores the encrypted Page token in channels). Mirrors connectSquare. If
    // Meta isn't configured yet (no META_APP_ID), the start function returns
    // meta_not_configured and we surface idle (honest — no fake connect).
    if (id === "instagram") {
      let sub: { remove: () => void } | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return setState(id, { state: "idle" });

        const res = await fetch(`${FUNCTIONS_URL}/instagram-oauth-start`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        const json = await res.json();
        if (!res.ok || !json.authorize_url) return setState(id, { state: "idle" });

        const returned = new Promise<string>((resolve) => {
          sub = Linking.addEventListener("url", ({ url }) => {
            if (url.includes("instagram-connected")) resolve(url);
          });
        });
        await Promise.race([
          WebBrowser.openAuthSessionAsync(json.authorize_url, "kasa://instagram-connected"),
          returned,
          new Promise<string>((r) => { timer = setTimeout(() => r(""), 90_000); }),
        ]);
        await refresh();
      } catch {
        setState(id, { state: "idle" });
      } finally {
        sub?.remove();
        if (timer) clearTimeout(timer);
      }
      return;
    }

    // WeChat: not connectable until OA verification is approved + credentials
    // configured (WECHAT_LIVE). Until then it's a no-op — the UI shows the
    // "Pending verification" state, never a fake connect.
    if (id === "wechat") {
      if (!WECHAT_LIVE) { await refresh(); return; }
      // (When live, the real WeChat connect flow — store AppID/secret + token —
      // slots in here.)
      await refresh();
      return;
    }

    // SMS: not connectable until a provider + A2P registration + number exist
    // (SMS_LIVE). No-op for now — the UI shows "Coming soon". When live, the real
    // provision/port + registration flow slots in here.
    if (id === "sms") {
      await refresh();
      return;
    }
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
