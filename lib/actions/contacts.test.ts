// Permisos y validaciones de las acciones de la ficha de contacto, con
// getWorkspace y el cliente de servicio simulados sobre la base en memoria.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { ADMIN_ONLY_MESSAGE } from "@/lib/permissions";

const state = vi.hoisted(() => ({ fake: null as unknown, userId: "", workspaceId: "" }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: state.userId },
    workspace: { id: state.workspaceId },
    role: "member",
    supabase: state.fake,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.fake,
  createClient: async () => state.fake,
}));

import {
  addContactTag,
  createContact,
  removeContactTag,
  setContactOwner,
  setContactTeam,
  updateContactKeyDate,
  updateContactPhone,
  updateContactType,
} from "./contacts";

const WS = randomUUID();
const OTHER_WS = randomUUID();
const OWNER = randomUUID();
const ANA = randomUUID();
const BETO = randomUUID();
const SEDE_A = randomUUID();
const TYPE_LEAD = randomUUID();
const TYPE_CLIENT = randomUUID();
const TYPE_OLD = randomUUID();
const TYPE_FOREIGN = randomUUID();
const TAG_VIP = randomUUID();
const TAG_FOREIGN = randomUUID();

let fake: FakeDb;
let contactId: string;

function as(userId: string) {
  state.userId = userId;
}

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.workspaceId = WS;
  fake.seed("workspaces", [
    { id: WS, name: "Tienda", slug: "tienda", settings: {} },
    { id: OTHER_WS, name: "Otra", slug: "otra", settings: {} },
  ]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: BETO, role: "member" },
  ]);
  fake.seed("teams", [{ id: SEDE_A, workspace_id: WS, name: "Sede A", is_default: true }]);
  fake.seed("contact_types", [
    { id: TYPE_LEAD, workspace_id: WS, name: "Lead" },
    { id: TYPE_CLIENT, workspace_id: WS, name: "Cliente" },
    { id: TYPE_OLD, workspace_id: WS, name: "Antiguo", archived_at: "2026-01-01T00:00:00.000Z" },
    { id: TYPE_FOREIGN, workspace_id: OTHER_WS, name: "Ajeno" },
  ]);
  fake.seed("tags", [
    { id: TAG_VIP, workspace_id: WS, name: "VIP" },
    { id: TAG_FOREIGN, workspace_id: OTHER_WS, name: "Ajena" },
  ]);
  // Ana es la responsable del contacto: lo ve. Beto no tiene relación con él.
  const [contact] = fake.seed("contacts", [
    { workspace_id: WS, display_name: "María", owner_id: ANA, contact_type_id: TYPE_LEAD },
  ]);
  contactId = contact.id as string;
});

function contactRow() {
  return fake.rows("contacts")[0];
}

