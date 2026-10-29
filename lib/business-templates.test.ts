import { describe, expect, it } from "vitest";
import {
  BUSINESS_TEMPLATES,
  applyTemplateWithStore,
  isBusinessTemplateKey,
  normalizeName,
  previewTemplateWithStore,
  supabaseTemplateStore,
} from "./business-templates";
import { FakeDb } from "./cases/fake-db.test-helper";

const WS = "ws-1";

function freshDb() {
  const fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: { agent_visibility: "own" } }]);
  return fake;
}

function counts(fake: FakeDb) {
  return {
    contactTypes: fake.rows("contact_types").length,
    caseTypes: fake.rows("case_types").length,
    stages: fake.rows("case_stages").length,
    categories: fake.rows("case_categories").length,
    reasons: fake.rows("case_outcome_reasons").length,
    rules: fake.rows("case_rules").length,
  };
}

const ZERO = { contactTypes: 0, caseTypes: 0, stages: 0, categories: 0, reasons: 0, rules: 0 };

describe("datos de las plantillas (docs/PLAN-CRM.md 3.3 y 3.4)", () => {
  it("E-commerce", () => {
    const t = BUSINESS_TEMPLATES.ecommerce;
    expect(t.contactTypes.map((c) => c.name)).toEqual(["Prospecto", "Cliente", "Cliente frecuente", "Inactivo"]);
    expect(t.caseTypes.map((c) => c.name)).toEqual(["Venta", "Postventa", "Consulta", "Recompra"]);
    const venta = t.caseTypes[0];
    expect(venta.stages).toEqual([
      { name: "Nuevo interesado", kind: "open" },
      { name: "Asesorando", kind: "open" },
      { name: "Pedido o enlace de pago enviado", kind: "open" },
      { name: "Esperando pago", kind: "open" },
      { name: "Pagado", kind: "won" },
      { name: "No compró", kind: "lost" },
    ]);
    expect(venta.suggestedFor).toEqual(["Prospecto"]);
    expect(venta.reasons?.map((r) => r.name)).toEqual([
      "Precio",
      "Sin stock",
      "Costo o demora del envío",
      "Solo consultaba",
      "Dejó de responder",
      "Compró en otro lado",
    ]);
    const recompra = t.caseTypes[3];
    expect(recompra.isProactive).toBe(true);
    expect(recompra.stages.map((s) => `${s.name}:${s.kind}`)).toEqual([
      "Recordatorio enviado:open",
      "Interesado:open",
      "Compró:won",
      "No compró:lost",
    ]);
    // Recompra ganada cuenta igual que una Venta.
    expect(recompra.rules).toEqual(venta.rules);
    expect(venta.rules).toEqual([
      { trigger: "on_won", action: "set_contact_type", contactType: "Cliente" },
      { trigger: "on_won", action: "set_contact_type", contactType: "Cliente frecuente", fromNthWin: 2 },
      { trigger: "on_won", action: "schedule_case", caseType: "Recompra", daysAfter: 25 },
    ]);
    expect(t.caseTypes[1].categories?.map((c) => c.name)).toEqual([
      "Estado de pedido",
      "Cambio o devolución",
      "Producto dañado",
      "Comprobante",
      "Reclamo",
    ]);
  });

  it("Gimnasio", () => {
    const t = BUSINESS_TEMPLATES.gym;
    expect(t.contactTypes.map((c) => c.name)).toEqual(["Prospecto", "Socio activo", "Socio congelado", "Ex socio"]);
    expect(t.caseTypes.map((c) => `${c.name}${c.isProactive ? " (proactiva)" : ""}`)).toEqual([
      "Venta de membresía",
      "Atención al socio",
      "Renovación (proactiva)",
    ]);
    expect(t.caseTypes[0].stages.map((s) => s.name)).toEqual([
      "Nuevo interesado",
      "Asesorando",
      "Visita o clase de prueba agendada",
      "Visitó la sede",
      "Inscrito",
      "No se inscribió",
    ]);
    expect(t.caseTypes[0].rules).toContainEqual({
      trigger: "on_won",
      action: "schedule_case",
      caseType: "Renovación",
      daysBeforeKeyDate: 7,
    });
    expect(t.caseTypes[0].rules).toContainEqual({ trigger: "on_won", action: "ask_key_date", label: "Vencimiento de membresía" });
    expect(t.caseTypes[2].rules).toContainEqual({ trigger: "on_lost", action: "set_contact_type", contactType: "Ex socio" });
    expect(t.keyDateLabel).toBe("Vencimiento de membresía");
  });

  it("General y En blanco", () => {
    expect(BUSINESS_TEMPLATES.general.caseTypes).toHaveLength(1);
    expect(BUSINESS_TEMPLATES.general.caseTypes[0].stages.map((s) => s.kind)).toEqual(["open", "resolved"]);
    expect(BUSINESS_TEMPLATES.blank.caseTypes).toEqual([]);
    expect(BUSINESS_TEMPLATES.blank.contactTypes).toEqual([]);
    expect(isBusinessTemplateKey("gym")).toBe(true);
    expect(isBusinessTemplateKey("restaurante")).toBe(false);
  });

  it("toda etapa abierta va antes que las de cierre y cada tipo tiene al menos una abierta", () => {
    for (const t of Object.values(BUSINESS_TEMPLATES)) {
      for (const ct of t.caseTypes) {
        const kinds = ct.stages.map((s) => s.kind);
        expect(kinds[0]).toBe("open");
        expect(kinds.lastIndexOf("open")).toBeLessThan(kinds.findIndex((k) => k !== "open"));
      }
    }
  });
});

