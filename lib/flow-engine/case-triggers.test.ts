import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

const executeFlow = vi.fn();
vi.mock("./engine", () => ({ executeFlow: (...args: unknown[]) => executeFlow(...args) }));

import { runCaseEventFlows, type CaseFlowEvent } from "./case-triggers";

type Rows = Record<string, unknown[]>;

/**
 * Cliente falso: cada tabla devuelve sus filas sin aplicar filtros (la
 * coincidencia de disparadores se hace en código, no en la consulta).
 */
function fakeService(tables: Rows): SupabaseClient<Database> {
  function builder(table: string) {
    const rows = tables[table] ?? [];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    return b;
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient<Database>;
}

const conversation = { id: "conv1", channel_id: "ch1", late_conversation_id: "late1", is_automation_paused: false };

const event: CaseFlowEvent = {
  type: "case_stage_changed",
  workspaceId: "ws1",
  caseId: "case1",
  contactId: "contact1",
  caseTypeId: "t1",
  stageId: "s2",
};

const trigger = (id: string, flowId: string, config: object = {}, type = "case_stage_changed", channelId: string | null = null) => ({
  id,
  flow_id: flowId,
  channel_id: channelId,
  type,
  config,
  priority: 0,
});

beforeEach(() => executeFlow.mockReset());

describe("runCaseEventFlows", () => {
  it("ejecuta el flujo cuyo disparador coincide, en la conversación del contacto", async () => {
    const service = fakeService({
      triggers: [trigger("tr1", "flowA", { stage_id: "s2" }), trigger("tr2", "flowB", { stage_id: "otra" })],
      conversations: [conversation],
    });
    await runCaseEventFlows(service, event);

    expect(executeFlow).toHaveBeenCalledTimes(1);
    const [, context] = executeFlow.mock.calls[0];
    expect(context).toMatchObject({
      triggerId: "tr1",
      flowId: "flowA",
      channelId: "ch1",
      contactId: "contact1",
      conversationId: "conv1",
      workspaceId: "ws1",
      lateConversationId: "late1",
      startFresh: true,
    });
    expect(context.variables).toMatchObject({
      case_id: "case1",
      __case_event: "case_stage_changed",
      __flow_chain: "flowA",
      stage_id: "s2",
    });
  });

  it("no ejecuta si el bot está en pausa en la conversación", async () => {
    const service = fakeService({
      triggers: [trigger("tr1", "flowA")],
      conversations: [{ ...conversation, is_automation_paused: true }],
    });
    await runCaseEventFlows(service, event);
    expect(executeFlow).not.toHaveBeenCalled();
  });

  it("no ejecuta si el contacto no tiene conversación", async () => {
    const service = fakeService({ triggers: [trigger("tr1", "flowA")], conversations: [] });
    await runCaseEventFlows(service, event);
    expect(executeFlow).not.toHaveBeenCalled();
  });

  it("respeta el canal del disparador", async () => {
    const service = fakeService({
      triggers: [trigger("tr1", "flowA", {}, "case_stage_changed", "otro-canal"), trigger("tr2", "flowB")],
      conversations: [conversation],
    });
    await runCaseEventFlows(service, event);
    expect(executeFlow.mock.calls.map((c) => c[1].flowId)).toEqual(["flowB"]);
  });

  it("un flujo disparado por cambio de etapa no se dispara a sí mismo en la cadena", async () => {
    const service = fakeService({
      triggers: [trigger("tr1", "flowA"), trigger("tr2", "flowB")],
      conversations: [conversation],
    });
    await runCaseEventFlows(service, { ...event, chain: ["flowA"] });
    expect(executeFlow.mock.calls.map((c) => c[1].flowId)).toEqual(["flowB"]);
    expect(executeFlow.mock.calls[0][1].variables.__flow_chain).toBe("flowA,flowB");
  });

  it("corta la cadena cuando ya es demasiado larga", async () => {
    const service = fakeService({ triggers: [trigger("tr1", "flowZ")], conversations: [conversation] });
    await runCaseEventFlows(service, { ...event, chain: ["a", "b", "c"] });
    expect(executeFlow).not.toHaveBeenCalled();
  });

  it("cliente sin responder: solo corren los disparadores con los minutos sellados por el cron", async () => {
    const service = fakeService({
      triggers: [
        trigger("tr30", "flow30", { minutes: 30 }, "client_no_reply"),
        trigger("tr60", "flow60", { minutes: 60 }, "client_no_reply"),
        trigger("trDef", "flowDef", {}, "client_no_reply"),
      ],
      cases: [{ status: "open", no_reply_event_minutes: 60 }],
      conversations: [conversation],
    });
    await runCaseEventFlows(service, { ...event, type: "client_no_reply" });
    expect(executeFlow.mock.calls.map((c) => c[1].flowId)).toEqual(["flow60", "flowDef"]);
  });

  it("cliente sin responder: sin sello o con la gestión cerrada no ejecuta nada", async () => {
    const triggers = [trigger("tr30", "flow30", { minutes: 30 }, "client_no_reply")];
    await runCaseEventFlows(
      fakeService({ triggers, cases: [{ status: "open", no_reply_event_minutes: null }], conversations: [conversation] }),
      { ...event, type: "client_no_reply" },
    );
    await runCaseEventFlows(
      fakeService({ triggers, cases: [{ status: "won", no_reply_event_minutes: 30 }], conversations: [conversation] }),
      { ...event, type: "client_no_reply" },
    );
    expect(executeFlow).not.toHaveBeenCalled();
  });

  it("gestión cerrada: filtra por resultado", async () => {
    const service = fakeService({
      triggers: [
        trigger("trWon", "flowWon", { outcome: "won" }, "case_closed"),
        trigger("trLost", "flowLost", { outcome: "lost" }, "case_closed"),
      ],
      conversations: [conversation],
    });
    await runCaseEventFlows(service, { ...event, type: "case_closed", outcome: "won" });
    expect(executeFlow.mock.calls.map((c) => c[1].flowId)).toEqual(["flowWon"]);
    expect(executeFlow.mock.calls[0][1].variables.outcome).toBe("won");
  });

  it("un error en un flujo no impide que corran los demás", async () => {
    executeFlow.mockRejectedValueOnce(new Error("falló"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = fakeService({
      triggers: [trigger("tr1", "flowA"), trigger("tr2", "flowB")],
      conversations: [conversation],
    });
    await runCaseEventFlows(service, event);
    expect(executeFlow).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
