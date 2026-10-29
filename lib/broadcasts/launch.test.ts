// A-9: una difusión no se manda dos veces al mismo cliente (doble clic, dos
// administradores, reintento tras un error a medias).

import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { ALREADY_SENDING_MESSAGE, LAUNCH_FAILED_MESSAGE, launchBroadcast, type LaunchParams } from "./launch";

const WS = "ws-1";
let fake: FakeDb;
let broadcastId: string;

const PROMO = { kind: "template" as const, template_name: "promo", language: "es", params: ["{nombre}"] };

function params(extra: Partial<LaunchParams> = {}): LaunchParams {
  return { workspaceId: WS, broadcastId, previousStatus: "draft", content: PROMO, filter: null, ...extra };
}

function broadcast() {
  return fake.rows("broadcasts").find((b) => b.id === broadcastId)!;
}

beforeEach(() => {
  fake = new FakeDb();
  fake.unique("broadcast_recipients", ["broadcast_id", "contact_id"]);
  fake.seed("workspaces", [{ id: WS, name: "Muscle Shop" }]);
  fake.seed("channels", [{ id: "ch-wa", workspace_id: WS, platform: "whatsapp", is_active: true }]);
  fake.seed("contacts", [
    { id: "c1", workspace_id: WS, display_name: "Ana Pérez", phone: "+51 987 654 321", is_subscribed: true },
    { id: "c2", workspace_id: WS, display_name: "Luis Gómez", phone: "+51 987 654 322", is_subscribed: true },
    { id: "c3", workspace_id: WS, display_name: "Baja Total", phone: "+51 987 654 323", is_subscribed: false },
  ]);
  const [b] = fake.seed("broadcasts", [
    { workspace_id: WS, name: "Promo", status: "draft", message_content: PROMO, total_recipients: 0 },
  ]);
  broadcastId = b.id as string;
});

describe("launchBroadcast", () => {
  it("crea un destinatario por contacto suscrito, programa un trabajo por cada uno y deja la difusión enviándose", async () => {
    const res = await launchBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: true, totalRecipients: 2 });
    expect(fake.rows("broadcast_recipients").map((r) => r.contact_id).sort()).toEqual(["c1", "c2"]);
    expect(fake.rows("scheduled_jobs")).toHaveLength(2);
    expect(broadcast()).toMatchObject({ status: "sending", total_recipients: 2 });
  });

  it("dos envíos a la vez (doble clic): solo uno prospera y no hay destinatarios repetidos", async () => {
    const [a, b] = await Promise.all([launchBroadcast(fake.asDb(), params()), launchBroadcast(fake.asDb(), params())]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser).toEqual({ ok: false, status: 409, error: ALREADY_SENDING_MESSAGE });
    expect(fake.rows("broadcast_recipients")).toHaveLength(2);
    expect(fake.rows("scheduled_jobs")).toHaveLength(2);
  });

  it("enviar una difusión que ya se está enviando o terminó responde 409 y no crea nada", async () => {
    broadcast().status = "completed";
    const res = await launchBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(fake.rows("broadcast_recipients")).toHaveLength(0);
    expect(fake.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("si falla a la mitad, deshace lo creado y la difusión vuelve a borrador (sin mensaje técnico)", async () => {
    fake.failNext.set("scheduled_jobs", "insert");
    const res = await launchBroadcast(fake.asDb(), params());
    expect(res).toEqual({ ok: false, status: 500, error: LAUNCH_FAILED_MESSAGE });
    expect(fake.rows("broadcast_recipients")).toHaveLength(0);
    expect(fake.rows("scheduled_jobs")).toHaveLength(0);
    expect(broadcast()).toMatchObject({ status: "draft", total_recipients: 0 });

    // El reintento funciona y deja un solo juego de destinatarios.
    const retry = await launchBroadcast(fake.asDb(), params());
    expect(retry).toMatchObject({ ok: true, totalRecipients: 2 });
    expect(fake.rows("broadcast_recipients")).toHaveLength(2);
  });

  it("si falla al crear los destinatarios, vuelve a su estado anterior (programada)", async () => {
    broadcast().status = "scheduled";
    fake.failNext.set("broadcast_recipients", "insert");
    const res = await launchBroadcast(fake.asDb(), params({ previousStatus: "scheduled" }));
    expect(res).toMatchObject({ ok: false, status: 500 });
    expect(broadcast().status).toBe("scheduled");
  });

  it("limpia restos pendientes de un intento anterior en lugar de duplicarlos", async () => {
    fake.seed("broadcast_recipients", [{ broadcast_id: broadcastId, contact_id: "c1", channel_id: "ch-wa", status: "pending" }]);
    const res = await launchBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: true, totalRecipients: 2 });
    expect(fake.rows("broadcast_recipients").filter((r) => r.contact_id === "c1")).toHaveLength(1);
  });

  it("guarda el contenido recibido junto con el reclamo", async () => {
    await launchBroadcast(fake.asDb(), params({ overrideContent: { kind: "template" } }));
    expect(broadcast().message_content).toMatchObject({ kind: "template", template_name: "promo" });
  });

  it("sin destinatarios válidos no reclama la difusión", async () => {
    fake.rows("contacts").forEach((c) => (c.phone = null));
    const res = await launchBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(broadcast().status).toBe("draft");
  });
});
