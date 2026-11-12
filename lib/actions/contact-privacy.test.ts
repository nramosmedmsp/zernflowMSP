// Permisos del borrado de datos de un cliente: solo Dueño y Administrador, con
// confirmación escrita y bloqueado en "Ver como".

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { ADMIN_ONLY_MESSAGE } from "@/lib/permissions";

const state = vi.hoisted(() => ({
  fake: null as unknown,
  role: "admin",
  locked: false,
  erase: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: "u-1" }, workspace: { id: "ws-1" }, role: state.role }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.fake }));
vi.mock("@/lib/view-as/lock", () => ({
  isViewAsLocked: async () => state.locked,
  markReadOnlyHit: async () => {},
  VIEW_AS_LOCKED_MESSAGE: "Estás viendo como otra persona (solo lectura): esta acción no se ejecutó.",
}));
vi.mock("@/lib/contact-erase", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/contact-erase")>();
  return { ...real, eraseContactData: state.erase, retryErasureFiles: state.retry };
});

import { eraseContact, retryEraseFiles } from "./contact-privacy";

const contactId = randomUUID();
let fake: FakeDb;

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.role = "admin";
  state.locked = false;
  state.erase.mockReset().mockResolvedValue({
    ok: true,
    alreadyErased: false,
    erasureId: "e-1",
    summary: { conversations: 1, messages: 5, files: 2, notes: 1, casesKept: 3, claimsKept: 1 },
    filesPending: 0,
  });
  state.retry.mockReset().mockResolvedValue({ ok: true, filesPending: 0 });
  fake.seed("contacts", [{ id: contactId, workspace_id: "ws-1", display_name: "María Pérez" }]);
});

describe("eraseContact", () => {
  it("el dueño o administrador con la confirmación correcta borra", async () => {
    const res = await eraseContact(contactId, "maria perez");
    expect(res).toMatchObject({ ok: true, filesPending: 0, warning: null, summary: { messages: 5, claimsKept: 1 } });
    expect(state.erase).toHaveBeenCalledWith(fake, { workspaceId: "ws-1", contactId, actorId: "u-1" });
  });

  it("un asesor no puede aunque conozca la confirmación", async () => {
    state.role = "member";
    expect(await eraseContact(contactId, "María Pérez")).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(state.erase).not.toHaveBeenCalled();
  });

  it("sin la palabra de confirmación no se borra", async () => {
    expect(await eraseContact(contactId, "ELIMINAR")).toMatchObject({ error: expect.stringContaining("no coincide") });
    expect(await eraseContact(contactId, "")).toMatchObject({ error: expect.stringContaining("no coincide") });
    expect(state.erase).not.toHaveBeenCalled();
  });

  it("en 'Ver como' queda bloqueado", async () => {
    state.locked = true;
    expect(await eraseContact(contactId, "María Pérez")).toMatchObject({ error: expect.stringContaining("solo lectura") });
    expect(state.erase).not.toHaveBeenCalled();
  });

  it("contacto de otro espacio o inexistente", async () => {
    expect(await eraseContact(randomUUID(), "x")).toEqual({ error: "No se encontró el contacto." });
    expect(await eraseContact("no-uuid", "x")).toEqual({ error: "Datos no válidos." });
  });

  it("ya borrado", async () => {
    fake.rows("contacts")[0].erased_at = "2026-11-01T00:00:00Z";
    expect(await eraseContact(contactId, "Cliente eliminado")).toEqual({ error: "Los datos de este cliente ya fueron eliminados." });
  });

  it("si quedaron archivos sin borrar avisa con palabras claras", async () => {
    state.erase.mockResolvedValue({ ok: true, alreadyErased: false, erasureId: "e-1", summary: {}, filesPending: 2 });
    const res = await eraseContact(contactId, "María Pérez");
    expect(res).toMatchObject({ ok: true, filesPending: 2, warning: expect.stringContaining("Reintentar borrar archivos") });
  });

  it("si la base falla, no hay éxito", async () => {
    state.erase.mockResolvedValue({ ok: false, code: "failed" });
    expect(await eraseContact(contactId, "María Pérez")).toMatchObject({ error: expect.any(String) });
  });
});

describe("retryEraseFiles", () => {
  it("solo administradores y fuera de 'Ver como'", async () => {
    const id = randomUUID();
    expect(await retryEraseFiles(id)).toEqual({ ok: true, filesPending: 0 });
    state.role = "member";
    expect(await retryEraseFiles(id)).toEqual({ error: ADMIN_ONLY_MESSAGE });
    state.role = "owner";
    state.locked = true;
    expect(await retryEraseFiles(id)).toMatchObject({ error: expect.stringContaining("solo lectura") });
  });
});
