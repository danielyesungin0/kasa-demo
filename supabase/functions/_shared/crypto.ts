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
// Preserved deliberate behavior from the original:
//   - legacy-plaintext fallback in decrypt (read rows stored before encryption)
//
// CHANGED vs the original (corrected check, NOT a redesign): the old code only
// threw on a missing key when NODE_ENV==="production" and otherwise PASSED
// PLAINTEXT THROUGH. That NODE_ENV gate is a Node assumption that's wrong in
// Edge Functions (NODE_ENV is unset there), so it would silently store/return
// plaintext tokens. Crypto is shared code — any future importer must be
// physically unable to hit the plaintext path. So encrypt/decrypt now HARD-FAIL
// at the point of use when ENCRYPTION_KEY is missing/short, regardless of
// runtime. The AES-256-GCM scheme + on-disk format are byte-for-byte identical
// to the original, so existing ciphertext still decrypts — ONLY the
// missing-key behavior changed (throw, never passthrough).
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

/** Returns the master key, or THROWS if ENCRYPTION_KEY is missing/short.
 *  Never returns null — there is no plaintext-passthrough path anymore. */
function getMasterKey(): Buffer {
  const key = Deno.env.get("ENCRYPTION_KEY");
  if (!key || key.length < 32) {
    throw new Error(
      "ENCRYPTION_KEY missing/short — refusing to handle secrets in plaintext",
    );
  }
  return Buffer.from(key, "utf8");
}

/** Belt-and-suspenders guard callers can run up front to fail fast before doing
 *  any work. encrypt/decrypt also hard-fail on their own (see getMasterKey). */
export function assertEncryptionKey(): void {
  getMasterKey();
}

export function encryptSecret(
  plaintext: string | null | undefined,
): string | null {
  if (plaintext == null) return null;
  if (plaintext === "") return "";

  const masterKey = getMasterKey(); // throws if no key — never passthrough

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

  const masterKey = getMasterKey(); // throws if no key — never passthrough

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
