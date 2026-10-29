import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isCronAuthorized } from "./cron-auth";

const req = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });

describe("isCronAuthorized", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "secreto-largo";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("acepta la clave en la cabecera (como la manda Vercel) y en ?key=", () => {
    expect(isCronAuthorized(req("http://x/api/cron/jobs", { authorization: "Bearer secreto-largo" }))).toBe(true);
    expect(isCronAuthorized(req("http://x/api/cron/jobs?key=secreto-largo"))).toBe(true);
  });

  it("rechaza clave ausente, equivocada o de otro largo", () => {
    expect(isCronAuthorized(req("http://x/api/cron/jobs"))).toBe(false);
    expect(isCronAuthorized(req("http://x/api/cron/jobs", { authorization: "Bearer otra" }))).toBe(false);
    expect(isCronAuthorized(req("http://x/api/cron/jobs?key=secreto-larg0"))).toBe(false);
    expect(isCronAuthorized(req("http://x/api/cron/jobs?key=secreto-largo-mas"))).toBe(false);
  });

  it("sin CRON_SECRET configurado nadie entra", () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(req("http://x/api/cron/jobs?key="))).toBe(false);
    expect(isCronAuthorized(req("http://x/api/cron/jobs", { authorization: "Bearer " }))).toBe(false);
  });
});
