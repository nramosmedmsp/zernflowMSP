// PRIV-03: Configuración guarda las palabras clave globales en el mismo formato
// que lee el motor al recibir un mensaje: `{keyword, action}`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ fake: null as unknown, role: "admin" as string, keywords: [] as unknown[] }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: "u1", email: "a@tienda.test" },
    workspace: { id: "ws-1", name: "Tienda", global_keywords: state.keywords },
    role: state.role,
    supabase: state.fake,
  }),
}));
vi.mock("@/lib/workspace-secrets", () => ({
  getWorkspaceSecretsStatus: async () => ({ hasLateApiKey: false, hasAiApiKey: false }),
  saveWorkspaceSecrets: async () => ({ error: null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.fake }));

import { resolveGlobalKeyword } from "@/lib/flow-engine/global-keywords";
import { saveWorkspaceSettings } from "./settings";

let fake: FakeDb;
const save = (globalKeywords: Parameters<typeof saveWorkspaceSettings>[0]["globalKeywords"]) =>
  saveWorkspaceSettings({ workspaceId: "ws-1", name: "Tienda", globalKeywords });

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.role = "admin";
  state.keywords = [];
  fake.seed("workspaces", [{ id: "ws-1", name: "Tienda", slug: "tienda", global_keywords: [] }]);
});

describe("saveWorkspaceSettings: palabras clave globales", () => {
  it("guarda objetos {keyword, action} que el motor sabe resolver", async () => {
    const result = await save([{ keyword: "BAJA", action: "unsubscribe" }, { keyword: " Alta ", action: "subscribe" }]);
    expect(result).toMatchObject({ ok: true });
    const stored = fake.rows("workspaces")[0].global_keywords;
    expect(stored).toEqual([
      { keyword: "baja", action: "unsubscribe" },
      { keyword: "alta", action: "subscribe" },
    ]);
    // Lo guardado es justo lo que lee el motor: sin TypeError.
    expect(resolveGlobalKeyword("BAJA", stored)).toMatchObject({ handled: true, action: "unsubscribe" });
    expect(resolveGlobalKeyword("alta", stored)).toMatchObject({ handled: true, action: "subscribe" });
  });

  it("un texto suelto (pantalla vieja abierta) se guarda como palabra de baja", async () => {
    await save(["Stop", "stop", "", "  "]);
    expect(fake.rows("workspaces")[0].global_keywords).toEqual([{ keyword: "stop", action: "unsubscribe" }]);
  });

  it("una acción desconocida se guarda como baja y lo que no es texto se descarta", async () => {
    await save([{ keyword: "x", action: "borrar" }, 5 as never, null as never]);
    expect(fake.rows("workspaces")[0].global_keywords).toEqual([{ keyword: "x", action: "unsubscribe" }]);
  });

  it("solo Dueño y Administrador pueden guardar", async () => {
    state.role = "member";
    const result = await save(["baja"]);
    expect(result).toHaveProperty("error");
    expect(fake.rows("workspaces")[0].global_keywords).toEqual([]);
  });
});

// SEG-05: cambiar claves o el nombre del espacio queda registrado, sin el valor.
describe("saveWorkspaceSettings: registro de acciones", () => {
  const auditRows = () => fake.rows("activity").filter((a) => (a.meta as { entity?: string }).entity);

  it("cambiar la clave de Zernio o de IA queda en la actividad, nunca el valor", async () => {
    state.role = "owner";
    const result = await saveWorkspaceSettings({
      workspaceId: "ws-1",
      name: "Tienda",
      globalKeywords: [],
      lateApiKey: "zk_SECRETA_123",
      aiApiKey: "sk-IA-SECRETA",
    });
    expect(result).toMatchObject({ ok: true });
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "config_changed",
      actor_id: "u1",
      workspace_id: "ws-1",
      meta: { action: "api_key_changed", entity: "secrets", zernio: true, ai: true },
    });
    expect(JSON.stringify(fake.rows("activity"))).not.toMatch(/SECRETA/);
  });

  it("un Administrador no puede cambiar claves y no queda ningún registro", async () => {
    const result = await saveWorkspaceSettings({ workspaceId: "ws-1", name: "Tienda", globalKeywords: [], lateApiKey: "zk_x" });
    expect(result).toHaveProperty("error");
    expect(auditRows()).toHaveLength(0);
  });

  it("guardar sin tocar claves ni nombre no registra nada", async () => {
    state.keywords = [{ keyword: "baja", action: "unsubscribe" }];
    await save(["baja"]);
    expect(auditRows()).toHaveLength(0);
  });

  it("agregar, quitar o cambiar de acción una palabra clave global queda registrado", async () => {
    state.keywords = [
      { keyword: "baja", action: "unsubscribe" },
      { keyword: "stop", action: "unsubscribe" },
    ];
    await save([
      { keyword: "baja", action: "subscribe" },
      { keyword: "alta", action: "subscribe" },
    ]);
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0].meta).toMatchObject({
      action: "global_keywords_changed",
      entity: "workspace",
      added: "alta (alta)",
      removed: "stop (baja)",
      changed: "baja (alta)",
      total: 2,
    });
  });

  it("cambiar el nombre del espacio queda registrado con el nombre anterior y el nuevo", async () => {
    await saveWorkspaceSettings({ workspaceId: "ws-1", name: "Muscle Shop", globalKeywords: [] });
    expect(auditRows()[0]).toMatchObject({
      from_value: "Tienda",
      to_value: "Muscle Shop",
      meta: { action: "workspace_settings_changed", entity: "workspace", field: "name" },
    });
  });
});
