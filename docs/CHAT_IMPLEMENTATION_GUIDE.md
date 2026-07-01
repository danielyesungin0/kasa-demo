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

---
---

# PART 2 — The composer UI micro-interactions (the "amazing" feel)

This is the detail that makes it feel premium: buttons living *inside* the input
pill, animating away as you type, the send button appearing. Plus the exact
keyboard-covers-input fix. **Wrap all of this in your own design system** (colors,
radii, fonts) — the values below are behavior, not brand.

## The composer anatomy
A single rounded "pill" bar containing, left→right:
```
[ primary action ]  [ ───── text input (flex) ───── ]  [ contextual right slot ]
   (always shown)                                        empty → media icons
                                                         typing → Send button
```
- **Left primary action** (optional): a persistent circular button — in Kasa it
  was "Book". Stays put in every state. Anchors the bar.
- **Text input**: `flex: 1`, `multiline`, `maxHeight ~96px` (grows a few lines
  then scrolls). Vertically centered.
- **Right slot**: this is where the magic is — it swaps based on whether there's
  text.

## The swap: media icons ⇄ send button
- **Empty input** → show 1–3 quick media icons (camera, photo).
- **Has text** (`text.trim().length > 0`) → icons disappear, a filled **Send**
  button appears.

Kasa shipped this as an **instant conditional swap**. To make it *animated*
(the polished version you want), animate opacity+width/scale on the right slot.

### Animated version (React Native, Reanimated or Animated)
```tsx
const hasText = text.trim().length > 0;
const t = useRef(new Animated.Value(0)).current; // 0 = empty, 1 = typing

useEffect(() => {
  Animated.timing(t, {
    toValue: hasText ? 1 : 0,
    duration: 160,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  }).start();
}, [hasText]);

// Right slot: cross-fade + slight scale between the two clusters.
<View style={{ width: 44, height: 40 }}>
  {/* media icons — visible when empty */}
  <Animated.View style={{
    position: "absolute", inset: 0, flexDirection: "row",
    opacity: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ scale: t.interpolate({ inputRange: [0,1], outputRange: [1, 0.8] }) }],
  }} pointerEvents={hasText ? "none" : "auto"}>
    <IconButton icon="camera" onPress={() => onAttach("camera")} />
    <IconButton icon="image"  onPress={() => onAttach("photo")} />
  </Animated.View>

  {/* send — visible when typing */}
  <Animated.View style={{
    position: "absolute", inset: 0, alignItems: "flex-end", justifyContent: "center",
    opacity: t,
    transform: [{ scale: t.interpolate({ inputRange: [0,1], outputRange: [0.8, 1] }) }],
  }} pointerEvents={hasText ? "auto" : "none"}>
    <Pressable onPress={handleSend}
      style={{ width: 40, height: 40, borderRadius: 20, /* your accent */ }}>
      <Icon name="send" />
    </Pressable>
  </Animated.View>
</View>
```
Notes that make it feel right:
- **Both clusters are absolutely positioned in a fixed-size box** so nothing
  jumps/reflows during the cross-fade — they occupy the same slot.
- `pointerEvents` flips with state so you never tap the invisible one.
- Keep it fast (**~150–180ms, ease-out**). Longer feels sluggish.
- The left primary action does NOT move — only the right slot animates.

### Web version (Framer Motion / CSS)
Same idea: fixed-width right slot, cross-fade the two children.
```tsx
<div className="relative h-10 w-11">
  <div className={`absolute inset-0 flex transition-all duration-150
       ${hasText ? "scale-90 opacity-0 pointer-events-none" : "opacity-100"}`}>
    …media icons…
  </div>
  <div className={`absolute inset-0 flex justify-end items-center transition-all duration-150
       ${hasText ? "opacity-100" : "scale-90 opacity-0 pointer-events-none"}`}>
    <button onClick={handleSend}>send</button>
  </div>
</div>
```
CSS-only alt: the send button can scale from 0→1 via
`transform: scale()` + `transition` keyed on an `is-typing` class.

## Send button behavior
- Only active when `text.trim()` is non-empty (disable/hide otherwise).
- On tap: **clear the input synchronously first**, THEN fire send (so the field
  empties instantly and the optimistic bubble takes over). Never `await` before
  clearing.
- After send, the right slot animates back to media icons (because text is now "").

## Input growth + reset
- `multiline`, `maxHeight` ~96px, `paddingVertical` ~9. It grows with content,
  scrolls past the cap.
- On send, setting text to `""` collapses it back to one line automatically.

---

# PART 3 — Fix: "the keyboard covers the input" (the exact recipe)

This is the bug you're still hitting. There are **three** independent causes;
you usually have to fix all three.

### Cause 1 — no keyboard avoidance at all
Wrap the WHOLE screen (header + list + composer) in `KeyboardAvoidingView`:
```tsx
<KeyboardAvoidingView
  style={{ flex: 1, paddingTop: insets.top }}
  behavior={Platform.OS === "ios" ? "padding" : "height"}
  keyboardVerticalOffset={0}
>
  {header}
  <View style={{ flex: 1 }}>{messageList}</View>
  {composer}
</KeyboardAvoidingView>
```
- **iOS uses `padding`, Android uses `height`.** Using the wrong one per-platform
  is the most common reason it "doesn't work."
- `keyboardVerticalOffset` must account for anything ABOVE the KAV. If your KAV
  starts at the top of the screen (as above, with `paddingTop: insets.top`
  inside), offset is `0`. If you have a nav bar the KAV sits *below*, set the
  offset to that bar's height — a wrong offset leaves a gap OR still covers it.

