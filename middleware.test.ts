// /api/health es público y barato: el middleware lo deja pasar sin tocar la sesión.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { updateSession } = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock("@/lib/supabase/middleware", () => ({ updateSession }));

import { middleware } from "./middleware";

beforeEach(() => {
  updateSession.mockReset();
  updateSession.mockResolvedValue(NextResponse.redirect("https://app.test/login"));
});

describe("middleware", () => {
  it("/api/health pasa sin sesión y sin consultar la autenticación", async () => {
    const res = await middleware(new NextRequest("https://app.test/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("el resto sigue pasando por la sesión", async () => {
    const res = await middleware(new NextRequest("https://app.test/dashboard"));
    expect(updateSession).toHaveBeenCalledOnce();
    expect(res.headers.get("location")).toContain("/login");
  });
});
