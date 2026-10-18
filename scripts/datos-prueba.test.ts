import { describe, expect, it } from "vitest";
import { BUSINESS_TEMPLATES } from "@/lib/business-templates";
import { demoTemplateText } from "@/lib/demo";
import {
  ADVISORS,
  CASES,
  CHANNELS,
  CONTACTS,
  CONTACT_ASSIGNMENTS,
  CONVERSATIONS,
  DEMO_DATA_KEY,
  DEMO_EMAIL_DOMAIN,
  DEMO_SUFFIX,
  NOTES,
  NOTIFICATIONS,
  ROUTING_OVERRIDES,
  SAVED_REPLIES,
  TEAMS,
  buildCase,
  buildConversation,
  buildContact,
  chunk,
  contactDisplayName,
  contactEmail,
  contactPhone,
  contactSenderId,
  deletionCount,
  deletionPlan,
  deriveCaseStamps,
  emptyDemoData,
  fillNames,
  hasDemoData,
  keyDatesByContact,
  limaAtIso,
  limaDate,
  markerProblems,
  previewOf,
  savedReplyTitle,
  withContactTypeChanges,
  withDemoData,
  withoutDemoData,
} from "./datos-prueba-lib.mjs";

const NOW = new Date("2026-10-18T17:30:00.000Z"); // 12:30 en Lima
const DAY = 1440;

const ecommerce = BUSINESS_TEMPLATES.ecommerce;
const typeDef = (name: string) => {
  const t = ecommerce.caseTypes.find((c) => c.name === name);
  if (!t) throw new Error(`tipo ${name}`);
  return t;
};

/** Resolvedor con ids simbólicos sobre la plantilla E-commerce real. */
function fakeIds() {
  return {
    contact: (k: string) => `contact:${k}`,
    advisor: (k: string) => `advisor:${k}`,
    team: (k: string) => `team:${k}`,
    contactType: (n: string) => `ctype:${n}`,
    type: (n: string) => `type:${n}`,
    stage: (t: string, n: string) => {
      if (!typeDef(t).stages.some((s) => s.name === n)) throw new Error(`etapa ${t}/${n}`);
      return `stage:${t}:${n}`;
    },
    category: (t: string, n: string) => {
      if (!typeDef(t).categories?.some((c) => c.name === n)) throw new Error(`categoría ${t}/${n}`);
      return `cat:${t}:${n}`;
    },
    reason: (t: string, n: string) => {
      if (!typeDef(t).reasons?.some((r) => r.name === n)) throw new Error(`motivo ${t}/${n}`);
      return `reason:${t}:${n}`;
    },
    openStages: (t: string) => typeDef(t).stages.filter((s) => s.kind === "open").map((s) => s.name),
  };
}

function conversationOf(contactKey: string) {
  const spec = CONVERSATIONS.find((c) => c.contact === contactKey);
  if (!spec) return null;
  const contact = CONTACTS.find((c) => c.key === contactKey)!;
  return buildConversation(spec, {
    now: NOW,
    advisorId: (k: string) => `advisor:${k}`,
    contactName: `${contact.first} ${contact.last}`,
  });
}

function buildAll() {
  const ids = fakeIds();
  return withContactTypeChanges(CASES).map((spec) => {
    const contact = CONTACTS.find((c) => c.key === spec.contact)!;
    const conversation = conversationOf(spec.contact);
    return {
      spec,
      ...buildCase(spec, {
        workspaceId: "ws",
        now: NOW,
        ids,
        ownerId: "owner",
        conversation,
        conversationId: conversation ? `conv:${spec.contact}` : null,
        contactFirstName: contact.first,
      }),
    };
  });
}

