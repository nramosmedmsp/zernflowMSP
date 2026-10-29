import { describe, expect, it } from "vitest";
import {
  ALERT_RETRY_MS,
  DEFAULT_ALERT_SETTINGS,
  evaluateAlerts,
  inAlertScope,
  newMessageIds,
  parseAlertSettings,
  titleWithCount,
  unreadChatsInScope,
  unreadSnapshot,
} from "./inbox-alerts";

const ME = "u-yo";

describe("parseAlertSettings", () => {
  it("por defecto solo el número en la pestaña, para mis chats", () => {
    expect(parseAlertSettings(null)).toEqual({ tabCount: true, sound: false, desktop: false, scope: "mine" });
    expect(parseAlertSettings("{no es json")).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(parseAlertSettings('{"sound":true,"scope":"raro"}')).toEqual({ ...DEFAULT_ALERT_SETTINGS, sound: true });
  });
});

describe("alcance", () => {
  const mine = [{ assignee_id: ME, status: "open" }];
  const other = [{ assignee_id: "u-ana", status: "open" }];
  const queue = [{ assignee_id: null, status: "open" }];
  const closedMine = [{ assignee_id: ME, status: "won" }];

  it("mis chats, cola o todos", () => {
    expect(inAlertScope(mine, ME, "mine")).toBe(true);
    expect(inAlertScope(other, ME, "mine")).toBe(false);
    expect(inAlertScope(queue, ME, "mine")).toBe(false);
    expect(inAlertScope(queue, ME, "mine_and_queue")).toBe(true);
    expect(inAlertScope(undefined, ME, "mine_and_queue")).toBe(true);
    expect(inAlertScope(other, ME, "mine_and_queue")).toBe(false);
    expect(inAlertScope(closedMine, ME, "mine")).toBe(false);
    expect(inAlertScope(other, ME, "all")).toBe(true);
  });

  it("cuenta los chats con no leídos del alcance", () => {
    const convs = [
      { id: "a", contact_id: "ca", unread_count: 2 },
      { id: "b", contact_id: "cb", unread_count: 1 },
      { id: "c", contact_id: "cc", unread_count: 0 },
    ];
    const cases = new Map([
      ["ca", mine],
      ["cb", other],
      ["cc", mine],
    ]);
    expect(unreadChatsInScope(convs, cases, ME, "mine")).toBe(1);
    expect(unreadChatsInScope(convs, cases, ME, "all")).toBe(2);
  });
});

describe("mensajes nuevos", () => {
  it("detecta los chats cuyos no leídos subieron", () => {
    const before = unreadSnapshot([
      { id: "a", contact_id: "ca", unread_count: 1 },
      { id: "b", contact_id: "cb", unread_count: 0 },
    ]);
    const now = [
      { id: "a", contact_id: "ca", unread_count: 1 },
      { id: "b", contact_id: "cb", unread_count: 1 },
      { id: "n", contact_id: "cn", unread_count: 1 },
    ];
    expect(newMessageIds(before, now)).toEqual(["b", "n"]);
    expect(newMessageIds(before, [{ id: "a", contact_id: "ca", unread_count: 0 }])).toEqual([]);
  });

  it("la primera carga no avisa", () => {
    expect(newMessageIds(new Map(), [{ id: "a", contact_id: "ca", unread_count: 3 }])).toEqual([]);
  });
});

describe("titleWithCount", () => {
  it("pone y quita el número", () => {
    expect(titleWithCount("CRM Muscle Shop", 3)).toBe("(3) CRM Muscle Shop");
    expect(titleWithCount("(3) CRM Muscle Shop", 5)).toBe("(5) CRM Muscle Shop");
    expect(titleWithCount("(5) CRM Muscle Shop", 0)).toBe("CRM Muscle Shop");
    expect(titleWithCount("X", 150)).toBe("(99+) X");
  });
});

