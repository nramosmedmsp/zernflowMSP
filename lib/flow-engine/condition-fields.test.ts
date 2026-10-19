import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { compareCondition, isCaseConditionField, normalizeForCompare } from "./case-conditions";
import {
  buildConditionField,
  evaluateContactCondition,
  newContactCondition,
  parseConditionField,
  renameConditionTarget,
  setTagPresence,
  tagCondition,
  upgradeCondition,
  type ContactFacts,
  type FlowCondition,
} from "./condition-fields";
import { simulateFlow } from "./simulator";

const facts = (over: Partial<ContactFacts> = {}): ContactFacts => ({
  platform: "whatsapp",
  isSubscribed: true,
  tags: ["VIP"],
  customFields: { numero_pedido: "PE-1" },
  variables: { message: "Quiero COMPRAR creatina" },
  ...over,
});

describe("comparaciones sin mayúsculas ni tildes", () => {
  it("normaliza mayúsculas, tildes y espacios", () => {
    expect(normalizeForCompare("  ÁÉÍÓÚ Envío ")).toBe("aeiou envio");
  });

  it("equals y not_equals", () => {
    expect(compareCondition("Sí", "equals", "si")).toBe(true);
    expect(compareCondition("ATENCIÓN", "equals", "atencion")).toBe(true);
    expect(compareCondition("Sede 1", "equals", "Sede 2")).toBe(false);
    expect(compareCondition("Sí", "not_equals", "si")).toBe(false);
    expect(compareCondition("No", "not_equals", "si")).toBe(true);
    // Sin valor no es igual a nada.
    expect(compareCondition(undefined, "equals", "")).toBe(false);
    expect(compareCondition(undefined, "not_equals", "x")).toBe(true);
  });

  it("contains", () => {
    expect(compareCondition("Quiero COMPRAR", "contains", "comprar")).toBe(true);
    expect(compareCondition("¿Dónde está mi envío?", "contains", "envio")).toBe(true);
    expect(compareCondition("hola", "contains", "adiós")).toBe(false);
    expect(compareCondition(undefined, "contains", "x")).toBe(false);
  });

  it("los números y existe no cambian", () => {
    expect(compareCondition("5", "gt", "3")).toBe(true);
    expect(compareCondition("2", "lt", "3")).toBe(true);
    expect(compareCondition("", "exists", "")).toBe(false);
    expect(compareCondition("x", "exists", "")).toBe(true);
  });
});

describe("condiciones del contacto: formato del panel y del motor", () => {
  it("variable:<nombre> compara sin mayúsculas ni tildes", () => {
    const c: FlowCondition = { field: "variable:message", operator: "contains", value: "comprar" };
    expect(evaluateContactCondition(c, facts())).toBe(true);
    expect(evaluateContactCondition({ ...c, value: "pedido" }, facts())).toBe(false);
  });

  it("variable con ruta de puntos hacia un objeto", () => {
    const c: FlowCondition = { field: "variable:respuesta.estado", operator: "equals", value: "ENTREGADO" };
    expect(evaluateContactCondition(c, facts({ variables: { respuesta: { estado: "entregado" } } }))).toBe(true);
  });

  it("tag:<nombre> con valor true / false", () => {
    const has: FlowCondition = { field: "tag:VIP", operator: "equals", value: "true" };
    const hasNot: FlowCondition = { field: "tag:VIP", operator: "equals", value: "false" };
    expect(evaluateContactCondition(has, facts())).toBe(true);
    expect(evaluateContactCondition(hasNot, facts())).toBe(false);
    expect(evaluateContactCondition(has, facts({ tags: [] }))).toBe(false);
    expect(evaluateContactCondition(hasNot, facts({ tags: [] }))).toBe(true);
    expect(evaluateContactCondition({ field: "tag:VIP", operator: "exists", value: "" }, facts())).toBe(true);
  });

  it("platform, is_subscribed y campo personalizado", () => {
    expect(evaluateContactCondition({ field: "platform", operator: "equals", value: "whatsapp" }, facts())).toBe(true);
    expect(evaluateContactCondition({ field: "is_subscribed", operator: "equals", value: "true" }, facts())).toBe(true);
    expect(evaluateContactCondition({ field: "is_subscribed", operator: "equals", value: "true" }, facts({ isSubscribed: false }))).toBe(false);
    expect(evaluateContactCondition({ field: "custom_field:numero_pedido", operator: "equals", value: "pe-1" }, facts())).toBe(true);
    expect(evaluateContactCondition({ field: "custom_field:otro", operator: "exists", value: "" }, facts())).toBe(false);
  });

  describe("formato antiguo (flujos ya guardados)", () => {
    it("tag sin nombre: la etiqueta está en el valor", () => {
      expect(evaluateContactCondition({ field: "tag", operator: "equals", value: "VIP" }, facts())).toBe(true);
      expect(evaluateContactCondition({ field: "tag", operator: "equals", value: "Mayorista" }, facts())).toBe(false);
      expect(evaluateContactCondition({ field: "tag", operator: "not_equals", value: "Mayorista" }, facts())).toBe(true);
      expect(evaluateContactCondition({ field: "has_tag", operator: "equals", value: "VIP" }, facts())).toBe(true);
    });

    it("el slug del campo personalizado sin prefijo", () => {
      expect(evaluateContactCondition({ field: "numero_pedido", operator: "equals", value: "PE-1" }, facts())).toBe(true);
    });

    it("variable y campo sin nombre no se pueden evaluar: valor vacío", () => {
      expect(evaluateContactCondition({ field: "variable", operator: "equals", value: "x" }, facts())).toBe(false);
      expect(evaluateContactCondition({ field: "variable", operator: "exists", value: "" }, facts())).toBe(false);
      expect(evaluateContactCondition({ field: "custom_field", operator: "exists", value: "" }, facts())).toBe(false);
    });

    it("upgradeCondition pasa al formato actual y deja intacto lo demás", () => {
      expect(upgradeCondition({ field: "tag", operator: "equals", value: "VIP" }, isCaseConditionField)).toEqual({
        field: "tag:VIP",
        operator: "equals",
        value: "true",
      });
      expect(upgradeCondition({ field: "tag", operator: "not_equals", value: "VIP" }, isCaseConditionField)).toEqual({
        field: "tag:VIP",
        operator: "equals",
        value: "false",
      });
      expect(upgradeCondition({ field: "numero_pedido", operator: "equals", value: "1" }, isCaseConditionField)).toEqual({
        field: "custom_field:numero_pedido",
        operator: "equals",
        value: "1",
      });
      const actual: FlowCondition = { field: "variable:message", operator: "contains", value: "x" };
      expect(upgradeCondition(actual, isCaseConditionField)).toBe(actual);
      const caso: FlowCondition = { field: "case_type", operator: "equals", value: "abc" };
      expect(upgradeCondition(caso, isCaseConditionField)).toBe(caso);
    });
  });
});