describe("marcas de los datos de prueba", () => {
  it("todo lo que se crea queda marcado", () => {
    expect(markerProblems()).toEqual([]);
  });

  it("asesores, equipos y canales siguen lo pedido", () => {
    expect(ADVISORS).toHaveLength(4);
    expect(ADVISORS.every((a) => a.name.endsWith(DEMO_SUFFIX) && a.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`))).toBe(true);
    const byTeam = (team: string) => ADVISORS.filter((a) => a.team === team);
    expect(byTeam("ventas")).toHaveLength(2);
    expect(byTeam("atencion")).toHaveLength(2);
    expect(byTeam("ventas").filter((a) => a.teamRole === "supervisor")).toHaveLength(1);
    expect(ADVISORS.filter((a) => a.availability === "away")).toHaveLength(1);
    expect(TEAMS.map((t) => [t.name, t.assignment_mode, t.wantsDefault])).toEqual([
      ["Ventas (Prueba)", "round_robin", true],
      ["Atención (Prueba)", "least_load", false],
    ]);
    expect(CHANNELS.map((c) => c.platform).sort()).toEqual(["instagram", "whatsapp"]);
    expect(CHANNELS.every((c) => c.late_account_id.startsWith("demo-"))).toBe(true);
    expect(ROUTING_OVERRIDES).toEqual([{ caseType: "Postventa", routing: "fixed_team", team: "atencion" }]);
  });

  it("20 contactos peruanos con teléfono +51 9xx, correos de prueba y tipos de la plantilla", () => {
    expect(CONTACTS).toHaveLength(20);
    const phones = CONTACTS.map((_, i) => contactPhone(i));
    expect(new Set(phones).size).toBe(20);
    for (const p of phones) expect(p).toMatch(/^\+519\d{8}$/);
    const types = new Set(ecommerce.contactTypes.map((t) => t.name));
    for (const c of CONTACTS) {
      expect(types.has(c.type)).toBe(true);
      expect(contactDisplayName(c).endsWith(DEMO_SUFFIX)).toBe(true);
      const email = contactEmail(c);
      if (email) expect(email).toMatch(new RegExp(`^[a-z0-9.]+@${DEMO_EMAIL_DOMAIN.replace(".", "\\.")}$`));
    }
    expect(new Set(CONTACTS.map((c) => c.type))).toEqual(new Set(["Prospecto", "Cliente", "Cliente frecuente", "Inactivo"]));
    expect(new Set(CONTACTS.flatMap((c) => c.tags))).toEqual(new Set(["Proteína", "Creatina", "Pre-entreno", "Mayorista"]));
    expect(new Set(CONTACTS.map((c) => c.key)).size).toBe(20);
    expect(Object.keys(CONTACT_ASSIGNMENTS).every((k) => CONTACTS.some((c) => c.key === k))).toBe(true);
  });

  it("los senderId de WhatsApp son solo dígitos y los de Instagram llevan el prefijo demo-", () => {
    CONTACTS.forEach((c, i) => {
      const sender = contactSenderId(c, i);
      if (c.channel === "wa") expect(sender).toMatch(/^519\d{8}$/);
      else expect(sender.startsWith("demo-")).toBe(true);
    });
    const all = CONTACTS.map((c, i) => `${c.channel}:${contactSenderId(c, i)}`);
    expect(new Set(all).size).toBe(all.length);
  });

  it("las respuestas guardadas llevan la marca y atajos válidos", () => {
    expect(SAVED_REPLIES.filter((r) => r.scope === "workspace").length).toBeGreaterThanOrEqual(4);
    expect(SAVED_REPLIES.filter((r) => r.scope === "personal")).toHaveLength(2);
    for (const r of SAVED_REPLIES) {
      expect(savedReplyTitle(r).endsWith(DEMO_SUFFIX)).toBe(true);
      expect(r.shortcut).toMatch(/^[a-z0-9_-]+$/);
    }
    const topics = SAVED_REPLIES.map((r) => r.title.toLowerCase()).join(" | ");
    for (const word of ["precios", "envíos", "pago", "horarios"]) expect(topics).toContain(word);
  });
});

describe("coherencia con la plantilla E-commerce", () => {
  it("las gestiones usan tipos, etapas, categorías y motivos que existen", () => {
    const ids = fakeIds();
    for (const c of CASES) {
      if (!c.type) {
        expect(c.stage).toBeNull();
        continue;
      }
      expect(() => ids.type(c.type!)).not.toThrow();
      expect(() => ids.stage(c.type!, c.stage!)).not.toThrow();
      if (c.reached) expect(() => ids.stage(c.type!, c.reached!)).not.toThrow();
      if (c.category) expect(() => ids.category(c.type!, c.category!)).not.toThrow();
      if (c.reason) expect(() => ids.reason(c.type!, c.reason!)).not.toThrow();
    }
  });

  it("la etapa final coincide con el estado y los motivos son de pérdida", () => {
    for (const c of CASES.filter((x) => x.type)) {
      const stage = typeDef(c.type!).stages.find((s) => s.name === c.stage)!;
      if (c.status === "open" || c.status === "scheduled") expect(stage.kind).toBe("open");
      else expect(stage.kind).toBe(c.status);
      if (c.reason) {
        const reason = typeDef(c.type!).reasons!.find((r) => r.name === c.reason)!;
        expect(reason.kind).toBe("lost");
        expect(c.status).toBe("lost");
      }
      // Venta y Recompra pierden con motivo (requireOutcomeReason).
      if (c.status === "lost" && typeDef(c.type!).requireOutcomeReason) expect(c.reason).toBeTruthy();
    }
  });

  it("los tipos de contacto finales siguen las reglas de la plantilla (1.ª ganada Cliente, 2.ª frecuente)", () => {
    const wins = new Map<string, number>();
    for (const c of CASES.filter((x) => x.status === "won")) wins.set(c.contact, (wins.get(c.contact) ?? 0) + 1);
    for (const contact of CONTACTS) {
      const n = wins.get(contact.key) ?? 0;
      if (contact.type === "Cliente frecuente") expect(n).toBeGreaterThanOrEqual(2);
      if (contact.type === "Cliente") expect(n).toBeGreaterThanOrEqual(1);
      if (contact.type === "Prospecto") expect(n).toBe(0);
    }
  });
});

describe("cobertura de gestiones", () => {
  it("hay gestiones en todos los estados y en cada etapa abierta de Venta", () => {
    expect(new Set(CASES.map((c) => c.status))).toEqual(new Set(["open", "scheduled", "won", "lost", "resolved"]));
    const ventaOpen = CASES.filter((c) => c.type === "Venta" && c.status === "open").map((c) => c.stage);
    expect(new Set(ventaOpen)).toEqual(new Set(typeDef("Venta").stages.filter((s) => s.kind === "open").map((s) => s.name)));
    expect(CASES.filter((c) => c.type === null && c.status === "open").length).toBeGreaterThanOrEqual(2);
    const postventa = CASES.filter((c) => c.type === "Postventa" && c.status === "open");
    expect(new Set(postventa.map((c) => c.category)).size).toBeGreaterThanOrEqual(3);
    expect(CASES.some((c) => c.type === "Consulta" && c.status === "open")).toBe(true);
  });

  it("hay abiertas asignadas y sin asignar, con esperas de minutos a días", () => {
    const open = buildAll().filter((x) => x.row.status === "open");
    expect(open.some((x) => x.row.assignee_id === null)).toBe(true);
    expect(open.some((x) => x.row.assignee_id !== null)).toBe(true);
    const waits = open
      .filter((x) => x.row.waiting_since)
      .map((x) => (NOW.getTime() - new Date(x.row.waiting_since as string).getTime()) / 60000);
    expect(Math.min(...waits)).toBeLessThan(15);
    expect(Math.max(...waits)).toBeGreaterThan(2 * 60);
    expect(Math.max(...waits)).toBeGreaterThan(DAY);
  });

  it("hay próximos contactos para hoy y vencidos", () => {
    const rows = buildAll().map((x) => x.row);
    const todayLima = limaDate(NOW.toISOString());
    const dated = rows.filter((r) => r.next_action_at);
    expect(dated.some((r) => new Date(r.next_action_at as string) > NOW && limaDate(r.next_action_at as string) === todayLima)).toBe(true);
    expect(dated.some((r) => new Date(r.next_action_at as string) < NOW)).toBe(true);
  });

  it("las recompras programadas son para hoy y para los próximos días", () => {
    const scheduled = buildAll().filter((x) => x.row.status === "scheduled").map((x) => x.row);
    expect(scheduled.length).toBeGreaterThanOrEqual(4);
    const todayLima = limaDate(NOW.toISOString());
    const days = scheduled.map((r) => limaDate(r.scheduled_for as string));
    expect(days.filter((d) => d === todayLima).length).toBeGreaterThanOrEqual(2);
    expect(days.some((d) => d > todayLima)).toBe(true);
    for (const r of scheduled) {
      expect(new Date(r.scheduled_for as string).getTime()).toBeGreaterThan(NOW.getTime());
      expect(r.opened_at).toBeNull();
      expect(r.case_type_id).toBe("type:Recompra");
    }
  });

  it("las cerradas están en los últimos 30 días, con motivos y notas, y tiempos coherentes", () => {
    const closed = buildAll().filter((x) => ["won", "lost", "resolved"].includes(x.row.status as string));
    expect(closed.length).toBeGreaterThanOrEqual(15);
    expect(new Set(closed.map((x) => x.row.status))).toEqual(new Set(["won", "lost", "resolved"]));
    for (const { row, spec } of closed) {
      const opened = new Date(row.opened_at as string).getTime();
      const closedAt = new Date(row.closed_at as string).getTime();
      expect(closedAt).toBeGreaterThan(opened);
      expect(closedAt).toBeLessThanOrEqual(NOW.getTime());
      expect(NOW.getTime() - closedAt).toBeLessThanOrEqual(30 * DAY * 60000);
      expect(row.waiting_since).toBeNull();
      expect(row.outcome_note, spec.key).toBeTruthy();
      expect(row.closed_by).toBeTruthy();
      const fr = row.first_response_at ? new Date(row.first_response_at as string).getTime() : null;
      expect(fr, `${spec.key} sin primera respuesta`).not.toBeNull();
      expect(fr!).toBeGreaterThanOrEqual(opened);
      expect(fr!).toBeLessThanOrEqual(closedAt);
      if (row.status === "lost" && spec.reason) expect(row.outcome_reason_id).toBe(`reason:${spec.type}:${spec.reason}`);
    }
    expect(closed.filter((x) => x.row.status === "lost" && x.row.outcome_reason_id).length).toBeGreaterThanOrEqual(4);
  });

  it("respeta las restricciones de la tabla cases (estado y fechas)", () => {
    for (const { row, spec } of buildAll()) {
      if (row.status === "scheduled") expect(row.scheduled_for, spec.key).toBeTruthy();
      if (["won", "lost", "resolved", "cancelled"].includes(row.status as string)) expect(row.closed_at, spec.key).toBeTruthy();
      expect(["open", "scheduled", "won", "lost", "resolved"]).toContain(row.status);
      expect(["inbound", "proactive", "manual"]).toContain(row.origin);
      expect(["low", "normal", "high", "urgent"]).toContain(row.priority);
      if (row.assignee_id) expect(row.assigned_at).toBeTruthy();
      if (row.case_type_id === null) {
        expect(row.stage_id).toBeNull();
        expect(row.category_id).toBeNull();
      }
    }
    // Un contacto no tiene dos gestiones abiertas a la vez.
    const open = buildAll().filter((x) => x.row.status === "open").map((x) => x.row.contact_id);
    expect(new Set(open).size).toBe(open.length);
  });

  it("Recompra abierta con plantilla automática deja su sello y su registro", () => {
    const all = buildAll();
    const milagros = all.find((x) => x.spec.key === "r-milagros")!;
    expect(milagros.row.auto_template_sent_at).toBe(milagros.row.opened_at);
    expect(milagros.activities.map((a) => a.type)).toEqual(
      expect.arrayContaining(["case_scheduled", "case_activated", "auto_template_sent", "assigned"]),
    );
    expect(milagros.row.waiting_since).toBeNull();
  });
});

describe("registro de actividad", () => {
  it("cada gestión tiene su historia en orden cronológico", () => {
    const all = buildAll();
    for (const { row, activities, spec } of all) {
      expect(activities.length, spec.key).toBeGreaterThan(0);
      const times = activities.map((a) => new Date(a.created_at).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      for (const a of activities) {
        expect(a.workspace_id).toBe("ws");
        expect(a.contact_id).toBe(row.contact_id);
      }
      const types = activities.map((a) => a.type);
      if (row.status === "scheduled") expect(types).toEqual(["case_scheduled"]);
      else if (spec.origin === "proactive") expect(types).toContain("case_activated");
      else expect(types).toContain("case_opened");
      if (row.assignee_id) expect(types).toContain("assigned");
      if (row.first_response_at) expect(types).toContain("first_response");
      if (row.closed_at) expect(types).toContain("case_closed");
    }
  });

  it("incluye todos los tipos de actividad pedidos", () => {
    const types = new Set(buildAll().flatMap((x) => x.activities.map((a) => a.type)));
    for (const t of ["case_opened", "assigned", "stage_changed", "first_response", "case_closed", "contact_type_changed", "next_action_set"]) {
      expect(types.has(t), t).toBe(true);
    }
  });

  it("los cambios de etapa recorren las etapas abiertas del tipo", () => {
    const venta = buildAll().find((x) => x.spec.key === "v-renzo")!;
    const changes = venta.activities.filter((a) => a.type === "stage_changed");
    expect(changes.map((a) => [a.from_value, a.to_value])).toEqual([
      ["stage:Venta:Nuevo interesado", "stage:Venta:Asesorando"],
      ["stage:Venta:Asesorando", "stage:Venta:Pedido o enlace de pago enviado"],
      ["stage:Venta:Pedido o enlace de pago enviado", "stage:Venta:Esperando pago"],
    ]);
  });

  it("el cambio de tipo de contacto sale de las gestiones ganadas (1.ª Cliente, 2.ª frecuente)", () => {
    const changes = buildAll().flatMap((x) => x.activities.filter((a) => a.type === "contact_type_changed").map((a) => ({ contact: x.row.contact_id, a })));
    const andrea = changes.filter((c) => c.contact === "contact:andrea").map((c) => c.a.to_value);
    expect(andrea).toEqual(["ctype:Cliente", "ctype:Cliente frecuente"]);
    const hugo = changes.filter((c) => c.contact === "contact:hugo").map((c) => c.a.to_value);
    expect(hugo).toEqual(["ctype:Cliente", "ctype:Cliente frecuente"]);
  });
});

describe("conversaciones", () => {
  it("cada conversación pertenece a un contacto y sus mensajes salen ordenados", () => {
    for (const spec of CONVERSATIONS) {
      expect(CONTACTS.some((c) => c.key === spec.contact)).toBe(true);
      const built = conversationOf(spec.contact)!;
      const times = built.messages.map((m: { created_at: string }) => new Date(m.created_at).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(built.messages.length).toBe(spec.messages.length);
      expect(built.messages.every((m: { created_at: string }) => new Date(m.created_at) <= NOW)).toBe(true);
      expect(built.last_message_at).toBe(built.messages[built.messages.length - 1].created_at);
    }
    expect(new Set(CONVERSATIONS.map((c) => c.contact)).size).toBe(CONVERSATIONS.length);
  });

  it("los mensajes se reparten en los últimos 10 días y algunos pasan de 24 h sin escribir el cliente", () => {
    const spans = CONVERSATIONS.flatMap((c) => c.messages.map((m) => m[2] as number));
    expect(Math.max(...spans)).toBeGreaterThanOrEqual(10 * DAY * 0.9);
    const stale = CONVERSATIONS.filter((c) => {
      const lastInbound = Math.min(...c.messages.filter((m) => m[0] === "c").map((m) => m[2] as number));
      const contact = CONTACTS.find((x) => x.key === c.contact)!;
      return lastInbound > DAY && contact.channel === "wa";
    });
    expect(stale.length).toBeGreaterThanOrEqual(3);
  });

  it("los no leídos son los mensajes del cliente sin respuesta al final", () => {
    expect(conversationOf("camila")!.unread_count).toBe(2);
    expect(conversationOf("fiorella")!.unread_count).toBe(2);
    expect(conversationOf("valeria")!.unread_count).toBe(0);
    expect(conversationOf("cesar")!.unread_count).toBe(2);
  });

  it("los asesores responden con su id y la plantilla automática sale sin autor", () => {
    const jorge = conversationOf("jorge")!;
    expect(jorge.messages.some((m: { sent_by_user_id: string | null }) => m.sent_by_user_id === "advisor:diego")).toBe(true);
    expect(jorge.hasHumanReply).toBe(true);
    const milagros = conversationOf("milagros")!;
    const template = milagros.messages.find((m: { text: string }) => m.text.startsWith("Hola Milagros, ya casi"))!;
    expect(template.sent_by_user_id).toBeNull();
    // Mismo texto que envía el canal de prueba con esa plantilla.
    expect(template.text).toBe(demoTemplateText("recordatorio_recompra", ["Milagros"]));
  });

  it("la vista previa corta a 100 caracteres", () => {
    expect(previewOf("a".repeat(150))).toHaveLength(100);
    expect(previewOf(null)).toBe("");
  });

  it("los sellos de la gestión salen de sus mensajes", () => {
    const conv = conversationOf("cesar")!;
    const opened = new Date(NOW.getTime() - 1500 * 60000).toISOString();
    const stamps = deriveCaseStamps(conv.messages, { openedAt: opened, closedAt: null, now: NOW });
    expect(stamps.lastInboundAt).toBe(new Date(NOW.getTime() - 55 * 60000).toISOString());
    expect(stamps.waitingSince).toBe(new Date(NOW.getTime() - 60 * 60000).toISOString());
    expect(stamps.firstResponse).toEqual({
      waitStart: new Date(NOW.getTime() - 1200 * 60000).toISOString(),
      at: new Date(NOW.getTime() - 1190 * 60000).toISOString(),
    });
  });
});

describe("notas, avisos y contactos construidos", () => {
  it("las notas y avisos apuntan a gestiones que existen", () => {
    const keys = new Set(CASES.map((c) => c.key));
    for (const n of NOTES) expect(keys.has(n.case)).toBe(true);
    for (const n of NOTIFICATIONS) expect(keys.has(n.case)).toBe(true);
    expect(NOTES.filter((n) => n.mentions.length > 0).length).toBeGreaterThanOrEqual(3);
    expect(NOTES.some((n) => n.mentions.includes("owner"))).toBe(true);
    expect(NOTIFICATIONS.length).toBeGreaterThanOrEqual(4);
    expect(NOTIFICATIONS.some((n) => !n.read)).toBe(true);
  });

  it("fillNames reemplaza al dueño y a los asesores", () => {
    expect(fillNames("@{owner} y @{sofia}", { owner: "Nico", sofia: "Sofía Paredes (Prueba)" })).toBe("@Nico y @Sofía Paredes (Prueba)");
    expect(fillNames("{otro}", {})).toBe("{otro}");
  });

  it("la fecha clave es la de la última compra ganada", () => {
    const keyDates = keyDatesByContact(CASES, NOW) as Map<string, string>;
    expect(keyDates.get("valeria")).toBe(limaDate(new Date(NOW.getTime() - 14380 * 60000).toISOString()));
    expect(keyDates.get("andrea")).toBe(limaDate(new Date(NOW.getTime() - 11500 * 60000).toISOString()));
    expect(keyDates.get("karen")).toBe(limaDate(new Date(NOW.getTime() - 100 * DAY * 60000).toISOString()));
    expect(keyDates.has("camila")).toBe(false);
  });

  it("buildContact arma la fila con su marca, teléfono y responsable", () => {
    const ids = fakeIds();
    const keyDates = keyDatesByContact(CASES, NOW) as Map<string, string>;
    const index = CONTACTS.findIndex((c) => c.key === "valeria");
    const row = buildContact(CONTACTS[index], index, { now: NOW, workspaceId: "ws", ids, keyDates, lastInteractionAgo: 195 });
    expect(row).toMatchObject({
      display_name: "Valeria Rojas (Prueba)",
      email: "valeria.rojas@prueba.invalid",
      phone: contactPhone(index),
      contact_type_id: "ctype:Cliente",
      team_id: "team:ventas",
      owner_id: "advisor:sofia",
      source: { demo: true },
    });
    expect(row.key_date).toBeTruthy();
  });
});

describe("hora de Lima", () => {
  it("limaDate y limaAtIso usan UTC-5", () => {
    expect(limaDate("2026-10-18T03:00:00.000Z")).toBe("2026-10-17");
    expect(limaDate("2026-10-18T17:30:00.000Z")).toBe("2026-10-18");
    expect(limaAtIso(NOW, 1, 9)).toBe("2026-10-19T14:00:00.000Z");
    expect(limaAtIso(NOW, 0, 9)).toBe("2026-10-18T14:00:00.000Z");
  });
});

describe("demo_data y borrado", () => {
  const full = () => {
    const dd = emptyDemoData(NOW);
    dd.user_ids = ["u1", "u2"];
    dd.invite_ids = ["i1", "i2"];
    dd.team_ids = ["t1", "t2"];
    dd.channel_ids = ["ch1", "ch2"];
    dd.contact_ids = ["c1", "c2", "c3"];
    dd.case_ids = ["k1"];
    dd.tag_ids = ["g1"];
    dd.saved_reply_ids = ["s1", "s2"];
    dd.broadcast_ids = ["b1"];
    dd.notification_ids = ["n1"];
    dd.restore.case_types = [{ id: "ct1", name: "Postventa", routing: "contact_owner", fixed_team_id: null }];
    return dd;
  };

  it("nace vacío, en estado de carga y con la restauración lista", () => {
    const dd = emptyDemoData(NOW);
    expect(dd.status).toBe("loading");
    expect(dd.created_at).toBe(NOW.toISOString());
    expect(dd.restore).toEqual({ case_types: [] });
    for (const [k, v] of Object.entries(dd)) if (k.endsWith("_ids")) expect(v).toEqual([]);
  });

  it("el plan de borrado lista exactamente los ids guardados, en orden", () => {
    const plan = deletionPlan(full());
    expect(plan.map((s) => s.kind)).toEqual([
      "notifications",
      "broadcasts",
      "saved_replies",
      "contacts",
      "channels",
      "restore_case_types",
      "teams",
      "members",
      "users",
      "invites",
      "tags",
    ]);
    const idsOf = (kind: string) => plan.find((s) => s.kind === kind)!.ids;
    expect(idsOf("contacts")).toEqual(["c1", "c2", "c3"]);
    expect(idsOf("channels")).toEqual(["ch1", "ch2"]);
    expect(idsOf("users")).toEqual(["u1", "u2"]);
    expect(idsOf("members")).toEqual(["u1", "u2"]);
    expect(idsOf("teams")).toEqual(["t1", "t2"]);
    expect(idsOf("invites")).toEqual(["i1", "i2"]);
    expect(idsOf("tags")).toEqual(["g1"]);
    expect(plan.find((s) => s.kind === "notifications")!.alsoByContactLink).toEqual(["c1", "c2", "c3"]);
    expect(plan.find((s) => s.kind === "members")!.column).toBe("user_id");
    // Los contactos (y lo que cuelga) se borran antes que canales, equipos y asesores.
    const order = plan.map((s) => s.kind);
    expect(order.indexOf("contacts")).toBeLessThan(order.indexOf("channels"));
    expect(order.indexOf("restore_case_types")).toBeLessThan(order.indexOf("teams"));
    expect(order.indexOf("members")).toBeLessThan(order.indexOf("users"));
    // 2 usuarios cuentan como membresía y como usuario; las gestiones y notas salen en cascada.
    expect(deletionCount(plan)).toBe(1 + 1 + 2 + 3 + 2 + 2 + 2 + 2 + 2 + 1);
  });

  it("restaura el destino anterior de los tipos modificados", () => {
    const plan = deletionPlan(full());
    const restore = plan.find((s) => s.kind === "restore_case_types")!;
    expect(restore.restore).toEqual([{ id: "ct1", name: "Postventa", routing: "contact_owner", fixed_team_id: null }]);
  });

  it("un demo_data incompleto (carga interrumpida) también se puede borrar", () => {
    const plan = deletionPlan({ version: 1, status: "loading", team_ids: ["t1"] });
    expect(plan.find((s) => s.kind === "teams")!.ids).toEqual(["t1"]);
    expect(plan.find((s) => s.kind === "contacts")!.ids).toEqual([]);
    expect(() => deletionPlan(undefined)).not.toThrow();
  });

  it("settings queda como estaba después de cargar y borrar", () => {
    const before = { agent_visibility: "own", business_template: "ecommerce", key_date_label: "Última compra", business_hours: { mon: [["09:00", "19:00"]] } };
    const loaded = withDemoData(before, full());
    expect(hasDemoData(before)).toBe(false);
    expect(hasDemoData(loaded)).toBe(true);
    expect(loaded[DEMO_DATA_KEY]).toBeTruthy();
    expect(withoutDemoData(loaded)).toEqual(before);
    // No modifica el original.
    expect(before).not.toHaveProperty(DEMO_DATA_KEY);
    expect(withoutDemoData(null)).toEqual({});
    expect(hasDemoData(null)).toBe(false);
    expect(hasDemoData({ demo_data: null })).toBe(false);
  });

  it("chunk parte las listas en trozos", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
