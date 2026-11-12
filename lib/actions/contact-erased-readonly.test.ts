// Cliente eliminado = solo lectura: cada acción que cambia datos del contacto lo rechaza
// con el mismo mensaje, y el contacto sigue vacío. Con la base en memoria.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { ERASED_READONLY_MESSAGE } from "@/lib/contact-erased";

const state = vi.hoisted(() => ({ fake: null as unknown, userId: "", workspaceId: "" }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    viewAs: { locked: false, active: false, ended: false, info: null },
    user: { id: state.userId },
    workspace: { id: state.workspaceId },
    role: "admin",
    supabase: state.fake,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.fake,
  createClient: async () => state.fake,
}));
vi.mock("@/lib/view-as/lock", () => ({
  isViewAsLocked: async () => false,
  markReadOnlyHit: async () => {},
  VIEW_AS_LOCKED_MESSAGE: "solo lectura",
}));

import {
  addContactTag,
  removeContactTag,
  setContactOwner,
  setContactTeam,
  setMarketingConsent,
  updateContactDetails,
  updateContactKeyDate,
  updateContactPhone,
  updateContactType,
} from "./contacts";
import { erasedContactError } from "@/lib/contact-erased-guard";

const WS = randomUUID();
const ADMIN = randomUUID();
const ANA = randomUUID();
const TAG = randomUUID();

let fake: FakeDb;
let erasedId: string;
let normalId: string;

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.workspaceId = WS;
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: ADMIN, role: "admin" },
    { workspace_id: WS, user_id: ANA, role: "member" },
  ]);
  fake.seed("tags", [{ id: TAG, workspace_id: WS, name: "VIP" }]);
  const [erased, normal] = fake.seed("contacts", [
    {
      workspace_id: WS,
      display_name: "Cliente eliminado",
      owner_id: ANA,
      phone: null,
      email: null,
      is_subscribed: false,
      marketing_status: "opted_out",
      erased_at: "2026-11-01T00:00:00Z",
    },
    { workspace_id: WS, display_name: "María", owner_id: ANA, phone: "+51987654321", is_subscribed: true },
  ]);
  erasedId = erased.id as string;
  normalId = normal.id as string;
  state.userId = ADMIN;
});

const BLOCKED = { error: ERASED_READONLY_MESSAGE };

describe("acciones sobre un cliente eliminado", () => {
  it("rechazan todos los cambios y no escriben nada", async () => {
    expect(await updateContactDetails(erasedId, { displayName: "Otra persona", email: "x@y.pe", phone: "+51999999999" })).toEqual(BLOCKED);
    expect(await updateContactPhone(erasedId, "+51999999999")).toEqual(BLOCKED);
    expect(await updateContactKeyDate(erasedId, "2026-11-05")).toEqual(BLOCKED);
    expect(await updateContactType(erasedId, null)).toEqual(BLOCKED);
    expect(await setContactOwner(erasedId, ADMIN)).toEqual(BLOCKED);
    expect(await setContactTeam(erasedId, null)).toEqual(BLOCKED);
    expect(await addContactTag(erasedId, TAG)).toEqual(BLOCKED);
    expect(await removeContactTag(erasedId, TAG)).toEqual(BLOCKED);
    expect(await setMarketingConsent(erasedId, "reactivate", "Me lo pidió por teléfono")).toEqual(BLOCKED);
    const row = fake.rows("contacts").find((c) => c.id === erasedId)!;
    expect(row).toMatchObject({ display_name: "Cliente eliminado", phone: null, email: null, owner_id: ANA, marketing_status: "opted_out" });
    expect(fake.rows("contact_tags")).toHaveLength(0);
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("un contacto normal sigue funcionando", async () => {
    expect(await updateContactPhone(normalId, "+51911111111")).toMatchObject({ ok: true });
    expect(await addContactTag(normalId, TAG)).toEqual({ ok: true });
  });
});

describe("comprobación común del servidor", () => {
  it("por contacto", async () => {
    expect(await erasedContactError(fake as never, WS, erasedId)).toEqual(BLOCKED);
    expect(await erasedContactError(fake as never, WS, normalId)).toBeNull();
    expect(await erasedContactError(fake as never, WS, null)).toBeNull();
    // Otro espacio: no se revela ni se bloquea.
    expect(await erasedContactError(fake as never, randomUUID(), erasedId)).toBeNull();
  });
});
