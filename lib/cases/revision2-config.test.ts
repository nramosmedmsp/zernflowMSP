// Revisión 2 (configuración de gestiones, equipos y reparto): quitar a una
// persona reparte su trabajo (R2-2), el supervisor puede quedar fuera del
// reparto (R2-17) y los ajustes del espacio se guardan sin pisarse.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { diffSettings, mergeWorkspaceSettings } from "@/lib/workspace-settings";
import { FakeDb } from "./fake-db.test-helper";

vi.mock("@/lib/flow-engine/case-triggers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flow-engine/case-triggers")>();
  return { ...actual, runCaseEventFlows: vi.fn(async () => {}) };
});

import { assignCase } from "./assign";
import { releaseMemberWork } from "./member-removal";

const WS = "ws-1";
const OWNER = "u-0-owner";
const ANA = "u-1-ana";
const BETO = "u-2-beto";
const SUP = "u-3-sup";
const TEAM = "team-1";

let fake: FakeDb;
const db = () => fake.asDb();

async function seedBase() {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: BETO, role: "member" },
    { workspace_id: WS, user_id: SUP, role: "member" },
  ]);
  await applyTemplateWithStore(supabaseTemplateStore(db()), WS, "ecommerce");
}

function openCase(contactName: string, extra: Record<string, unknown> = {}) {
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: contactName }]);
  const venta = fake.rows("case_types").find((t) => t.name === "Venta")!;
  const stage = fake.rows("case_stages").find((s) => s.case_type_id === venta.id && s.kind === "open")!;
  const [row] = fake.seed("cases", [
    {
      workspace_id: WS,
      contact_id: contact.id,
      case_type_id: venta.id,
      stage_id: stage.id,
      status: "open",
      opened_at: "2026-10-20T10:00:00.000Z",
      ...extra,
    },
  ]);
  return { contact, row };
}

describe("R2-2: quitar a una persona del espacio reparte su trabajo", () => {
  beforeEach(seedBase);

  it("sus gestiones abiertas se reparten entre quienes quedan y salen de sus equipos", async () => {
    fake.seed("teams", [{ id: TEAM, workspace_id: WS, name: "Ventas", is_default: true }]);
    fake.seed("team_members", [
      { team_id: TEAM, user_id: ANA, role: "agent" },
      { team_id: TEAM, user_id: BETO, role: "agent" },
    ]);
    const a = openCase("María", { assignee_id: ANA, team_id: TEAM });
    const b = openCase("Luis", { assignee_id: BETO, team_id: TEAM });
    const scheduled = openCase("Rosa", { assignee_id: ANA, team_id: TEAM, status: "scheduled", opened_at: null });
    // Ana ya no es miembro del espacio (se borró su fila antes de llamar).
    fake.tables.workspace_members = fake.rows("workspace_members").filter((m) => m.user_id !== ANA);

    const stats = await releaseMemberWork(db(), { workspaceId: WS, userId: ANA, actorId: OWNER });
    expect(stats).toMatchObject({ releasedCases: 2, reassigned: 1, teamsLeft: 1 });
    const get = (id: unknown) => fake.rows("cases").find((c) => c.id === id)!;
    expect(get(a.row.id).assignee_id).toBe(BETO);
    expect(get(b.row.id).assignee_id).toBe(BETO);
    expect(get(scheduled.row.id).assignee_id ?? null).toBeNull();
    expect(fake.rows("team_members").map((m) => m.user_id)).toEqual([BETO]);
    const unassigned = fake.rows("activity").filter((x) => x.type === "unassigned");
    expect(unassigned).toHaveLength(2);
    expect(unassigned[0].meta).toMatchObject({ reason: "member_removed" });
  });

  it("deja de ser responsable de contactos y, sin nadie disponible, la gestión queda en la cola", async () => {
    const a = openCase("María", { assignee_id: ANA });
    fake.rows("contacts").find((c) => c.id === a.contact.id)!.owner_id = ANA;
    fake.tables.workspace_members = fake.rows("workspace_members").filter((m) => m.user_id === ANA || m.user_id === OWNER);
    // Con Ana fuera solo queda el dueño (rol owner): no recibe repartos de asesor.
    fake.tables.workspace_members = fake.rows("workspace_members").filter((m) => m.user_id !== ANA);

    const stats = await releaseMemberWork(db(), { workspaceId: WS, userId: ANA, actorId: OWNER });
    expect(stats).toMatchObject({ releasedCases: 1, reassigned: 0, contactsFreed: 1 });
    expect(fake.rows("cases").find((c) => c.id === a.row.id)!.assignee_id).toBeNull();
    expect(fake.rows("contacts").find((c) => c.id === a.contact.id)!.owner_id).toBeNull();
    expect(fake.rows("activity").some((x) => x.type === "owner_changed" && x.meta && (x.meta as Record<string, unknown>).reason === "member_removed")).toBe(true);
  });

  it("no toca el trabajo de otras personas", async () => {
    const b = openCase("Luis", { assignee_id: BETO });
    await releaseMemberWork(db(), { workspaceId: WS, userId: ANA, actorId: OWNER });
    expect(fake.rows("cases").find((c) => c.id === b.row.id)!.assignee_id).toBe(BETO);
  });
});

