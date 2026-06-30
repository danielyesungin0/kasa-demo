// Live inbox data. Loads conversations + client + latest-message snippet,
// ordered by last_message_at desc, and keeps it correct via Supabase Realtime:
//   - a new/updated message → refresh that conversation's snippet/time and let
//     it reorder to the top
//   - a conversation row change (unread/intent/archived) → apply it
// Unread comes from the real `unread` field, never a local guess.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { getCache, setCache, subscribeCache } from "./cache";
import type { InboxItem, MessageRow } from "./types";

const SNIPPET_NONE = "";

function snippetFor(body: string | null, direction: string): string {
  if (!body) return "[photo]";
  return direction === "out" ? `You: ${body}` : body;
}

/** One round-trip that assembles inbox items (conversation + client + snippet). */
async function loadInbox(): Promise<InboxItem[]> {
  // Cap the inbox page: the 200 most recent conversations. (Older threads load
  // via search/scroll later; pulling all-time conversations doesn't scale.)
  const { data: convos, error } = await supabase
    .from("conversations")
    .select(
      "id, client_id, channel_type, last_message_at, unread, archived, window_expires_at, intent, intent_payload, " +
        "client:clients(id, name, value, phone, email, instagram_handle)",
    )
    .eq("archived", false)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error || !convos) return [];

  // Latest message per conversation for the snippet (one query, then map).
  // Bounded so we never pull a whole message history just for previews: only
  // messages from the last ~90 days, newest first; the first per conversation
  // wins. (Threads with no message in the window simply show no snippet.)
  const ids = convos.map((c: any) => c.id);
  const snippets = new Map<string, { body: string | null; direction: string }>();
  if (ids.length) {
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const { data: msgs } = await supabase
      .from("messages")
      .select("conversation_id, body, direction, sent_at")
      .in("conversation_id", ids)
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(1000);
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

const CACHE_KEY = "conversations";

export function useConversations() {
  const { session } = useAuth();
  // Seed from cache → instant inbox on revisit (Today + Inbox share this).
  const [items, setItems] = useState<InboxItem[]>(() => getCache<InboxItem[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(() => getCache<InboxItem[]>(CACHE_KEY) === undefined);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => subscribeCache(CACHE_KEY, () => {
    const v = getCache<InboxItem[]>(CACHE_KEY);
    if (v) setItems(v);
  }), []);

  const reload = useCallback(async () => {
    // Without a session, RLS returns nothing — don't overwrite with an empty
    // list (that's the "inbox blank on reload before auth restores" bug). Wait
    // for the session; the effect below re-runs when it arrives.
    if (!session) return;
    const next = await loadInbox();
    setItems(next);
    setCache(CACHE_KEY, next);
    setLoading(false);
  }, [session]);

  // Debounce bursty Realtime events into a single reload (correctness over
  // micro-optimization; the inbox is small and a full reload is cheap + always
  // consistent with the server ordering).
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void reload(), 150);
  }, [reload]);

  useEffect(() => {
    // No session yet → don't fetch or subscribe (RLS would return nothing, and
    // re-subscribing a same-named channel after subscribe() throws). The effect
    // re-runs when the session arrives.
    if (!session) return;
    void reload();
    // Unique channel name per subscription so a re-run never adds .on() to an
    // already-subscribed channel ("cannot add postgres_changes after subscribe").
    const channel = supabase
      .channel(`inbox-${Math.random().toString(36).slice(2)}`)
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
  }, [session, reload, scheduleReload]);

  return { items, loading, reload };
}

export type { MessageRow };
