// Tiny stale-while-revalidate cache shared across screens. The reason the app
// felt slow: every hook started loading=true and refetched on each mount, so
// navigating between tabs re-ran the same query and showed a skeleton again.
//
// With this, a hook seeds its initial state synchronously from the last cached
// value (instant, no skeleton) and revalidates in the background. Switching tabs
// shows data immediately; it quietly refreshes. No external dependency.
//
// In-memory only (per app session) — that's enough to make navigation instant;
// it intentionally doesn't persist across cold starts.

type Entry<T> = { value: T; at: number };
const store = new Map<string, Entry<unknown>>();
const subs = new Map<string, Set<() => void>>();

export function getCache<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}

export function setCache<T>(key: string, value: T): void {
  store.set(key, { value, at: Date.now() });
  subs.get(key)?.forEach((fn) => fn());
}

/** Subscribe to writes for a key (so other mounted screens update live). */
export function subscribeCache(key: string, fn: () => void): () => void {
  let set = subs.get(key);
  if (!set) { set = new Set(); subs.set(key, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}

/** ms since this key was last written, or Infinity if never. */
export function cacheAge(key: string): number {
  const e = store.get(key);
  return e ? Date.now() - e.at : Infinity;
}
