// Prueba de equivalencia: para los mismos flujos y mensajes, la simulación del
// laboratorio produce los mismos mensajes y cambios de gestión que el motor
// real (runInboundPipeline, cambios de gestión, cierre y cron de lib/cases)
// ejecutado sobre la base en memoria de las pruebas (fake-db.test-helper).
//
// Ambos lados parten de lo mismo: el catálogo del laboratorio se carga de la
// base en memoria con loadLabCatalog, así que ids, flujos y reglas coinciden.
// El reloj es el mismo (Date simulado) y el cron real corre en los instantes en
// que la simulación encontró trabajo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ afterQueue: [] as Array<() => unknown> }));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    hoisted.afterQueue.push(cb);
  },
}));

import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import {
  setConversationBotPaused,
  changeStage as realChangeStage,
  classifyCase as realClassifyCase,
  closeCase as realCloseCase,
  handleHumanOutboundForConversation,
  runCaseTasks,
  type CaseMessenger,
} from "@/lib/cases";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { demoTemplateText } from "@/lib/demo";
import { resumeSession } from "@/lib/flow-engine/engine";
import { FLOW_TEMPLATES } from "@/lib/flow-templates";
import { loadTemplateCatalog } from "@/lib/flow-templates/install";
import { resolveFlowTemplate } from "@/lib/flow-templates/resolve";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { runInboundPipeline } from "@/lib/inbound-pipeline";
import type { Database } from "@/lib/types/database";
import * as lab from "./actions";
import { loadLabCatalog } from "./load-catalog";
import { createLabState } from "./state";
import type { LabCatalog, LabState, LabTrace } from "./types";

type Row = Record<string, unknown>;
type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];

const WS = "ws-eq";
const PHONE = "51999999999";
const START = "2026-10-19T15:00:00.000Z"; // lunes 19/10/2026 10:00 en Lima

type Step =
  | { say: string }
  | { press: string; payload?: string }
  | { wait: number }
  | { agent: string }
  | { stage: string }
  | { classify: string }
  | { close: "won" | "lost" | "resolved"; keyDate?: string }
  /** El botón «Pausar bot» / «Reanudar bot» de la bandeja. */
  | { pause: true }
  | { unpause: true };

interface Options {
  platform?: "whatsapp" | "instagram";
  settings?: Row;
  /** Ids de plantillas de flujo; por defecto las de E-commerce y las generales. */
  flows?: string[];
  recompraTemplate?: boolean;
  business?: "ecommerce" | "gym";
  contactExisted?: boolean;
  /**
   * Cliente que vuelve: ya existe como contacto y es de tipo «Cliente», para el que ningún tipo de gestión
   * se sugiere: su gestión nueva queda sin clasificar y la bienvenida («Gestión nueva sin clasificar») lo saluda.
   */
  returning?: boolean;
}

const realSetTimeout = globalThis.setTimeout;

class Harness {
  fake = new FakeDb();
  catalog!: LabCatalog;
  state!: LabState;
  contactId!: string;
  conversationId!: string;
  channel!: ChannelRow;
  contactExisted: boolean;
  sentTemplates: Array<{ name: string; params: string[] }> = [];

  constructor(private options: Options = {}) {
    this.contactExisted = options.returning ? true : (options.contactExisted ?? false);
  }

  get db() {
    return this.fake.asDb();
  }