describe("applyBusinessTemplate", () => {
  it("carga la plantilla con ids resueltos y guarda la configuración", async () => {
    const fake = freshDb();
    const result = await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "ecommerce");
    expect(result.added).toEqual({ contactTypes: 4, caseTypes: 4, stages: 18, categories: 5, reasons: 12, rules: 6 });

    const prospecto = fake.rows("contact_types").find((c) => c.name === "Prospecto")!;
    expect(prospecto.is_default).toBe(true);
    expect(fake.rows("contact_types").filter((c) => c.is_default)).toHaveLength(1);

    const venta = fake.rows("case_types").find((c) => c.name === "Venta")!;
    const recompra = fake.rows("case_types").find((c) => c.name === "Recompra")!;
    expect(venta.suggested_for_contact_type_ids).toEqual([prospecto.id]);
    expect(recompra.is_proactive).toBe(true);
    const stages = fake.rows("case_stages").filter((s) => s.case_type_id === venta.id);
    expect(stages.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(fake.rows("case_rules").filter((r) => r.case_type_id === venta.id).map((r) => r.params)).toContainEqual({
      case_type_id: recompra.id,
      days_after: 25,
    });
    expect(fake.rows("workspaces")[0].settings).toEqual({
      agent_visibility: "own",
      business_template: "ecommerce",
      key_date_label: "Última compra",
    });
  });

  it("es idempotente: aplicarla de nuevo no agrega nada", async () => {
    const fake = freshDb();
    const store = supabaseTemplateStore(fake.asDb());
    await applyTemplateWithStore(store, WS, "ecommerce");
    const before = counts(fake);
    const again = await applyTemplateWithStore(store, WS, "ecommerce");
    expect(again.added).toEqual(ZERO);
    expect(counts(fake)).toEqual(before);
  });

  it("nunca borra ni pisa: respeta renombres de mayúsculas o tildes, días editados y lo agregado a mano", async () => {
    const fake = freshDb();
    const store = supabaseTemplateStore(fake.asDb());
    await applyTemplateWithStore(store, WS, "ecommerce");

    const venta = fake.rows("case_types").find((c) => c.name === "Venta")!;
    venta.name = "  VENTA ";
    const regla = fake.rows("case_rules").find((r) => (r.params as Record<string, unknown>).days_after === 25 && r.case_type_id === venta.id)!;
    regla.params = { ...(regla.params as object), days_after: 40 };
    fake.seed("case_stages", [{ case_type_id: venta.id, name: "Etapa propia", kind: "open", position: 99 }]);
    fake.rows("contact_types").find((c) => c.name === "Inactivo")!.archived_at = "2026-10-01T00:00:00Z";
    const before = counts(fake);

    const again = await applyTemplateWithStore(store, WS, "ecommerce");
    expect(again.added).toEqual(ZERO);
    expect(counts(fake)).toEqual(before);
    expect(regla.params).toMatchObject({ days_after: 40 });
    expect(venta.name).toBe("  VENTA ");
  });

  it("agrega solo lo que falta (por ejemplo, una etapa borrada) y no repite el tipo de contacto por defecto", async () => {
    const fake = freshDb();
    const store = supabaseTemplateStore(fake.asDb());
    await applyTemplateWithStore(store, WS, "ecommerce");
    const venta = fake.rows("case_types").find((c) => c.name === "Venta")!;
    fake.tables.case_stages = fake.rows("case_stages").filter((s) => !(s.case_type_id === venta.id && s.name === "Asesorando"));

    const again = await applyTemplateWithStore(store, WS, "ecommerce");
    expect(again.added).toEqual({ ...ZERO, stages: 1 });
    const readded = fake.rows("case_stages").find((s) => s.case_type_id === venta.id && s.name === "Asesorando")!;
    // R2-16: ya no queda al final, después de las etapas de cierre.
    const closing = fake.rows("case_stages").filter((s) => s.case_type_id === venta.id && s.kind !== "open");
    expect(closing.every((c) => (c.position as number) > (readded.position as number))).toBe(true);
  });

  it("otra plantilla suma lo suyo sin duplicar nombres comunes ni cambiar la etiqueta de fecha clave", async () => {
    const fake = freshDb();
    const store = supabaseTemplateStore(fake.asDb());
    await applyTemplateWithStore(store, WS, "ecommerce");
    const result = await applyTemplateWithStore(store, WS, "gym");
    // "Prospecto" ya existía.
    expect(result.added.contactTypes).toBe(3);
    expect(fake.rows("contact_types").filter((c) => normalizeName(c.name as string) === "prospecto")).toHaveLength(1);
    expect(fake.rows("contact_types").filter((c) => c.is_default)).toHaveLength(1);
    expect(fake.rows("workspaces")[0].settings).toMatchObject({
      business_template: "gym",
      key_date_label: "Última compra",
    });
    // Idempotente también combinada.
    expect((await applyTemplateWithStore(store, WS, "gym")).added).toEqual(ZERO);
    expect((await applyTemplateWithStore(store, WS, "ecommerce")).added).toEqual(ZERO);
  });

  it("En blanco solo guarda la plantilla elegida", async () => {
    const fake = freshDb();
    const result = await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "blank");
    expect(result.added).toEqual(ZERO);
    expect(fake.rows("workspaces")[0].settings).toEqual({ agent_visibility: "own", business_template: "blank" });
  });

  it("General: un tipo sugerido para el tipo de contacto por defecto", async () => {
    const fake = freshDb();
    await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "general");
    const contacto = fake.rows("contact_types")[0];
    expect(contacto).toMatchObject({ name: "Contacto", is_default: true });
    expect(fake.rows("case_types")[0]).toMatchObject({ name: "General", suggested_for_contact_type_ids: [contacto.id] });
  });
});