describe("tipo de contacto", () => {
  it("lo cambia quien ve el contacto y deja registro", async () => {
    as(ANA);
    expect(await updateContactType(contactId, TYPE_CLIENT)).toEqual({ ok: true });
    expect(contactRow().contact_type_id).toBe(TYPE_CLIENT);
    expect(fake.rows("activity")).toHaveLength(1);
    expect(fake.rows("activity")[0]).toMatchObject({
      type: "contact_type_changed",
      contact_id: contactId,
      actor_id: ANA,
      from_value: TYPE_LEAD,
      to_value: TYPE_CLIENT,
    });
  });

  it("puede quitarlo, pero no usar uno archivado o de otro espacio", async () => {
    as(ANA);
    expect(await updateContactType(contactId, null)).toEqual({ ok: true });
    expect(contactRow().contact_type_id).toBeNull();
    expect(await updateContactType(contactId, TYPE_OLD)).toEqual({
      error: "El tipo de contacto no existe o está archivado.",
    });
    expect(await updateContactType(contactId, TYPE_FOREIGN)).toEqual({
      error: "El tipo de contacto no existe o está archivado.",
    });
  });

  it("sin cambios no registra nada", async () => {
    as(ANA);
    expect(await updateContactType(contactId, TYPE_LEAD)).toEqual({ ok: true });
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("quien no ve el contacto recibe 'no encontrado'", async () => {
    as(BETO);
    expect(await updateContactType(contactId, TYPE_CLIENT)).toEqual({ error: "No se encontró el contacto." });
    expect(contactRow().contact_type_id).toBe(TYPE_LEAD);
  });

  it("rechaza ids que no son UUID", async () => {
    as(ANA);
    expect(await updateContactType("no-es-uuid", TYPE_CLIENT)).toEqual({ error: "Datos no válidos." });
    expect(await updateContactType(contactId, "tampoco")).toEqual({ error: "Datos no válidos." });
  });
});

describe("responsable y equipo: solo administradores", () => {
  it("un asesor que ve el contacto no puede cambiar el responsable ni el equipo", async () => {
    as(ANA);
    expect(await setContactOwner(contactId, BETO)).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(await setContactTeam(contactId, SEDE_A)).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(contactRow().owner_id).toBe(ANA);
    expect(contactRow().team_id).toBeNull();
  });

  it("el administrador cambia el responsable y queda registrado", async () => {
    as(OWNER);
    expect(await setContactOwner(contactId, BETO)).toEqual({ ok: true });
    expect(contactRow().owner_id).toBe(BETO);
    expect(fake.rows("activity")[0]).toMatchObject({
      type: "owner_changed",
      actor_id: OWNER,
      from_value: ANA,
      to_value: BETO,
    });
    expect(await setContactOwner(contactId, null)).toEqual({ ok: true });
    expect(contactRow().owner_id).toBeNull();
  });

  it("el responsable debe ser miembro del espacio", async () => {
    as(OWNER);
    expect(await setContactOwner(contactId, randomUUID())).toEqual({
      error: "La persona no es miembro de este espacio de trabajo.",
    });
    expect(contactRow().owner_id).toBe(ANA);
  });

  it("el administrador cambia el equipo, que debe existir en el espacio", async () => {
    as(OWNER);
    expect(await setContactTeam(contactId, SEDE_A)).toEqual({ ok: true });
    expect(contactRow().team_id).toBe(SEDE_A);
    expect(fake.rows("activity")[0]).toMatchObject({ type: "team_changed", from_value: null, to_value: SEDE_A });
    expect(await setContactTeam(contactId, randomUUID())).toEqual({ error: "El equipo no existe o está archivado." });
  });
});

describe("fecha clave y teléfono", () => {
  it("guarda y quita la fecha clave; valida el formato", async () => {
    as(ANA);
    expect(await updateContactKeyDate(contactId, "2026-12-01")).toEqual({ ok: true });
    expect(contactRow().key_date).toBe("2026-12-01");
    expect(await updateContactKeyDate(contactId, "2026-02-30")).toEqual({ error: "La fecha no es válida." });
    expect(await updateContactKeyDate(contactId, "01/12/2026")).toEqual({ error: "La fecha no es válida." });
    expect(await updateContactKeyDate(contactId, null)).toEqual({ ok: true });
    expect(contactRow().key_date).toBeNull();
  });

  it("guarda el teléfono limpio y lo valida", async () => {
    as(ANA);
    expect(await updateContactPhone(contactId, "  +51  999 888 777 ")).toEqual({ ok: true, phone: "+51999888777" });
    expect(contactRow().phone).toBe("+51999888777");
    expect(await updateContactPhone(contactId, "abc")).toMatchObject({ error: expect.any(String) });
    expect(await updateContactPhone(contactId, "123")).toMatchObject({ error: expect.any(String) });
    expect(contactRow().phone).toBe("+51999888777");
    expect(await updateContactPhone(contactId, "")).toEqual({ ok: true, phone: null });
    expect(contactRow().phone).toBeNull();
  });

  it("quien no ve el contacto no puede editarlo", async () => {
    as(BETO);
    expect(await updateContactPhone(contactId, "999888777")).toEqual({ error: "No se encontró el contacto." });
    expect(await updateContactKeyDate(contactId, "2026-12-01")).toEqual({ error: "No se encontró el contacto." });
  });
});

describe("etiquetas", () => {
  it("agrega una etiqueta existente una sola vez y la quita", async () => {
    as(ANA);
    expect(await addContactTag(contactId, TAG_VIP)).toEqual({ ok: true });
    expect(await addContactTag(contactId, TAG_VIP)).toEqual({ ok: true });
    expect(fake.rows("contact_tags")).toHaveLength(1);
    expect(await removeContactTag(contactId, TAG_VIP)).toEqual({ ok: true });
    expect(fake.rows("contact_tags")).toHaveLength(0);
    // La etiqueta sigue existiendo.
    expect(fake.rows("tags").some((t) => t.id === TAG_VIP)).toBe(true);
  });

  it("no acepta etiquetas de otro espacio ni de contactos que no ve", async () => {
    as(ANA);
    expect(await addContactTag(contactId, TAG_FOREIGN)).toEqual({ error: "La etiqueta no existe." });
    as(BETO);
    expect(await addContactTag(contactId, TAG_VIP)).toEqual({ error: "No se encontró el contacto." });
    expect(fake.rows("contact_tags")).toHaveLength(0);
  });
});

describe("crear contacto (B-38)", () => {
  it("cualquier miembro registra un cliente nuevo y queda como su responsable", async () => {
    as(BETO);
    const res = await createContact({ name: "  Luis   Ramos ", phone: "987 654 321" });
    expect(res).toMatchObject({ ok: true, existed: false, contact: { displayName: "Luis Ramos", phone: "+51987654321" } });
    expect(fake.rows("contacts").find((c) => c.display_name === "Luis Ramos")).toMatchObject({
      owner_id: BETO,
      workspace_id: WS,
    });
  });

  it("M-3: guarda el teléfono normalizado y lo vincula a los canales de WhatsApp activos", async () => {
    as(BETO);
    const channel = randomUUID();
    fake.seed("channels", [
      { id: channel, workspace_id: WS, platform: "whatsapp", is_active: true },
      { id: randomUUID(), workspace_id: WS, platform: "whatsapp", is_active: false },
      { id: randomUUID(), workspace_id: WS, platform: "instagram", is_active: true },
    ]);
    const res = await createContact({ name: "Tomás Manual", phone: "+51 911 222 333" });
    expect(res).toMatchObject({ ok: true, existed: false, contact: { phone: "+51911222333" } });
    const id = (res as { contact: { id: string } }).contact.id;
    expect(fake.rows("contact_channels")).toEqual([
      expect.objectContaining({ contact_id: id, channel_id: channel, platform_sender_id: "51911222333" }),
    ]);
    // Lo mismo escrito de otra forma es el mismo cliente, no un duplicado.
    const before = fake.rows("contacts").length;
    expect(await createContact({ name: "Tomás Repetido", phone: "911222333" })).toMatchObject({ ok: true, existed: true });
    expect(fake.rows("contacts")).toHaveLength(before);
    expect(fake.rows("contact_channels")).toHaveLength(1);
  });

  it("M-3: reconoce a un cliente que ya escribió por WhatsApp (solo vínculo) en vez de duplicarlo", async () => {
    as(OWNER);
    const channel = randomUUID();
    fake.seed("channels", [{ id: channel, workspace_id: WS, platform: "whatsapp", is_active: true }]);
    fake.seed("contact_channels", [{ contact_id: contactId, channel_id: channel, platform_sender_id: "51987000111" }]);
    const before = fake.rows("contacts").length;
    expect(await createContact({ name: "María", phone: "987000111" })).toMatchObject({
      ok: true,
      existed: true,
      contact: { id: contactId },
    });
    expect(fake.rows("contacts")).toHaveLength(before);
  });

  it("valida nombre y teléfono en español", async () => {
    as(BETO);
    expect(await createContact({ name: "L", phone: "987654321" })).toMatchObject({ error: expect.stringContaining("nombre") });
    expect(await createContact({ name: "Luis", phone: "" })).toEqual({ error: "Escribe el teléfono del cliente." });
    expect(await createContact({ name: "Luis", phone: "abc" })).toMatchObject({ error: expect.stringContaining("teléfono") });
  });

  it("un teléfono repetido devuelve el contacto si lo ve, y si no, no lo duplica", async () => {
    as(ANA);
    fake.rows("contacts")[0].phone = "+51900000008";
    const before = fake.rows("contacts").length;
    const seen = await createContact({ name: "María otra vez", phone: "+51 900 000 008" });
    expect(seen).toMatchObject({ ok: true, existed: true, contact: { id: contactId } });
    as(BETO);
    expect(await createContact({ name: "María", phone: "+51900000008" })).toMatchObject({
      error: expect.stringContaining("Ya existe"),
    });
    expect(fake.rows("contacts")).toHaveLength(before);
  });
});