  async setup() {
    const { fake, options } = this;
    fake.seed("workspaces", [{ id: WS, name: "Tienda de prueba", slug: "tienda", settings: options.settings ?? {} }]);
    fake.seed("workspace_members", [
      { workspace_id: WS, user_id: "u-ana", role: "member" },
      { workspace_id: WS, user_id: "u-beto", role: "member" },
    ]);
    await applyTemplateWithStore(supabaseTemplateStore(this.db), WS, options.business ?? "ecommerce");
    if (options.business === "gym") {
      fake.rows("case_types").find((t) => t.name === "Renovación")!.auto_template = {
        template_name: "recordatorio_renovacion",
        language: "es",
        params: ["{nombre}", "{fecha_clave}"],
      };
    } else if (options.recompraTemplate !== false) {
      fake.rows("case_types").find((t) => t.name === "Recompra")!.auto_template = {
        template_name: "recordatorio_recompra",
        language: "es",
        params: ["{nombre}"],
      };
    }
    fake.seed("custom_field_definitions", [{ workspace_id: WS, slug: "producto_interes", name: "Producto de interés", type: "text" }]);
    const platform = options.platform ?? "whatsapp";
    const [channel] = fake.seed("channels", [{ id: "ch-eq", workspace_id: WS, platform, late_account_id: "demo-lab", is_active: true }]);
    this.channel = channel as unknown as ChannelRow;
    const customerType = options.returning ? fake.rows("contact_types").find((t) => t.name === "Cliente") : undefined;
    const [contact] = fake.seed("contacts", [
      { workspace_id: WS, display_name: "Lucía", phone: PHONE, is_subscribed: true, ...(customerType ? { contact_type_id: customerType.id } : {}) },
    ]);
    this.contactId = contact.id as string;
    fake.seed("contact_channels", [{ contact_id: this.contactId, channel_id: "ch-eq", platform_sender_id: PHONE }]);
    const [conversation] = fake.seed("conversations", [
      { workspace_id: WS, contact_id: this.contactId, channel_id: "ch-eq", platform, late_conversation_id: "conv-lab", status: "open" },
    ]);
    this.conversationId = conversation.id as string;

    // Los flujos como los dejaría instalar y publicar la biblioteca de plantillas.
    const templateCatalog = await loadTemplateCatalog(this.db, WS);
    const wanted = options.flows
      ? options.flows.map((id) => FLOW_TEMPLATES.find((t) => t.id === id)!)
      : FLOW_TEMPLATES.filter((t) => t.business === (options.business ?? "ecommerce") || t.business === "general");
    for (const template of wanted) {
      const resolved = resolveFlowTemplate(template, templateCatalog);
      const flowId = `flow-${template.id}`;
      fake.seed("flows", [{ id: flowId, workspace_id: WS, name: template.name, status: "published", nodes: resolved.nodes, edges: resolved.edges }]);
      fake.seed("triggers", buildDesiredTriggers(resolved.nodes as unknown as Array<Record<string, unknown>>, flowId) as unknown as Row[]);
    }

    this.catalog = await loadLabCatalog(WS, { db: this.db });
    this.state = createLabState(this.catalog, {
      clock: START,
      channel: platform,
      contact: { name: "Lucía", phone: PHONE, existed: this.contactExisted, ...(customerType ? { contactTypeId: customerType.id as string } : {}) },
    });
    vi.setSystemTime(new Date(START));
  }

  // ── Mensajería del cron real (canal de prueba): guarda los mensajes y los anota ──

  messenger(): CaseMessenger {
    const store = (text: string) => this.fake.insertRow("messages", { conversation_id: this.conversationId, direction: "outbound", text, status: "sent" });
    return {
      sendText: async (input) => {
        store(input.text);
        return { ok: true, messageId: "m" };
      },
      sendTemplate: async (input) => {
        this.sentTemplates.push({ name: input.templateName, params: input.params });
        store(demoTemplateText(input.templateName, input.params));
        return { ok: true, messageId: "m" };
      },
    };
  }

  // ── Lado real ──

  async flush() {
    for (let i = 0; i < 100 && hoisted.afterQueue.length > 0; i++) {
      const cb = hoisted.afterQueue.shift()!;
      await cb();
    }
  }

  openCaseRow(): Row | undefined {
    return this.fake
      .rows("cases")
      .filter((c) => c.status === "open")
      .sort((a, b) => String(b.opened_at ?? "").localeCompare(String(a.opened_at ?? "")))[0];
  }

