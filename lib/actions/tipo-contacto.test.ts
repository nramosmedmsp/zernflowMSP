// Tanda 9: acciones de servidor del tipo de contacto (cambio a mano que confirma,
// «Preguntar después», permisos), lectura para el chat y Configuración
// (descripción, conteo por tipo, inactividad automática), con getWorkspace y los
// clientes simulados sobre la base en memoria.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { ADMIN_ONLY_MESSAGE } from "@/lib/permissions";
import { loadContactTypeInfo } from "@/lib/cases/contact-type";
import { shouldAskContactType } from "@/lib/cases/contact-type-model";

const state = vi.hoisted(() => ({ fake: null as unknown, userId: "", workspaceId: "", role: "member" }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    viewAs: { locked: false, active: false, ended: false, info: null },
    user: { id: state.userId },
    workspace: { id: state.workspaceId },
    role: state.role,
    supabase: state.fake,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.fake,
  createClient: async () => state.fake,
}));

import { snoozeContactTypePrompt, updateContactType } from "./contacts";
import { getCaseConfig, saveContactTypeInactivity, updateContactType as updateContactTypeConfig } from "./case-config";

const WS = randomUUID();
const OWNER = randomUUID();
const ANA = randomUUID();
const BETO = randomUUID();

let fake: FakeDb;
let contactId: string;
let tipo: (name: string) => string;

function as(userId: string, role: string) {
  state.userId = userId;
  state.role = role;
}
const contactRow = () => fake.rows("contacts").find((c) => c.id === contactId)!;
const changes = () => fake.rows("activity").filter((a) => a.type === "contact_type_changed");

beforeEach(async () => {
  fake = new FakeDb();
  state.fake = fake;
  state.workspaceId = WS;
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: BETO, role: "member" },
  ]);
  await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "ecommerce");
  tipo = (name) => fake.rows("contact_types").find((t) => t.name === name)!.id as string;
  // Ana es la responsable: ve el contacto. Beto no tiene relación con él.
  const [contact] = fake.seed("contacts", [
    { workspace_id: WS, display_name: "María Fernanda", owner_id: ANA, contact_type_id: tipo("Prospecto") },
  ]);
  contactId = contact.id as string;
  as(ANA, "member");
});

describe("cambiar el tipo a mano", () => {
  it("lo cambia, lo confirma (quién y cuándo) y deja el historial con origen 'manual'", async () => {
    expect(await updateContactType(contactId, tipo("Cliente"))).toEqual({ ok: true });
    expect(contactRow()).toMatchObject({ contact_type_id: tipo("Cliente"), contact_type_confirmed_by: ANA });
    expect(contactRow().contact_type_confirmed_at).toBeTruthy();
    expect(changes()).toHaveLength(1);
    expect(changes()[0]).toMatchObject({ actor_id: ANA, from_value: tipo("Prospecto"), to_value: tipo("Cliente") });
    expect(changes()[0].meta).toMatchObject({ source: "manual", reason: "manual" });
  });

  it("elegir el tipo que ya tiene (p. ej. «Es nuevo · Prospecto») solo lo confirma, sin historial", async () => {
    expect(await updateContactType(contactId, tipo("Prospecto"))).toEqual({ ok: true });
    expect(contactRow().contact_type_id).toBe(tipo("Prospecto"));
    expect(contactRow().contact_type_confirmed_by).toBe(ANA);
    expect(changes()).toHaveLength(0);
    const info = await loadContactTypeInfo(fake.asDb(), contactId, contactRow());
    expect(shouldAskContactType(info, new Date())).toBe(false);
  });

  it("repetirlo no cambia quién lo confirmó", async () => {
    await updateContactType(contactId, tipo("Prospecto"));
    const firstAt = contactRow().contact_type_confirmed_at;
    as(OWNER, "owner");
    await updateContactType(contactId, tipo("Prospecto"));
    expect(contactRow().contact_type_confirmed_by).toBe(ANA);
    expect(contactRow().contact_type_confirmed_at).toBe(firstAt);
  });

  it("quien no ve el contacto no puede cambiarlo ni posponerlo; un tipo archivado no sirve", async () => {
    as(BETO, "member");
    expect(await updateContactType(contactId, tipo("Cliente"))).toEqual({ error: "No se encontró el contacto." });
    expect(await snoozeContactTypePrompt(contactId)).toEqual({ error: "No se encontró el contacto." });
    expect(contactRow().contact_type_id).toBe(tipo("Prospecto"));
    expect(contactRow().contact_type_prompt_snoozed_until ?? null).toBeNull();

    as(ANA, "member");
    fake.rows("contact_types").find((t) => t.name === "Inactivo")!.archived_at = "2026-01-01T00:00:00.000Z";
    expect(await updateContactType(contactId, tipo("Inactivo"))).toEqual({ error: "El tipo de contacto no existe o está archivado." });
  });

  it("un administrador que ve todos los contactos también puede", async () => {
    as(OWNER, "owner");
    expect(await updateContactType(contactId, tipo("Cliente frecuente"))).toEqual({ ok: true });
    expect(changes()[0].actor_id).toBe(OWNER);
  });
});

