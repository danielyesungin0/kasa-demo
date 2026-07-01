# Portable Chat Implementation Guide

A copy-paste-able spec for building a chat/messaging UI that feels *good* —
extracted from Kasa's thread implementation. Hand this whole file to another
project (or an AI building one) so it doesn't start from scratch.

It's stack-described for **React Native (Expo) + Supabase**, but every principle
maps to any stack (web/Flutter/etc.) — the *behaviors* are what make it feel
right, not the framework.

---

## The 9 things that make a chat feel good (in priority order)

Most chat UIs feel janky because they miss these. Get them right and it feels
native.

### 1. Optimistic send — the bubble appears INSTANTLY on tap
Never wait for the server. On send: immediately push a local "pending" bubble,
clear the input, scroll to bottom. Then fire the network call and *reconcile*.
The user perceives zero latency.

```
appendOptimistic(text) → pushes { id: temp-<ts>, direction:'out',
  _local:'sending' } to a `pending` ref + to messages, returns tempId.
onSend:
  const tempId = appendOptimistic(text)
  scrollToEnd()
  const res = await send(text)
  res.ok ? reconcile(tempId,'sent') : reconcile(tempId,'failed')
```

### 2. Reconcile without a duplicate flicker (the #1 subtle bug)
The trap: your optimistic bubble is still showing when the *real* server row
arrives (via realtime/refetch) → you briefly see the message twice. Fix: keep
optimistic rows in a **separate `pending` ref**, and when merging DB rows, DROP
any pending bubble whose content matches a DB row that just arrived.

