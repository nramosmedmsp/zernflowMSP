// Orden de la entrada de mensajes: palabras clave globales, luego la sesión de
// flujo que espera respuesta y, solo si no hay, los disparadores.
//
// El motor de flujos es el real sobre la base en memoria; solo se simulan el
// motor de gestiones (handleInbound) y la búsqueda de disparadores (que usa
// filtros que la base en memoria no imita). El flujo que espera termina en
// Atención humana con una nota: la nota delata qué camino siguió el mensaje.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { executeFlow } from "@/lib/flow-engine/engine";
import type { FlowExecutionContext } from "@/lib/flow-engine/types";
import { runInboundPipeline, type InboundPipelineInput } from "./inbound-pipeline";

const { matchTrigger, handleInbound, flagComplaint } = vi.hoisted(() => ({
  matchTrigger: vi.fn(),
  handleInbound: vi.fn(async () => null),
  flagComplaint: vi.fn(async (..._args: unknown[]) => "no_match"),
}));
vi.mock("@/lib/flow-engine/trigger-matcher", () => ({ matchTrigger }));
vi.mock("@/lib/cases", () => ({ handleInbound, flagComplaint }));

type Row = Record<string, unknown>;

const WS = "ws-1";
const CH = "ch-1";
let fake: FakeDb;
let contactId: string;
let conversationId: string;

const humanTakeover = (id: string, message: string) => ({
  id,
  type: "action",
  position: { x: 0, y: 0 },
  data: { actionType: "humanTakeover", message },
});
const triggerNode = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "keyword" } };

async function setup() {
  matchTrigger.mockReset();
  matchTrigger.mockResolvedValue(null);
  handleInbound.mockClear();
  flagComplaint.mockClear();
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {}, global_keywords: [{ keyword: "baja", action: "unsubscribe" }] }]);
  fake.seed("channels", [{ id: CH, workspace_id: WS, platform: "instagram", late_account_id: null }]);
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María", is_subscribed: true }]);
  contactId = contact.id as string;
  const [conversation] = fake.seed("conversations", [{ workspace_id: WS, contact_id: contactId, channel_id: CH }]);
  conversationId = conversation.id as string;
  fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, status: "open" }]);

  // Flujo que pregunta, espera y usa la respuesta.
  fake.seed("flows", [
    {
      id: "flow-wait",
      workspace_id: WS,
      status: "published",
      nodes: [
        triggerNode,
        { id: "w", type: "action", position: { x: 0, y: 0 }, data: { actionType: "smartDelay", timeout: 30, timeoutUnit: "minutes" } },
        humanTakeover("h", "Respuesta: {{message}}"),
      ],
      edges: [
        { id: "e0", source: "t", target: "w" },
        { id: "e1", source: "w", target: "h" },
      ],
    },
    {
      id: "flow-trigger",
      workspace_id: WS,
      status: "published",
      nodes: [triggerNode, humanTakeover("h2", "DISPARADOR")],
      edges: [{ id: "e2", source: "t", target: "h2" }],
    },
  ]);
}

/** El flujo pregunta y queda esperando la respuesta (como tras el mensaje que lo disparó). */
async function startWaitingFlow() {
  const ctx: FlowExecutionContext = {
    triggerId: "tr",
    flowId: "flow-wait",
    channelId: CH,
    contactId,
    conversationId,
    workspaceId: WS,
    incomingMessage: { text: "pedido" },
    startFresh: true,
    variables: {},
  };
  await executeFlow(fake.asDb(), ctx);
  expect(fake.rows("flow_sessions")[0]).toMatchObject({ waiting_for_input: true, status: "active" });
}

function input(over: Partial<InboundPipelineInput["message"]> = {}, paused = false): InboundPipelineInput {
  return {
    channel: { id: CH, workspace_id: WS } as InboundPipelineInput["channel"],
    contactId,
    conversation: { id: conversationId, is_automation_paused: paused },
    isFirstMessage: false,
    message: { text: "PE-10458", sender: { id: "s1", name: "María" }, ...over },
    lateConversationId: "late-conv",
    lateAccountId: "late-acc",
  };
}

const notes = (): string[] => fake.rows("case_notes").map((n) => n.body as string);
const session = (): Row => fake.rows("flow_sessions")[0];
const run = (over: Partial<InboundPipelineInput["message"]> = {}, paused = false) =>
  runInboundPipeline(fake.asDb(), input(over, paused));

