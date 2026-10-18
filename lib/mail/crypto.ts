import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Cifrado de la contraseña SMTP guardada en la base (AES-256-GCM).
//
// La clave se deriva con HKDF-SHA256 de SUPABASE_SERVICE_ROLE_KEY para no
// exigir otra variable de entorno. Si se rota la service role key, la
// contraseña guardada deja de poder leerse y hay que volver a escribirla en
// Configuración → Correo.
//
// scripts/mail-crypto.mjs repite esta misma lógica para el script crear-admin;
// si cambias el formato o las constantes, cámbialas en ambos sitios (hay una
// prueba que verifica que sean compatibles).

const VERSION = "v1";
const HKDF_SALT = "crm-muscleshop/app_mail_settings";
const HKDF_INFO = "smtp-password/aes-256-gcm/v1";
const IV_BYTES = 12;

function deriveKey(secret: string): Buffer {
  if (!secret) throw new Error("mail_secret_missing");
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, 32));
}

/** Clave base para cifrar: la service role key de Supabase. */
export function mailSecretFromEnv(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
}

/** Devuelve "v1.<iv>.<tag>.<cifrado>" en base64url. */
export function encryptSecret(plain: string, secret: string = mailSecretFromEnv()): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

/** Descifra lo que produjo `encryptSecret`; lanza error si la clave no coincide. */
export function decryptSecret(payload: string, secret: string = mailSecretFromEnv()): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("mail_secret_format");
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
