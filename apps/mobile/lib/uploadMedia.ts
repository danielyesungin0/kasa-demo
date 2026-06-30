// Upload a locally-picked/recorded file to the public `message-media` Storage
// bucket and return its public URL. Instagram can only send media by URL, so
// this is the bridge between capture and send.
import { supabase } from "./supabase";

export type UploadKind = "image" | "video" | "audio";

const EXT: Record<UploadKind, string> = { image: "jpg", video: "mp4", audio: "m4a" };
const CONTENT_TYPE: Record<UploadKind, string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/m4a",
};

/** Reads a local file:// uri and uploads it. Returns the public URL (or null). */
export async function uploadMedia(localUri: string, kind: UploadKind): Promise<string | null> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user?.id ?? "anon";

    // Fetch the local file into an ArrayBuffer (RN fetch supports file:// uris).
    const res = await fetch(localUri);
    const bytes = await res.arrayBuffer();

    // Vary the name by index-free uniqueness: uid + a counter from the byte
    // length + last path segment, to avoid Date.now()/random (and collisions).
    const tail = localUri.split("/").pop()?.split(".")[0]?.slice(-12) ?? "file";
    const path = `${uid}/${tail}-${bytes.byteLength}.${EXT[kind]}`;

    const { error } = await supabase.storage
      .from("message-media")
      .upload(path, bytes, { contentType: CONTENT_TYPE[kind], upsert: true });
    if (error) {
      console.warn("[uploadMedia] upload failed:", error.message);
      return null;
    }
    const { data } = supabase.storage.from("message-media").getPublicUrl(path);
    return data.publicUrl ?? null;
  } catch (e) {
    console.warn("[uploadMedia] threw:", (e as Error).message);
    return null;
  }
}