### Cause 2 — the double safe-area gap (looks like "covered" or "floating")
When the keyboard is UP, it already covers the home-indicator area. If the
composer keeps its safe-area bottom padding, you get a visible gap between the
keyboard and the input. Fix: **drop the bottom inset while the keyboard is up.**
```tsx
const [kbUp, setKbUp] = useState(false);
useEffect(() => {
  const show = Keyboard.addListener("keyboardWillShow", () => setKbUp(true));
  const hide = Keyboard.addListener("keyboardWillHide", () => setKbUp(false));
  return () => { show.remove(); hide.remove(); };
}, []);
// composer bottom padding:
paddingBottom: kbUp ? 8 : Math.max(12, insets.bottom)
```
(Use `keyboardWillShow/Hide` on iOS for a smooth sync with the keyboard
animation; `keyboardDidShow/Hide` on Android which lacks the "will" events.)

### Cause 3 — a parent ScrollView / wrong flex swallowing the resize
- The message list must be `flex: 1` and the composer a fixed sibling BELOW it,
  both inside the KAV. If the composer is `position:absolute` or outside the KAV,
  it won't ride up.
- Don't nest the whole thing in a `ScrollView` — the list is the scroller.
- On Android also set, in `app.json`:
  `"android": { "softwareKeyboardLayoutMode": "pan" }` (Expo) — or ensure
  `windowSoftInputMode` is `adjustResize`. Wrong mode = keyboard overlaps.

### Web equivalent (if this is a web chat)
`KeyboardAvoidingView` is RN-only. On web:
- Use `100dvh` (dynamic viewport height) not `100vh` for the chat container so it
  shrinks when the mobile keyboard opens.
- Or listen to `visualViewport` resize and set the composer's bottom to
  `window.innerHeight - visualViewport.height`.
- Keep the composer `position: sticky; bottom: 0` inside a flex column where the
  message list is `flex: 1; overflow-y: auto`.

### Verify the fix
Open the thread, focus the input: the input should sit **flush on top of the
keyboard**, the last message visible above it, no gap, no overlap. Type multiple
lines — it grows without being covered.

---

# PART 4 — The bubble meta line (sending / sent / failed)
Under each outgoing bubble, ONE line that swaps by state:
- `sending` → "Sending" + animated dots (PART: TypingDots)
- `sent`    → the timestamp (12h)
- `failed`  → "Failed — tap to retry" in the error color, the whole row tappable

```tsx
{failed ? (
  <Pressable onPress={() => onRetry(msg)} className="row">
    <Icon name="alert" /> <Text>Failed — tap to retry</Text>
  </Pressable>
) : sending ? (
  <View className="row"><Text>Sending</Text><TypingDots /></View>
) : (
  <Text>{time12h(msg.sent_at)}</Text>
)}
```

## TypingDots (animated "sending", reduce-motion aware) — full component
```tsx
export function TypingDots({ color, size = 4 }: { color: string; size?: number }) {
  const dots = [useRef(new Animated.Value(0.3)).current,
                useRef(new Animated.Value(0.3)).current,
                useRef(new Animated.Value(0.3)).current];
  useEffect(() => {
    let reduce = false, cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(r => { reduce = r; });
    const loops = dots.map((d, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 150),
      Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(d, { toValue: 0.3, duration: 300, useNativeDriver: true }),
      Animated.delay((2 - i) * 150),
    ])));
    if (!reduce) loops.forEach(l => !cancelled && l.start());
    return () => { cancelled = true; loops.forEach(l => l.stop()); };
  }, []);
  return (
    <View style={{ flexDirection: "row", gap: size - 1 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: size, height: size,
          borderRadius: size / 2, backgroundColor: color, opacity: d }} />
      ))}
    </View>
  );
}
```

---

# PART 5 — Wrapping it in a design system
Everything above is **behavior**. Skin it with tokens so it matches the app:
- Bubbles: outgoing = your accent fill + white text; incoming = surface +
  hairline border + ink text. Radius ~20, with one corner tightened
  (`borderBottomRightRadius: 6` on outgoing) for the "tail" look.
- Composer pill: `bg` fill, `border` hairline, radius ~24, the input transparent.
- Buttons: primary action = soft-tinted circle; send = accent-strong circle;
  icons ~18–21px. All ≥40pt touch targets.
- Spacing: 16 padding on the list, 1.5–2 between bubbles, generous line-height.
- Timestamps/meta in ink-4 at ~10.5px.
Keep the *values* from the target app's design system; keep the *interactions*
from this guide.

## Full port checklist (UI additions)
- [ ] Left primary action pinned; never moves
- [ ] Right slot: media icons ⇄ Send, cross-faded in a FIXED-size box (no reflow)
- [ ] Animate the swap ~150ms ease-out; flip pointerEvents with state
- [ ] Clear input synchronously before firing send
- [ ] Multiline input, maxHeight cap, grows then scrolls, resets on send
- [ ] KeyboardAvoidingView: padding(iOS)/height(Android), correct offset
- [ ] Drop composer bottom inset while keyboard is up (keyboardWillShow/Hide)
- [ ] Android adjustResize / softwareKeyboardLayoutMode: pan
- [ ] (web) 100dvh + visualViewport handling, sticky composer
- [ ] Meta line swaps sending(dots)/sent(time)/failed(retry)
- [ ] Reduce-motion aware animations

