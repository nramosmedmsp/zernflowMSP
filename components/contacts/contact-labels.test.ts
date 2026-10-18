import { describe, expect, it } from "vitest";
import { contactInitial, describeSource, keyDateLabel, normalizePhone } from "./contact-labels";
import { matchesContactFilters, type FilterableContact } from "./contact-filters";

describe("normalizePhone", () => {
  it("limpia espacios y acepta formatos comunes", () => {
    expect(normalizePhone("  +51   999 888 777 ")).toEqual({ ok: true, value: "+51 999 888 777" });
    expect(normalizePhone("(01) 555-1234")).toEqual({ ok: true, value: "(01) 555-1234" });
    expect(normalizePhone("999888777")).toEqual({ ok: true, value: "999888777" });
  });

  it("vacío o null quitan el teléfono", () => {
    expect(normalizePhone("   ")).toEqual({ ok: true, value: null });
    expect(normalizePhone(null)).toEqual({ ok: true, value: null });
    expect(normalizePhone(undefined)).toEqual({ ok: true, value: null });
  });

  it("rechaza letras, pocos o demasiados dígitos y tipos raros", () => {
    expect(normalizePhone("999-abc")).toMatchObject({ ok: false });
    expect(normalizePhone("12345")).toMatchObject({ ok: false });
    expect(normalizePhone("1234567890123456")).toMatchObject({ ok: false });
    expect(normalizePhone("999+888777")).toMatchObject({ ok: false });
    expect(normalizePhone(51999888777)).toMatchObject({ ok: false });
  });
});

describe("describeSource", () => {
  it("traduce las claves conocidas y deja las demás", () => {
    expect(describeSource({ channel: "whatsapp", campaign: "Verano", otro_dato: "x" })).toBe(
      "Canal: whatsapp · Campaña: Verano · otro dato: x",
    );
  });

  it("ignora vacíos, objetos anidados y valores que no son objeto", () => {
    expect(describeSource({})).toBe("");
    expect(describeSource({ a: "", b: null, c: { d: 1 } })).toBe("");
    expect(describeSource(null)).toBe("");
    expect(describeSource([1, 2])).toBe("");
    expect(describeSource(" Instagram ")).toBe("Instagram");
  });
});

describe("keyDateLabel e inicial", () => {
  it("usa la etiqueta configurada o 'Fecha clave'", () => {
    expect(keyDateLabel({ key_date_label: " Vencimiento de membresía " })).toBe("Vencimiento de membresía");
    expect(keyDateLabel({ key_date_label: "" })).toBe("Fecha clave");
    expect(keyDateLabel({})).toBe("Fecha clave");
    expect(keyDateLabel(null)).toBe("Fecha clave");
  });

  it("inicial del avatar", () => {
    expect(contactInitial(" ana")).toBe("A");
    expect(contactInitial(null)).toBe("?");
    expect(contactInitial("")).toBe("?");
  });
});

describe("filtros de la lista de contactos", () => {
  const base: FilterableContact = {
    display_name: "María Pérez",
    email: "maria@correo.pe",
    phone: "+51 999 111 222",
    contact_type_id: "k-lead",
    owner_id: "u-ana",
    team_id: null,
    contact_tags: [{ tag_id: "vip" }],
  };
  const none = { search: "", tagId: null, contactTypeId: "", ownerId: "", teamId: "" };

  it("sin filtros deja pasar todo", () => {
    expect(matchesContactFilters(base, none)).toBe(true);
  });

  it("busca por nombre, correo o teléfono sin distinguir mayúsculas", () => {
    expect(matchesContactFilters(base, { ...none, search: "PÉREZ" })).toBe(true);
    expect(matchesContactFilters(base, { ...none, search: "correo.pe" })).toBe(true);
    expect(matchesContactFilters(base, { ...none, search: "999 111" })).toBe(true);
    expect(matchesContactFilters(base, { ...none, search: "otro" })).toBe(false);
  });

  it("filtra por tipo, responsable, equipo y etiqueta", () => {
    expect(matchesContactFilters(base, { ...none, contactTypeId: "k-lead" })).toBe(true);
    expect(matchesContactFilters(base, { ...none, contactTypeId: "k-cliente" })).toBe(false);
    expect(matchesContactFilters(base, { ...none, contactTypeId: "none" })).toBe(false);
    expect(matchesContactFilters(base, { ...none, ownerId: "u-ana" })).toBe(true);
    expect(matchesContactFilters(base, { ...none, ownerId: "u-beto" })).toBe(false);
    expect(matchesContactFilters(base, { ...none, teamId: "none" })).toBe(true);
    expect(matchesContactFilters(base, { ...none, teamId: "t-a" })).toBe(false);
    expect(matchesContactFilters(base, { ...none, tagId: "vip" })).toBe(true);
    expect(matchesContactFilters(base, { ...none, tagId: "otra" })).toBe(false);
    expect(matchesContactFilters({ ...base, owner_id: null }, { ...none, ownerId: "none" })).toBe(true);
  });

  it("combina todos los filtros", () => {
    expect(
      matchesContactFilters(base, { search: "maría", tagId: "vip", contactTypeId: "k-lead", ownerId: "u-ana", teamId: "none" }),
    ).toBe(true);
    expect(
      matchesContactFilters(base, { search: "maría", tagId: "vip", contactTypeId: "k-lead", ownerId: "u-beto", teamId: "none" }),
    ).toBe(false);
  });
});
