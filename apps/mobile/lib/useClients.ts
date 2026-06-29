// Clients list + single client profile, from the real clients table. The
// profile also pulls the client's conversations (for the Conversations block)
// and derives the channels they've reached out on.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
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

export function useClients() {
  const [items, setItems] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data } = await supabase
      .from("clients")
      .select("id, name, value, since, visits, last_appt_at, preferences, notes, tags, phone, email, instagram_handle")
      .order("name", { ascending: true });
    setItems((data ?? []) as ClientRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, reload };
}

export function useClientProfile(id: string | undefined) {
  const [client, setClient] = useState<ClientRow | null>(null);
  const [convos, setConvos] = useState<ClientConvo[]>([]);
  const [channels, setChannels] = useState<ChannelType[]>([]);
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

  return { client, convos, channels, loading };
}
