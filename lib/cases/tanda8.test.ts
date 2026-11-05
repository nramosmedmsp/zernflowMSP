// Tanda 8: hallazgos medios de la verificación final sobre la base en memoria.

import { beforeEach, describe, expect, it } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "./fake-db.test-helper";
import { handleHumanOutboundForConversation, handleInbound } from "./index";

type Row = Record<string, unknown>;

const WS = "ws-1";
const OWNER = "u-0-owner";
const ANA = "u-1-ana";
const BETO = "u-2-beto";

let fake: FakeDb;
const db = () => fake.asDb();
const caseById = (id: unknown): Row => fake.rows("cases").find((c) => c.id === id)!;

async function setup() {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: BETO, role: "member" },
  ]);
  await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "ecommerce");
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "Jorge" }]);
  const [conversation] = fake.seed("conversations", [{ workspace_id: WS, contact_id: contact.id, channel_id: "ch" }]);
  return { contactId: contact.id as string, conversationId: conversation.id as string };
}

describe("M-1: gestiones en paralelo y espera del cliente", () => {
  let contactId: string;
  let conversationId: string;
  let ventaId: string;
  let consultaId: string;

  beforeEach(async () => {
    ({ contactId, conversationId } = await setup());
    const first = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: "2026-10-18T15:00:00.000Z" }))!;
    ventaId = first.caseId;
    // El asesor ya respondió la primera vez; luego se crea una Consulta más nueva con otra persona.
    await handleHumanOutboundForConversation(db(), { conversationId, userId: ANA, at: "2026-10-18T15:01:00.000Z" });
    const [consulta] = fake.seed("cases", [
      {
        workspace_id: WS,
        contact_id: contactId,
        status: "open",
        assignee_id: BETO,
        opened_at: "2026-10-18T15:02:00.000Z",
        created_at: "2026-10-18T15:02:00.000Z",
      },
    ]);
    consultaId = consulta.id as string;
  });

  it("un mensaje del cliente marca la espera en todas las gestiones abiertas", async () => {
    await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: "2026-10-18T16:00:00.000Z" });
    expect(caseById(ventaId).waiting_since).toBe("2026-10-18T16:00:00.000Z");
    expect(caseById(consultaId)).toMatchObject({
      waiting_since: "2026-10-18T16:00:00.000Z",
      last_inbound_at: "2026-10-18T16:00:00.000Z",
    });
  });

  it("no pisa una espera que ya venía corriendo", async () => {
    await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: "2026-10-18T16:00:00.000Z" });
    await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: "2026-10-18T16:30:00.000Z" });
    expect(caseById(consultaId).waiting_since).toBe("2026-10-18T16:00:00.000Z");
    expect(caseById(consultaId).last_inbound_at).toBe("2026-10-18T16:30:00.000Z");
  });

  it("la respuesta del asesor limpia la espera de las dos y registra la primera respuesta solo en la suya", async () => {
    await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: "2026-10-18T16:00:00.000Z" });
    await handleHumanOutboundForConversation(db(), { conversationId, userId: ANA, at: "2026-10-18T16:05:00.000Z" });
    expect(caseById(ventaId).waiting_since).toBeNull();
    expect(caseById(consultaId).waiting_since).toBeNull();
    expect(caseById(consultaId).first_response_at).toBeNull();
    expect(
      fake.rows("activity").filter((a) => a.type === "first_response" && a.case_id === consultaId),
    ).toHaveLength(0);
  });
});
