// PRIV-05: el consentimiento se vuelve a mirar justo antes de cada envío.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const sent = vi.hoisted(() => ({ template: vi.fn(), text: vi.fn() }));

vi.mock("./delivery", async (importOriginal) => {
  const real = await importOriginal<typeof import("./delivery")>();
  return {
    ...real,
    loadDeliveryContext: vi.fn(async () => ({}) as never),
    sendTemplateToContact: sent.template,
    sendTextToContact: sent.text,
  };
});

import { deliverBroadcast } from "./deliver";

const WS = "ws-1";
let fake: FakeDb;

const TEMPLATE = { kind: "template", template_name: "promo", language: "es", params: [] };
const TEXT = { kind: "text", text: "Hola, tenemos ofertas" };

function deliver(content: unknown, contactId = "c1") {
  return deliverBroadcast(fake.asDb(), { workspaceId: WS, contactId, channelId: "ch-1", messageContent: content });
}

beforeEach(() => {
  fake = new FakeDb();
  sent.template.mockReset().mockResolvedValue({ ok: true, messageId: "m1" });
  sent.text.mockReset().mockResolvedValue({ ok: true, messageId: "m2" });
  fake.seed("contacts", [
    { id: "c1", workspace_id: WS, marketing_status: "accepted" },
    { id: "c2", workspace_id: WS, marketing_status: "opted_out", is_subscribed: false },
    { id: "c3", workspace_id: WS, marketing_status: "unknown" },
    { id: "c4", workspace_id: WS, marketing_status: "accepted", erased_at: "2026-11-01T00:00:00Z" },
    { id: "c5", workspace_id: WS },
  ]);
});

describe("deliverBroadcast", () => {
  it("envía a quien sigue con consentimiento (plantilla y texto)", async () => {
    expect(await deliver(TEMPLATE)).toMatchObject({ ok: true });
    expect(await deliver(TEXT)).toMatchObject({ ok: true });
    expect(sent.template).toHaveBeenCalledTimes(1);
    expect(sent.text).toHaveBeenCalledTimes(1);
  });

  it("quien se dio de baja después de lanzar la difusión no recibe nada", async () => {
    const res = await deliver(TEMPLATE, "c2");
    expect(res).toEqual({ ok: false, skipped: true, error: "Omitido: el cliente se dio de baja de la publicidad." });
    expect(await deliver(TEXT, "c2")).toMatchObject({ ok: false, skipped: true });
    expect(sent.template).not.toHaveBeenCalled();
    expect(sent.text).not.toHaveBeenCalled();
  });

  it("sin consentimiento registrado, con los datos eliminados o sin dato, tampoco", async () => {
    for (const id of ["c3", "c4", "c5", "no-existe"]) {
      expect(await deliver(TEMPLATE, id)).toMatchObject({ ok: false, skipped: true });
    }
    expect(sent.template).not.toHaveBeenCalled();
  });

  it("si no se puede leer el contacto, no envía y avisa como fallo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.failNext.set("contacts", "select");
    const res = await deliver(TEMPLATE);
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("No se pudo comprobar") });
    expect(res).not.toHaveProperty("skipped");
    // No depende del contacto: si pasa muchas veces seguidas, la difusión se pausa sola.
    expect(res).toMatchObject({ general: true });
    expect(sent.template).not.toHaveBeenCalled();
  });

  it("un contenido inválido sigue siendo un fallo, y es general (no del contacto)", async () => {
    expect(await deliver({ kind: "otra" })).toMatchObject({ ok: false, general: true });
  });

  it("omitir por consentimiento no es un fallo general", async () => {
    expect(await deliver(TEMPLATE, "c2")).not.toHaveProperty("general");
  });
});
