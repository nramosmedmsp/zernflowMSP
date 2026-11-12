import { describe, expect, it } from "vitest";
import { brokenBadgeText, brokenDetailLines, brokenNodeCount, findBrokenNodes, type FlowCatalog } from "./broken-nodes";

const catalog: FlowCatalog = {
  caseTypes: { t1: { name: "Venta", archived: false }, t2: { name: "Reclamo", archived: true } },
  stages: { s1: { name: "Nuevo", archived: false }, s2: { name: "Cotizado", archived: true } },
  teams: { e1: { name: "Ventas", archived: false }, e2: { name: "Soporte", archived: true } },
  contactTypes: { c1: { name: "Cliente", archived: false }, c2: { name: "Proveedor", archived: true } },
};

const action = (id: string, actionType: string, data: Record<string, unknown>) => ({
  id,
  type: "action",
  data: { actionType, ...data },
});

describe("findBrokenNodes", () => {
  it("un flujo sano no tiene nodos rotos", () => {
    const nodes = [
      action("a", "changeStage", { stageId: "s1" }),
      action("b", "classifyCase", { caseTypeId: "t1", stageId: "s1" }),
      action("c", "assignTeam", { mode: "fixed", teamId: "e1" }),
      action("d", "distributeCase", {}),
    ];
    expect(findBrokenNodes(nodes, catalog)).toEqual([]);
  });

  it("etapa archivada: dice cuál y que está archivada", () => {
    const [b] = findBrokenNodes([action("a", "changeStage", { stageId: "s2", stageName: "viejo" })], catalog);
    expect(b).toMatchObject({ nodeId: "a", nodeLabel: "Cambiar etapa", refKind: "stage", state: "archived", refName: "Cotizado" });
    expect(b.message).toBe("usa la etapa «Cotizado», que está archivada");
  });

  it("etapa borrada: usa el nombre que guardó el nodo, o lo omite", () => {
    const [named] = findBrokenNodes([action("a", "changeStage", { stageId: "zz", stageName: "Perdida" })], catalog);
    expect(named).toMatchObject({ state: "missing", message: "usa la etapa «Perdida», que ya no existe" });
    const [unnamed] = findBrokenNodes([action("a", "changeStage", { stageId: "zz" })], catalog);
    expect(unnamed.message).toBe("usa una etapa, que ya no existe");
  });

  it("Clasificar gestión revisa tipo y etapa", () => {
    const broken = findBrokenNodes([action("a", "classifyCase", { caseTypeId: "t2", stageId: "s2" })], catalog);
    expect(broken.map((b) => b.refKind)).toEqual(["caseType", "stage"]);
    expect(brokenNodeCount(broken)).toBe(1);
    expect(brokenDetailLines(broken)[0]).toBe("«Clasificar gestión» usa el tipo de gestión «Reclamo», que está archivado.");
  });

  it("Asignar a equipo: equipo fijo archivado sí; re-ruteo o sin equipo no", () => {
    expect(findBrokenNodes([action("a", "assignTeam", { mode: "fixed", teamId: "e2" })], catalog)[0].message).toBe(
      "usa el equipo «Soporte», que está archivado",
    );
    expect(findBrokenNodes([action("a", "assignTeam", { mode: "reroute", teamId: "e2" })], catalog)).toEqual([]);
    expect(findBrokenNodes([action("a", "assignTeam", { mode: "fixed" })], catalog)).toEqual([]);
  });

  it("disparadores de gestión: tipo, etapa y tipos de contacto, en el formato del panel y en config", () => {
    const panel = { id: "t", type: "trigger", data: { triggerType: "case_stage_changed", caseTypeId: "t2", stageId: "s2" } };
    expect(findBrokenNodes([panel], catalog).map((b) => b.refKind)).toEqual(["caseType", "stage"]);
    const opened = {
      id: "o",
      type: "trigger",
      data: { triggerType: "case_opened", contactTypeIds: ["c1", "c2", "gone"], contactTypeNames: ["Cliente", "Proveedor", "Mayorista"] },
    };
    const broken = findBrokenNodes([opened], catalog);
    expect(broken.map((b) => b.message)).toEqual([
      "se activa con el tipo de contacto «Proveedor», que está archivado",
      "se activa con el tipo de contacto «Mayorista», que ya no existe",
    ]);
    const fromConfig = { id: "x", type: "trigger", data: { triggerType: "case_opened", config: { case_type_id: "t2" } } };
    expect(findBrokenNodes([fromConfig], catalog)).toHaveLength(1);
  });

  it("los disparadores que no son de gestión no se revisan", () => {
    expect(findBrokenNodes([{ id: "k", type: "trigger", data: { triggerType: "keyword", caseTypeId: "gone" } }], catalog)).toEqual([]);
  });

  it("condiciones de gestión comparan ids; Sí/No y otros campos se ignoran", () => {
    const node = {
      id: "c",
      type: "condition",
      data: {
        conditions: [
          { field: "case_stage", operator: "equals", value: "s2" },
          { field: "case_team", operator: "equals", value: "e1" },
          { field: "contact_type", operator: "equals", value: "gone" },
          { field: "within_hours", operator: "equals", value: "true" },
          { field: "message", operator: "contains", value: "hola" },
        ],
      },
    };
    expect(findBrokenNodes([node], catalog).map((b) => b.message)).toEqual([
      "compara con la etapa «Cotizado», que está archivada",
      "compara con un tipo de contacto, que ya no existe",
    ]);
  });

  it("no repite la misma referencia en un nodo y cuenta nodos distintos", () => {
    const cond = {
      id: "c",
      type: "condition",
      data: {
        conditions: [
          { field: "case_stage", operator: "equals", value: "s2" },
          { field: "case_stage", operator: "not_equals", value: "s2" },
        ],
      },
    };
    const broken = findBrokenNodes([cond, action("a", "changeStage", { stageId: "s2" })], catalog);
    expect(broken).toHaveLength(2);
    expect(brokenNodeCount(broken)).toBe(2);
  });

  it("tolera datos raros", () => {
    expect(findBrokenNodes([{ id: "x" }, { id: "y", data: null }, { id: "z", type: "action", data: "mal" }], catalog)).toEqual([]);
  });

  it("textos de la insignia", () => {
    expect(brokenBadgeText(1)).toBe("1 nodo roto");
    expect(brokenBadgeText(3)).toBe("3 nodos rotos");
  });
});