  async realSay(text: string, payload?: string) {
    const conversation = this.fake.rows("conversations")[0];
    const isFirstMessage = !this.contactExisted;
    this.contactExisted = true;
    await runInboundPipeline(this.db, {
      channel: this.channel,
      contactId: this.contactId,
      conversation: { id: this.conversationId, is_automation_paused: conversation.is_automation_paused as boolean },
      isFirstMessage,
      message: { text, postbackPayload: payload, sender: { id: PHONE, name: "Lucía" } },
      lateConversationId: "conv-lab",
      lateAccountId: "demo-lab",
      at: new Date().toISOString(),
    });
    await this.flush();
  }

  async processDueJobs() {
    const now = Date.now();
    const jobs = this.fake
      .rows("scheduled_jobs")
      .filter((j) => (j.status ?? "pending") === "pending" && new Date(j.run_at as string).getTime() <= now)
      .sort((a, b) => String(a.run_at).localeCompare(String(b.run_at)));
    for (const job of jobs) {
      job.status = "completed";
      const payload = job.payload as { sessionId: string; nodeId: string };
      const session = this.fake.rows("flow_sessions").find((s) => s.id === payload.sessionId && s.status === "active");
      if (!session || session.current_node_id !== payload.nodeId) continue;
      await resumeSession(this.db, session as never, {
        triggerId: "",
        flowId: session.flow_id as string,
        channelId: "ch-eq",
        contactId: this.contactId,
        conversationId: this.conversationId,
        workspaceId: WS,
        incomingMessage: {},
      });
    }
  }

  async realTick() {
    await this.processDueJobs();
    await runCaseTasks(this.db, { deadline: Date.now() + 30_000, now: new Date(), messenger: this.messenger() });
    await this.flush();
  }

  stageIdNamed(typeId: unknown, name: string): string {
    return this.fake.rows("case_stages").find((s) => s.case_type_id === typeId && s.name === name)!.id as string;
  }

  // ── Un paso en ambos lados ──

  async run(step: Step): Promise<LabTrace> {
    vi.setSystemTime(new Date(this.state.clock));
    let result;
    if ("say" in step) {
      result = lab.clientSays(this.catalog, this.state, { kind: "text", text: step.say });
      await this.realSay(step.say);
    } else if ("press" in step) {
      const payload = step.payload ?? step.press;
      result = lab.clientSays(this.catalog, this.state, { kind: "button", title: step.press, payload });
      await this.realSay(step.press, payload);
    } else if ("wait" in step) {
      const start = new Date(this.state.clock).getTime();
      result = lab.advanceTime(this.catalog, this.state, step.wait);
      const end = new Date(result.state.clock).getTime();
      const instants = [...new Set(result.trace.steps.map((s) => new Date(s.at).getTime()))].filter((t) => t > start && t < end).sort((a, b) => a - b);
      for (const t of [...instants, end]) {
        vi.setSystemTime(new Date(t));
        await this.realTick();
      }
    } else if ("agent" in step) {
      const row = this.state.cases.find((c) => c.status === "open");
      result = lab.agentReplies(this.catalog, this.state, step.agent, { agentId: row?.assigneeId ?? undefined });
      await handleHumanOutboundForConversation(this.db, {
        conversationId: this.conversationId,
        userId: (row?.assigneeId ?? "u-ana") as string,
        at: new Date().toISOString(),
      });
      await this.flush();
    } else if ("stage" in step) {
      const open = this.openCaseRow()!;
      const stageId = this.stageIdNamed(open.case_type_id, step.stage);
      result = lab.changeStage(this.catalog, this.state, stageId);
      await realChangeStage(this.db, { caseId: open.id as string, stageId, actorId: "u-ana" });
      await this.flush();
    } else if ("classify" in step) {
      const open = this.openCaseRow()!;
      const typeId = this.fake.rows("case_types").find((t) => t.name === step.classify)!.id as string;
      result = lab.classify(this.catalog, this.state, typeId);
      await realClassifyCase(this.db, { caseId: open.id as string, caseTypeId: typeId, actorId: "u-ana" });
      await this.flush();
    } else if ("close" in step) {
      const open = this.openCaseRow()!;
      result = lab.closeCase(this.catalog, this.state, { kind: step.close, keyDate: step.keyDate });
      await realCloseCase(this.db, { caseId: open.id as string, kind: step.close, keyDate: step.keyDate, actorId: "u-ana" }, new Date());
      await this.flush();
    } else {
      // El botón de la bandeja: en el CRM real es setConversationBotPaused (sin la validación de permisos, que hace la acción de servidor).
      const paused = "pause" in step;
      result = lab.setBotPaused(this.catalog, this.state, paused);
      const real = await setConversationBotPaused(this.db, { workspaceId: WS, conversationId: this.conversationId, paused, actorId: "u-ana" });
      expect(real).toMatchObject({ ok: true, paused });
    }
    expect(result.trace.error, `la simulación rechazó el paso ${JSON.stringify(step)}`).toBeUndefined();
    this.state = result.state;
    return result.trace;
  }

