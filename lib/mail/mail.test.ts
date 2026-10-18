import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";
import * as scriptCrypto from "../../scripts/mail-crypto.mjs";
import {
  isRowComplete,
  mailConfigFromEnv,
  mailStatus,
  parseFromAddress,
  translateSmtpError,
  validateMailSettingsInput,
  type MailSettingsRow,
} from "./config";
import { escapeHtml, inviteEmail, resetPasswordEmail, testEmail } from "./templates";

const SECRET = "clave-de-prueba-que-no-es-real";

describe("cifrado de la contraseña SMTP", () => {
  it("cifra y descifra", () => {
    const payload = encryptSecret("token-smtp-123", SECRET);
    expect(payload.startsWith("v1.")).toBe(true);
    expect(payload).not.toContain("token-smtp-123");
    expect(decryptSecret(payload, SECRET)).toBe("token-smtp-123");
  });

  it("usa un IV distinto cada vez", () => {
    expect(encryptSecret("x", SECRET)).not.toBe(encryptSecret("x", SECRET));
  });

  it("falla con otra clave o con datos alterados", () => {
    const payload = encryptSecret("token", SECRET);
    expect(() => decryptSecret(payload, "otra-clave")).toThrow();
    const parts = payload.split(".");
    parts[3] = Buffer.from("otro").toString("base64url");
    expect(() => decryptSecret(parts.join("."), SECRET)).toThrow();
    expect(() => decryptSecret("texto-plano", SECRET)).toThrow();
  });

  it("es compatible con scripts/mail-crypto.mjs", () => {
    expect(scriptCrypto.decryptSecret(encryptSecret("desde-ts", SECRET), SECRET)).toBe("desde-ts");
    expect(decryptSecret(scriptCrypto.encryptSecret("desde-mjs", SECRET), SECRET)).toBe("desde-mjs");
  });
});

const validInput = {
  host: "smtp.zeptomail.com",
  port: "587",
  security: "starttls",
  username: "emailapikey",
  password: "token",
  fromEmail: "no-responder@tienda.pe",
  fromName: "CRM Tienda",
};

describe("validateMailSettingsInput", () => {
  it("acepta una configuración completa", () => {
    const result = validateMailSettingsInput(validInput, false);
    expect(result.error).toBeNull();
    expect(result.value).toMatchObject({ port: 587, security: "starttls", password: "token" });
  });

  it("permite dejar la contraseña vacía si ya hay una guardada", () => {
    expect(validateMailSettingsInput({ ...validInput, password: "" }, true).value?.password).toBeNull();
    expect(validateMailSettingsInput({ ...validInput, password: "" }, false).error).toMatch(/contraseña/);
  });

  it("rechaza datos inválidos", () => {
    expect(validateMailSettingsInput({ ...validInput, host: "smtp mal" }, true).error).toMatch(/servidor/);
    expect(validateMailSettingsInput({ ...validInput, port: "70000" }, true).error).toMatch(/puerto/);
    expect(validateMailSettingsInput({ ...validInput, security: "tls" }, true).error).toMatch(/seguridad/);
    expect(validateMailSettingsInput({ ...validInput, username: " " }, true).error).toMatch(/usuario/);
    expect(validateMailSettingsInput({ ...validInput, fromEmail: "nada" }, true).error).toMatch(/remitente/);
    expect(validateMailSettingsInput({ ...validInput, fromName: "Hola <x>" }, true).error).toMatch(/remitente/);
  });
});

const emptyRow: MailSettingsRow = {
  id: 1,
  host: null,
  port: null,
  security: null,
  username: null,
  password_encrypted: null,
  from_email: null,
  from_name: null,
  last_error: null,
  last_error_at: null,
  last_success_at: null,
  updated_at: null,
};

const fullRow: MailSettingsRow = {
  ...emptyRow,
  host: "smtp.zeptomail.com",
  port: 587,
  security: "starttls",
  username: "emailapikey",
  password_encrypted: "v1.x.y.z",
  from_email: "no-responder@tienda.pe",
};