```
merge(dbRows):
  dbOut = dbRows.filter(direction==='out')
  stillPending = pending.filter(p =>
     p.conversation === thisConvo &&
     !dbOut.some(r => p.body ? r.body===p.body
                             : hasMedia(p) && hasMedia(r) && !r.body)) // media-only match
  render [...dbRows, ...stillPending]
```
On `sent`: drop the optimistic copy, let the real row render (it's identical).
On `failed`: KEEP the bubble, mark it `failed` for a retry affordance.

### 3. Honest delivery states — never fake "delivered/read"
Only show what you can prove: **sending → sent | failed**. Don't render
"delivered"/"read" unless the provider truly reports it — a fake checkmark
destroys trust the first time a message silently fails. Failed bubbles are
tappable to retry.

### 4. Animated "sending" indicator, not a static word
While a send is in flight, show a subtle animated three-dot pulse (the iMessage
rhythm) instead of a static "Sending…". Tiny touch, big perceived-quality lift.
Reduce-motion aware (fall back to static).

### 5. Open the thread scrolled to the bottom — INSTANTLY (no visible scroll)
On first render of a thread, jump to the newest message with **no animation**.
Only animate the scroll for *subsequent* new messages while viewing. Track a
`didInitialScroll` ref keyed to the conversation id.

```
onContentSizeChange:
  if (!didInitialScroll) { didInitialScroll = true; scrollToEnd({animated:false}) }
  else scrollToEnd({animated:true})
```

### 6. Keyboard handling that doesn't leave a gap
- Wrap the whole screen in `KeyboardAvoidingView` (`behavior: padding` on iOS,
  `height` on Android, `keyboardVerticalOffset: 0`).
- The composer's bottom padding = safe-area inset **when keyboard is down**, but
  **drop it to ~8px when the keyboard is up** (the keyboard already covers the
  home-indicator area, so keeping the inset creates a visible gap above the
  keyboard). Listen to `keyboardWillShow/Hide`.

### 7. Instant reopen via a per-thread cache (stale-while-revalidate)
Reopening a chat you've seen should be instant — no skeleton. Seed messages
synchronously from an in-memory cache keyed `thread:<id>`, show the skeleton only
if the cache is empty, then revalidate in the background. (Same trick makes tab
navigation instant everywhere.)

### 8. Skeleton on cold load, never a blank screen
First-ever load of a thread shows a minimal header (back button) + alternating
bubble skeletons — never a white flash. (A blank screen reads as "broken.")

### 9. Composer that collapses options as you type (Instagram pattern)
Empty input → show quick actions (camera / photo / etc.). As soon as there's
text → those collapse and a Send button appears. A primary action (e.g. "Book")
can stay pinned on the left always. Feels alive and uncluttered.

---

## Data flow architecture

```
┌─ useThread(conversationId) ──────────────────────────────┐
│  state: convo, messages, loading                          │
│  refs:  pending[] (optimistic, not yet in DB)             │
│                                                           │
│  on mount / id change:                                    │
│    seed messages from cache[thread:id]  (instant)         │
│    fetch conversation + last 100 messages (desc+limit,    │
│      reversed) → cache + merge                             │
│    mark conversation read                                 │
│    subscribe to realtime: messages (filtered to this      │
│      conversation) + conversation updates                 │
│                                                           │
│  exposes: appendOptimistic, reconcile, dropOptimistic     │
└───────────────────────────────────────────────────────────┘
        │                          ▲
    (composer sends)          (realtime pushes → loadMessages → merge)
```

Key choices:
- **Load newest 100** (`order sent_at desc limit 100`, then `.reverse()`),
  not the whole history — long threads stay fast. Page older on demand later.
- **Realtime subscription is filtered** to `conversation_id=eq.<id>` and uses a
  **unique channel name** per mount (`thread:<id>:<random>`) — re-subscribing a
  same-named channel throws.
- **`dropOptimistic`** for honest refusals (e.g. a closed reply-window): remove
  the bubble entirely and show a banner instead of a fake-sent message.

---

## Reference implementation — the core hook (RN + Supabase)

```ts
export type LocalState = "sending" | "sent" | "failed";
export type ThreadMessage = MessageRow & { _local?: LocalState; _tempId?: string };

export function useThread(conversationId: string) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const pending = useRef<ThreadMessage[]>([]);

  const merge = useCallback((dbRows: MessageRow[]) => {
    const dbOut = dbRows.filter(r => r.direction === "out");
    const hasMedia = (m: any) => Array.isArray(m.media) && m.media.length > 0;
    const stillPending = pending.current.filter(m => {
      if (m.conversation_id !== conversationId) return false;
      const echoed = dbOut.some(r =>
        m.body ? (r.body ?? "") === m.body
               : hasMedia(m) && hasMedia(r) && !(r.body ?? ""));
      return !echoed;
    });
    pending.current = stillPending;
    setMessages([...dbRows, ...stillPending]);
  }, [conversationId]);

  // seed from cache on id change (instant reopen)
  useEffect(() => {
    pending.current = [];
    const cached = getCache<MessageRow[]>(`thread:${conversationId}`);
    setMessages(cached ?? []);
    setLoading(cached === undefined);
  }, [conversationId]);

  const loadMessages = useCallback(async () => {
    const { data } = await supabase.from("messages")
      .select("id, conversation_id, direction, body, media, status, sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false }).limit(100);
    const rows = ((data ?? []) as MessageRow[]).reverse();
    setCache(`thread:${conversationId}`, rows);
    merge(rows);
  }, [conversationId, merge]);

  useEffect(() => {
    let active = true;
    (async () => { await loadMessages(); if (active) setLoading(false); })();
    const channel = supabase
      .channel(`thread:${conversationId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "messages",
          filter: `conversation_id=eq.${conversationId}` },
        () => void loadMessages())
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [conversationId, loadMessages]);

  const appendOptimistic = useCallback((body: string, localMedia?: any) => {
    const tempId = `temp-${Date.now()}`;
    const msg: ThreadMessage = {
      id: tempId, _tempId: tempId, conversation_id: conversationId,
      direction: "out", body, media: localMedia ? [{ type: localMedia.type,
      payload: { url: localMedia.url } }] : null, status: "sent",
      sent_at: new Date().toISOString(), _local: "sending",
    };
    pending.current = [...pending.current, msg];
    setMessages(m => [...m, msg]);
    return tempId;
  }, [conversationId]);

  const reconcile = useCallback((tempId: string, state: LocalState) => {
    if (state === "sent") {
      pending.current = pending.current.filter(m => m._tempId !== tempId);
      void loadMessages(); // real row arrives via the fetch/realtime
    } else {
      pending.current = pending.current.map(m =>
        m._tempId === tempId ? { ...m, _local: "failed" } : m);
      setMessages(m => m.map(x =>
        x._tempId === tempId ? { ...x, _local: "failed" } : x));
    }
  }, [loadMessages]);

  const dropOptimistic = useCallback((tempId: string) => {
    pending.current = pending.current.filter(m => m._tempId !== tempId);
    setMessages(m => m.filter(x => x._tempId !== tempId));
  }, []);

  return { messages, loading, appendOptimistic, reconcile, dropOptimistic };
}
```

## Reference — the send handler (screen)
```ts
async function doSend(text: string) {
  const tempId = appendOptimistic(text);
  scrollToEnd();                      // animated=false on first, true after
  const res = await sendMessage(id, text);
  if (res.ok) reconcile(tempId, "sent");
  else if (res.blocked) {             // honest refusal (closed window etc.)
    dropOptimistic(tempId);
    setBanner(`Reply window closed — open ${channelLabel} to continue.`);
  } else reconcile(tempId, "failed"); // keep bubble, allow retry
}
```

## Message bubble essentials
- Left/right by `direction` (`in` left/surface, `out` right/accent).
- Media (images) render as tappable thumbnails → fullscreen viewer; audio as a
  waveform chip; unknown as a file chip. Normalize provider media shapes into
  `{type,url}` in one helper.
- Meta line: timestamp OR the animated "Sending" dots OR "Failed — tap to retry".
- Optimistic bubble shows the picked image via a **local object URL** instantly,
  before upload completes.

## Media send chain (if you support attachments)
pick/capture → show bubble instantly (local uri) → upload to storage → get public
URL → send that URL → reconcile. Surface an honest toast on failure ("couldn't
upload" / "provider didn't accept this"), never a silent fail.

---

## Checklist to port
- [ ] Optimistic append + reconcile (sent/failed), separate `pending` ref
- [ ] Dedup on merge (body match; media-only match) — no duplicate flicker
- [ ] Honest states only (sending/sent/failed), retry on failed
- [ ] Animated sending dots
- [ ] Instant initial scroll-to-bottom (no animation); animate subsequent
- [ ] KeyboardAvoidingView + drop safe-area pad when keyboard up
- [ ] Per-thread cache seed (instant reopen) + skeleton on cold load
- [ ] Newest-N fetch (not full history) + filtered realtime + unique channel name
- [ ] Composer: options collapse on type, Send appears, primary action pinned
- [ ] dropOptimistic for honest refusals (banner, not a fake bubble)

## Files this was extracted from (Kasa)
- `apps/mobile/lib/useThread.ts` — the hook (source of truth for #1,2,3,7,8)
- `apps/mobile/app/thread/[id].tsx` — screen: keyboard, scroll, send handler
- `apps/mobile/components/thread/Composer.tsx` — composer collapse pattern
- `apps/mobile/components/thread/MessageBubble.tsx` — bubbles, media, states
- `apps/mobile/components/ui/TypingDots.tsx` — animated sending dots
- `apps/mobile/lib/cache.ts` — stale-while-revalidate cache
```
```
