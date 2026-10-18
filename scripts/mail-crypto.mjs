// Copia en JavaScript de lib/mail/crypto.ts para los scripts de Node (que no
// cargan TypeScript). Mantén las constantes y el formato idénticos: la prueba
// lib/mail/crypto.test.ts verifica que ambos sean compatibles.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const HKDF_SALT = "crm-muscleshop/app_mail_settings";
const HKDF_INFO = "smtp-password/aes-256-gcm/v1";
const IV_BYTES = 12;

function deriveKey(secret) {
  if (!secret) throw new Error("mail_secret_missing");
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, 32));
}

export function encryptSecret(plain, secret) {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload, secret) {
  const parts = String(payload).split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("mail_secret_format");
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
