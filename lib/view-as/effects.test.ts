// Efectos externos: con una vista de "Ver como" activa (cookie de candado) no
// sale ningún correo ni mensaje por Zernio.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  sendMail: vi.fn(async () => ({})),
  sendInboxMessage: vi.fn(async () => ({ data: { data: { messageId: "m1" } } })),
  createInboxConversation: vi.fn(async () => ({ data: { data: { messageId: "m2" } } })),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "crm_view_as" && state.cookie ? { value: state.cookie } : undefined),
    set: () => {},
  }),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: state.sendMail }) } }));
vi.mock("@/lib/mail/settings", () => ({
  resolveMailConfig: async () => ({
    host: "smtp.test",
    port: 587,
    security: "starttls",
    username: "u",
    password: "p",
    fromName: "CRM",
    fromEmail: "crm@test.pe",
  }),
  recordMailResult: async () => {},
}));
vi.mock("@/lib/workspace-secrets", () => ({ getLateApiKey: async () => "key" }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({
    messages: { sendInboxMessage: state.sendInboxMessage, createInboxConversation: state.createInboxConversation },
  }),
}));

import { sendAppMail } from "@/lib/mail/send";
import { zernioMessenger } from "@/lib/cases/messaging";
import type { Db } from "@/lib/cases/io";

const content = { subject: "Hola", html: "<p>Hola</p>", text: "Hola" };
const textInput = { workspaceId: "w", lateConversationId: "c", lateAccountId: "a", text: "hola" };
const tplInput = { workspaceId: "w", lateAccountId: "a", phone: "51999999999", templateName: "t", language: "es", params: [] };

beforeEach(() => {
  state.cookie = undefined;
  state.sendMail.mockClear();
  state.sendInboxMessage.mockClear();
  state.createInboxConversation.mockClear();
});

describe("correo", () => {
  it("sin vista, el correo sale", async () => {
    const res = await sendAppMail({ from: () => ({}) }, "a@b.pe", content);
    expect(res.ok).toBe(true);
    expect(state.sendMail).toHaveBeenCalledTimes(1);
  });

  it("con vista activa no sale (tampoco con una cookie falsa)", async () => {
    for (const cookie of ["a.b.1", "basura"]) {
      state.cookie = cookie;
      const res = await sendAppMail({ from: () => ({}) }, "a@b.pe", content);
      expect(res).toMatchObject({ ok: false, notConfigured: false });
      expect(res.ok === false && res.error).toContain("solo lectura");
    }
    expect(state.sendMail).not.toHaveBeenCalled();
  });
});

describe("envío de mensajes por Zernio", () => {
  const messenger = () => zernioMessenger({} as Db);

  it("sin vista, sale", async () => {
    expect((await messenger().sendText(textInput)).ok).toBe(true);
    expect((await messenger().sendTemplate(tplInput)).ok).toBe(true);
    expect(state.sendInboxMessage).toHaveBeenCalledTimes(1);
    expect(state.createInboxConversation).toHaveBeenCalledTimes(1);
  });

  it("con vista activa no se llama a Zernio", async () => {
    state.cookie = "x.y.1";
    const a = await messenger().sendText(textInput);
    const b = await messenger().sendTemplate(tplInput);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(state.sendInboxMessage).not.toHaveBeenCalled();
    expect(state.createInboxConversation).not.toHaveBeenCalled();
  });

  it("tampoco en canales de prueba (no guarda mensajes)", async () => {
    state.cookie = "x.y.1";
    const res = await messenger().sendText({ ...textInput, lateAccountId: "demo_x" });
    expect(res.ok).toBe(false);
  });
});
