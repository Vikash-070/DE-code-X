/**
 * AES-256-GCM symmetric encryption for user API keys.
 *
 * SECURITY INVARIANTS:
 * - Encryption key lives only in ENCRYPTION_KEY env variable (server-side)
 * - Raw user keys never touch localStorage or browser network payloads
 * - A fresh IV is generated per encryption call (no IV reuse)
 * - Auth tag is appended and verified on every decryption
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES   = 12;   // 96-bit IV — recommended for GCM
const TAG_BYTES  = 16;   // 128-bit auth tag

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars). Got ${key.length} bytes.`
    );
  }
  return key;
}

/**
 * Encrypt a plaintext string.
 * Returns: `<iv_hex>:<ciphertext_hex>:<tag_hex>`
 */
export function encryptKey(plaintext: string): string {
  const key  = getKey();
  const iv   = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
}

/**
 * Decrypt a value produced by encryptKey().
 * Throws on tampered data (auth tag mismatch).
 */
export function decryptKey(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted key format — expected iv:ciphertext:tag");
  }

  const [ivHex, ctHex, tagHex] = parts as [string, string, string];
  const key  = getKey();
  const iv   = Buffer.from(ivHex, "hex");
  const ct   = Buffer.from(ctHex, "hex");
  const tag  = Buffer.from(tagHex, "hex");

  if (tag.length !== TAG_BYTES) {
    throw new Error("Auth tag has unexpected length — possible data corruption");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(ct).toString("utf8") + decipher.final("utf8");
}

/** Redact a key for safe display: show only first 8 chars. */
export function redactKey(rawKey: string): string {
  if (rawKey.length <= 8) return "••••••••";
  return `${rawKey.slice(0, 8)}${"•".repeat(Math.min(rawKey.length - 8, 24))}`;
}
