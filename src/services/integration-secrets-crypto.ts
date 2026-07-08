import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const CIPHER = "aes-256-gcm";
const VERSION_PREFIX = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function decodeMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const hexLike = /^[0-9a-f]+$/i.test(trimmed) && trimmed.length === KEY_BYTES * 2;
  const key = hexLike ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("INTEGRATION_SECRETS_MASTER_KEY must decode to 32 bytes");
  }
  return key;
}

function getMasterKey(): Buffer {
  const raw = process.env.INTEGRATION_SECRETS_MASTER_KEY ?? process.env.ENCRYPTION_SECRET;
  if (!raw) {
    throw new Error("INTEGRATION_SECRETS_MASTER_KEY or ENCRYPTION_SECRET is required for encrypted integration secrets");
  }
  return decodeMasterKey(raw);
}

export function encryptSecretPayload(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecretPayload(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION_PREFIX) {
    throw new Error("Unsupported integration secret ciphertext format");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const encrypted = Buffer.from(parts[3], "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Invalid integration secret ciphertext");
  }
  const decipher = createDecipheriv(CIPHER, getMasterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
