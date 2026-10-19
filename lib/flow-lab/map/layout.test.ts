import { describe, expect, it } from "vitest";
import { buildCatalogFromTemplates } from "../from-templates";
import { buildFlowMap, filterPublished } from "./build";
import { layoutFlowMap, pickSides } from "./layout";
import { flowNodeId, stageNodeId } from "./types";

describe("layoutFlowMap", () => {
  it("coloca flujos arriba, etapas debajo y no deja nodos encimados", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
    const model = buildFlowMap(catalog);
    const layout = layoutFlowMap(model);
    const items = layout.nodes.filter((n) => n.kind !== "lane");

    const lastFlowY = Math.max(...items.filter((n) => n.kind === "flow").map((n) => n.y));
    const firstStageY = Math.min(...items.filter((n) => n.kind === "stage").map((n) => n.y));
    expect(firstStageY).toBeGreaterThan(lastFlowY);
    expect(items.filter((n) => n.kind === "flow")).toHaveLength(catalog.flows.length);

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap, `${a.id} con ${b.id}`).toBe(false);
      }
    }
    // Cada conexión del modelo tiene sus dos extremos dibujados.
    expect(layout.edges).toHaveLength(model.connections.length);
  });

  it("deja fuera los carriles vacíos y lo que no es publicado al filtrar", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
    const datos = catalog.flows.find((f) => f.name === "Datos de pago")!;
    datos.status = "draft";
    const layout = layoutFlowMap(filterPublished(buildFlowMap(catalog)));
    expect(layout.nodes.some((n) => n.id === flowNodeId(datos.id))).toBe(false);
    expect(layout.nodes.some((n) => n.id === "lane:none")).toBe(false);
    expect(layout.edges.some((e) => e.target === flowNodeId(datos.id))).toBe(false);
  });

  it("elige los lados de salida y entrada según la posición", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
    const layout = layoutFlowMap(buildFlowMap(catalog));
    const datos = catalog.flows.find((f) => f.name === "Datos de pago")!;
    const edge = layout.edges.find((e) => e.target === flowNodeId(datos.id))!;
    // La etapa está debajo del flujo: sube desde su borde superior hasta el inferior de la tarjeta.
    expect(edge.source.startsWith(stageNodeId(""))).toBe(true);
    expect(edge.sourceHandle).toBe("t-s");
    expect(edge.targetHandle).toBe("b-t");
    const a = { id: "a", kind: "flow" as const, x: 0, y: 0, width: 10, height: 10, ref: "" };
    expect(pickSides(a, { ...a, x: 50 })).toEqual(["r", "l"]);
    expect(pickSides({ ...a, x: 50 }, a)).toEqual(["l", "r"]);
  });
});
