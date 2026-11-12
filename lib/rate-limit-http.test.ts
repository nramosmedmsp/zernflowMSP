import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: null as unknown, throwOnCreate: false }));
vi.mock("@/lib/supabase/server", () => ({
  createRawServiceClient: () => {
    if (state.throwOnCreate) throw new Error("falta SUPABASE_URL");
    return { rpc: state.rpc };
  },
}));

import { RATE_LIMIT_MESSAGE, RATE_RULES } from "./rate-limit";
import { enforceRateLimit, rateLimitDecision, rateLimitedResponse } from "./rate-limit-http";

const blocked = async () => ({ data: [{ allowed: false, current_hits: 99, retry_after_seconds: 17 }], error: null });
const allowed = async () => ({ data: [{ allowed: true, current_hits: 1, retry_after_seconds: 17 }], error: null });

beforeEach(() => {
  state.throwOnCreate = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("rateLimitedResponse", () => {
  it("es un 429 con el mensaje en español, Retry-After y sin caché", async () => {
    const res = rateLimitedResponse(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "Vas muy rápido. Espera un momento y vuelve a intentar.", code: "rate_limited", retryAfterSeconds: 42 });
  });

  it("admite otro mensaje", async () => {
    expect((await rateLimitedResponse(5, "Otro texto").json()).error).toBe("Otro texto");
  });
});

describe("enforceRateLimit", () => {
  it("dentro del tope devuelve null y la ruta sigue", async () => {
    state.rpc = allowed;
    expect(await enforceRateLimit(RATE_RULES.messageSend, "u1")).toBeNull();
  });

  it("pasado el tope devuelve la respuesta 429 con el tiempo de espera", async () => {
    state.rpc = blocked;
    const res = await enforceRateLimit(RATE_RULES.messageSend, "u1");
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("17");
    expect((await res!.json()).error).toBe(RATE_LIMIT_MESSAGE);
  });

  it("si el contador falla (base caída) deja pasar y lo registra", async () => {
    state.rpc = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await enforceRateLimit(RATE_RULES.messageSend, "u1")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("si ni siquiera se puede crear el cliente, deja pasar", async () => {
    state.throwOnCreate = true;
    expect(await rateLimitDecision(RATE_RULES.uploadUrl, "u1")).toEqual({ allowed: true });
    expect(await enforceRateLimit(RATE_RULES.uploadUrl, "u1")).toBeNull();
  });
});
