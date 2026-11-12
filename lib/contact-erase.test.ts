import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import type { Db } from "@/lib/cases/io";
import {
  REMOVE_CHUNK,
  eraseContactData,
  erasureConfirmationMatches,
  erasureConfirmationWord,
  parseErasureSummary,
  removeFiles,
  retryErasureFiles,
} from "./contact-erase";

const WS = randomUUID();
const CONTACT = randomUUID();
const ACTOR = randomUUID();

type RemoveFn = (paths: string[]) => Promise<{ error: { message: string } | null }>;

function setup(opts: { rpc?: () => Promise<{ data: unknown; error: { message: string } | null }>; remove?: RemoveFn } = {}) {
  const fake = new FakeDb();
  const removed: string[][] = [];
  const remove: RemoveFn =
    opts.remove ??
    (async (paths) => {
      removed.push(paths);
      return { error: null };
    });
  Object.assign(fake, {
    rpc: vi.fn(opts.rpc ?? (async () => ({ data: null, error: null }))),
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => (expect(bucket).toBe("chat-media"), remove(paths)) }) },
  });
  return { fake, db: fake as unknown as Db, removed };
}

const paths = (n: number) => Array.from({ length: n }, (_, i) => `${WS}/conv/c/in/${i}.jpg`);

describe("confirmación escrita", () => {
  it("pide el nombre del cliente o ELIMINAR si no tiene un nombre útil", () => {
    expect(erasureConfirmationWord("  María   Pérez ")).toBe("María Pérez");
    expect(erasureConfirmationWord(null)).toBe("ELIMINAR");
    expect(erasureConfirmationWord("A")).toBe("ELIMINAR");
  });

  it("compara sin mayúsculas, tildes ni espacios sobrantes", () => {
    expect(erasureConfirmationMatches(" maria  perez ", "María Pérez")).toBe(true);
    expect(erasureConfirmationMatches("eliminar", null)).toBe(true);
    expect(erasureConfirmationMatches("Maria", "María Pérez")).toBe(false);
    expect(erasureConfirmationMatches("", "María Pérez")).toBe(false);
    expect(erasureConfirmationMatches(undefined, "María Pérez")).toBe(false);
    // Con nombre, la palabra genérica NO sirve.
    expect(erasureConfirmationMatches("ELIMINAR", "María Pérez")).toBe(false);
  });
});

describe("resumen", () => {
  it("lee lo que devuelve la base y tolera datos dañados", () => {
    expect(parseErasureSummary({ conversations: 2, messages: 10, files: 3, notes: 1, cases_kept: 4, claims_kept: 1 })).toEqual({
      conversations: 2, messages: 10, files: 3, notes: 1, casesKept: 4, claimsKept: 1,
    });
    expect(parseErasureSummary(null)).toEqual({ conversations: 0, messages: 0, files: 0, notes: 0, casesKept: 0, claimsKept: 0 });
  });
});

describe("borrar archivos", () => {
  it("los borra de a grupos", async () => {
    const { db, removed } = setup();
    const res = await removeFiles(db as never, paths(REMOVE_CHUNK + 5));
    expect(res).toEqual({ pending: [], error: null });
    expect(removed.map((r) => r.length)).toEqual([REMOVE_CHUNK, 5]);
  });

  it("un grupo que falla queda pendiente y los demás se borran igual", async () => {
    let call = 0;
    const { db } = setup({ remove: async () => (++call === 1 ? { error: { message: "caída" } } : { error: null }) });
    const list = paths(REMOVE_CHUNK + 5);
    const res = await removeFiles(db as never, list);
    expect(res.pending).toEqual(list.slice(0, REMOVE_CHUNK));
    expect(res.error).toBe("caída");
  });

  it("si la llamada lanza, esos archivos quedan pendientes", async () => {
    const { db } = setup({ remove: async () => { throw new Error("sin red"); } });
    const res = await removeFiles(db as never, paths(3));
    expect(res.pending).toHaveLength(3);
    expect(res.error).toBe("sin red");
  });
});

