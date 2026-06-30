// Clients list + single client profile, from the real clients table. The
// profile also pulls the client's conversations (for the Conversations block)
// and derives the channels they've reached out on.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { getCache, setCache, subscribeCache } from "./cache";
import type { ChannelType } from "./types";

export type ClientRow = {
  id: string;
  name: string;
  value: "high" | "regular" | "new";
  since: string | null;
  visits: number | null;
  last_appt_at: string | null;
  preferences: string | null;
  notes: string | null;
  tags: string[] | null;
  phone: string | null;
  email: string | null;
  instagram_handle: string | null;
};

export type ClientConvo = {
  id: string;
  channel_type: ChannelType;
  last_message_at: string | null;
  preview: string | null;
};

export type ClientAppt = {
  id: string;
  starts_at: string;
  ends_at: string;
  service_name: string | null;
};

const CLIENTS_CACHE = "clients";

export function useClients() {
  const { session } = useAuth();
  const [items, setItems] = useState<ClientRow[]>(() => getCache<ClientRow[]>(CLIENTS_CACHE) ?? []);
  const [loading, setLoading] = useState(() => getCache<ClientRow[]>(CLIENTS_CACHE) === undefined);

  useEffect(() => subscribeCache(CLIENTS_CACHE, () => {
    const v = getCache<ClientRow[]>(CLIENTS_CACHE);
    if (v) setItems(v);
  }), []);

  const reload = useCallback(async () => {
    if (!session) return; // wait for auth; RLS returns nothing otherwise
    const { data } = await supabase
      .from("clients")
      .select("id, name, value, since, visits, last_appt_at, preferences, notes, tags, phone, email, instagram_handle")
      .order("name", { ascending: true });
    const rows = (data ?? []) as ClientRow[];
    setItems(rows);
    setCache(CLIENTS_CACHE, rows);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, reload };
}

export function useClientProfile(id: string | undefined) {
  const [client, setClient] = useState<ClientRow | null>(null);
  const [convos, setConvos] = useState<ClientConvo[]>([]);
  const [channels, setChannels] = useState<ChannelType[]>([]);
  const [upcoming, setUpcoming] = useState<ClientAppt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: c } = await supabase
        .from("clients")
        .select("id, name, value, since, visits, last_appt_at, preferences, notes, tags, phone, email, instagram_handle")
        .eq("id", id)
        .maybeSingle();
      setClient((c as ClientRow) ?? null);

      // Upcoming bookings (not canceled, starting from now), soonest first.
      const { data: appts } = await supabase
        .from("appointments")
        .select("id, starts_at, ends_at, service_name, service_id")
        .eq("client_id", id)
        .neq("status", "canceled")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(10);
      const arows = (appts ?? []) as any[];
      // Resolve service names from the catalog where service_name is missing.
      const sids = Array.from(new Set(arows.map((a) => a.service_id).filter(Boolean)));
      const sname = new Map<string, string>();
      if (sids.length) {
        const { data: svcs } = await supabase.from("provider_services").select("id, name").in("id", sids);
        for (const s of (svcs ?? []) as any[]) sname.set(s.id, s.name);
      }
      setUpcoming(arows.map((a) => ({
        id: a.id, starts_at: a.starts_at, ends_at: a.ends_at,
        service_name: (a.service_id && sname.get(a.service_id)) || a.service_name || null,
      })));

      const { data: conv } = await supabase
        .from("conversations")
        .select("id, channel_type, last_message_at")
        .eq("client_id", id)
        .order("last_message_at", { ascending: false });
      const rows = (conv ?? []) as any[];

      // Latest message per conversation for the preview (same pattern as inbox —
      // conversations has no denormalized preview column).
      const ids = rows.map((x) => x.id);
      const preview = new Map<string, string | null>();
      if (ids.length) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("conversation_id, body, sent_at")
          .in("conversation_id", ids)
          .order("sent_at", { ascending: false });
        for (const m of (msgs ?? []) as any[]) {
          if (!preview.has(m.conversation_id)) preview.set(m.conversation_id, m.body);
        }
      }

      const mapped: ClientConvo[] = rows.map((x) => ({
        id: x.id,
        channel_type: x.channel_type,
        last_message_at: x.last_message_at,
        preview: preview.get(x.id) ?? null,
      }));
      setConvos(mapped);
      setChannels(Array.from(new Set(mapped.map((m) => m.channel_type))));
      setLoading(false);
    })();
  }, [id]);

  return { client, convos, channels, upcoming, loading };
}
