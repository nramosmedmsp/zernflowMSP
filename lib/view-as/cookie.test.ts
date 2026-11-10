import { describe, expect, it } from "vitest";
import {
  VIEW_AS_GRACE_MS,
  formatViewAsCookie,
  isViewAsCookieExpired,
  parseViewAsCookie,
  viewAsCookieOptions,
} from "./cookie";

const SID = "0a1a9d2b-96f7-4797-ace6-9644863cb7c7";
const VIEWER = "7df08737-c90b-4a06-9398-b31c478f50a8";

describe("cookie de Ver como", () => {
  it("ida y vuelta", () => {
    const raw = formatViewAsCookie({ sid: SID, viewer: VIEWER, exp: 1_800_000_000_000 });
    expect(raw).toBe(`${SID}.${VIEWER}.1800000000000`);
    expect(parseViewAsCookie(raw)).toEqual({ sid: SID, viewer: VIEWER, exp: 1_800_000_000_000 });
  });

  it("rechaza cualquier cosa que no tenga el formato exacto", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "x",
      `${SID}.${VIEWER}`,
      `${SID}.${VIEWER}.abc`,
      `${SID}.${VIEWER}.-5`,
      `${SID}.${VIEWER}.1.2`,
      `no-es-uuid.${VIEWER}.1`,
      `${SID}.${VIEWER}.${"9".repeat(20)}`,
    ]) {
      expect(parseViewAsCookie(raw as string)).toBeNull();
    }
  });

  it("caduca cuando pasa exp", () => {
    const c = { sid: SID, viewer: VIEWER, exp: 1000 };
    expect(isViewAsCookieExpired(c, 999)).toBe(false);
    expect(isViewAsCookieExpired(c, 1000)).toBe(true);
  });

  it("la cookie dura hasta el margen de la base y es httpOnly", () => {
    const o = viewAsCookieOptions(10_000_000, 10_000_000 - 60_000, true);
    expect(o.httpOnly).toBe(true);
    expect(o.secure).toBe(true);
    expect(o.maxAge).toBe(Math.ceil((60_000 + VIEW_AS_GRACE_MS) / 1000));
    expect(viewAsCookieOptions(1, 10_000_000).maxAge).toBe(1);
  });
});
