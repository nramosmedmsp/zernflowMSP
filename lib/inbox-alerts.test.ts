import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALERT_SETTINGS,
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
