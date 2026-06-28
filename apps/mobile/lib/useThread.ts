// Live data for one thread: the conversation (+ client) and its messages,
// ordered oldest→newest, kept live via a Realtime subscription scoped to this
// conversation. Marks the conversation read on open. Exposes optimistic-append
// helpers the composer uses (add a pending 'out' message, then reconcile it to
// sent/failed against the send-message result — never a fake delivery state).
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type {
  ChannelType,
  ClientRow,
  ConversationRow,
  MessageRow,
} from "./types";

export type ThreadConversation = ConversationRow & { client: ClientRow };

// A local-only optimistic message gets a temp id + a client-side lifecycle
// state. We DO NOT show "delivered/read" — real delivery is a Phase-4 stub, so
// the honest states are: sending → sent (locally) | failed.
export type LocalState = "sending" | "sent" | "failed";
export type ThreadMessage = MessageRow & { _local?: LocalState; _tempId?: string };

export function useThread(conversationId: string) {
  const [convo, setConvo] = useState<ThreadConversation | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const pending = useRef<ThreadMessage[]>([]); // optimistic, not yet in DB

  const merge = useCallback((dbRows: MessageRow[]) => {
    // DB rows are the source of truth; keep any still-pending optimistic rows
    // that haven't shown up from the server yet (matched by channel-less temp).
    setMessages([...dbRows, ...pending.current]);
  }, []);

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, direction, body, media, channel_message_id, status, sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });
    merge((data ?? []) as MessageRow[]);
  }, [conversationId, merge]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select(
          "id, client_id, channel_type, last_message_at, unread, archived, window_expires_at, intent, intent_payload, " +
            "client:clients(id, name, value, phone, email, instagram_handle)",
        )
        .eq("id", conversationId)
        .maybeSingle();
      // The joined select widens Supabase's generic type; cast once to our row.
      const c = data as unknown as ThreadConversation | null;
      if (active && c) setConvo({ ...c, client: (c as any).client });

      await loadMessages();
      if (active) setLoading(false);

      // Mark read on open (real field; reflects in Inbox via its subscription).
      if (c?.unread) {
        await supabase.from("conversations").update({ unread: false }).eq("id", conversationId);
      }
    })();

    const channel = supabase
      .channel(`thread:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => void loadMessages(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        (payload) => setConvo((prev) => (prev ? { ...prev, ...(payload.new as any) } : prev)),
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId, loadMessages]);

  /** Add an optimistic outgoing bubble immediately; returns its temp id. */
  const appendOptimistic = useCallback((body: string): string => {
    const tempId = `temp-${Date.now()}`;
    const msg: ThreadMessage = {
      id: tempId,
      _tempId: tempId,
      conversation_id: conversationId,
      direction: "out",
      body,
      media: null,
      channel_message_id: null,
      status: "sent",
      sent_at: new Date().toISOString(),
      _local: "sending",
    };
    pending.current = [...pending.current, msg];
    setMessages((m) => [...m, msg]);
    return tempId;
  }, [conversationId]);

  /** Reconcile an optimistic bubble after the send-message call resolves. */
  const reconcile = useCallback((tempId: string, state: LocalState) => {
    if (state === "sent") {
      // Drop the optimistic copy; the real DB row arrives via Realtime.
      pending.current = pending.current.filter((m) => m._tempId !== tempId);
      void loadMessages();
    } else {
      // failed: keep the bubble, mark it failed for retry UI.
      pending.current = pending.current.map((m) =>
        m._tempId === tempId ? { ...m, _local: "failed" } : m,
      );
      setMessages((m) =>
        m.map((x) => (x._tempId === tempId ? { ...x, _local: "failed" } : x)),
      );
    }
  }, [loadMessages]);

  /** Remove an optimistic bubble entirely (e.g. closed-window refusal). */
  const dropOptimistic = useCallback((tempId: string) => {
    pending.current = pending.current.filter((m) => m._tempId !== tempId);
    setMessages((m) => m.filter((x) => x._tempId !== tempId));
  }, []);

  return {
    convo,
    messages,
    loading,
    appendOptimistic,
    reconcile,
    dropOptimistic,
    channel: convo?.channel_type as ChannelType | undefined,
  };
}