describe("ida y vuelta panel -> motor", () => {
  // Lo que arma el panel con sus ayudantes es lo que evalúa el motor.
  it("etiqueta: nombre y tiene / no tiene", () => {
    let c = newContactCondition("tag");
    expect(c).toEqual({ field: "tag:", operator: "equals", value: "true" });
    c = renameConditionTarget(c, "VIP");
    expect(c.field).toBe("tag:VIP");
    expect(parseConditionField(c)).toMatchObject({ kind: "tag", name: "VIP", legacy: false });
    expect(tagCondition(c)).toEqual({ name: "VIP", has: true });
    expect(evaluateContactCondition(c, facts())).toBe(true);

    const without = setTagPresence(c, false);
    expect(tagCondition(without)).toEqual({ name: "VIP", has: false });
    expect(evaluateContactCondition(without, facts())).toBe(false);
    expect(evaluateContactCondition(without, facts({ tags: [] }))).toBe(true);
  });

  it("variable: nombre, operador y valor", () => {
    let c = newContactCondition("variable");
    c = { ...renameConditionTarget(c, "message"), operator: "contains", value: "comprar" };
    expect(c).toEqual({ field: "variable:message", operator: "contains", value: "comprar" });
    expect(evaluateContactCondition(c, facts())).toBe(true);
  });

  it("campo personalizado, plataforma y suscripción", () => {
    const campo = { ...renameConditionTarget(newContactCondition("custom_field"), "numero_pedido"), value: "PE-1" };
    expect(campo.field).toBe("custom_field:numero_pedido");
    expect(evaluateContactCondition(campo, facts())).toBe(true);

    const plataforma = { ...newContactCondition("platform"), value: "whatsapp" };
    expect(evaluateContactCondition(plataforma, facts())).toBe(true);
    expect(evaluateContactCondition(plataforma, facts({ platform: "instagram" }))).toBe(false);

    const suscrito = newContactCondition("is_subscribed");
    expect(evaluateContactCondition(suscrito, facts())).toBe(true);
    expect(evaluateContactCondition(suscrito, facts({ isSubscribed: false }))).toBe(false);
  });

  it("buildConditionField y parseConditionField son inversos", () => {
    for (const kind of ["tag", "variable", "custom_field"] as const) {
      const field = buildConditionField(kind, "algo");
      expect(parseConditionField({ field, operator: "equals", value: "" })).toMatchObject({ kind, name: "algo", legacy: false });
    }
    for (const kind of ["platform", "is_subscribed"] as const) {
      expect(parseConditionField({ field: buildConditionField(kind), operator: "equals", value: "" })).toMatchObject({ kind });
    }
  });

  it("el simulador evalúa lo mismo que el panel guarda (incluido el formato antiguo)", () => {
    const run = (conditions: FlowCondition[], tags: string[] = []) => {
      const nodes: Node[] = [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "default" } },
        { id: "c", type: "condition", position: { x: 0, y: 0 }, data: { conditions, logic: "and" } },
        { id: "y", type: "action", position: { x: 0, y: 0 }, data: { actionType: "addTag", tagName: "si" } },
        { id: "n", type: "action", position: { x: 0, y: 0 }, data: { actionType: "addTag", tagName: "no" } },
      ];
      const edges: Edge[] = [
        { id: "e0", source: "t", target: "c" },
        { id: "e1", source: "c", target: "y", sourceHandle: "yes" },
        { id: "e2", source: "c", target: "n", sourceHandle: "no" },
      ];
      const result = simulateFlow(nodes, edges, { incomingMessage: "Quiero COMPRAR", mockContact: { tags } });
      return result.steps.find((s) => s.nodeType === "condition")!.result as { result: boolean };
    };
    expect(run([{ field: "variable:message", operator: "contains", value: "comprar" }]).result).toBe(true);
    expect(run([{ field: "tag:VIP", operator: "equals", value: "true" }], ["VIP"]).result).toBe(true);
    expect(run([{ field: "tag:VIP", operator: "equals", value: "true" }], []).result).toBe(false);
    expect(run([{ field: "tag", operator: "equals", value: "VIP" }], ["VIP"]).result).toBe(true);
  });
});
