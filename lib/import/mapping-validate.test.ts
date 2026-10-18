import { describe, expect, it } from "vitest";
import { autoMapColumns, customKey, mapRows, normalizeHeader } from "./mapping";
import { sanitizeImportOptions, sanitizeImportRows } from "./sanitize";
import {
  buildErrorsCsvRows,
  findFileDuplicates,
  splitTags,
  summarizeRows,
  validateImportRow,
  type ImportLookups,
  type ImportOptions,
} from "./validate";

describe("autoMapColumns", () => {
  it("detecta encabezados en español", () => {
    const m = autoMapColumns(["Nombre completo", "Teléfono", "Correo electrónico", "Tipo", "Sede", "Asesor", "Fecha de vencimiento", "Etiquetas"]);
    expect(m).toMatchObject({ name: 0, phone: 1, email: 2, type: 3, team: 4, owner: 5, keyDate: 6, tags: 7 });
  });
  it("detecta encabezados en inglés", () => {
    const m = autoMapColumns(["Full Name", "Phone", "Email", "Contact Type", "Branch", "Owner", "Key date", "Tags"]);
    expect(m).toMatchObject({ name: 0, phone: 1, email: 2, type: 3, team: 4, owner: 5, keyDate: 6, tags: 7 });
  });
  it("el correo del responsable no se confunde con el correo del contacto", () => {
    const m = autoMapColumns(["Correo responsable", "Correo", "Nombre"]);
    expect(m.owner).toBe(0);
    expect(m.email).toBe(1);
    expect(m.name).toBe(2);
  });
  it("deja sin mapear lo que no encuentra y no repite columnas", () => {
    const m = autoMapColumns(["Celular", "Otra cosa"]);
    expect(m.phone).toBe(0);
    expect(m.name).toBeNull();
    expect(Object.values(m).filter((v) => v === 0)).toHaveLength(1);
  });
  it("mapea campos personalizados por slug o nombre", () => {
    const m = autoMapColumns(
      ["DNI", "plan"],
      [
        { slug: "dni", name: "DNI" },
        { slug: "plan_mensual", name: "Plan" },
      ],
    );
    expect(m[customKey("dni")]).toBe(0);
    expect(m[customKey("plan_mensual")]).toBe(1);
  });
  it("normalizeHeader quita tildes y símbolos", () => {
    expect(normalizeHeader(" Teléfono (móvil) ")).toBe("telefono movil");
  });
});

describe("mapRows", () => {
  it("arma las filas con número de línea del archivo", () => {
    const mapping = autoMapColumns(["Nombre", "Celular", "DNI"], [{ slug: "dni", name: "DNI" }]);
    const rows = mapRows(
      [
        ["Ana", "987654321", "123"],
        ["", "", ""],
      ],
      mapping,
    );
    expect(rows[0]).toEqual({ line: 2, values: { name: "Ana", phone: "987654321" }, custom: { dni: "123" } });
    expect(rows[1].line).toBe(3);
    expect(rows[1].values).toEqual({});
  });
});

const lookups: ImportLookups = {
  types: [
    { id: "t1", name: "Socio", archived: false },
    { id: "t2", name: "Antiguo", archived: true },
  ],
  teams: [{ id: "e1", name: "Sede Centro" }],
  members: [{ userId: "u1", email: "asesor@gym.pe" }],
  tags: [{ id: "g1", name: "Verano" }],
  customFields: [{ id: "c1", slug: "dni" }],
  existingByPhone: new Map([["51987654321", "k1"]]),
  existingByEmail: new Map([["luis@x.pe", "k2"]]),
};
const options: ImportOptions = { existing: "skip", createTags: true, channelId: null, scheduleCases: false };
const row = (
  values: Record<string, string>,
  extra: Partial<{ line: number; custom: Record<string, string>; fileDuplicateOf: number | null }> = {},
) => ({
  line: extra.line ?? 2,
  values,
  custom: extra.custom ?? {},
  fileDuplicateOf: extra.fileDuplicateOf ?? null,
});

