// SEG-01: "¿Olvidaste tu contraseña?" es pública; tiene tope por IP y por correo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: null as unknown,
  rpcCalls: [] as Array<Record<string, unknown>>,
  existsCalls: [] as string[],
  forwarded: "203.0.113.9",
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": state.forwarded }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({}),
  createRawServiceClient: () => ({ rpc: state.rpc }),
}));
vi.mock("@/lib/mail/settings", () => ({ isMailConfigured: async () => true }));
vi.mock("@/lib/mail/send", () => ({ sendAppMail: async () => ({ ok: true }) }));
vi.mock("@/lib/supabase/extra-rpc", () => ({
  rpcAuthUserExists: async (_s: unknown, email: string) => {
    state.existsCalls.push(email);
    return { exists: false, error: null };
  },
}));
vi.mock("@/lib/supabase/admin-users", () => ({ findAuthUserByEmail: async () => null, generateAccessLink: async () => ({ ok: false }) }));

import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { requestPasswordReset } from "./auth";

const RESET_OK = "Si el correo está registrado, te enviamos un enlace.";

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
  state.rpcCalls = [];
  state.existsCalls = [];
  state.forwarded = "203.0.113.9";
  state.rpc = async (_name: string, args: Record<string, unknown>) => {
    state.rpcCalls.push(args);
    return { data: [{ allowed: true, current_hits: 1, retry_after_seconds: 60 }], error: null };
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("requestPasswordReset: tope de frecuencia", () => {
  it("dentro del tope responde lo de siempre", async () => {
    expect(await requestPasswordReset("ana@tienda.pe")).toEqual({ message: RESET_OK });
    expect(state.existsCalls).toEqual(["ana@tienda.pe"]);
  });

  it("cuenta por IP y por correo, y el correo nunca va en claro al contador", async () => {
    await requestPasswordReset("Ana@Tienda.pe");
    const buckets = state.rpcCalls.map((c) => String(c.p_bucket));
    expect(buckets.some((b) => b.startsWith("pwd_reset_email:3600:"))).toBe(true);
    expect(buckets.some((b) => b.startsWith("pwd_reset_ip:60:"))).toBe(true);
    for (const b of buckets) {
      expect(b).not.toContain("ana");
      expect(b).not.toContain("203.0.113.9");
    }
  });

  it("pasado el tope muestra el mensaje de 'vas muy rápido' y no manda ningún correo", async () => {
    state.rpc = async () => ({ data: [{ allowed: false, current_hits: 9, retry_after_seconds: 60 }], error: null });
    expect(await requestPasswordReset("ana@tienda.pe")).toEqual({ message: RATE_LIMIT_MESSAGE });
    expect(state.existsCalls).toEqual([]);
  });

  it("la respuesta de tope es la misma exista o no la cuenta (no revela nada)", async () => {
    state.rpc = async () => ({ data: [{ allowed: false, current_hits: 9, retry_after_seconds: 60 }], error: null });
    const a = await requestPasswordReset("existe@tienda.pe");
    const b = await requestPasswordReset("no-existe@tienda.pe");
    expect(a).toEqual(b);
  });

  it("si el contador falla, deja pasar", async () => {
    state.rpc = async () => {
      throw new Error("base caída");
    };
    expect(await requestPasswordReset("ana@tienda.pe")).toEqual({ message: RESET_OK });
    expect(state.existsCalls).toEqual(["ana@tienda.pe"]);
  });
});
