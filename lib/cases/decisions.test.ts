// Decisiones puras extraídas del motor de gestiones. Se prueban solas y contra
// el motor real sobre la base en memoria (lo que antes hacía una consulta ahora
// lo decide una función pura, con el mismo resultado).

import { describe, expect, it } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { nextAutoTemplateStageId, pickSuggestedCaseTypeId, planActivation, resolveReopenStageId } from "./decisions";
import { FakeDb } from "./fake-db.test-helper";
import { suggestedCaseTypeId } from "./inbound";
import { isPendingNoReply, nextNoReplyThreshold } from "./no-reply-rules";

describe("pickSuggestedCaseTypeId", () => {
  const types = [
    { id: "b", position: 2, suggested_for_contact_type_ids: ["p"] },
    { id: "a", position: 1, suggested_for_contact_type_ids: ["p", "c"] },
    { id: "z", position: 0, archived_at: "2026-01-01", suggested_for_contact_type_ids: ["p"] },
    { id: "n", position: 3, suggested_for_contact_type_ids: null },
  ];
  it("el primero por posición entre los no archivados que lo sugieren", () => {
    expect(pickSuggestedCaseTypeId(types, "p")).toBe("a");
    expect(pickSuggestedCaseTypeId(types, "c")).toBe("a");
    expect(pickSuggestedCaseTypeId(types, "otro")).toBeNull();
    expect(pickSuggestedCaseTypeId(types, null)).toBeNull();
  });

  it("el motor real (base en memoria) elige lo mismo", async () => {
    const fake = new FakeDb();
    fake.seed("workspaces", [{ id: "ws", name: "T", slug: "t", settings: {} }]);
    await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), "ws", "ecommerce");
    const prospecto = fake.rows("contact_types").find((t) => t.name === "Prospecto")!.id as string;
    const cliente = fake.rows("contact_types").find((t) => t.name === "Cliente")!.id as string;
    const venta = fake.rows("case_types").find((t) => t.name === "Venta")!.id as string;
    expect(await suggestedCaseTypeId(fake.asDb(), "ws", prospecto)).toBe(venta);
    expect(await suggestedCaseTypeId(fake.asDb(), "ws", cliente)).toBeNull();
    expect(await suggestedCaseTypeId(fake.asDb(), "ws", null)).toBeNull();
    // Un tipo archivado ya no se sugiere.
    fake.rows("case_types").find((t) => t.id === venta)!.archived_at = "2026-01-01";
    expect(await suggestedCaseTypeId(fake.asDb(), "ws", prospecto)).toBeNull();
  });
});

describe("resolveReopenStageId", () => {
  const open = [
    { id: "s2", position: 2 },
    { id: "s1", position: 1 },
  ];
  it("vuelve a la etapa del cierre si sigue abierta; si no, a la primera", () => {
    expect(resolveReopenStageId("s2", open)).toBe("s2");
    expect(resolveReopenStageId("archivada", open)).toBe("s1");
    expect(resolveReopenStageId(null, open)).toBe("s1");
    expect(resolveReopenStageId("s1", [])).toBeNull();
  });
});

describe("nextAutoTemplateStageId", () => {
  const open = [
    { id: "s2", position: 2 },
    { id: "s1", position: 1 },
    { id: "s3", position: 3 },
  ];
  it("pasa a la segunda etapa abierta si está sin etapa o en la primera", () => {
    expect(nextAutoTemplateStageId(open, null)).toBe("s2");
    expect(nextAutoTemplateStageId(open, "s1")).toBe("s2");
    expect(nextAutoTemplateStageId(open, "s3")).toBeNull();
    expect(nextAutoTemplateStageId([{ id: "s1", position: 1 }], null)).toBeNull();
  });
});

describe("planActivation", () => {
  const now = new Date("2026-10-19T15:00:00.000Z");
  const later = new Date("2026-10-20T14:00:00.000Z");
  it("abierto: activa; cerrado con próxima apertura: aplaza; sin apertura: activa", () => {
    expect(planActivation({ isOpen: true, nextOpening: null, now, scheduledFor: now.toISOString() })).toEqual({ action: "activate" });
    expect(planActivation({ isOpen: false, nextOpening: later, now, scheduledFor: now.toISOString() })).toEqual({ action: "defer", to: later });
    expect(planActivation({ isOpen: false, nextOpening: null, now, scheduledFor: now.toISOString() })).toEqual({ action: "activate" });
    expect(planActivation({ isOpen: false, nextOpening: now, now, scheduledFor: now.toISOString() })).toEqual({ action: "activate" });
    expect(planActivation({ isOpen: false, nextOpening: later, now, scheduledFor: null })).toEqual({ action: "activate" });
  });
});

