import { beforeAll, describe, expect, it } from "vitest";
import { ecommerceCatalog, MONDAY_10AM, Script } from "@/lib/flow-lab/lab.test-helper";
import { newCaseTemplate } from "@/lib/flow-lab/state";
import type { LabCatalog, LabMessage, LabTrace, TraceStep } from "@/lib/flow-lab/types";
import {
  CUSTOM_PROFILE_ID,
  MAX_ENTRIES,
  buildCustomProfile,
  buildSummary,
  buildThread,
  changedLabels,
  clearSaved,
  countWarnings,
  defaultCustomProfile,
  defaultFlowIds,
  diffSnapshots,
  formatMinutes,
  loadSaved,
  parseSaved,
  parseTags,
  pushEntry,
  readableSteps,
  reconcileSaved,
  saveSaved,
  snapshotOf,
  storageKey,
  visitedHighlight,
  type LabEntry,
  type SavedLab,
  type StorageLike,
} from "./lab-model";

let catalog: LabCatalog;

beforeAll(async () => {
  catalog = await ecommerceCatalog({ globalKeywords: [] });
});

function memoryStorage(limit = Infinity): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > limit) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
}

function step(n: number, partial: Partial<TraceStep>): TraceStep {
  return { n, at: MONDAY_10AM, kind: "info", level: "info", text: `paso ${n}`, ...partial };
}

function trace(partial: Partial<LabTrace> = {}): LabTrace {
  return { action: "clientSays", title: "t", startedAt: MONDAY_10AM, endedAt: MONDAY_10AM, steps: [], visited: [], messages: [], warnings: [], ...partial };
}

function message(id: string, at: string, author: LabMessage["author"], text: string, extra: Partial<LabMessage> = {}): LabMessage {
  return { id, at, author, kind: "text", text, ...extra };
}

describe("configuración", () => {
  it("por defecto participan los publicados, y el flujo de ?flow= aunque sea borrador", () => {
    const published = catalog.flows.filter((f) => f.status === "published").map((f) => f.id);
    expect(defaultFlowIds(catalog)).toEqual(published);
    const draft = { ...catalog, flows: [...catalog.flows, { id: "borrador", name: "B", status: "draft" as const, nodes: [], edges: [] }] };
    expect(defaultFlowIds(draft)).toEqual(published);
    expect(defaultFlowIds(draft, "borrador")).toEqual([...published, "borrador"]);
    expect(defaultFlowIds(draft, "no-existe")).toEqual(published);
    expect(defaultFlowIds(draft, published[0])).toEqual(published);
  });

  it("separa las etiquetas por comas sin repetir ni dejar vacías", () => {
    expect(parseTags(" VIP, , Cliente frecuente,VIP ")).toEqual(["VIP", "Cliente frecuente"]);
  });

  it("el perfil personalizado arma contacto y gestión inicial", () => {
    const venta = catalog.caseTypes.find((t) => t.name === "Venta")!;
    const stage = venta.stages.find((s) => s.kind === "open" && s.name !== venta.stages[0].name) ?? venta.stages[0];
    const profile = buildCustomProfile({ ...defaultCustomProfile(catalog), name: "  Ana ", tags: "VIP", caseTypeId: venta.id, stageId: stage.id }, catalog, MONDAY_10AM);
    expect(profile.contact.name).toBe("Ana");
    expect(profile.contact.tags).toEqual(["VIP"]);
    expect(profile.cases).toHaveLength(1);
    expect(profile.cases[0]).toMatchObject({ caseTypeId: venta.id, stageId: stage.id, status: "open" });
    expect(profile.cases[0].lastInboundAt).not.toBeNull();
    // Con gestión, el contacto ya existe aunque no se marque.
    const withoutCase = buildCustomProfile({ ...defaultCustomProfile(catalog), existed: false }, catalog, MONDAY_10AM);
    expect(withoutCase.contact.existed).toBe(false);
    expect(withoutCase.cases).toEqual([]);
    const forced = buildCustomProfile({ ...defaultCustomProfile(catalog), existed: false, caseTypeId: venta.id }, catalog, MONDAY_10AM);
    expect(forced.contact.existed).toBe(true);
    expect(forced.cases[0].stageId).toBe(venta.stages.find((s) => s.kind === "open")!.id);
  });

  it("ignora un tipo de gestión o de contacto que ya no existe", () => {
    const profile = buildCustomProfile({ ...defaultCustomProfile(catalog), caseTypeId: "fantasma", contactTypeId: "fantasma" }, catalog, MONDAY_10AM);
    expect(profile.cases).toEqual([]);
    expect(profile.contact.contactTypeId).toBeNull();
    expect(profile.notices).toHaveLength(1);
  });
});