describe("R2-16: volver a agregar una plantilla", () => {
  it("las etapas abiertas que faltan se insertan antes de las de cierre", async () => {
    const fake = freshDb();
    const store = supabaseTemplateStore(fake.asDb());
    await applyTemplateWithStore(store, WS, "ecommerce");
    const venta = fake.rows("case_types").find((c) => c.name === "Venta")!;
    const first = fake.rows("case_stages").filter((s) => s.case_type_id === venta.id).find((s) => s.kind === "open")!;
    fake.tables.case_stages = fake.rows("case_stages").filter((s) => s.id !== first.id);
    const again = await applyTemplateWithStore(store, WS, "ecommerce");
    expect(again.added.stages).toBe(1);
    const ordered = fake.rows("case_stages").filter((s) => s.case_type_id === venta.id).sort((a, b) => (a.position as number) - (b.position as number));
    const kinds = ordered.map((s) => s.kind);
    expect(kinds.lastIndexOf("open")).toBeLessThan(kinds.findIndex((k) => k !== "open"));
    expect(new Set(ordered.map((s) => s.position)).size).toBe(ordered.length);
    expect(ordered.map((s) => s.name)).toContain(first.name);
  });

  it("la vista previa dice qué se volvería a crear y no escribe nada", async () => {
    const fake = freshDb();
    const store = supabaseTemplateStore(fake.asDb());
    await applyTemplateWithStore(store, WS, "ecommerce");
    const venta = fake.rows("case_types").find((c) => c.name === "Venta")!;
    const rule = fake.rows("case_rules").find((r) => r.case_type_id === venta.id)!;
    fake.tables.case_rules = fake.rows("case_rules").filter((r) => r.id !== rule.id);
    const before = JSON.stringify(fake.tables);
    const preview = await previewTemplateWithStore(store, WS, "ecommerce");
    expect(preview.added.rules).toBe(1);
    expect(preview.details.some((d) => d.startsWith("Venta") && d.includes("1 regla"))).toBe(true);
    expect(JSON.stringify(fake.tables)).toBe(before);
    // Sin nada que volver a crear, la vista previa queda vacía.
    await applyTemplateWithStore(store, WS, "ecommerce");
    expect((await previewTemplateWithStore(store, WS, "ecommerce")).added).toEqual(ZERO);
  });
});
