import { describe, expect, it } from "vitest";
import {
  applyContactListQuery,
  cleanSearch,
  contactListHref,
  contactListSelect,
  contactPageCount,
  contactPageRange,
  parseContactListParams,
  type ContactListParams,
  type ContactQueryBuilder,
} from "./contact-list-query";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";

class Recorder implements ContactQueryBuilder {
  calls: [string, ...unknown[]][] = [];
  private rec(name: string, ...args: unknown[]) {
    this.calls.push([name, ...args]);
    return this;
  }
  eq(c: string, v: string) {
    return this.rec("eq", c, v);
  }
  is(c: string, v: null) {
    return this.rec("is", c, v);
  }
  or(f: string) {
    return this.rec("or", f);
  }
  gte(c: string, v: string) {
    return this.rec("gte", c, v);
  }
  lte(c: string, v: string) {
    return this.rec("lte", c, v);
  }
  order(c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) {
    return this.rec("order", c, o);
  }
  range(a: number, b: number) {
    return this.rec("range", a, b);
  }
}

const defaults = parseContactListParams({});

describe("parseContactListParams", () => {
  it("usa valores por defecto", () => {
    expect(defaults).toEqual({
      search: "",
      typeId: "",
      ownerId: "",
      teamId: "",
      tagId: "",
      keyFrom: "",
      keyTo: "",
      sort: "recent",
      dir: "desc",
      page: 1,
    });
  });
  it("lee filtros válidos y descarta los inválidos", () => {
    const p = parseContactListParams({
      q: "  ana ",
      type: T,
      owner: "none",
      team: "basura",
      tag: U,
      from: "2026-01-01",
      to: "2026-02-30",
      sort: "name",
      page: "3",
    });
    expect(p).toMatchObject({
      search: "ana",
      typeId: T,
      ownerId: "none",
      teamId: "",
      tagId: U,
      keyFrom: "2026-01-01",
      keyTo: "",
      sort: "name",
      dir: "asc",
      page: 3,
    });
  });
  it("corrige página y orden inválidos, y acepta URLSearchParams", () => {
    expect(parseContactListParams({ page: "-4", sort: "zzz" })).toMatchObject({ page: 1, sort: "recent" });
    expect(parseContactListParams({ page: ["2", "5"] }).page).toBe(2);
    expect(parseContactListParams(new URLSearchParams("q=hola&dir=asc")).dir).toBe("asc");
  });
});

describe("contactListHref", () => {
  it("omite lo que está por defecto y se puede volver a leer", () => {
    expect(contactListHref(defaults)).toBe("/dashboard/contacts");
    const p: ContactListParams = { ...defaults, search: "ana lópez", typeId: T, sort: "key_date", dir: "desc", page: 2 };
    const href = contactListHref(p);
    expect(href).toContain("q=ana+l%C3%B3pez");
    expect(href).toContain("sort=key_date");
    expect(href).toContain("dir=desc");
    expect(parseContactListParams(new URL(href, "http://x").searchParams)).toEqual(p);
  });
});

describe("applyContactListQuery", () => {
  it("sin filtros solo ordena y pagina (primera página de 50)", () => {
    const q = applyContactListQuery(new Recorder(), defaults);
    expect(q.calls).toEqual([
      ["order", "last_interaction_at", { ascending: false, nullsFirst: false }],
      ["order", "id", { ascending: true }],
      ["range", 0, 49],
    ]);
  });
  it("busca por nombre, correo o teléfono y limpia caracteres que rompen el filtro", () => {
    const q = applyContactListQuery(new Recorder(), { ...defaults, search: 'a,b(c)"d' });
    expect(q.calls[0]).toEqual(["or", "display_name.ilike.%a b c d%,email.ilike.%a b c d%,phone.ilike.%a b c d%"]);
    expect(cleanSearch("  x*y  ")).toBe("x y");
  });
  it("aplica tipo, responsable, equipo, etiqueta y rango de fecha clave", () => {
    const q = applyContactListQuery(new Recorder(), {
      ...defaults,
      typeId: T,
      ownerId: "none",
      teamId: U,
      tagId: T,
      keyFrom: "2026-01-01",
      keyTo: "2026-01-31",
    });
    expect(q.calls.slice(0, 6)).toEqual([
      ["eq", "contact_type_id", T],
      ["is", "owner_id", null],
      ["eq", "team_id", U],
      ["eq", "tag_filter.tag_id", T],
      ["gte", "key_date", "2026-01-01"],
      ["lte", "key_date", "2026-01-31"],
    ]);
  });
  it("ordena por nombre, creación o fecha clave y pagina", () => {
    expect(applyContactListQuery(new Recorder(), { ...defaults, sort: "name", dir: "asc", page: 3 }).calls).toEqual([
      ["order", "display_name", { ascending: true, nullsFirst: false }],
      ["order", "id", { ascending: true }],
      ["range", 100, 149],
    ]);
    expect(applyContactListQuery(new Recorder(), { ...defaults, sort: "created" }).calls[0]).toEqual([
      "order",
      "created_at",
      { ascending: false },
    ]);
    expect(applyContactListQuery(new Recorder(), { ...defaults, sort: "key_date", dir: "asc" }).calls[0]).toEqual([
      "order",
      "key_date",
      { ascending: true, nullsFirst: false },
    ]);
  });
  it("el join por etiqueta solo se agrega cuando hay etiqueta", () => {
    expect(contactListSelect(defaults)).not.toContain("tag_filter");
    expect(contactListSelect({ ...defaults, tagId: T })).toContain("tag_filter:contact_tags!inner(tag_id)");
  });
});

describe("paginación", () => {
  it("calcula rango y número de páginas", () => {
    expect(contactPageRange(1)).toEqual({ from: 0, to: 49 });
    expect(contactPageRange(2)).toEqual({ from: 50, to: 99 });
    expect(contactPageCount(0)).toBe(1);
    expect(contactPageCount(50)).toBe(1);
    expect(contactPageCount(51)).toBe(2);
    expect(contactPageCount(1234)).toBe(25);
  });
});
