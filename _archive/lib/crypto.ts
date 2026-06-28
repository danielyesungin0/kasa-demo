import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * Application-level AES-256-GCM encryption for sensitive fields stored
 * in Supabase (Square OAuth tokens, refresh tokens). The encryption key
 * is derived from ENCRYPTION_KEY in env.
 *
 * Format: base64( salt[16] || iv[12] || authTag[16] || ciphertext )
 *
 * If ENCRYPTION_KEY is missing, we fall back to passthrough so existing
 * dev DBs don't break. Production deployments MUST set the key — there's
 * a startup check below.
 */

const ALGORITHM = "aes-256-gcm";
const SALT_LEN = 16;
const IV_LEN = 12; // 96 bits, recommended for GCM
const TAG_LEN = 16;
const KEY_LEN = 32;

function getMasterKey(): Buffer | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    if (process.env.NODE_ENV === "production") {
      // Loud failure in production — never silently store plaintext.
      throw new Error(
        "ENCRYPTION_KEY env var must be set to a 32+ character secret in production"
      );
    }
    return null;
  }
  return Buffer.from(key, "utf8");
}

/**
 * Encrypts plaintext. Returns base64-encoded blob, or the original string
 * unchanged if no encryption key is configured (dev-mode passthrough).
 *
 * Each call produces a fresh salt + IV, so re-encrypting the same value
 * yields different ciphertext. That's correct GCM behaviour.
 */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  if (plaintext === "") return "";

  const masterKey = getMasterKey();
  if (!masterKey) return plaintext; // dev-mode passthrough

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

/**
 * Decrypts a value produced by encryptSecret. If the value doesn't look
 * encrypted (no key configured, or value stored before encryption was
 * enabled), returns it unchanged so we can read legacy plaintext rows.
 */
export function decryptSecret(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (value === "") return "";

  const masterKey = getMasterKey();
  if (!masterKey) return value; // dev-mode passthrough

  let blob: Buffer;
  try {
    blob = Buffer.from(value, "base64");
  } catch {
    return value; // not base64 — must be legacy plaintext
  }

  // Encrypted blobs are at least salt + iv + tag long; anything shorter is plaintext.
  if (blob.length < SALT_LEN + IV_LEN + TAG_LEN) return value;

  try {
    const salt = blob.subarray(0, SALT_LEN);
    const iv = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN);
    const authTag = blob.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
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
    // Auth tag mismatch or malformed — assume legacy plaintext.
    return value;
  }
}