describe("isPendingNoReply", () => {
  const T = (m: number) => new Date(Date.UTC(2026, 9, 19, 15, m)).toISOString();
  const base = {
    status: "open",
    waiting_since: null as string | null,
    last_outbound_at: T(0),
    last_inbound_at: null as string | null,
    no_reply_event_outbound_at: null as string | null,
    no_reply_event_minutes: null as number | null,
  };
  const older = new Date(T(60));
  it("abierta y con salida (de bot o de persona) posterior a la última entrada, haya o no espera del cliente", () => {
    expect(isPendingNoReply(base, older, 120)).toBe(true);
    expect(isPendingNoReply({ ...base, status: "won" }, older, 120)).toBe(false);
    // Que el cliente espere respuesta humana (waiting_since) no impide avisar: el último mensaje saliente sigue sin respuesta.
    expect(isPendingNoReply({ ...base, waiting_since: T(-5) }, older, 120)).toBe(true);
    expect(isPendingNoReply({ ...base, last_outbound_at: null }, older, 120)).toBe(false);
    expect(isPendingNoReply({ ...base, last_outbound_at: T(61) }, older, 120)).toBe(false);
    expect(isPendingNoReply({ ...base, last_inbound_at: T(-1) }, older, 120)).toBe(true);
    expect(isPendingNoReply({ ...base, last_inbound_at: T(0) }, older, 120)).toBe(false);
  });
  it("le falta algún umbral: no se emitió ninguno para ese mensaje o el último es menor que el máximo", () => {
    const stamped = { ...base, no_reply_event_outbound_at: T(0) };
    expect(isPendingNoReply({ ...stamped, no_reply_event_minutes: 60 }, older, 120)).toBe(true);
    expect(isPendingNoReply({ ...stamped, no_reply_event_minutes: 120 }, older, 120)).toBe(false);
    // Un mensaje saliente nuevo reinicia la cuenta aunque el sello anterior fuera del umbral máximo.
    expect(isPendingNoReply({ ...base, no_reply_event_outbound_at: T(-30), no_reply_event_minutes: 120 }, older, 120)).toBe(true);
  });

  it("coincide con la función de la base que imita la base en memoria (cases_pending_no_reply)", async () => {
    const fake = new FakeDb();
    const rows = [
      base,
      { ...base, status: "won" },
      { ...base, waiting_since: T(-5) },
      { ...base, last_outbound_at: null },
      { ...base, last_outbound_at: T(61) },
      { ...base, last_inbound_at: T(0) },
      { ...base, last_inbound_at: T(-1) },
      { ...base, no_reply_event_outbound_at: T(0), no_reply_event_minutes: 60 },
      { ...base, no_reply_event_outbound_at: T(0), no_reply_event_minutes: 120 },
      { ...base, no_reply_event_outbound_at: T(-30), no_reply_event_minutes: 120 },
    ];
    const seeded = fake.seed("cases", rows.map((r) => ({ workspace_id: "ws", contact_id: "c", ...r })));
    const { data } = await fake.rpc("cases_pending_no_reply", {
      p_workspace_id: "ws",
      p_older_than: older.toISOString(),
      p_max_minutes: 120,
      p_after_id: null,
      p_limit: 100,
    });
    const fromDb = new Set((data as Array<{ id: string }>).map((r) => r.id));
    seeded.forEach((row, i) => {
      expect(isPendingNoReply(rows[i], older, 120), `fila ${i}`).toBe(fromDb.has(row.id as string));
    });
  });
});

describe("nextNoReplyThreshold (sin cambios)", () => {
  it("el menor umbral alcanzado que aún no se emitió", () => {
    const base = { thresholds: [30, 120], lastOutboundAt: "2026-10-19T15:00:00.000Z", stampedOutboundAt: null, stampedMinutes: null };
    expect(nextNoReplyThreshold({ ...base, now: new Date("2026-10-19T15:29:00.000Z") })).toBeNull();
    expect(nextNoReplyThreshold({ ...base, now: new Date("2026-10-19T15:30:00.000Z") })).toBe(30);
    expect(nextNoReplyThreshold({ ...base, stampedOutboundAt: base.lastOutboundAt, stampedMinutes: 30, now: new Date("2026-10-19T17:00:00.000Z") })).toBe(120);
  });
});
