// ============================================================
// crypto — FAITHFUL Deno port of lib/crypto.ts. DO NOT redesign.
//
// AES-256-GCM, key derived from ENCRYPTION_KEY via scrypt. The on-disk format
// is preserved EXACTLY so tokens encrypted by the old Node app remain
// decryptable and vice-versa:
//   base64( salt[16] || iv[12] || authTag[16] || ciphertext )
//
// Implemented via `node:crypto` (Deno supports it) so the primitives —
// scryptSync, createCipheriv("aes-256-gcm"), getAuthTag — are byte-for-byte the
// same as the original. NOT reimplemented with WebCrypto, which would change the
// scheme and make existing ciphertext undecryptable.
//
// Preserved deliberate behaviors from the original:
//   - dev-mode passthrough when no key is configured
//   - legacy-plaintext fallback in decrypt (read rows stored before encryption)
//
// NOTE (flagged to owner, not silently changed): the original only throws on a
// missing key when NODE_ENV==="production". Edge Functions don't set that, so a
// missing ENCRYPTION_KEY would silently passthrough PLAINTEXT tokens. Because
// this path handles OAuth tokens, the CALLER (square-create-booking) refuses to
// run if ENCRYPTION_KEY is unset — see assertEncryptionKey(). The crypto
// functions themselves keep the original passthrough semantics unchanged.
// ============================================================

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { Buffer } from "node:buffer";

const ALGORITHM = "aes-256-gcm";
const SALT_LEN = 16;
const IV_LEN = 12; // 96 bits, recommended for GCM
const TAG_LEN = 16;
const KEY_LEN = 32;

function getMasterKey(): Buffer | null {
  const key = Deno.env.get("ENCRYPTION_KEY");
  if (!key || key.length < 32) return null;
  return Buffer.from(key, "utf8");
}

/** Hard guard for token-handling callers: refuse to operate without a key,
 *  rather than silently passing through plaintext OAuth tokens. */
export function assertEncryptionKey(): void {
  const key = Deno.env.get("ENCRYPTION_KEY");
  if (!key || key.length < 32) {
    throw new Error(
      "ENCRYPTION_KEY missing/short — refusing to handle Square tokens in plaintext",
    );
  }
}

export function encryptSecret(
  plaintext: string | null | undefined,
): string | null {
  if (plaintext == null) return null;
  if (plaintext === "") return "";

  const masterKey = getMasterKey();
  if (!masterKey) return plaintext; // dev-mode passthrough (unchanged)

  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(masterKey, salt, KEY_LEN);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  if (value === "") return "";

  const masterKey = getMasterKey();
  if (!masterKey) return value; // dev-mode passthrough (unchanged)

  let blob: Buffer;
  try {
    blob = Buffer.from(value, "base64");
  } catch {
    return value; // not base64 — legacy plaintext
  }

  if (blob.length < SALT_LEN + IV_LEN + TAG_LEN) return value;

  try {
    const salt = blob.subarray(0, SALT_LEN);
    const iv = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN);
    const authTag = blob.subarray(
      SALT_LEN + IV_LEN,
      SALT_LEN + IV_LEN + TAG_LEN,
    );
    const ciphertext = blob.subarray(SALT_LEN + IV_LEN + TAG_LEN);

    const key = scryptSync(masterKey, salt, KEY_LEN);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    return value; // auth-tag mismatch / malformed — assume legacy plaintext
  }
}