  // ── Fotos comparables ──

  private name(table: string, id: unknown): string | null {
    return id ? ((this.fake.rows(table).find((r) => r.id === id)?.name as string | undefined) ?? String(id)) : null;
  }

  realSnapshot() {
    const { fake } = this;
    const contact = fake.rows("contacts")[0];
    const tagNames = fake
      .rows("contact_tags")
      .filter((c) => c.contact_id === this.contactId)
      .map((c) => fake.rows("tags").find((t) => t.id === c.tag_id)?.name as string);
    const fields = Object.fromEntries(
      fake
        .rows("contact_custom_fields")
        .filter((c) => c.contact_id === this.contactId)
        .map((c) => [fake.rows("custom_field_definitions").find((d) => d.id === c.field_id)?.slug as string, c.value as string]),
    );
    return {
      contact: {
        type: this.name("contact_types", contact.contact_type_id),
        owner: (contact.owner_id as string | null) ?? null,
        subscribed: contact.is_subscribed as boolean,
        keyDate: (contact.key_date as string | null) ?? null,
        tags: tagNames.sort(),
        fields,
      },
      paused: fake.rows("conversations")[0].is_automation_paused as boolean,
      cases: fake.rows("cases").map((c) => ({
        type: this.name("case_types", c.case_type_id),
        stage: this.name("case_stages", c.stage_id),
        status: c.status as string,
        assignee: (c.assignee_id as string | null) ?? null,
        team: (c.team_id as string | null) ?? null,
        scheduledFor: (c.scheduled_for as string | null) ?? null,
        openedAt: (c.opened_at as string | null) ?? null,
        lastInboundAt: (c.last_inbound_at as string | null) ?? null,
        lastOutboundAt: (c.last_outbound_at as string | null) ?? null,
        waitingSince: (c.waiting_since as string | null) ?? null,
        firstResponseAt: (c.first_response_at as string | null) ?? null,
        closedAt: (c.closed_at as string | null) ?? null,
        autoTemplateSentAt: (c.auto_template_sent_at as string | null) ?? null,
        offHoursReplySentAt: (c.off_hours_reply_sent_at as string | null) ?? null,
        noReplyMinutes: (c.no_reply_event_minutes as number | null) ?? null,
        notes: fake
          .rows("case_notes")
          .filter((n) => n.case_id === c.id)
          .map((n) => n.body as string),
      })),
      botMessages: fake
        .rows("messages")
        .filter((m) => m.direction === "outbound")
        .map((m) => m.text as string),
      sessions: fake.rows("flow_sessions").map((s) => ({
        flow: s.flow_id as string,
        status: s.status as string,
        waiting: (s.waiting_for_input as boolean) ?? false,
      })),
    };
  }