describe("evaluateAlerts (M-14): el aviso espera a que llegue la gestión del chat", () => {
  const NOW = 1_000_000;
  const conv = (id: string, contactId: string, unread: number) => ({ id, contact_id: contactId, unread_count: unread });
  const mine = new Map([["c1", [{ assignee_id: ME, status: "open" }]]]);
  const noCases = new Map<string, { assignee_id: string | null; status: string }[]>();
  const base = {
    userId: ME,
    scope: "mine" as const,
    openId: null,
    visible: true,
    now: NOW,
  };

  it("un cliente nuevo: el no leído sube sin gestión, pero avisa cuando llega la gestión asignada a mí", () => {
    const before = new Map<string, number>([["x", 0]]);
    // 1) Sube el contador y todavía no hay gestión.
    const first = evaluateAlerts({ ...base, before, conversations: [conv("v1", "c1", 1), conv("x", "cx", 0)], pending: new Map(), casesByContact: noCases });
    expect(first.alertIds).toEqual([]);
    expect(first.pending.has("v1")).toBe(true);
    // 2) Llega la gestión (el contador no cambia).
    const second = evaluateAlerts({
      ...base,
      before: unreadSnapshot([conv("v1", "c1", 1), conv("x", "cx", 0)]),
      conversations: [conv("v1", "c1", 1), conv("x", "cx", 0)],
      pending: first.pending,
      casesByContact: mine,
      now: NOW + 3_000,
    });
    expect(second.alertIds).toEqual(["v1"]);
    expect(second.pending.size).toBe(0);
  });

  it("un chat cerrado que vuelve a escribir: igual", () => {
    const before = new Map([["v1", 0]]);
    const first = evaluateAlerts({ ...base, before, conversations: [conv("v1", "c1", 1)], pending: new Map(), casesByContact: noCases });
    const second = evaluateAlerts({
      ...base,
      before: unreadSnapshot([conv("v1", "c1", 1)]),
      conversations: [conv("v1", "c1", 1)],
      pending: first.pending,
      casesByContact: mine,
      now: NOW + 1_000,
    });
    expect(second.alertIds).toEqual(["v1"]);
  });

  it("si la gestión llega pasado el plazo, ya no avisa", () => {
    const pending = new Map([["v1", NOW]]);
    const r = evaluateAlerts({
      ...base,
      before: new Map([["v1", 1]]),
      conversations: [conv("v1", "c1", 1)],
      pending,
      casesByContact: mine,
      now: NOW + ALERT_RETRY_MS + 1,
    });
    expect(r.alertIds).toEqual([]);
    expect(r.pending.size).toBe(0);
  });

  it("si el chat se leyó mientras tanto, no avisa", () => {
    const r = evaluateAlerts({
      ...base,
      before: new Map([["v1", 0]]),
      conversations: [conv("v1", "c1", 0)],
      pending: new Map([["v1", NOW + 5_000]]),
      casesByContact: mine,
    });
    expect(r.alertIds).toEqual([]);
  });

  it("un chat de otro asesor nunca avisa y queda pendiente solo hasta que vence", () => {
    const other = new Map([["c1", [{ assignee_id: "u-otro", status: "open" }]]]);
    const r = evaluateAlerts({ ...base, before: new Map([["v1", 0]]), conversations: [conv("v1", "c1", 1)], pending: new Map(), casesByContact: other });
    expect(r.alertIds).toEqual([]);
  });

  it("el chat abierto a la vista no avisa; con alcance «todos» avisa al instante", () => {
    const open = evaluateAlerts({ ...base, openId: "v1", before: new Map([["v1", 0]]), conversations: [conv("v1", "c1", 1)], pending: new Map(), casesByContact: mine });
    expect(open.alertIds).toEqual([]);
    const all = evaluateAlerts({ ...base, scope: "all", before: new Map([["v1", 0]]), conversations: [conv("v1", "c1", 1)], pending: new Map(), casesByContact: noCases });
    expect(all.alertIds).toEqual(["v1"]);
  });
});
