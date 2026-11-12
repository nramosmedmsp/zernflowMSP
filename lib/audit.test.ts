import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { auditRow, logAudit, sanitizeAuditMeta } from "./audit";

describe("sanitizeAuditMeta", () => {
  it("descarta cualquier campo que parezca un secreto, un token o un enlace", () => {
    const meta = sanitizeAuditMeta({
      apiKey: "sk-secreto",
      late_api_key: "x",
      ai_api_key: "y",
      password: "p",
      token_hash: "t",
      accessUrl: "https://app/auth/confirm?token_hash=abc",
      link: "https://x",
      webhookSecret: "s",
      role: "admin",
      user_id: "u1",
      count: 3,
    });
    expect(meta).toEqual({ role: "admin", user_id: "u1", count: 3 });
  });

  it("solo deja valores simples y acota los textos largos", () => {
    const meta = sanitizeAuditMeta({ obj: { a: 1 }, list: [1], big: "x".repeat(500), ok: true, nada: null, fn: undefined });
    expect(meta).toEqual({ big: "x".repeat(200), ok: true, nada: null });
  });
});

describe("auditRow", () => {
  it("usa el mismo formato que member_readded: config_changed con action y entity en meta", () => {
    const row = auditRow({
      workspaceId: "ws",
      actorId: "u",
      action: "api_key_changed",
      entity: "secrets",
      meta: { which: "zernio", apiKey: "sk-NO-DEBE-GUARDARSE" },
    });
    expect(row).toEqual({
      workspace_id: "ws",
      type: "config_changed",
      actor_id: "u",
      from_value: null,
      to_value: null,
      meta: { which: "zernio", action: "api_key_changed", entity: "secrets" },
    });
    expect(JSON.stringify(row)).not.toContain("sk-NO-DEBE");
  });

  it("la acción y la entidad no se pueden pisar desde meta", () => {
    const row = auditRow({ workspaceId: "w", actorId: "u", action: "channel_deleted", entity: "channel", meta: { action: "otra", entity: "otra" } });
    expect(row.meta).toMatchObject({ action: "channel_deleted", entity: "channel" });
  });
});

describe("logAudit", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("escribe una fila en activity", async () => {
    const db = new FakeDb();
    await logAudit(db, { workspaceId: "ws", actorId: "u", action: "member_created", entity: "team", toValue: "admin", meta: { user_id: "n", role: "admin" } });
    expect(db.rows("activity")).toHaveLength(1);
    expect(db.rows("activity")[0]).toMatchObject({
      workspace_id: "ws",
      type: "config_changed",
      actor_id: "u",
      to_value: "admin",
      meta: { action: "member_created", entity: "team", role: "admin", user_id: "n" },
    });
  });

  it("si guardar el registro falla, no lanza", async () => {
    const broken = { from: () => { throw new Error("base caída"); } };
    await expect(logAudit(broken, { workspaceId: "w", actorId: "u", action: "data_exported", entity: "export" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