describe("«Preguntar después»", () => {
  it("calla la pregunta 7 días sin confirmar el tipo", async () => {
    const before = Date.now();
    const result = await snoozeContactTypePrompt(contactId);
    if (!("ok" in result)) throw new Error("falló");
    const until = new Date(result.until).getTime();
    expect(until - before).toBeGreaterThan(6.99 * 86_400_000);
    expect(until - before).toBeLessThan(7.01 * 86_400_000);
    expect(contactRow().contact_type_confirmed_at ?? null).toBeNull();

    const info = await loadContactTypeInfo(fake.asDb(), contactId, contactRow());
    expect(shouldAskContactType(info, new Date())).toBe(false);
    expect(shouldAskContactType(info, new Date(until + 1000))).toBe(true);
  });

  it("responder después de posponer confirma y borra el aplazamiento", async () => {
    await snoozeContactTypePrompt(contactId);
    await updateContactType(contactId, tipo("Cliente"));
    expect(contactRow().contact_type_prompt_snoozed_until ?? null).toBeNull();
  });

  it("un tipo ya confirmado no se pospone", async () => {
    await updateContactType(contactId, tipo("Prospecto"));
    await snoozeContactTypePrompt(contactId);
    expect(contactRow().contact_type_prompt_snoozed_until ?? null).toBeNull();
  });
});

describe("la pregunta no corresponde si el contacto ya compró", () => {
  it("con una venta ganada no se pregunta aunque no esté confirmado", async () => {
    fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, status: "won", closed_at: "2026-09-01T00:00:00.000Z" }]);
    const info = await loadContactTypeInfo(fake.asDb(), contactId, contactRow());
    expect(info.hasWonCase).toBe(true);
    expect(shouldAskContactType(info, new Date())).toBe(false);
  });
});

describe("Configuración → Tipos de contacto", () => {
  it("cuenta los contactos de cada tipo, con la descripción", async () => {
    as(OWNER, "owner");
    fake.seed("contacts", [
      { workspace_id: WS, display_name: "A", contact_type_id: tipo("Cliente") },
      { workspace_id: WS, display_name: "B", contact_type_id: tipo("Cliente") },
      { workspace_id: WS, display_name: "C", contact_type_id: null },
    ]);
    expect(await updateContactTypeConfig({ id: tipo("Cliente"), description: "  Ya compró   una vez " })).toEqual({ ok: true });
    const config = await getCaseConfig();
    if (!("ok" in config)) throw new Error("falló");
    const byName = Object.fromEntries(config.data.contactTypes.map((t) => [t.name, t]));
    expect(byName["Cliente"]).toMatchObject({ contactCount: 2, description: "Ya compró una vez" });
    expect(byName["Prospecto"]).toMatchObject({ contactCount: 1, description: null });
    expect(byName["Inactivo"].contactCount).toBe(0);
  });

  it("la descripción tiene tope de 200 caracteres y solo la cambia un administrador", async () => {
    as(OWNER, "owner");
    expect(await updateContactTypeConfig({ id: tipo("Cliente"), description: "x".repeat(201) })).toEqual({
      error: "La descripción admite hasta 200 caracteres.",
    });
    expect(await updateContactTypeConfig({ id: tipo("Cliente"), description: "ok" })).toEqual({ ok: true });
    expect(await updateContactTypeConfig({ id: tipo("Cliente"), description: "" })).toEqual({ ok: true });
    expect(fake.rows("contact_types").find((t) => t.id === tipo("Cliente"))!.description).toBeNull();
    as(ANA, "member");
    expect(await updateContactTypeConfig({ id: tipo("Cliente"), description: "otra" })).toEqual({ error: ADMIN_ONLY_MESSAGE });
  });

  it("guarda la inactividad automática (tipo y días) y reinicia el «ya corrió hoy»", async () => {
    as(OWNER, "owner");
    fake.rows("workspaces")[0].settings = { agent_visibility: "team", contact_type_inactivity_run: { day: "2026-10-18", cursor: null } };
    expect(await saveContactTypeInactivity({ enabled: true, typeId: tipo("Inactivo"), days: 60 })).toEqual({ ok: true });
    const settings = fake.rows("workspaces")[0].settings as Record<string, unknown>;
    expect(settings.contact_type_inactivity).toEqual({ enabled: true, type_id: tipo("Inactivo"), days: 60 });
    expect(settings.contact_type_inactivity_run).toEqual({ day: null, cursor: null });
    expect(settings.agent_visibility).toBe("team"); // no pisa el resto
    const config = await getCaseConfig();
    if (!("ok" in config)) throw new Error("falló");
    expect(config.data.inactivity).toEqual({ enabled: true, typeId: tipo("Inactivo"), days: 60 });
  });

  it("valida los días y el tipo; un asesor no puede", async () => {
    as(OWNER, "owner");
    expect(await saveContactTypeInactivity({ enabled: true, typeId: tipo("Inactivo"), days: 3 })).toMatchObject({ error: expect.stringContaining("entre 7 y 3650") });
    expect(await saveContactTypeInactivity({ enabled: true, typeId: null, days: 90 })).toMatchObject({ error: expect.stringContaining("Elige") });
    expect(await saveContactTypeInactivity({ enabled: true, typeId: randomUUID(), days: 90 })).toEqual({ error: "No se encontró el tipo de contacto." });
    fake.rows("contact_types").find((t) => t.name === "Inactivo")!.archived_at = "2026-01-01T00:00:00.000Z";
    expect(await saveContactTypeInactivity({ enabled: true, typeId: tipo("Inactivo"), days: 90 })).toMatchObject({ error: expect.stringContaining("archivado") });
    // Apagarlo no exige tipo.
    expect(await saveContactTypeInactivity({ enabled: false, typeId: null, days: 90 })).toEqual({ ok: true });
    as(ANA, "member");
    expect(await saveContactTypeInactivity({ enabled: true, typeId: tipo("Cliente"), days: 90 })).toEqual({ error: ADMIN_ONLY_MESSAGE });
  });
});
