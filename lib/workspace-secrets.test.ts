import { describe, it, expect } from "vitest";
import {
  MIGRATION_MISSING_MESSAGE,
  WorkspaceSecretsError,
  getLateApiKey,
  getWorkspaceSecrets,
  getWorkspaceSecretsStatus,
  saveWorkspaceSecrets,
} from "./workspace-secrets";

interface FakeResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/** Cliente falso: responde según la tabla y registra las escrituras. */
function fakeClient(responses: Record<string, FakeResult>, upsertResult: FakeResult = { data: null, error: null }) {
  const calls: Array<{ table: string; op: string; payload?: unknown; options?: unknown }> = [];
  const client = {
    from(table: string) {
      return {
        select() {
          calls.push({ table, op: "select" });
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve(responses[table] ?? { data: null, error: null });
        },
        upsert(payload: unknown, options: unknown) {
          calls.push({ table, op: "upsert", payload, options });
          return Promise.resolve(upsertResult);
        },
      };
    },
  };
  return { client, calls };
}

describe("getWorkspaceSecrets", () => {
  it("lee workspace_secrets y mapea los nombres", async () => {
    const { client } = fakeClient({
      workspace_secrets: {
        data: { late_api_key: " zk_123 ", ai_api_key: "", webhook_secret: "whsec" },
        error: null,
      },
    });
    await expect(getWorkspaceSecrets("ws-1", client)).resolves.toEqual({
      lateApiKey: "zk_123",
      aiApiKey: null,
      webhookSecret: "whsec",
    });
  });

  it("sin fila devuelve todo vacío", async () => {
    const { client } = fakeClient({ workspace_secrets: { data: null, error: null } });
    await expect(getWorkspaceSecrets("ws-1", client)).resolves.toEqual({
      lateApiKey: null,
      aiApiKey: null,
      webhookSecret: null,
    });
  });

  it("si la tabla no existe todavía, lee las columnas viejas de workspaces", async () => {
    const { client, calls } = fakeClient({
      workspace_secrets: { data: null, error: { code: "PGRST205", message: "Could not find the table" } },
      workspaces: {
        data: { late_api_key_encrypted: "legacy", ai_api_key: "ai", webhook_secret: null },
        error: null,
      },
    });
    await expect(getWorkspaceSecrets("ws-1", client)).resolves.toEqual({
      lateApiKey: "legacy",
      aiApiKey: "ai",
      webhookSecret: null,
    });
    expect(calls.map((c) => c.table)).toEqual(["workspace_secrets", "workspaces"]);
  });

  it("ante otro error lanza WorkspaceSecretsError", async () => {
    const { client } = fakeClient({
      workspace_secrets: { data: null, error: { code: "42501", message: "permission denied" } },
    });
    await expect(getWorkspaceSecrets("ws-1", client)).rejects.toBeInstanceOf(WorkspaceSecretsError);
  });
});

describe("getLateApiKey y getWorkspaceSecretsStatus", () => {
  it("no lanzan: ante un error devuelven vacío", async () => {
    const { client } = fakeClient({
      workspace_secrets: { data: null, error: { code: "42501", message: "permission denied" } },
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(getLateApiKey("ws-1", client)).resolves.toBeNull();
      await expect(getWorkspaceSecretsStatus("ws-1", client)).resolves.toEqual({
        hasLateApiKey: false,
        hasAiApiKey: false,
        hasWebhookSecret: false,
      });
    } finally {
      console.error = originalError;
    }
  });

  it("el estado solo dice si hay valor, nunca el valor", async () => {
    const { client } = fakeClient({
      workspace_secrets: { data: { late_api_key: "zk", ai_api_key: null, webhook_secret: "s" }, error: null },
    });
    const status = await getWorkspaceSecretsStatus("ws-1", client);
    expect(status).toEqual({ hasLateApiKey: true, hasAiApiKey: false, hasWebhookSecret: true });
    expect(JSON.stringify(status)).not.toContain("zk");
  });
});

describe("saveWorkspaceSecrets", () => {
  it("hace upsert solo con los campos presentes y vacía con null o ''", async () => {
    const { client, calls } = fakeClient({});
    await expect(
      saveWorkspaceSecrets("ws-1", { lateApiKey: "  nueva  ", aiApiKey: "" }, client),
    ).resolves.toEqual({ error: null });
    expect(calls).toEqual([
      {
        table: "workspace_secrets",
        op: "upsert",
        payload: { workspace_id: "ws-1", late_api_key: "nueva", ai_api_key: null },
        options: { onConflict: "workspace_id" },
      },
    ]);
  });

  it("sin cambios no escribe", async () => {
    const { client, calls } = fakeClient({});
    await expect(saveWorkspaceSecrets("ws-1", {}, client)).resolves.toEqual({ error: null });
    expect(calls).toHaveLength(0);
  });

  it("avisa si falta la migración", async () => {
    const { client } = fakeClient({}, { data: null, error: { code: "42P01", message: "relation does not exist" } });
    await expect(saveWorkspaceSecrets("ws-1", { aiApiKey: "x" }, client)).resolves.toEqual({
      error: MIGRATION_MISSING_MESSAGE,
    });
  });
});