describe("traza legible", () => {
  it("agrupa bajo el nodo los pasos que ocurren en él y deja el resto suelto", () => {
    const rows = readableSteps({
      steps: [
        step(1, { kind: "client_message" }),
        step(2, { kind: "trigger_evaluation", level: "ok", flowId: "f", nodeId: "n1" }),
        step(3, { kind: "node", flowId: "f", nodeId: "n2" }),
        step(4, { kind: "tag_changed", flowId: "f", nodeId: "n2" }),
        step(5, { kind: "message_sent", level: "warning", flowId: "f", nodeId: "n2" }),
        step(6, { kind: "node", flowId: "f", nodeId: "n3" }),
        step(7, { kind: "flow_completed", flowId: "f" }),
        step(8, { kind: "tag_changed", flowId: "f", nodeId: "n3" }),
      ],
    });
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3, 6, 7, 8]);
    expect(rows[2].children.map((c) => c.n)).toEqual([4, 5]);
    expect(rows[2].level).toBe("warning");
    expect(rows[2].highlight).toEqual([{ flowId: "f", nodeIds: ["n2"] }]);
    expect(rows[3].children).toEqual([]);
  });

  it("explica la evaluación de disparadores con sus candidatos y marca el que coincidió", () => {
    const rows = readableSteps({
      steps: [
        step(1, {
          kind: "trigger_evaluation",
          level: "ok",
          flowId: "f1",
          nodeId: "t1",
          data: {
            matched: true,
            candidates: [
              { triggerId: "a", flowId: "f1", flowName: "Catálogo", type: "keyword", description: "palabras clave: precio", outcome: "matched", why: "Contiene «precio»", nodeId: "t1" },
              { triggerId: "b", flowId: "f2", flowName: "Bienvenida", type: "welcome", description: "primer mensaje", outcome: "not_matched", why: "Habría coincidido, pero ganó «Catálogo»", nodeId: "t2" },
            ],
          },
        }),
      ],
    });
    expect(rows[0].details).toEqual(["Coincide · Catálogo (palabras clave: precio): Contiene «precio»", "Descartado · Bienvenida (primer mensaje): Habría coincidido, pero ganó «Catálogo»"]);
    expect(rows[0].highlight).toEqual([{ flowId: "f1", nodeIds: ["t1"] }]);
  });

  it("muestra cada condición con su resultado y la plantilla enviada", () => {
    const rows = readableSteps({
      steps: [
        step(1, { kind: "condition", data: { conditions: [{ description: "tiene la etiqueta VIP", result: true }, { description: "etapa es Pago", result: false }] } }),
        step(2, { kind: "message_sent", data: { template: "recompra", params: ["Ana", "12"] } }),
      ],
    });
    expect(rows[0].details).toEqual(["Sí · tiene la etiqueta VIP", "No · etapa es Pago"]);
    expect(rows[1].details).toEqual(["Plantilla recompra con «Ana», «12»"]);
  });

  it("funciona con una traza real del motor", () => {
    const s = new Script(catalog, { contact: { name: "Lucía", existed: false } }).says("Hola, ¿cuál es el precio de la proteína?");
    const rows = readableSteps(s.last);
    expect(rows.length).toBeGreaterThan(3);
    const trigger = rows.find((r) => r.kind === "trigger_evaluation")!;
    expect(trigger.details.some((d) => d.startsWith("Descartado ·"))).toBe(true);
    expect(trigger.highlight.length).toBeGreaterThan(0);
    // Todos los pasos de la traza aparecen exactamente una vez.
    const count = (list: typeof rows): number => list.reduce((n, r) => n + 1 + count(r.children), 0);
    expect(count(rows)).toBe(s.last.steps.length);
  });

  it("junta los nodos recorridos por flujo sin repetir", () => {
    const h = visitedHighlight({ visited: [{ flowId: "a", nodeId: "1", step: 1 }, { flowId: "b", nodeId: "9", step: 2 }, { flowId: "a", nodeId: "2", step: 3 }, { flowId: "a", nodeId: "1", step: 4 }] });
    expect(h).toEqual([
      { flowId: "a", nodeIds: ["1", "2"] },
      { flowId: "b", nodeIds: ["9"] },
    ]);
    expect(visitedHighlight(undefined)).toEqual([]);
  });

  it("cuenta avisos y errores", () => {
    expect(countWarnings({ steps: [step(1, { level: "ok" }), step(2, { level: "warning" }), step(3, { level: "error" })] })).toBe(2);
  });
});

