import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = createHash("sha256").update(env.SESSION_SECRET).digest();

export function encryptSecret(secret: string) {
  const normalized = secret.trim();
  if (!normalized) {
    throw new Error("Секрет не может быть пустым.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string | null | undefined) {
  if (!payload) {
    return null;
  }

  const [ivBase64, tagBase64, encryptedBase64] = payload.split(".");
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error("Секрет повреждён и не может быть расшифрован.");
  }

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(ivBase64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function getSecretLastFour(secret: string) {
  const normalized = secret.trim();
  return normalized.slice(-4);
}