  simSnapshot() {
    const { state, catalog } = this;
    const typeName = (id: string | null) => catalog.caseTypes.find((t) => t.id === id)?.name ?? null;
    const stageName = (id: string | null) => catalog.caseTypes.flatMap((t) => t.stages).find((s) => s.id === id)?.name ?? null;
    return {
      contact: {
        type: catalog.contactTypes.find((t) => t.id === state.contact.contactTypeId)?.name ?? null,
        owner: state.contact.ownerId,
        subscribed: state.contact.subscribed,
        keyDate: state.contact.keyDate,
        tags: [...state.contact.tags].sort(),
        fields: state.contact.customFields,
      },
      paused: state.automationPaused,
      cases: state.cases.map((c) => ({
        type: typeName(c.caseTypeId),
        stage: stageName(c.stageId),
        status: c.status as string,
        assignee: c.assigneeId,
        team: c.teamId,
        scheduledFor: c.scheduledFor,
        openedAt: c.openedAt,
        lastInboundAt: c.lastInboundAt,
        lastOutboundAt: c.lastOutboundAt,
        waitingSince: c.waitingSince,
        firstResponseAt: c.firstResponseAt,
        closedAt: c.closedAt,
        autoTemplateSentAt: c.autoTemplateSentAt,
        offHoursReplySentAt: c.offHoursReplySentAt,
        noReplyMinutes: c.noReplyEventMinutes,
        notes: c.notes.map((n) => n.body),
      })),
      botMessages: state.messages.filter((m) => m.author === "bot" && !m.failed).map((m) => m.text),
      sessions: state.sessions.map((s) => ({ flow: s.flowId, status: s.status as string, waiting: s.waitingForInput })),
    };
  }
}

async function playScenario(steps: Step[], options: Options = {}) {
  const harness = new Harness(options);
  await harness.setup();
  for (const [i, step] of steps.entries()) {
    await harness.run(step);
    expect(harness.simSnapshot(), `tras el paso ${i + 1}: ${JSON.stringify(step)}`).toEqual(harness.realSnapshot());
  }
  return harness;
}

