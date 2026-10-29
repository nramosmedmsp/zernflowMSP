// M-18: al cerrar una gestión, si la regla no pudo programar la siguiente
// (p. ej. la Recompra, porque el tipo está archivado), se dice qué pasó.

import { beforeEach, describe, expect, it } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "./fake-db.test-helper";
import { describeSkippedEffects } from "./close-messages";
import { closeCase, handleInbound, previewClose } from "./index";

const WS = "ws-1";
const ANA = "u-1-ana";
let fake: FakeDb;
let caseId: string;

beforeEach(async () => {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [{ workspace_id: WS, user_id: ANA, role: "member" }]);
  await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "ecommerce");
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María" }]);
  caseId = (await handleInbound(fake.asDb(), { workspaceId: WS, contactId: contact.id as string }))!.caseId;
});

const recompra = () => fake.rows("case_types").find((t) => t.name === "Recompra")!;

describe("cierre con la Recompra archivada", () => {
  it("la vista previa no promete la recompra y avisa que no se programará", async () => {
    recompra().archived_at = "2026-01-01T00:00:00.000Z";
    const res = await previewClose(fake.asDb(), { caseId, kind: "won" }, new Date("2026-10-18T19:35:00Z"));
    expect(res).toMatchObject({ ok: true, preview: { schedules: [], blocked: [{ caseTypeName: "Recompra" }] } });
  });

  it("al cerrar queda el motivo y el texto explica qué hacer", async () => {
    recompra().archived_at = "2026-01-01T00:00:00.000Z";
    const res = await closeCase(fake.asDb(), { caseId, kind: "won", actorId: ANA }, new Date("2026-10-18T19:35:00Z"));
    expect(res).toMatchObject({ ok: true });
    if (!("effects" in res)) throw new Error("sin efectos");
    expect(res.effects.scheduled).toEqual([]);
    expect(res.effects.skipped).toHaveLength(1);
    expect(res.effects.skipped[0].reason).toBe("invalid_case_type");
    expect(fake.rows("cases").some((c) => c.status === "scheduled")).toBe(false);

    const names = new Map([[res.effects.skipped[0].ruleId, "Recompra"]]);
    expect(describeSkippedEffects(res.effects.skipped, names)).toEqual([
      "No se programó Recompra porque ese tipo de gestión está archivado o ya no existe; prográmala a mano.",
    ]);
  });

  it("con el tipo activo todo sigue igual", async () => {
    const res = await previewClose(fake.asDb(), { caseId, kind: "won" }, new Date("2026-10-18T19:35:00Z"));
    expect(res).toMatchObject({ ok: true, preview: { blocked: [], schedules: [{ caseTypeName: "Recompra" }] } });
  });
});

describe("describeSkippedEffects", () => {
  it("un motivo por cada efecto omitido", () => {
    const out = describeSkippedEffects(
      [
        { ruleId: "r1", reason: "missing_key_date" },
        { ruleId: "r2", reason: "invalid_contact_type" },
        { ruleId: "r3", reason: "error" },
      ],
      new Map([["r1", "Renovación"]]),
    );
    expect(out).toEqual([
      "No se programó Renovación porque falta la fecha clave del contacto; prográmala a mano.",
      "No se cambió el tipo del contacto porque el tipo elegido por la regla está archivado; cámbialo a mano.",
      "No se pudo programar la gestión siguiente; prográmala a mano.",
    ]);
  });
});