describe("entrada de mensajes: retomar la conversación", () => {
  beforeEach(async () => {
    await setup();
  });

  it("con una sesión esperando, el mensaje la retoma sin buscar disparadores", async () => {
    await startWaitingFlow();
    // Aunque algún disparador coincidiera, no se consulta.
    matchTrigger.mockResolvedValue({ id: "tr2", flow_id: "flow-trigger" });

    await run({ text: "PE-10458" });

    expect(matchTrigger).not.toHaveBeenCalled();
    expect(notes()).toEqual(["Respuesta: PE-10458"]);
    expect(session()).toMatchObject({ status: "completed" });
    expect((session().variables as Record<string, string>).message).toBe("PE-10458");
  });

  it("la respuesta queda en {{message}} aunque no diga ninguna palabra clave", async () => {
    await startWaitingFlow();
    await run({ text: "Sede 2" });
    expect(notes()).toEqual(["Respuesta: Sede 2"]);
  });

  it("un clic en un botón sin texto guarda su carga como respuesta", async () => {
    await startWaitingFlow();
    await run({ text: undefined, quickReplyPayload: "comprar" });
    expect(notes()).toEqual(["Respuesta: comprar"]);
  });

  it("sin sesión esperando, busca disparadores como antes", async () => {
    matchTrigger.mockResolvedValue({ id: "tr2", flow_id: "flow-trigger" });
    await run({ text: "hola" });
    expect(matchTrigger).toHaveBeenCalledTimes(1);
    expect(notes()).toEqual(["DISPARADOR"]);
  });

  it("si no hay sesión ni disparador, no pasa nada", async () => {
    await run({ text: "hola" });
    expect(matchTrigger).toHaveBeenCalledTimes(1);
    expect(notes()).toEqual([]);
  });

  it("una espera vencida no se retoma: el mensaje busca disparadores", async () => {
    await startWaitingFlow();
    session().waiting_until = new Date(Date.now() - 60_000).toISOString();
    matchTrigger.mockResolvedValue({ id: "tr2", flow_id: "flow-trigger" });

    await run({ text: "PE-10458" });

    expect(matchTrigger).toHaveBeenCalledTimes(1);
    expect(notes()).toEqual(["DISPARADOR"]);
    expect(session()).toMatchObject({ status: "expired" });
  });

  it("la sesión de otro canal no se retoma", async () => {
    await startWaitingFlow();
    session().channel_id = "otro-canal";
    await run({ text: "PE-10458" });
    expect(matchTrigger).toHaveBeenCalledTimes(1);
    expect(notes()).toEqual([]);
    expect(session()).toMatchObject({ status: "active", waiting_for_input: true });
  });

  it("con la automatización en pausa no retoma ni dispara nada", async () => {
    await startWaitingFlow();
    await run({ text: "PE-10458" }, true);
    expect(matchTrigger).not.toHaveBeenCalled();
    expect(notes()).toEqual([]);
    expect(session()).toMatchObject({ status: "active", waiting_for_input: true });
    // La gestión sí se maneja (el motor de gestiones corre antes).
    expect(handleInbound).toHaveBeenCalledTimes(1);
  });

  it("pasa el texto al detector de reclamos, aunque el bot esté en pausa, y un fallo no corta el mensaje", async () => {
    await run({ text: "mi pedido llegó roto" }, true);
    expect(flagComplaint).toHaveBeenCalledTimes(1);
    expect(flagComplaint.mock.calls[0][1]).toMatchObject({ workspaceId: WS, contactId, conversationId, text: "mi pedido llegó roto" });

    flagComplaint.mockRejectedValueOnce(new Error("boom"));
    await run({ text: "otro mensaje" }, false);
    expect(matchTrigger).toHaveBeenCalledTimes(1);
  });

  it("registra un message_received por mensaje entrante, con la plataforma, incluso con el bot en pausa", async () => {
    const withPlatform = (paused: boolean): InboundPipelineInput => {
      const base = input({}, paused);
      return { ...base, channel: { ...base.channel, platform: "instagram" } };
    };
    await runInboundPipeline(fake.asDb(), withPlatform(false));
    await runInboundPipeline(fake.asDb(), withPlatform(true));
    const events = fake.rows("analytics_events").filter((e) => e.event_type === "message_received");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ workspace_id: WS, contact_id: contactId, metadata: { platform: "instagram" } });
  });

  it("si el registro de message_received falla, el mensaje sigue su camino", async () => {
    const db = fake.asDb();
    const original = db.from.bind(db);
    const failing = new Proxy(db, {
      get: (target, prop) =>
        prop === "from"
          ? (table: string) => {
              const query = original(table as never);
              if (table !== "analytics_events") return query;
              // Solo falla el registro del mensaje entrante; el motor de flujos usa la misma tabla.
              return new Proxy(query, {
                get: (q, p) =>
                  p === "insert"
                    ? (row: Record<string, unknown>) =>
                        row.event_type === "message_received" ? Promise.reject(new Error("caída")) : q.insert(row as never)
                    : Reflect.get(q, p),
              });
            }
          : Reflect.get(target, prop),
    });
    await startWaitingFlow();
    await runInboundPipeline(failing, input({ text: "Sede 2" }));
    expect(notes()).toEqual(["Respuesta: Sede 2"]);
  });

  it("las palabras clave globales (baja) tienen prioridad sobre la espera", async () => {
    await startWaitingFlow();
    await run({ text: "Baja" });
    expect(fake.rows("contacts")[0].is_subscribed).toBe(false);
    expect(notes()).toEqual([]);
    expect(matchTrigger).not.toHaveBeenCalled();
    // La conversación sigue esperando.
    expect(session()).toMatchObject({ status: "active", waiting_for_input: true });
  });

  it("de dos mensajes seguidos solo uno retoma la sesión", async () => {
    await startWaitingFlow();
    await Promise.all([run({ text: "uno" }), run({ text: "dos" })]);
    expect(notes()).toHaveLength(1);
  });

  it("si leer el flujo falla de forma pasajera, la espera se conserva para reintentar", async () => {
    await startWaitingFlow();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // El flujo no se puede leer (no es "no existe", es un fallo de la base).
    const original = fake.from.bind(fake);
    vi.spyOn(fake, "from").mockImplementation((table: string) => {
      const q = original(table) as unknown as { single: () => PromiseLike<unknown> } & Record<string, unknown>;
      if (table === "flows") {
        q.single = () => Promise.resolve({ data: null, error: { code: "08006", message: "conexión perdida" } });
      }
      return q as unknown as ReturnType<typeof original>;
    });

    await run({ text: "PE-10458" });

    expect(session()).toMatchObject({ status: "active", waiting_for_input: true });
    expect(notes()).toEqual([]);
    error.mockRestore();
  });
});