describe("validateImportRow", () => {
  it("crea un contacto nuevo con todo resuelto", () => {
    const r = validateImportRow(
      row(
        {
          name: "Ana",
          phone: "999111222",
          email: "ANA@X.PE",
          type: "socio",
          team: "sede centro",
          owner: "Asesor@gym.pe",
          keyDate: "15/03/2026",
          tags: "Verano|Nueva|verano",
        },
        { custom: { dni: "123", otro: "x" } },
      ),
      lookups,
      options,
    );
    expect(r.status).toBe("create");
    expect(r.contact).toMatchObject({
      displayName: "Ana",
      phone: "+51999111222",
      email: "ana@x.pe",
      contactTypeId: "t1",
      teamId: "e1",
      ownerId: "u1",
      keyDate: "2026-03-15",
      tagNames: ["Verano", "Nueva"],
      customValues: [{ fieldId: "c1", value: "123" }],
    });
    expect(r.warnings).toEqual([]);
  });
  it("marca valores desconocidos con aviso sin descartar la fila", () => {
    const r = validateImportRow(row({ phone: "999111222", type: "VIP", team: "Norte", owner: "otro@x.pe" }), lookups, options);
    expect(r.status).toBe("create");
    expect(r.warnings).toHaveLength(3);
    expect(r.contact.contactTypeId).toBeNull();
    const archived = validateImportRow(row({ phone: "999111222", type: "Antiguo" }), lookups, options);
    expect(archived.warnings[0]).toMatch(/archivado/);
  });
  it("avisa de etiquetas inexistentes cuando no se crean", () => {
    const r = validateImportRow(row({ phone: "999111222", tags: "Verano|Nueva" }), lookups, { ...options, createTags: false });
    expect(r.warnings.join(" ")).toMatch(/Nueva/);
    expect(r.warnings.join(" ")).not.toMatch(/Verano/);
  });
  it("es error si el teléfono, el correo o la fecha no son válidos, o falta contacto", () => {
    expect(validateImportRow(row({ phone: "123" }), lookups, options).status).toBe("error");
    expect(validateImportRow(row({ email: "no-es-correo" }), lookups, options).status).toBe("error");
    expect(validateImportRow(row({ phone: "999111222", keyDate: "31/02/2026" }), lookups, options).status).toBe("error");
    const sin = validateImportRow(row({ name: "Solo nombre" }), lookups, options);
    expect(sin.status).toBe("error");
    expect(sin.errors[0]).toMatch(/teléfono o un correo/);
  });
  it("detecta existentes por teléfono y luego por correo", () => {
    const byPhone = validateImportRow(row({ phone: "987654321", email: "luis@x.pe" }), lookups, options);
    expect(byPhone).toMatchObject({ status: "skip", existingId: "k1", matchedBy: "phone" });
    const byEmail = validateImportRow(row({ phone: "999000111", email: "luis@x.pe" }), lookups, { ...options, existing: "update" });
    expect(byEmail).toMatchObject({ status: "update", existingId: "k2", matchedBy: "email" });
  });
  it("salta las duplicadas del archivo", () => {
    const r = validateImportRow(row({ phone: "999111222" }, { fileDuplicateOf: 2 }), lookups, options);
    expect(r.status).toBe("skip");
    expect(r.skipReason).toMatch(/fila 2/);
  });
});

describe("findFileDuplicates", () => {
  it("encuentra repetidos por teléfono (con distinto formato) y por correo", () => {
    const rows = [
      row({ phone: "987654321", email: "a@x.pe" }, { line: 2 }),
      row({ phone: "+51 987 654 321" }, { line: 3 }),
      row({ phone: "999000111", email: "A@x.pe" }, { line: 4 }),
      row({ phone: "999000222", email: "b@x.pe" }, { line: 5 }),
      row({ email: "b@x.pe" }, { line: 6 }),
    ];
    const dups = findFileDuplicates(rows);
    expect([...dups.entries()]).toEqual([
      [3, 2],
      [4, 2],
      [6, 5],
    ]);
  });
});

describe("resumen, etiquetas y errores", () => {
  it("cuenta por estado", () => {
    const rows = [
      validateImportRow(row({ phone: "999111222", type: "VIP" }), lookups, options),
      validateImportRow(row({ phone: "123" }), lookups, options),
      validateImportRow(row({ phone: "987654321" }), lookups, options),
    ];
    expect(summarizeRows(rows)).toEqual({ total: 3, create: 1, update: 0, skip: 1, error: 1, withWarnings: 1 });
  });
  it("splitTags separa por | y quita repetidas", () => {
    expect(splitTags(" a | b |A||c ")).toEqual(["a", "b", "c"]);
    expect(splitTags(undefined)).toEqual([]);
  });
  it("arma el CSV de errores con la fila original y el motivo", () => {
    const out = buildErrorsCsvRows(
      ["n", "t"],
      [
        ["Ana", "1"],
        ["Luis", "2"],
      ],
      [{ line: 3, message: "malo" }],
    );
    expect(out).toEqual([
      ["n", "t", "error"],
      ["Luis", "2", "malo"],
    ]);
  });
});

describe("sanitize", () => {
  it("rechaza lotes grandes o mal formados y recorta valores", () => {
    expect(sanitizeImportRows("x")).toBeNull();
    expect(sanitizeImportRows(Array.from({ length: 201 }, (_, i) => ({ line: i + 2 })))).toBeNull();
    expect(sanitizeImportRows([{ line: 1 }])).toBeNull();
    const ok = sanitizeImportRows([{ line: 2, values: { name: " Ana ", extra: "x" }, custom: { dni: "1", "mal slug!": "2" } }]);
    expect(ok).toEqual([{ line: 2, values: { name: "Ana" }, custom: { dni: "1" }, fileDuplicateOf: null }]);
  });
  it("normaliza las opciones", () => {
    expect(sanitizeImportOptions({ existing: "update", channelId: "no-uuid" })).toBeNull();
    expect(sanitizeImportOptions({ existing: "x", scheduleCases: true })).toEqual({
      existing: "skip",
      createTags: true,
      channelId: null,
      scheduleCases: true,
    });
  });
});
