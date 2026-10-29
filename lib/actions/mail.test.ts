// Correo de la instalación: solo el Dueño, con rastro y aviso a los Dueños.
// Sin contraseñas en el registro ni en los avisos.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { OWNER_ONLY_MAIL_MESSAGE } from "@/lib/team-rules";

const state = vi.hoisted(() => ({
  fake: null as unknown,
  userId: "",
  workspaceId: "",
  role: "owner" as string,
  saved: [] as unknown[],
}));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: state.userId, email: "actor@tienda.test" },
    workspace: { id: state.workspaceId },
    role: state.role,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.fake,
  createClient: async () => state.fake,
}));
vi.mock("@/lib/mail/settings", () => ({
  loadMailRow: async () => ({
    host: "smtp.tienda.test",
    port: 587,
    username: "correo@tienda.test",
    password_encrypted: "CIFRADO",
    from_email: "ventas@tienda.test",
  }),
  saveMailRow: async (_s: unknown, value: unknown) => {
    state.saved.push(value);
    return { error: null };
  },
  getMailStatus: async () => ({ row: null, status: { configured: true } }),
}));
vi.mock("@/lib/mail/send", () => ({ sendAppMail: async () => ({ ok: true }) }));

import { saveMailSettings, sendTestMail } from "./mail";

const WS = randomUUID();
const OWNER = randomUUID();
const OWNER2 = randomUUID();
const ADMIN = randomUUID();
const MEMBER = randomUUID();

const input = {
  host: "smtp.atacante.test",
  port: "465",
  security: "ssl",
  username: "user",
  password: "SUPER-SECRETO-123",
  fromEmail: "ceo@tienda.test",
  fromName: "Tienda",
};

let fake: FakeDb;

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.workspaceId = WS;
  state.saved = [];
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: OWNER2, role: "owner" },
    { workspace_id: WS, user_id: ADMIN, role: "admin" },
    { workspace_id: WS, user_id: MEMBER, role: "member" },
  ]);
});

function as(userId: string, role: string) {
  state.userId = userId;
  state.role = role;
}

describe("configuración de correo", () => {
  it("un Administrador y un Miembro no pueden guardar ni probar", async () => {
    for (const [id, role] of [[ADMIN, "admin"], [MEMBER, "member"]] as const) {
      as(id, role);
      expect(await saveMailSettings(input)).toEqual({ error: OWNER_ONLY_MAIL_MESSAGE });
      expect(await sendTestMail()).toEqual({ error: OWNER_ONLY_MAIL_MESSAGE });
    }
    expect(state.saved).toHaveLength(0);
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("el Dueño guarda, deja rastro y avisa a todos los Dueños con la configuración anterior", async () => {
    as(OWNER, "owner");
    const res = await saveMailSettings(input);
    expect("ok" in res).toBe(true);
    expect(state.saved).toHaveLength(1);

    const log = fake.rows("activity").filter((a) => a.type === "config_changed");
    expect(log).toHaveLength(1);
    expect(log[0].actor_id).toBe(OWNER);
    expect(log[0].meta).toMatchObject({
      action: "mail_settings_changed",
      previous_host: "smtp.tienda.test",
      previous_from_email: "ventas@tienda.test",
      new_host: "smtp.atacante.test",
    });

    const notes = fake.rows("notifications");
    expect(notes.map((n) => n.user_id).sort()).toEqual([OWNER, OWNER2].sort());
    expect(notes[0].type).toBe("mail_settings_changed");
    expect(String(notes[0].body)).toContain("smtp.tienda.test");
    expect(String(notes[0].body)).toContain("ventas@tienda.test");
  });

  it("nunca guarda contraseñas en el registro ni en los avisos", async () => {
    as(OWNER, "owner");
    await saveMailSettings(input);
    const dump = JSON.stringify([fake.rows("activity"), fake.rows("notifications")]);
    expect(dump).not.toContain("SUPER-SECRETO-123");
    expect(dump).not.toContain("CIFRADO");
  });
});