describe("eraseContactData", () => {
  const params = { workspaceId: WS, contactId: CONTACT, actorId: ACTOR };

  it("llama a la base, borra los archivos y deja el borrado completo", async () => {
    const erasureId = randomUUID();
    const list = paths(3);
    const { fake, db, removed } = setup({
      rpc: async () => ({ data: { erasure_id: erasureId, paths: list, summary: { messages: 7, files: 3, cases_kept: 2, claims_kept: 1 } }, error: null }),
    });
    fake.seed("contact_erasures", [{ id: erasureId, workspace_id: WS, contact_id: CONTACT, files_pending: list, files_total: 3, file_attempts: 0 }]);
    const out = await eraseContactData(db, params);
    expect(out).toMatchObject({ ok: true, alreadyErased: false, erasureId, filesPending: 0 });
    expect((fake.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      "erase_contact_data",
      { p_workspace_id: WS, p_contact_id: CONTACT, p_actor_id: ACTOR },
    ]);
    expect(removed.flat()).toEqual(list);
    expect(fake.rows("contact_erasures")[0]).toMatchObject({ files_pending: [], last_file_error: null, file_attempts: 1 });
    expect(typeof fake.rows("contact_erasures")[0].files_done_at).toBe("string");
  });

  it("si falla el borrado de archivos queda registrado qué faltó y se puede reintentar", async () => {
    const erasureId = randomUUID();
    const list = paths(2);
    let failing = true;
    const { fake, db } = setup({
      rpc: async () => ({ data: { erasure_id: erasureId, paths: list, summary: {} }, error: null }),
      remove: async () => (failing ? { error: { message: "almacenamiento no disponible" } } : { error: null }),
    });
    fake.seed("contact_erasures", [{ id: erasureId, workspace_id: WS, contact_id: CONTACT, files_pending: list, files_total: 2, file_attempts: 0 }]);

    const out = await eraseContactData(db, params);
    expect(out).toMatchObject({ ok: true, filesPending: 2 });
    expect(fake.rows("contact_erasures")[0]).toMatchObject({
      files_pending: list,
      files_done_at: null,
      last_file_error: "almacenamiento no disponible",
      file_attempts: 1,
    });

    failing = false;
    const retry = await retryErasureFiles(db, { workspaceId: WS, erasureId, actorId: ACTOR });
    expect(retry).toEqual({ ok: true, filesPending: 0 });
    expect(fake.rows("contact_erasures")[0]).toMatchObject({ files_pending: [], last_file_error: null, file_attempts: 2 });
    expect(fake.rows("activity").at(-1)).toMatchObject({ type: "contact_data_erase_files_retried", contact_id: CONTACT, actor_id: ACTOR });
  });

  it("sin archivos no toca el almacenamiento", async () => {
    const { db, removed } = setup({ rpc: async () => ({ data: { erasure_id: randomUUID(), paths: [], summary: {} }, error: null }) });
    expect(await eraseContactData(db, params)).toMatchObject({ ok: true, filesPending: 0 });
    expect(removed).toHaveLength(0);
  });

  it("un contacto ya borrado se reconoce", async () => {
    const { db } = setup({ rpc: async () => ({ data: { already_erased: true }, error: null }) });
    expect(await eraseContactData(db, params)).toEqual({ ok: true, alreadyErased: true });
  });

  it("si la base falla no se borra ningún archivo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, removed } = setup({ rpc: async () => ({ data: null, error: { message: "deadlock detected" } }) });
    expect(await eraseContactData(db, params)).toEqual({ ok: false, code: "failed" });
    expect(removed).toHaveLength(0);
  });

  it("contacto inexistente", async () => {
    const { db } = setup({ rpc: async () => ({ data: null, error: { message: "contact_not_found" } }) });
    expect(await eraseContactData(db, params)).toEqual({ ok: false, code: "not_found" });
  });

  it("reintentar un borrado ajeno o inexistente", async () => {
    const { db } = setup();
    expect(await retryErasureFiles(db, { workspaceId: WS, erasureId: randomUUID(), actorId: ACTOR })).toEqual({ ok: false, code: "not_found" });
  });
});