describe("hilo del teléfono", () => {
  it("formatea los minutos en español", () => {
    expect(formatMinutes(15)).toBe("15 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(150)).toBe("2 h 30 min");
    expect(formatMinutes(1440)).toBe("1 día");
    expect(formatMinutes(7 * 1440)).toBe("7 días");
  });

  it("pone un separador por cada avance de tiempo, antes de los mensajes que genera", () => {
    const at0 = "2026-10-19T15:00:00.000Z";
    const at2h = "2026-10-19T17:00:00.000Z";
    const thread = buildThread(
      [message("m1", at0, "client", "hola"), message("m2", at2h, "bot", "¿sigues ahí?")],
      [trace({ action: "clientSays" }), trace({ action: "advanceTime", startedAt: at0, endedAt: at2h })],
    );
    const kinds = thread.map((i) => (i.kind === "separator" ? `sep:${i.label}` : i.message.id));
    expect(kinds[0]).toMatch(/^sep:/); // el día del primer mensaje
    expect(kinds.slice(1)).toEqual(["m1", expect.stringContaining("Pasaron 2 h"), "m2"]);
  });

  it("agrega un separador cuando cambia el día y no repite el del avance", () => {
    const thread = buildThread(
      [message("m1", "2026-10-19T15:00:00.000Z", "client", "hola"), message("m2", "2026-10-20T15:00:00.000Z", "bot", "buen día"), message("m3", "2026-10-20T15:01:00.000Z", "client", "gracias")],
      [],
    );
    expect(thread.filter((i) => i.kind === "separator")).toHaveLength(2);
    const advanced = buildThread(
      [message("m1", "2026-10-19T15:00:00.000Z", "client", "hola"), message("m2", "2026-10-20T15:00:00.000Z", "bot", "buen día")],
      [trace({ action: "advanceTime", startedAt: "2026-10-19T15:00:00.000Z", endedAt: "2026-10-20T15:00:00.000Z" })],
    );
    expect(advanced.filter((i) => i.kind === "separator")).toHaveLength(2); // primer día + el avance
  });

  it("ignora los avances que fallaron", () => {
    const thread = buildThread([message("m1", MONDAY_10AM, "client", "hola")], [trace({ action: "advanceTime", error: "no" })]);
    expect(thread.filter((i) => i.kind === "separator")).toHaveLength(1);
  });
});

describe("gestión y contacto", () => {
  it("resalta lo que cambió entre dos pasos", () => {
    const s = new Script(catalog, { contact: { name: "Lucía", existed: false } });
    const before = snapshotOf(catalog, s.state);
    s.says("precio");
    const after = snapshotOf(catalog, s.state);
    const sections = diffSnapshots(before, after);
    const labels = changedLabels(sections);
    expect(labels).toContain("Etapa");
    expect(labels).toContain("Último mensaje del cliente");
    const stage = sections.flatMap((x) => x.fields).find((f) => f.k.endsWith(":stage"))!;
    expect(stage.changed).toBe(true);
    expect(stage.v).toBe("Asesorando");
    // Una gestión nueva no tiene valor anterior.
    expect(stage.previous).toBeUndefined();
    // Sin paso anterior no se marca nada.
    expect(changedLabels(diffSnapshots(null, after))).toEqual([]);
    // Sin cambios, nada resaltado.
    expect(changedLabels(diffSnapshots(after, after))).toEqual([]);
  });

  it("muestra el valor anterior cuando cambia la etapa y lista lo programado", () => {
    const s = new Script(catalog, { contact: { name: "Lucía", existed: false } }).says("precio");
    const before = snapshotOf(catalog, s.state);
    const venta = catalog.caseTypes.find((t) => t.name === "Venta")!;
    const other = venta.stages.find((x) => x.kind === "open" && x.name !== "Asesorando")!;
    s.stageById(other.id);
    const sections = diffSnapshots(before, snapshotOf(catalog, s.state));
    const stage = sections.flatMap((x) => x.fields).find((f) => f.k.endsWith(":stage"))!;
    expect(stage).toMatchObject({ changed: true, previous: "Asesorando", v: other.name });
  });

  it("incluye las próximas programadas (gestiones y esperas)", () => {
    const state = new Script(catalog).state;
    const row = newCaseTemplate("case-9", MONDAY_10AM);
    Object.assign(row, { status: "scheduled", scheduledFor: "2026-11-12T15:00:00.000Z", caseTypeId: catalog.caseTypes[0].id });
    state.cases.push(row);
    const flow = catalog.flows[0];
    state.sessions.push({ id: "session-1", flowId: flow.id, status: "active", currentNodeId: "n1", waitingForInput: false, waitingUntil: null, variables: {}, humanTakeoverAt: null, startedAt: MONDAY_10AM, updatedAt: MONDAY_10AM });
    state.jobs.push({ id: "job-1", type: "resume_flow", sessionId: "session-1", nodeId: "n1", runAt: "2026-10-19T17:00:00.000Z", status: "pending" });
    const upcoming = snapshotOf(catalog, state).filter((f) => f.s === "Próximas");
    expect(upcoming.map((f) => f.k)).toEqual(["next:case:case-9", "next:job:job-1"]);
    expect(upcoming[1].l).toContain(flow.name);
  });
});

describe("resumen para compartir", () => {
  it("incluye la conversación, la traza y el estado final", () => {
    const s = new Script(catalog, { contact: { name: "Lucía", existed: false } }).says("Hola, ¿cuál es el precio de la proteína?").wait(120);
    const text = buildSummary({ catalog, state: s.state, profileName: "Prospecto nuevo", flowNames: ["Catálogo y precios"], traces: s.traces });
    expect(text).toContain("LABORATORIO DE CONVERSACIONES");
    expect(text).toContain("Perfil: Prospecto nuevo · Canal: WhatsApp");
    expect(text).toContain("Cliente: Hola, ¿cuál es el precio de la proteína?");
    expect(text).toContain("Bot (Catálogo y precios)");
    expect(text).toContain("Respuestas rápidas: Hablar con un asesor | Consultar mi pedido");
    expect(text).toContain("1. [");
    expect(text).toContain("2. [");
    expect(text).toContain("Coincide el disparador");
    expect(text).toContain("ESTADO FINAL");
    expect(text).toContain("Etapa: Asesorando");
  });

  it("indica cuando no hay nada", () => {
    const s = new Script(catalog);
    const text = buildSummary({ catalog, state: s.state, profileName: "X", flowNames: [], traces: [] });
    expect(text).toContain("(sin mensajes)");
    expect(text).toContain("(sin acciones)");
    expect(text).toContain("Flujos que participan: ninguno");
  });

  it("marca las plantillas de WhatsApp y los avisos", () => {
    const state = new Script(catalog).state;
    state.messages.push(message("m1", MONDAY_10AM, "bot", "Hola Ana", { kind: "template", template: { name: "recompra", language: "es", params: ["Ana"] }, failed: "sin teléfono" }));
    const text = buildSummary({
      catalog,
      state,
      profileName: "X",
      flowNames: [],
      traces: [trace({ title: "pasa el tiempo", steps: [step(1, { level: "warning", text: "Ventana cerrada" })] })],
    });
    expect(text).toContain("[Plantilla de WhatsApp recompra] Hola Ana");
    expect(text).toContain("No se pudo enviar: sin teléfono");
    expect(text).toContain("! Ventana cerrada");
  });
});

describe("persistencia", () => {
  function saved(): SavedLab {
    const s = new Script(catalog, { contact: { name: "Lucía", existed: false } }).says("precio");
    const entries: LabEntry[] = s.traces.map((t) => ({ trace: t, snapshot: snapshotOf(catalog, s.state) }));
    return {
      version: 1,
      config: { profileId: "prospecto-nuevo", custom: defaultCustomProfile(catalog), channel: "whatsapp", flowIds: defaultFlowIds(catalog) },
      state: s.state,
      entries,
      initialSnapshot: [],
      selected: 0,
    };
  }

  it("guarda y recupera igual", () => {
    const storage = memoryStorage();
    const value = saved();
    expect(saveSaved(storage, "ws1", value)).toBe(true);
    expect(storage.data.has(storageKey("ws1"))).toBe(true);
    expect(loadSaved(storage, "ws1")).toEqual(JSON.parse(JSON.stringify(value)));
    expect(loadSaved(storage, "ws2")).toBeNull();
    clearSaved(storage, "ws1");
    expect(loadSaved(storage, "ws1")).toBeNull();
  });

  it("no se rompe sin almacenamiento, con datos corruptos o con un almacenamiento que falla", () => {
    expect(loadSaved(null, "ws")).toBeNull();
    expect(saveSaved(null, "ws", saved())).toBe(false);
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(loadSaved(broken, "ws")).toBeNull();
    expect(saveSaved(broken, "ws", saved())).toBe(false);
    expect(() => clearSaved(broken, "ws")).not.toThrow();
    expect(parseSaved("{no es json")).toBeNull();
    expect(parseSaved(JSON.stringify({ version: 2 }))).toBeNull();
    expect(parseSaved(JSON.stringify({ version: 1, config: {}, state: {}, entries: [], initialSnapshot: [] }))).toBeNull();
    const ok = saved();
    expect(parseSaved(JSON.stringify({ ...ok, entries: [{ trace: {}, snapshot: [] }] }))).toBeNull();
    expect(parseSaved(JSON.stringify({ ...ok, selected: 99 }))?.selected).toBeNull();
  });

  it("si no cabe, recorta el historial más viejo", () => {
    const value = saved();
    const many = { ...value, entries: Array.from({ length: 8 }, () => value.entries[0]), selected: 7 };
    const size = JSON.stringify(many).length;
    const storage = memoryStorage(Math.floor(size * 0.6));
    expect(saveSaved(storage, "ws", many)).toBe(true);
    const back = loadSaved(storage, "ws")!;
    expect(back.entries.length).toBeLessThan(8);
    expect(back.entries.length).toBeGreaterThan(0);
    expect(back.selected === null || back.selected < back.entries.length).toBe(true);
    // Si ni vacío cabe, devuelve false.
    expect(saveSaved(memoryStorage(10), "ws", many)).toBe(false);
  });

  it("al reabrir quita los flujos y perfiles que ya no existen", () => {
    const value = saved();
    const withGhost: SavedLab = { ...value, config: { ...value.config, profileId: "perfil-viejo", flowIds: [...value.config.flowIds, "borrado"] }, state: { ...value.state, enabledFlowIds: [...value.config.flowIds, "borrado"] } };
    const rec = reconcileSaved(withGhost, catalog, ["prospecto-nuevo"]);
    expect(rec.config.flowIds).toEqual(value.config.flowIds);
    expect(rec.config.profileId).toBe(CUSTOM_PROFILE_ID);
    expect(rec.state.enabledFlowIds).toEqual(value.config.flowIds);
    expect(reconcileSaved(value, catalog, ["prospecto-nuevo"]).config.profileId).toBe("prospecto-nuevo");
  });

  it("limita el historial", () => {
    let entries: LabEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES + 5; i++) entries = pushEntry(entries, { trace: trace({ title: `t${i}` }), snapshot: [] });
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[entries.length - 1].trace.title).toBe(`t${MAX_ENTRIES + 4}`);
    expect(entries[0].trace.title).toBe("t5");
  });
});