describe("mailStatus", () => {
  it("sin configurar por defecto", () => {
    expect(mailStatus(null, false).state).toBe("unconfigured");
    expect(mailStatus(emptyRow, false).state).toBe("unconfigured");
    expect(isRowComplete(emptyRow)).toBe(false);
  });

  it("configurado con la tabla o con variables de entorno", () => {
    expect(mailStatus(fullRow, false)).toMatchObject({ state: "configured", source: "db" });
    expect(mailStatus(null, true)).toMatchObject({ state: "configured", source: "env" });
  });

  it("muestra el último error solo si es posterior al último envío correcto", () => {
    const withError = {
      ...fullRow,
      last_error: "falló",
      last_error_at: "2026-10-18T12:00:00Z",
      last_success_at: "2026-10-18T11:00:00Z",
    };
    expect(mailStatus(withError, false)).toMatchObject({ state: "error", lastError: "falló" });
    expect(
      mailStatus({ ...withError, last_success_at: "2026-10-18T13:00:00Z" }, false),
    ).toMatchObject({ state: "configured", lastError: null });
  });
});

describe("mailConfigFromEnv y parseFromAddress", () => {
  it("lee las variables SMTP_* y MAIL_FROM", () => {
    const config = mailConfigFromEnv(
      {
        SMTP_HOST: "smtp.zeptomail.com",
        SMTP_PORT: "465",
        SMTP_USER: "emailapikey",
        SMTP_PASS: "token",
        MAIL_FROM: "CRM Tienda <no-responder@tienda.pe>",
      },
      "CRM",
    );
    expect(config).toMatchObject({
      source: "env",
      port: 465,
      security: "ssl",
      fromEmail: "no-responder@tienda.pe",
      fromName: "CRM Tienda",
    });
  });

  it("devuelve null si falta algo", () => {
    expect(mailConfigFromEnv({ SMTP_HOST: "x" }, "CRM")).toBeNull();
  });

  it("separa nombre y correo", () => {
    expect(parseFromAddress("no-responder@tienda.pe")).toEqual({ name: "", email: "no-responder@tienda.pe" });
    expect(parseFromAddress('"Tienda" <A@Tienda.pe>')).toEqual({ name: "Tienda", email: "a@tienda.pe" });
    expect(parseFromAddress("sin correo")).toBeNull();
  });
});

describe("translateSmtpError", () => {
  it("traduce los errores típicos", () => {
    expect(translateSmtpError({ code: "EAUTH", responseCode: 535 })).toMatch(/usuario o la contraseña/);
    expect(translateSmtpError({ code: "ENOTFOUND" })).toMatch(/No se encontró/);
    expect(translateSmtpError({ code: "ETIMEDOUT" })).toMatch(/No se pudo conectar/);
    expect(translateSmtpError(new Error("algo"))).toMatch(/No se pudo enviar/);
  });
});

describe("plantillas", () => {
  it("escapan el HTML", () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
  });

  it("la invitación incluye el enlace, el nombre de la app y no inyecta HTML", () => {
    const mail = inviteEmail({
      name: "<script>Ana</script>",
      url: "https://crm.example.pe/auth/confirm?token_hash=a&type=invite",
      inviterName: "Luis",
      workspaceName: "Tienda",
      appName: "CRM Tienda",
    });
    expect(mail.subject).toBe("Activa tu cuenta en CRM Tienda");
    expect(mail.html).toContain("token_hash=a&amp;type=invite");
    expect(mail.html).not.toContain("<script>");
    expect(mail.text).toContain("https://crm.example.pe/auth/confirm?token_hash=a&type=invite");
  });

  it("recuperación y prueba usan el nombre de la app", () => {
    expect(resetPasswordEmail({ url: "https://x", appName: "CRM Gym" }).subject).toContain("CRM Gym");
    expect(testEmail({ appName: "CRM Gym" }).subject).toBe("Correo de prueba de CRM Gym");
  });
});
