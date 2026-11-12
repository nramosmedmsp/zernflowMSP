// SEG-14: el POST que valida el enlace de acceso solo vale desde esta misma app.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyOtp } = vi.hoisted(() => ({ verifyOtp: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

function post(headers: Record<string, string>) {
  const form = new FormData();
  form.set("token_hash", "abc123");
  form.set("type", "recovery");
  return POST(
    new NextRequest("https://app.test/auth/confirm/verificar", {
      method: "POST",
      body: form,
      headers: { host: "app.test", ...headers },
    }),
  );
}

beforeEach(() => verifyOtp.mockClear());

describe("POST /auth/confirm/verificar", () => {
  it("con el Origin de la propia app valida el token y redirige", async () => {
    const res = await post({ origin: "https://app.test" });
    expect(res.status).toBe(303);
    expect(verifyOtp).toHaveBeenCalledOnce();
    expect(new URL(res.headers.get("location")!).pathname).not.toBe("/login");
  });

  it("desde otro sitio NO toca el token ni crea sesión", async () => {
    const res = await post({ origin: "https://sitio-malo.test" });
    expect(res.status).toBe(303);
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://app.test/login?error=enlace");
  });

  it("sin Origin tampoco", async () => {
    const res = await post({});
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/login?error=enlace");
  });

  it("detrás de un proxy usa x-forwarded-host", async () => {
    const res = await post({ origin: "https://crm.muscle.test", host: "interno:3000", "x-forwarded-host": "crm.muscle.test" });
    expect(verifyOtp).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
  });
});
