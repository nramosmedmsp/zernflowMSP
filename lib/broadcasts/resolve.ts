// Resuelve el filtro de segmento de una difusión a contactos suscritos
// (servidor, con el cliente de servicio: el administrador ya se validó en la
// ruta y todas las consultas van acotadas al espacio).
//
// Filtros de la fase 1 (etiquetas, campos personalizados, plataforma,
// suscripción, última interacción) siguen igual; la interfaz guarda la
// etiqueta por id y el campo personalizado como "slug::valor", y aquí se
// aceptan esas formas además de las anteriores (nombre de etiqueta, "slug:valor").
// Filtros de fase 2 (tipo de contacto, equipo, responsable, fecha clave):
// ver segment.ts.

import type { Db } from "@/lib/cases/io";
import type { Platform } from "@/lib/types/database";
import { pageAll, selectInChunks } from "./db";
import {
  combineSets,
  isContactAttributeField,
  matchesContactRule,
  parseCustomFieldValue,
  type SegmentContact,
  type SegmentFilter,
  type SegmentRule,
} from "./segment";

export interface SegmentContactRow extends SegmentContact {
  display_name: string | null;
  phone: string | null;
}

const CONTACT_COLUMNS = "id, display_name, phone, key_date, contact_type_id, team_id, owner_id";

/** Contactos suscritos del espacio que cumplen el filtro (todos si no hay filtro). */
export async function resolveSegmentContacts(
  db: Db,
  workspaceId: string,
  filter: SegmentFilter | null,
): Promise<SegmentContactRow[]> {
  const all = await pageAll<SegmentContactRow>((from, to) =>
    db
      .from("contacts")
      .select(CONTACT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("is_subscribed", true)
      .order("id")
      .range(from, to),
  );
  if (!filter || !filter.groups?.length || all.length === 0) return all;

  const byId = new Map(all.map((c) => [c.id, c]));
  const allIds = all.map((c) => c.id);

  const groupResults: Set<string>[] = [];
  for (const group of filter.groups) {
    const ruleResults: Set<string>[] = [];
    for (const rule of group.rules ?? []) {
      ruleResults.push(await evaluateRule(db, workspaceId, rule, all, allIds));
    }
    groupResults.push(combineSets(group.combinator, ruleResults));
  }
  const finalIds = combineSets(filter.combinator, groupResults);
  return allIds.filter((id) => finalIds.has(id)).map((id) => byId.get(id) as SegmentContactRow);
}

async function evaluateRule(
  db: Db,
  workspaceId: string,
  rule: SegmentRule,
  contacts: SegmentContactRow[],
  contactIds: string[],
): Promise<Set<string>> {
  if (isContactAttributeField(rule.field)) {
    return new Set(contacts.filter((c) => matchesContactRule(c, rule)).map((c) => c.id));
  }

  switch (rule.field) {
    case "has_tag":
    case "missing_tag": {
      const tagId = await findTagId(db, workspaceId, rule.value);
      if (!tagId) return rule.field === "has_tag" ? new Set() : new Set(contactIds);
      const tagged = await selectInChunks(contactIds, (ids) =>
        db.from("contact_tags").select("contact_id").eq("tag_id", tagId).in("contact_id", ids),
      );
      const taggedSet = new Set(tagged.map((t) => t.contact_id));
      return rule.field === "has_tag" ? taggedSet : new Set(contactIds.filter((id) => !taggedSet.has(id)));
    }

    case "platform": {
      const { data: channels } = await db
        .from("channels")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("platform", rule.value as Platform);
      if (!channels?.length) {
        return rule.operator === "not_equals" ? new Set(contactIds) : new Set();
      }
      const channelIds = channels.map((c) => c.id);
      const links = await selectInChunks(contactIds, (ids) =>
        db.from("contact_channels").select("contact_id").in("channel_id", channelIds).in("contact_id", ids),
      );
      const linked = new Set(links.map((l) => l.contact_id));
      return rule.operator === "not_equals" ? new Set(contactIds.filter((id) => !linked.has(id))) : linked;
    }

    case "is_subscribed":
      // Las difusiones solo van a contactos suscritos.
      return rule.value === "false" ? new Set() : new Set(contactIds);

    case "last_interaction": {
      const parsed = new Date(rule.value);
      if (Number.isNaN(parsed.getTime())) return new Set();
      const date = parsed.toISOString();
      const rows = await selectInChunks(contactIds, (ids) => {
        const q = db.from("contacts").select("id").eq("workspace_id", workspaceId).in("id", ids);
        return rule.operator === "before" ? q.lt("last_interaction_at", date) : q.gt("last_interaction_at", date);
      });
      return new Set(rows.map((c) => c.id));
    }

    case "custom_field": {
      const { slug, value: fieldValue } = parseCustomFieldValue(rule.value);
      const { data: fieldDef } = await db
        .from("custom_field_definitions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("slug", slug)
        .maybeSingle();
      if (!fieldDef) return new Set();
      const rows = await selectInChunks(contactIds, (ids) => {
        let q = db.from("contact_custom_fields").select("contact_id").eq("field_id", fieldDef.id).in("contact_id", ids);
        switch (rule.operator) {
          case "equals":
            q = q.eq("value", fieldValue);
            break;
          case "not_equals":
            q = q.neq("value", fieldValue);
            break;
          case "contains":
            q = q.ilike("value", `%${fieldValue}%`);
            break;
          case "gt":
            q = q.gt("value", fieldValue);
            break;
          case "lt":
            q = q.lt("value", fieldValue);
            break;
        }
        return q;
      });
      return new Set(rows.map((r) => r.contact_id));
    }

    default:
      return new Set(contactIds);
  }
}

/** La interfaz guarda el id de la etiqueta; antes se buscaba por nombre. */
async function findTagId(db: Db, workspaceId: string, value: string): Promise<string | null> {
  const wanted = value.trim();
  if (!wanted) return null;
  const { data: byName } = await db
    .from("tags")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", wanted)
    .limit(1)
    .maybeSingle();
  if (byName) return byName.id;
  // Un id con formato inválido hace fallar la consulta; solo se prueba si parece uuid.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wanted)) return null;
  const { data: byId } = await db.from("tags").select("id").eq("workspace_id", workspaceId).eq("id", wanted).maybeSingle();
  return byId?.id ?? null;
}
