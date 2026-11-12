// PRIV-03: Configuración guarda las palabras clave globales en el mismo formato
// que lee el motor al recibir un mensaje: `{keyword, action}`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ fake: null as unknown, role: "admin" as string }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: "u1", email: "a@tienda.test" },
    workspace: { id: "ws-1" },
    role: state.role,
    supabase: state.fake,
  }),
}));
vi.mock("@/lib/workspace-secrets", () => ({
  getWorkspaceSecretsStatus: async () => ({ hasLateApiKey: false, hasAiApiKey: false }),
  saveWorkspaceSecrets: async () => ({ error: null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { resolveGlobalKeyword } from "@/lib/flow-engine/global-keywords";
import { saveWorkspaceSettings } from "./settings";

let fake: FakeDb;
const save = (globalKeywords: Parameters<typeof saveWorkspaceSettings>[0]["globalKeywords"]) =>
  saveWorkspaceSettings({ workspaceId: "ws-1", name: "Tienda", globalKeywords });

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.role = "admin";
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
