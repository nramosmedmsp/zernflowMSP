// Consentimiento de publicidad y corrección de datos (PRIV-04 / PRIV-06): permisos,
// historial y candado de "Ver como", con la base en memoria.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { ADMIN_ONLY_MESSAGE } from "@/lib/permissions";

const state = vi.hoisted(() => ({ fake: null as unknown, userId: "", workspaceId: "", locked: false }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    viewAs: { locked: state.locked, active: false, ended: false, info: null },
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
vi.mock("@/lib/view-as/lock", () => ({
  isViewAsLocked: async () => state.locked,
  markReadOnlyHit: async () => {},
  VIEW_AS_LOCKED_MESSAGE: "Estás viendo como otra persona (solo lectura): esta acción no se ejecutó.",
}));

import { setMarketingConsent, updateContactDetails } from "./contacts";

const WS = randomUUID();
const OWNER = randomUUID();
const ADMIN = randomUUID();
const ANA = randomUUID();
const BETO = randomUUID();

let fake: FakeDb;
let contactId: string;

const as = (userId: string) => {
  state.userId = userId;
};
const contactRow = () => fake.rows("contacts")[0];

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.workspaceId = WS;
  state.locked = false;
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ADMIN, role: "admin" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: BETO, role: "member" },
  ]);
  const [contact] = fake.seed("contacts", [
    { workspace_id: WS, display_name: "María", owner_id: ANA, email: "maria@correo.pe", phone: "+51987654321", is_subscribed: true },
  ]);
  contactId = contact.id as string;
});

describe("registrar consentimiento, dar de baja y reactivar", () => {
  it("un asesor que ve el contacto registra el consentimiento y queda en el historial", async () => {
    as(ANA);
    const res = await setMarketingConsent(contactId, "accept", "Me lo dijo por teléfono");
    expect(res).toMatchObject({ ok: true, marketing: { status: "accepted", source: "manual", note: "Me lo dijo por teléfono" } });
    expect(contactRow()).toMatchObject({
      marketing_status: "accepted",
      marketing_source: "manual",
      marketing_set_by: ANA,
      marketing_note: "Me lo dijo por teléfono",
      is_subscribed: true,
    });
    expect(typeof contactRow().marketing_status_at).toBe("string");
    expect(fake.rows("activity")).toHaveLength(1);
    expect(fake.rows("activity")[0]).toMatchObject({
      type: "contact_subscribed",
      contact_id: contactId,
      actor_id: ANA,
      from_value: "unknown",
      to_value: "accepted",
      meta: { source: "manual", note: "Me lo dijo por teléfono" },
    });
  });

  it("la baja apaga is_subscribed; reactivar pide la evidencia", async () => {
    as(ANA);
    expect(await setMarketingConsent(contactId, "opt_out")).toMatchObject({ ok: true, marketing: { status: "opted_out" } });
    expect(contactRow()).toMatchObject({ marketing_status: "opted_out", is_subscribed: false });
    expect(fake.rows("activity")[0]).toMatchObject({ type: "contact_unsubscribed", from_value: "unknown", to_value: "opted_out" });

    const sinNota = await setMarketingConsent(contactId, "reactivate", "");
    expect(sinNota).toMatchObject({ error: expect.stringContaining("Para reactivar") });
    expect(contactRow().marketing_status).toBe("opted_out");

    expect(await setMarketingConsent(contactId, "reactivate", "Escribió ofertas por WhatsApp el 3/11")).toMatchObject({ ok: true });
    expect(contactRow()).toMatchObject({ marketing_status: "accepted", is_subscribed: true });
    expect(fake.rows("activity")).toHaveLength(2);
  });

  it("no ofrece una acción que no corresponde al estado actual", async () => {
    as(ANA);
    expect(await setMarketingConsent(contactId, "reactivate", "evidencia clara")).toMatchObject({ error: expect.stringContaining("ya cambió") });
    await setMarketingConsent(contactId, "accept");
    expect(await setMarketingConsent(contactId, "accept")).toMatchObject({ error: expect.stringContaining("ya cambió") });
  });

  it("quien no ve el contacto recibe 'no encontrado' y nada cambia", async () => {
    as(BETO);
    expect(await setMarketingConsent(contactId, "accept")).toEqual({ error: "No se encontró el contacto." });
    expect(contactRow().marketing_status).toBeUndefined();
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("rechaza acciones inventadas y notas larguísimas", async () => {
    as(ANA);
    expect(await setMarketingConsent(contactId, "borrar" as never)).toEqual({ error: "Datos no válidos." });
    expect(await setMarketingConsent(contactId, "accept", "x".repeat(501))).toMatchObject({ error: expect.stringContaining("500") });
  });

  it("en 'Ver como' (solo lectura) no cambia nada", async () => {
    as(ANA);
    state.locked = true;
    expect(await setMarketingConsent(contactId, "accept")).toEqual({
      error: expect.stringContaining("solo lectura"),
    });
    expect(contactRow().marketing_status).toBeUndefined();
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("un contacto con los datos eliminados no admite cambios", async () => {
    as(ANA);
    contactRow().erased_at = "2026-11-01T00:00:00Z";
    expect(await setMarketingConsent(contactId, "accept")).toEqual({ error: "Los datos de este cliente se eliminaron. La ficha es solo de lectura." });
  });
});

describe("corregir nombre, correo y teléfono: solo Dueño y Administrador", () => {
  it("un asesor no puede", async () => {
    as(ANA);
    expect(await updateContactDetails(contactId, { displayName: "María Pérez" })).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(contactRow().display_name).toBe("María");
  });

  it("el administrador corrige y queda qué campos se tocaron, sin copiar los valores", async () => {
    as(ADMIN);
    const res = await updateContactDetails(contactId, { displayName: "  María  Pérez ", email: "MARIA.P@correo.pe", phone: "987 111 222" });
    expect(res).toMatchObject({ ok: true, displayName: "María Pérez", email: "maria.p@correo.pe", phone: "+51987111222" });
    expect(contactRow()).toMatchObject({ display_name: "María Pérez", email: "maria.p@correo.pe", phone: "+51987111222" });
    expect(fake.rows("activity")).toHaveLength(1);
    const log = fake.rows("activity")[0];
    expect(log).toMatchObject({ type: "contact_data_corrected", actor_id: ADMIN, contact_id: contactId });
    expect(JSON.stringify(log.meta)).not.toContain("Pérez");
    expect(log.meta).toEqual({ fields: ["nombre", "correo", "teléfono"] });
  });

  it("el dueño también; un correo vacío lo quita", async () => {
    as(OWNER);
    expect(await updateContactDetails(contactId, { email: "" })).toMatchObject({ ok: true, email: null });
    expect(contactRow().email).toBeNull();
  });

  it("valida nombre y correo, y sin cambios no registra nada", async () => {
    as(ADMIN);
    expect(await updateContactDetails(contactId, { displayName: "A" })).toMatchObject({ error: expect.stringContaining("nombre") });
    expect(await updateContactDetails(contactId, { email: "no-es-correo" })).toMatchObject({ error: expect.stringContaining("correo") });
    expect(await updateContactDetails(contactId, { displayName: "María" })).toMatchObject({ ok: true });
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("en 'Ver como' no cambia nada", async () => {
    as(ADMIN);
    state.locked = true;
    expect(await updateContactDetails(contactId, { displayName: "Otro Nombre" })).toMatchObject({ error: expect.stringContaining("solo lectura") });
    expect(contactRow().display_name).toBe("María");
  });
});
