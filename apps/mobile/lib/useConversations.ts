// Live inbox data. Loads conversations + client + latest-message snippet,
// ordered by last_message_at desc, and keeps it correct via Supabase Realtime:
//   - a new/updated message → refresh that conversation's snippet/time and let
//     it reorder to the top
//   - a conversation row change (unread/intent/archived) → apply it
// Unread comes from the real `unread` field, never a local guess.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { InboxItem, MessageRow } from "./types";

const SNIPPET_NONE = "";

function snippetFor(body: string | null, direction: string): string {
  if (!body) return "[photo]";
  return direction === "out" ? `You: ${body}` : body;
}

/** One round-trip that assembles inbox items (conversation + client + snippet). */
async function loadInbox(): Promise<InboxItem[]> {
  const { data: convos, error } = await supabase
    .from("conversations")
    .select(
      "id, client_id, channel_type, last_message_at, unread, archived, window_expires_at, intent, intent_payload, " +
        "client:clients(id, name, value, phone, email, instagram_handle)",
    )
    .eq("archived", false)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error || !convos) return [];

  // Latest message per conversation for the snippet (one query, then map).
  const ids = convos.map((c: any) => c.id);
  const snippets = new Map<string, { body: string | null; direction: string }>();
  if (ids.length) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("conversation_id, body, direction, sent_at")
      .in("conversation_id", ids)
      .order("sent_at", { ascending: false });
    for (const m of (msgs ?? []) as any[]) {
      if (!snippets.has(m.conversation_id)) {
        snippets.set(m.conversation_id, { body: m.body, direction: m.direction });
      }
    }
  }

  return convos.map((c: any): InboxItem => {
    const snip = snippets.get(c.id);
    return {
      ...c,
      client: c.client,
      snippet: snip ? snippetFor(snip.body, snip.direction) : SNIPPET_NONE,
      hasBooking: c.intent === "booking",
    };
  });
}

export function useConversations() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const next = await loadInbox();
    setItems(next);
    setLoading(false);
  }, []);

  // Debounce bursty Realtime events into a single reload (correctness over
  // micro-optimization; the inbox is small and a full reload is cheap + always
  // consistent with the server ordering).
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void reload(), 150);
  }, [reload]);

  useEffect(() => {
    void reload();
    const channel = supabase
      .channel("inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        scheduleReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        scheduleReload,
      )
      .subscribe();
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      supabase.removeChannel(channel);
    };
  }, [reload, scheduleReload]);

  return { items, loading, reload };
}

export type { MessageRow };