describe("R2-17: el supervisor no recibe chats", () => {
  beforeEach(async () => {
    await seedBase();
    fake.seed("teams", [{ id: TEAM, workspace_id: WS, name: "Ventas", is_default: true }]);
    fake.seed("team_members", [
      { team_id: TEAM, user_id: ANA, role: "agent" },
      { team_id: TEAM, user_id: SUP, role: "supervisor" },
    ]);
  });

  it("por defecto el supervisor entra al reparto por turnos", async () => {
    const got = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const { row } = openCase(`C${i}`);
      const out = await assignCase(db(), row.id as string, {});
      if (out.status === "assigned") got.add(out.assigneeId);
    }
    expect(got).toEqual(new Set([ANA, SUP]));
  });

  it("encendido, solo recibe el asesor", async () => {
    fake.rows("teams")[0].supervisor_skips_chats = true;
    const got = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const { row } = openCase(`C${i}`);
      const out = await assignCase(db(), row.id as string, {});
      if (out.status === "assigned") got.add(out.assigneeId);
    }
    expect(got).toEqual(new Set([ANA]));
  });
});

describe("ajustes del espacio sin pisarse", () => {
  it("diffSettings solo envía lo que cambió", () => {
    expect(diffSettings({ a: 1, b: { x: 1 }, c: 3 }, { a: 1, b: { x: 2 }, d: 4 })).toEqual({
      set: { b: { x: 2 }, d: 4 },
      remove: ["c"],
    });
    expect(diffSettings({ a: 1 }, { a: 1 })).toEqual({ set: {}, remove: [] });
    expect(diffSettings(null, { a: 1 })).toEqual({ set: { a: 1 }, remove: [] });
  });

  it("usa la mezcla atómica de la base cuando existe", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const update = vi.fn();
    const client = { rpc, from: () => ({ update }) } as never;
    expect(await mergeWorkspaceSettings(client, WS, { a: 1, b: 2 }, { a: 1, b: 3 })).toBeNull();
    expect(rpc).toHaveBeenCalledWith("merge_workspace_settings", { p_workspace_id: WS, p_set: { b: 3 }, p_remove: [] });
    expect(update).not.toHaveBeenCalled();
    // Sin cambios no llama a la base.
    rpc.mockClear();
    expect(await mergeWorkspaceSettings(client, WS, { a: 1 }, { a: 1 })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("si la función aún no existe, guarda el objeto completo como antes", async () => {
    await seedBase();
    fake.rows("workspaces")[0].settings = { a: 1 };
    const res = await mergeWorkspaceSettings(db(), WS, { a: 1 }, { a: 1, b: 2 });
    expect(res).toBeNull();
    expect(fake.rows("workspaces")[0].settings).toEqual({ a: 1, b: 2 });
  });

  it("un error real de la base se devuelve", async () => {
    const client = { rpc: async () => ({ data: null, error: { message: "boom", code: "XX000" } }) } as never;
    expect(await mergeWorkspaceSettings(client, WS, {}, { a: 1 })).toBe("boom");
  });
});
