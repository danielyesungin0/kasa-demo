// Normalize message media (from the `messages.media` jsonb) into a simple list
// of {type,url}. Instagram delivers attachments as:
//   [{ type: "image"|"video"|"audio"|"file"|"share"|"story_mention", payload: { url } }]
// We also tolerate a few other shapes (bare url strings, {url}) so any channel
// that stores media lands here cleanly.
export type MediaItem = { type: "image" | "video" | "audio" | "file"; url: string };

export function parseMedia(raw: unknown): MediaItem[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: MediaItem[] = [];
  for (const a of arr) {
    if (!a) continue;
    if (typeof a === "string") { out.push({ type: "image", url: a }); continue; }
    const o = a as any;
    const url: string | undefined = o.payload?.url ?? o.url ?? o.src;
    if (!url) continue;
    const t = String(o.type ?? "image").toLowerCase();
    const type: MediaItem["type"] =
      t.includes("video") ? "video" : t.includes("audio") ? "audio" : t.includes("image") ? "image" : "file";
    out.push({ type, url });
  }
  return out;
}
