import { describe, expect, it, vi } from "vitest";
import { READ_ONLY_HEADER, createReadOnlyFetch, isAllowedViewAsWrite } from "./read-only-fetch";

function setup() {
  const base = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response("{}", { status: 200 }));
  const onBlocked = vi.fn();
  const f = createReadOnlyFetch({ baseFetch: base as unknown as typeof fetch, onBlocked });
  return { base, onBlocked, f };
}
const URL_BASE = "http://127.0.0.1:54321";

describe("fetch de solo lectura", () => {
  it("las lecturas pasan y llevan la cabecera del candado", async () => {
    const { base, f, onBlocked } = setup();
    for (const method of ["GET", "HEAD"]) {
      const res = await f(`${URL_BASE}/rest/v1/cases?select=id`, { method, headers: { apikey: "k" } });
      expect(res.status).toBe(200);
    }
    expect(base).toHaveBeenCalledTimes(2);
    const init = base.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get(READ_ONLY_HEADER)).toBe("1");
    expect(new Headers(init.headers).get("apikey")).toBe("k");
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("sin método explícito es GET", async () => {
    const { base, f } = setup();
    await f(`${URL_BASE}/rest/v1/cases`);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("cualquier escritura recibe 403 VIEW_AS_READ_ONLY sin llegar a la red", async () => {
    const { base, f, onBlocked } = setup();
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const res = await f(`${URL_BASE}/rest/v1/conversations?id=eq.1`, { method, body: "{}" });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "VIEW_AS_READ_ONLY" });
    }
    // RPC de escritura, admin de Auth, Storage de subida y funciones: también.
    for (const path of [
      "/rest/v1/rpc/increment_unread",
      "/auth/v1/admin/users",
      "/storage/v1/object/upload/sign/chat-media/x",
      "/storage/v1/object/chat-media/x",
      "/functions/v1/algo",
    ]) {
      expect((await f(`${URL_BASE}${path}`, { method: "POST", body: "{}" })).status).toBe(403);
    }
    expect(base).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledTimes(9);
  });

  it("excepciones: refrescar sesión, firmar lectura de Storage y view_as_current", async () => {
    const { base, f } = setup();
    for (const path of ["/auth/v1/token?grant_type=refresh_token", "/storage/v1/object/sign/chat-media/a.jpg", "/rest/v1/rpc/view_as_current"]) {
      expect((await f(`${URL_BASE}${path}`, { method: "POST", body: "{}" })).status).toBe(200);
    }
    expect(base).toHaveBeenCalledTimes(3);
    expect(isAllowedViewAsWrite("/rest/v1/rpc/view_as_start")).toBe(false);
    expect(isAllowedViewAsWrite("/storage/v1/object/upload/sign/x")).toBe(false);
  });

  it("también vale con un objeto Request", async () => {
    const { base, f } = setup();
    const res = await f(new Request(`${URL_BASE}/rest/v1/cases`, { method: "DELETE" }));
    expect(res.status).toBe(403);
    expect(base).not.toHaveBeenCalled();
  });
});
