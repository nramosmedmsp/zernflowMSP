// M-5: «Devolver a la cola» no se deshace en un minuto: el reparto automático
// no le devuelve la gestión a quien la devolvió.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "./fake-db.test-helper";

vi.mock("@/lib/flow-engine/case-triggers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flow-engine/case-triggers")>();
  return { ...actual, runCaseEventFlows: vi.fn(async () => {}) };
});

import { assignTo, handleInbound, retryUnassignedCases } from "./index";

const WS = "ws-1";
const ANA = "u-1-ana";
const BETO = "u-2-beto";

let fake: FakeDb;
let caseId: string;

const db = () => fake.asDb();
const row = () => fake.rows("cases").find((c) => c.id === caseId)!;

beforeEach(async () => {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: "u-0-owner", role: "owner" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: BETO, role: "member" },
  ]);
  await applyTemplateWithStore(supabaseTemplateStore(db()), WS, "ecommerce");
  fake.seed("channels", [{ id: "ch", workspace_id: WS, platform: "whatsapp", late_account_id: "acc-1" }]);
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María" }]);
  const [conversation] = fake.seed("conversations", [
    { workspace_id: WS, contact_id: contact.id, channel_id: "ch", late_conversation_id: "conv-1" },
  ]);
  const result = (await handleInbound(db(), { workspaceId: WS, contactId: contact.id as string, conversationId: conversation.id as string }))!;
  caseId = result.caseId;
});

describe("devolver a la cola", () => {
  it("el reparto automático no se la devuelve a quien la devolvió", async () => {
    const first = row().assignee_id as string;
    expect([ANA, BETO]).toContain(first);
    expect(await assignTo(db(), { caseId, assigneeId: null, actorId: first })).toEqual({ ok: true });
    expect(row().assignee_id).toBeNull();

    const retried = await retryUnassignedCases(db(), { deadline: Date.now() + 5000 });
    expect(retried.assigned).toBe(1);
    const second = row().assignee_id as string;
    expect(second).not.toBe(first);
    expect([ANA, BETO]).toContain(second);
  });

  it("si es la única persona disponible, la gestión sigue en la cola", async () => {
    const first = row().assignee_id as string;
    const other = first === ANA ? BETO : ANA;
    fake.rows("workspace_members").find((m) => m.user_id === other)!.availability = "away";
    await assignTo(db(), { caseId, assigneeId: null, actorId: first });
    await retryUnassignedCases(db(), { deadline: Date.now() + 5000 });
    expect(row().assignee_id).toBeNull();
  });

  it("pasadas las horas de espera, vuelve a poder recibirla", async () => {
    const first = row().assignee_id as string;
    const other = first === ANA ? BETO : ANA;
    fake.rows("workspace_members").find((m) => m.user_id === other)!.availability = "away";
    await assignTo(db(), { caseId, assigneeId: null, actorId: first });
    const later = new Date(Date.now() + 13 * 3_600_000);
    await retryUnassignedCases(db(), { deadline: Date.now() + 5000, now: later });
    expect(row().assignee_id).toBe(first);
  });
});

describe("tomar la gestión a la vez (B-10)", () => {
  it("dos personas pulsan «Tomar» casi juntas: una gana y la otra recibe un aviso", async () => {
    const first = row().assignee_id as string;
    await assignTo(db(), { caseId, assigneeId: null, actorId: first });
    const [a, b] = await Promise.all([
      assignTo(db(), { caseId, assigneeId: ANA, actorId: ANA, enforceTeam: false }),
      assignTo(db(), { caseId, assigneeId: BETO, actorId: BETO, enforceTeam: false }),
    ]);
    const results = [a, b];
    expect(results.filter((r) => "ok" in r)).toHaveLength(1);
    expect(results.find((r) => "error" in r)).toEqual({ error: "Otra persona tomó la gestión." });
    expect([ANA, BETO]).toContain(row().assignee_id);
  });
});
