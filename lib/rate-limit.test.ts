import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  RATE_LIMIT_MESSAGE,
  RATE_RULES,
  bucketKey,
  checkRateLimit,
  clientIp,
  hashSubject,
  rateLimitPruneCutoff,
  type RateRule,
} from "./rate-limit";

type Call = { name: string; args: Record<string, unknown> };

/** Cliente falso con una base de contadores en memoria (misma lógica que rate_limit_hit). */
function fakeClient(opts: { fail?: "error" | "throw" | "empty" } = {}) {
  const counts = new Map<string, number>();
  const calls: Call[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (opts.fail === "throw") throw new Error("base caída");
      if (opts.fail === "error") return { data: null, error: { message: "relation does not exist" } };
      if (opts.fail === "empty") return { data: [], error: null };
      const key = String(args.p_bucket);
      const hits = (counts.get(key) ?? 0) + 1;
      counts.set(key, hits);
      return {
        data: [{ allowed: hits <= Number(args.p_limit), current_hits: hits, retry_after_seconds: Number(args.p_window_seconds) - 10 }],
        error: null,
      };
    },
  };
  return { client, calls, counts };
}

const ONE: RateRule = { name: "prueba", windows: [{ limit: 2, seconds: 60 }] };
const TWO: RateRule = {
  name: "dos",
  windows: [
    { limit: 5, seconds: 60 },
    { limit: 3, seconds: 3600 },
  ],
};

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("deja pasar hasta el tope y bloquea el siguiente, con el tiempo de espera", async () => {
    const { client } = fakeClient();
    expect(await checkRateLimit(client, ONE, "u1")).toEqual({ allowed: true });
    expect(await checkRateLimit(client, ONE, "u1")).toEqual({ allowed: true });
    expect(await checkRateLimit(client, ONE, "u1")).toEqual({ allowed: false, retryAfterSeconds: 50 });
  });

  it("cuenta por separado a cada usuario", async () => {
    const { client } = fakeClient();
    await checkRateLimit(client, ONE, "u1");
    await checkRateLimit(client, ONE, "u1");
    expect(await checkRateLimit(client, ONE, "u1")).toMatchObject({ allowed: false });
    expect(await checkRateLimit(client, ONE, "u2")).toEqual({ allowed: true });
  });

  it("con varias ventanas basta con que una se pase; espera la mayor", async () => {
    const { client } = fakeClient();
    await checkRateLimit(client, TWO, "u1");
    await checkRateLimit(client, TWO, "u1");
    await checkRateLimit(client, TWO, "u1");
    const fourth = await checkRateLimit(client, TWO, "u1");
    // La ventana de la hora (tope 3) se pasó; la del minuto (tope 5) todavía no.
    expect(fourth).toEqual({ allowed: false, retryAfterSeconds: 3590 });
  });

  it("manda a la función la clave, el tope y la ventana de cada una", async () => {
    const { client, calls } = fakeClient();
    await checkRateLimit(client, TWO, "u1");
    expect(calls.map((c) => c.name)).toEqual(["rate_limit_hit", "rate_limit_hit"]);
    expect(calls.map((c) => c.args)).toEqual([
      { p_bucket: "dos:60:u1", p_limit: 5, p_window_seconds: 60 },
      { p_bucket: "dos:3600:u1", p_limit: 3, p_window_seconds: 3600 },
    ]);
  });

  it.each(["error", "throw", "empty"] as const)("si el contador falla (%s) NO bloquea y lo registra", async (fail) => {
    const { client } = fakeClient({ fail });
    expect(await checkRateLimit(client, TWO, "u1")).toEqual({ allowed: true });
    expect(console.error).toHaveBeenCalled();
  });

  it("una ventana que falla no libera a otra que sí contó y se pasó", async () => {
    const counts = new Map<string, number>();
    const client = {
      rpc: async (_n: string, args: Record<string, unknown>) => {
        if (args.p_window_seconds === 60) throw new Error("fallo pasajero");
        const hits = (counts.get(String(args.p_bucket)) ?? 0) + 1;
        counts.set(String(args.p_bucket), hits);
        return { data: [{ allowed: hits <= 1, current_hits: hits, retry_after_seconds: 120 }], error: null };
      },
    };
    await checkRateLimit(client, TWO, "u1");
    expect(await checkRateLimit(client, TWO, "u1")).toEqual({ allowed: false, retryAfterSeconds: 120 });
  });
});

describe("reglas propuestas", () => {
  it("todas tienen ventanas válidas y la de la hora nunca es menor que la del minuto", () => {
    for (const rule of Object.values(RATE_RULES)) {
      expect(rule.name).toMatch(/^[a-z_]+$/);
      expect(rule.windows.length).toBeGreaterThan(0);
      for (const w of rule.windows) {
        expect(Number.isInteger(w.limit) && w.limit >= 1).toBe(true);
        expect(w.seconds).toBeGreaterThanOrEqual(1);
        expect(w.seconds).toBeLessThanOrEqual(86_400);
      }
      const sorted = [...rule.windows].sort((a, b) => a.seconds - b.seconds);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].limit).toBeGreaterThanOrEqual(sorted[i - 1].limit);
    }
  });

  it("los nombres no se repiten (cada regla tiene su propio contador)", () => {
    const names = Object.values(RATE_RULES).map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("el trabajo normal de un asesor cabe holgado", () => {
    const minute = (r: RateRule) => r.windows.find((w) => w.seconds === 60)!.limit;
    expect(minute(RATE_RULES.messageSend)).toBeGreaterThanOrEqual(30);
    expect(minute(RATE_RULES.uploadUrl)).toBeGreaterThanOrEqual(20);
  });
});

describe("claves y datos de quien llama", () => {
  it("la clave junta regla, ventana y sujeto, y no pasa de 200 caracteres", () => {
    expect(bucketKey(ONE, ONE.windows[0], "abc")).toBe("prueba:60:abc");
    expect(bucketKey(ONE, ONE.windows[0], "x".repeat(500)).length).toBe(200);
  });

  it("el hash del correo no lo deja en claro, ignora mayúsculas y espacios", () => {
    const a = hashSubject(" Ana@Tienda.com ");
    expect(a).toBe(hashSubject("ana@tienda.com"));
    expect(a).not.toContain("ana");
    expect(a).toHaveLength(32);
  });

  it("toma la primera IP de x-forwarded-for y descarta valores raros", () => {
    const h = (v: Record<string, string>) => ({ get: (n: string) => v[n] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(h({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIp(h({ "x-forwarded-for": "<script>" }))).toBe("desconocida");
    expect(clientIp(h({}))).toBe("desconocida");
  });

  it("la poda conserva el último día", () => {
    const now = new Date("2026-11-12T10:00:00Z");
    expect(rateLimitPruneCutoff(now)).toBe("2026-11-11T10:00:00.000Z");
  });

  it("el mensaje es el pedido", () => {
    expect(RATE_LIMIT_MESSAGE).toBe("Vas muy rápido. Espera un momento y vuelve a intentar.");
  });
});