beforeEach(() => {
  hoisted.afterQueue.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  // El motor real espera 500 ms entre los mensajes de un nodo: aquí no hace falta esperar.
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    ms === 500 ? (Promise.resolve().then(() => fn(...args)), 0) : realSetTimeout(fn, ms, ...args)) as typeof setTimeout);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("equivalencia con el motor real", () => {
  it("pregunta precio: catálogo y paso a «Asesorando»", async () => {
    const h = await playScenario([{ say: "Hola, ¿cuál es el precio de la proteína?" }]);
    expect(h.simSnapshot().botMessages).toHaveLength(1);
    expect(h.simSnapshot().cases[0].stage).toBe("Asesorando");
  });

  it("un prospecto nuevo abre una Venta clasificada: la bienvenida «sin clasificar» no corre", async () => {
    const h = await playScenario([{ say: "Hola" }]);
    // Solo responde la bienvenida simple (primer mensaje); la bienvenida con clasificación no.
    expect(h.simSnapshot().botMessages.some((t) => t.includes("asistente virtual de la tienda"))).toBe(false);
    expect(h.simSnapshot().cases[0].type).toBe("Venta");
  });

  it("cliente que vuelve (gestión sin clasificar) → bienvenida → compra → producto → reparto", async () => {
    const h = await playScenario(
      [{ say: "Hola" }, { press: "Quiero comprar", payload: "quiero_comprar" }, { say: "Proteína whey vainilla" }],
      { returning: true },
    );
    const snap = h.simSnapshot();
    expect(snap.contact.fields).toEqual({ producto_interes: "Proteína whey vainilla" });
    expect(snap.contact.tags).toEqual(["Interesado en compra"]);
    expect(snap.botMessages).toHaveLength(3);
  });

  it("«Mi pedido» y «Otra consulta» reclasifican la gestión", async () => {
    await playScenario([{ say: "hola" }, { press: "Mi pedido" }], { returning: true });
    await playScenario([{ say: "hola" }, { press: "Otra consulta" }], { returning: true });
  });

  it("la respuesta numérica o con el texto de la opción retoma la espera como esa opción (menú de botones)", async () => {
    const compra = await playScenario([{ say: "hola" }, { say: "1" }], { returning: true });
    expect(compra.simSnapshot().cases[0].type).toBe("Venta");
    expect(compra.simSnapshot().botMessages.at(-1)).toContain("¿Qué producto estás buscando?");
    const pedido = await playScenario([{ say: "hola" }, { say: "2." }], { returning: true });
    expect(pedido.simSnapshot().cases[0].type).toBe("Postventa");
    const consulta = await playScenario([{ say: "hola" }, { say: "OTRA CONSULTA" }], { returning: true });
    expect(consulta.simSnapshot().cases[0].type).toBe("Consulta");
    // Un número fuera del menú no elige nada: la condición no coincide y cae en «Consulta».
    const fuera = await playScenario([{ say: "hola" }, { say: "7" }], { returning: true });
    expect(fuera.simSnapshot().cases[0].type).toBe("Consulta");
  });

  it("la respuesta numérica en una lista numerada de WhatsApp (más de 3 opciones): igual en ambos lados", async () => {
    // Prospecto ya conocido: su gestión se abre clasificada (Venta) y la bienvenida con clasificación no compite por la espera.
    const h = new Harness({ contactExisted: true });
    await h.setup();
    // Un flujo con 4 botones: WhatsApp lo muestra como lista numerada y «4» elige la cuarta opción.
    const flowId = "flow-menu";
    const nodes = [
      { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Menú", triggerType: "keyword", keywords: [{ value: "menu", matchType: "exact" }] } },
      {
        id: "m",
        type: "sendMessage",
        position: { x: 0, y: 0 },
        data: {
          messages: [
            {
              text: "Elige una sede",
              buttons: ["Miraflores", "San Isidro", "Surco", "La Molina"].map((title) => ({ title, type: "postback", payload: title.toLowerCase().replace(" ", "_") })),
            },
          ],
        },
      },
      { id: "w", type: "action", position: { x: 0, y: 0 }, data: { actionType: "smartDelay", timeout: 30, timeoutUnit: "minutes" } },
      { id: "s", type: "action", position: { x: 0, y: 0 }, data: { actionType: "setCustomField", fieldSlug: "producto_interes", value: "{{message}}" } },
    ];
    const edges = [
      { id: "e1", source: "t", target: "m" },
      { id: "e2", source: "m", target: "w" },
      { id: "e3", source: "w", target: "s" },
    ];
    h.fake.seed("flows", [{ id: flowId, workspace_id: WS, name: "Menú de sedes", status: "published", nodes, edges }]);
    h.fake.seed("triggers", buildDesiredTriggers(nodes as unknown as Array<Record<string, unknown>>, flowId) as unknown as Row[]);
    h.catalog = await loadLabCatalog(WS, { db: h.db });
    h.state = createLabState(h.catalog, {
      clock: START,
      channel: "whatsapp",
      contact: { ...h.state.contact },
    });
    for (const step of [{ say: "menu" }, { say: "4" }] as Step[]) {
      await h.run(step);
      expect(h.simSnapshot()).toEqual(h.realSnapshot());
    }
    expect(h.simSnapshot().contact.fields).toEqual({ producto_interes: "La Molina" });
    expect(h.simSnapshot().botMessages[0]).toContain("4. La Molina");
  });

  it("Instagram: mismas respuestas y botones como opciones del canal", async () => {
    await playScenario([{ say: "hola" }, { press: "Quiero comprar" }, { say: "Creatina" }], { platform: "instagram", returning: true });
    await playScenario([{ say: "hola" }, { say: "1" }, { say: "Creatina" }], { platform: "instagram", returning: true });
  });

  it("pide asesor: aviso, reparto, nota y bot en pausa; luego el cliente insiste", async () => {
    const h = await playScenario([{ say: "precio" }, { say: "quiero hablar con un asesor" }, { wait: 5 }, { say: "¿hola?" }]);
    expect(h.simSnapshot().paused).toBe(true);
    expect(h.simSnapshot().cases[0].notes).toEqual(["El cliente pidió hablar con un asesor."]);
  });

  it("asesor → «Pedido o enlace de pago enviado» con el bot en pausa: los flujos de evento sí corren", async () => {
    const h = await playScenario([
      { say: "precio" },
      { say: "quiero hablar con un asesor" },
      { wait: 3 },
      { agent: "Hola, te cuento las opciones" },
      { stage: "Pedido o enlace de pago enviado" },
    ]);
    const snap = h.simSnapshot();
    expect(snap.paused).toBe(true);
    // «Datos de pago» corrió en la conversación pausada y llevó la venta a «Esperando pago».
    expect(snap.cases[0].stage).toBe("Esperando pago");
    expect(snap.botMessages.filter((t) => t.includes("Estos son nuestros medios de pago"))).toHaveLength(1);
  });

  it("con el bot en pausa los mensajes del cliente no activan flujos, pero «Reanudar bot» los vuelve a activar", async () => {
    const h = await playScenario([
      { say: "quiero hablar con un asesor" },
      { wait: 3 },
      { agent: "Hola, te ayudo" },
      { say: "precio por favor" },
      { unpause: true },
      { say: "precio por favor" },
      { pause: true },
      { say: "precio" },
    ]);
    // Solo el segundo «precio» (con el bot activo) recibió el catálogo.
    expect(h.simSnapshot().botMessages.filter((t) => t.includes("catálogo"))).toHaveLength(1);
    expect(h.simSnapshot().paused).toBe(true);
  });

  it("cliente sin responder: avisa tras un mensaje del bot aunque el cliente siga esperando a una persona (waiting_since)", async () => {
    const h = await playScenario([
      { say: "precio" },
      { wait: 1 },
      // El asesor cambia la etapa (sin responder): «Datos de pago» envía mensajes del bot y deja la venta en «Esperando pago».
      { stage: "Pedido o enlace de pago enviado" },
      { wait: 119 },
      { wait: 2 },
      { wait: 600 },
    ]);
    const snap = h.simSnapshot();
    // El cliente espera respuesta humana: waiting_since sigue puesto y no cambió.
    expect(snap.cases[0].waitingSince).not.toBeNull();
    expect(snap.cases[0].noReplyMinutes).toBe(120);
    const texts = snap.botMessages;
    expect(texts.filter((t) => t.includes("pudiste realizar el pago"))).toHaveLength(1);
  });

  it("datos de pago → «Esperando pago» → a las 2 h el recordatorio, una sola vez", async () => {
    const h = await playScenario([
      { say: "precio" },
      { say: "asesor" },
      { wait: 3 },
      { agent: "Te paso las opciones" },
      { unpause: true },
      { stage: "Pedido o enlace de pago enviado" },
      { wait: 119 },
      { wait: 2 },
      { wait: 600 },
    ]);
    const texts = h.simSnapshot().botMessages;
    expect(texts.filter((t) => t.includes("Estos son nuestros medios de pago"))).toHaveLength(1);
    expect(texts.filter((t) => t.includes("pudiste realizar el pago"))).toHaveLength(1);
  });

  it("cerrar ganada: gracias, Cliente, Recompra a 25 días y su activación con plantilla", async () => {
    const h = await playScenario([
      { say: "precio" },
      { say: "asesor" },
      { wait: 3 },
      { agent: "Listo, te espero" },
      { close: "won" },
      { wait: 25 * 24 * 60 },
      { say: "sí, quiero mi pedido, precio" },
    ]);
    const snap = h.simSnapshot();
    expect(snap.cases.map((c) => `${c.type}:${c.status}`)).toEqual(["Venta:won", "Recompra:open"]);
    expect(h.sentTemplates).toEqual([{ name: "recordatorio_recompra", params: ["Lucía"] }]);
    expect(snap.botMessages.some((t) => t.includes("Gracias por tu compra"))).toBe(true);
  });

  it("dos compras ganadas: Cliente frecuente y una sola Recompra (se mueve la fecha)", async () => {
    await playScenario([
      { say: "precio" },
      { say: "asesor" },
      { wait: 3 },
      { agent: "ok" },
      { close: "won" },
      { wait: 2 * 24 * 60 },
      { say: "quiero comprar de nuevo, precio" },
      { classify: "Venta" },
      { close: "won" },
    ]);
  });

  it("pasar 24 h: sin plantilla el nodo no envía; con plantilla sale el recordatorio por plantilla", async () => {
    const h = await playScenario([
      { say: "precio" },
      { wait: 2 },
      { agent: "Te paso los datos" },
      { wait: 25 * 60 },
      { agent: "¿Sigues interesada?" },
      { unpause: true },
      { stage: "Pedido o enlace de pago enviado" },
      { wait: 121 },
    ]);
    const texts = h.simSnapshot().botMessages;
    expect(texts.some((t) => t.includes("Estos son nuestros medios de pago"))).toBe(false);
    expect(texts.at(-1)).toContain("recordatorio_pago");
  });

  it("se da de baja: «baja», una frase parecida y «rebajas»", async () => {
    const h = await playScenario([{ say: "¿tienen rebajas?" }, { say: "baja" }, { say: "hola" }], { contactExisted: true });
    expect(h.simSnapshot().contact.subscribed).toBe(false);
  });

  it("espera fija (nodo Espera): el seguimiento llega al pasar el tiempo", async () => {
    const h = await playScenario([{ say: "hola" }, { wait: 0.5 }, { wait: 1 }], { flows: ["general-bienvenida-simple"] });
    expect(h.simSnapshot().botMessages).toHaveLength(2);
  });

  it("fuera de horario: respuesta automática, gestión sin asignar y reparto al abrir", async () => {
    const hours = { mon: [["09:00", "18:00"]], tue: [["09:00", "18:00"]], wed: [["09:00", "18:00"]], thu: [["09:00", "18:00"]], fri: [["09:00", "18:00"]] };
    const h = new Harness({
      settings: { business_hours: hours, off_hours_reply: { enabled: true, text: "Hola {nombre}, abrimos {apertura}.", min_hours_between: null } },
      flows: ["general-respuesta-defecto"],
    });
    await h.setup();
    // Domingo 18/10/2026 10:00 (Lima).
    h.state.clock = "2026-10-18T15:00:00.000Z";
    for (const step of [{ say: "hola" }, { wait: 60 * 24 }] as Step[]) {
      await h.run(step);
      expect(h.simSnapshot()).toEqual(h.realSnapshot());
    }
    const snap = h.simSnapshot();
    // El domingo, el lunes a las 9:00 es «mañana».
    expect(snap.botMessages).toEqual(["Hola Lucía, abrimos mañana 9:00."]);
    expect(snap.cases[0].assignee).toBeTruthy();
  });

  it("gimnasio: cerrar una inscripción pide la fecha clave y programa la renovación 7 días antes", async () => {
    const h = await playScenario(
      [
        { say: "asesor" },
        { wait: 3 },
        { agent: "Bienvenido, te inscribo" },
        { close: "won", keyDate: "2026-11-30" },
        { wait: 35 * 24 * 60 },
      ],
      { business: "gym", flows: ["general-asesor", "gym-renovacion"] },
    );
    const snap = h.simSnapshot();
    expect(snap.contact).toMatchObject({ type: "Socio activo", keyDate: "2026-11-30" });
    // La renovación se programó para el 23/11 a las 09:00 de Lima y se activó con su plantilla.
    expect(snap.cases[1]).toMatchObject({ type: "Renovación", status: "open", stage: "Contactado" });
    expect(h.sentTemplates).toEqual([{ name: "recordatorio_renovacion", params: ["Lucía", "30/11/2026"] }]);
  });

  it("gimnasio: cerrar sin la fecha clave que piden las reglas se rechaza en ambos lados", async () => {
    const h = new Harness({ business: "gym", flows: ["general-asesor"] });
    await h.setup();
    await h.run({ say: "asesor" });
    const result = lab.closeCase(h.catalog, h.state, { kind: "won" });
    expect(result.trace.error).toBe("Indica la fecha: Vencimiento de membresía.");
    const real = await realCloseCase(h.db, { caseId: h.openCaseRow()!.id as string, kind: "won", actorId: "u-ana" }, new Date());
    expect(real).toEqual({ error: "Indica la fecha: Vencimiento de membresía." });
  });
});
