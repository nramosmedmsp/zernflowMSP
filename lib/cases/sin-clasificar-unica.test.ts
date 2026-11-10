// Una sola gestión «Sin clasificar» activa por contacto (migración 00038): el
// índice único parcial rechaza el segundo insert (23505) aunque la comprobación
// previa no lo viera (dos pedidos simultáneos). La acción manual lo traduce al
// mensaje y los caminos automáticos reutilizan la gestión que ya existe.

import { beforeEach, describe, expect, it } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "./fake-db.test-helper";
import { handleInbound, openCase } from "./index";
import { UNCLASSIFIED_DUPLICATE_MESSAGE } from "./parallel";

type Row = Record<string, unknown>;

const WS = "ws-1";
const OWNER = "u-0-owner";

let fake: FakeDb;
let contactId: string;

const activeUnclassified = () =>
  fake.rows("cases").filter((c) => c.case_type_id === null && ["open", "scheduled"].includes(c.status as string));

/** Una apertura simultánea que se adelanta: crea la «Sin clasificar» justo antes del insert. */
function competingOpening() {
  let done = false;
  fake.beforeInsert.set("cases", () => {
    if (done) return;
    done = true;
    fake.insertRow("cases", { workspace_id: WS, contact_id: contactId, case_type_id: null, status: "open", origin: "manual" });
  });
}

beforeEach(async () => {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [{ workspace_id: WS, user_id: OWNER, role: "owner" }]);
  await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "ecommerce");
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María" }]);
  contactId = contact.id as string;
  // Mismo índice que 00038.
  fake.unique(
    "cases",
    ["contact_id"],
    (r: Row) => (r.case_type_id ?? null) === null && ["open", "scheduled"].includes(r.status as string),
  );
});

describe("única «Sin clasificar» activa por contacto", () => {
  it("el índice rechaza un segundo insert sin tipo, pero no con tipo", async () => {
    const venta = fake.rows("case_types").find((t) => t.name === "Venta")!.id as string;
    fake.insertRow("cases", { workspace_id: WS, contact_id: contactId, case_type_id: null, status: "open" });
    const dup = await fake.asDb().from("cases").insert({ workspace_id: WS, contact_id: contactId, case_type_id: null, status: "open" });
    expect(dup.error).toMatchObject({ code: "23505" });
    const typed = await fake.asDb().from("cases").insert({ workspace_id: WS, contact_id: contactId, case_type_id: venta, status: "open" });
    expect(typed.error).toBeNull();
  });

  it("openCase: si otra solicitud se adelanta, devuelve el mensaje y no crea otra", async () => {
    competingOpening();
    const result = await openCase(fake.asDb(), { workspaceId: WS, contactId, caseTypeId: null, actorId: OWNER });
    expect(result).toEqual({ error: UNCLASSIFIED_DUPLICATE_MESSAGE });
    expect(activeUnclassified()).toHaveLength(1);
    expect(fake.rows("activity").filter((a) => a.type === "case_opened")).toHaveLength(0);
  });

  it("openCase: un 23505 con tipo no se confunde con el de «Sin clasificar»", async () => {
    const venta = fake.rows("case_types").find((t) => t.name === "Venta")!.id as string;
    fake.unique("cases", ["contact_id", "case_type_id"]);
    fake.insertRow("cases", { workspace_id: WS, contact_id: contactId, case_type_id: venta, status: "open" });
    const result = await openCase(fake.asDb(), { workspaceId: WS, contactId, caseTypeId: venta, actorId: OWNER });
    expect(result).not.toEqual({ error: UNCLASSIFIED_DUPLICATE_MESSAGE });
    expect("error" in result).toBe(true);
  });

  it("entrante (RPC open_inbound_case): si una apertura manual se coló, reutiliza esa gestión", async () => {
    // Sin tipo sugerido, el mensaje entrante abre una «Sin clasificar».
    fake.rows("case_types").forEach((t) => (t.suggested_for_contact_type_ids = []));
    competingOpening();
    const result = await handleInbound(fake.asDb(), { workspaceId: WS, contactId });
    const existing = activeUnclassified();
    expect(existing).toHaveLength(1);
    expect(result).toMatchObject({ caseId: existing[0].id, opened: false });
    expect(fake.rows("cases")).toHaveLength(1);
  });

  it("entrante sin carrera: abre una sola «Sin clasificar» y el siguiente mensaje la reutiliza", async () => {
    fake.rows("case_types").forEach((t) => (t.suggested_for_contact_type_ids = []));
    const first = await handleInbound(fake.asDb(), { workspaceId: WS, contactId });
    const second = await handleInbound(fake.asDb(), { workspaceId: WS, contactId });
    expect(first).toMatchObject({ opened: true });
    expect(second).toMatchObject({ caseId: first!.caseId, opened: false });
    expect(activeUnclassified()).toHaveLength(1);
  });
});
