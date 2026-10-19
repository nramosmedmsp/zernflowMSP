// Resolución por nombre de una plantilla de flujo contra el catálogo del
// espacio (tipos de gestión, etapas, equipos y tipos de contacto). Puro:
// lo usa la acción de servidor que instala la plantilla y las pruebas.
//
// Si un nombre no existe, el nodo queda sin configurar (sin id) y se agrega un
// aviso. La comparación ignora mayúsculas, tildes y espacios de más.

import { normalizeName } from "@/lib/business-templates";
import type {
  CatalogCaseType,
  CatalogStage,
  ConditionRef,
  FlowTemplate,
  FlowTemplateNotice,
  TemplateCatalog,
  TemplateEdge,
  TemplateNode,
} from "./types";

/** Nodo tal como se guarda en `flows.nodes` (sin las referencias por nombre). */
export interface CanvasNode {
  id: string;
  type: TemplateNode["type"];
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface ResolvedFlow {
  nodes: CanvasNode[];
  edges: TemplateEdge[];
  notices: FlowTemplateNotice[];
}

function byName<T extends { name: string }>(list: T[], name: string): T | undefined {
  const wanted = normalizeName(name);
  return list.find((item) => normalizeName(item.name) === wanted);
}

function findStage(type: CatalogCaseType, name: string, openOnly: boolean): CatalogStage | undefined {
  const wanted = normalizeName(name);
  return type.stages.find((s) => normalizeName(s.name) === wanted && (!openOnly || s.kind === "open"));
}

export function resolveFlowTemplate(template: FlowTemplate, catalog: TemplateCatalog): ResolvedFlow {
  const notices: FlowTemplateNotice[] = [];

  const warn = (node: TemplateNode, message: string) =>
    notices.push({
      level: "warning",
      nodeId: node.id,
      nodeLabel: typeof node.data.label === "string" ? node.data.label : undefined,
      message,
    });

  /** Etapa de un tipo de gestión; devuelve null (y avisa) si falta el tipo o la etapa. */
  const resolveStage = (
    node: TemplateNode,
    caseTypeName: string,
    stageName: string,
    openOnly: boolean,
  ): { caseType: CatalogCaseType; stage: CatalogStage } | null => {
    const caseType = byName(catalog.caseTypes, caseTypeName);
    if (!caseType) {
      warn(node, `No existe el tipo de gestión "${caseTypeName}" en tu espacio; la etapa "${stageName}" quedó sin elegir.`);
      return null;
    }
    const stage = findStage(caseType, stageName, openOnly);
    if (!stage) {
      warn(node, `El tipo de gestión "${caseTypeName}" no tiene una etapa${openOnly ? " abierta" : ""} llamada "${stageName}".`);
      return null;
    }
    return { caseType, stage };
  };

  const nodes: CanvasNode[] = template.graph.nodes.map((source) => {
    const data: Record<string, unknown> = JSON.parse(JSON.stringify(source.data));
    const node: CanvasNode = { id: source.id, type: source.type, position: { ...source.position }, data };
    const refs = source.refs;
    if (!refs) return node;
    const isTrigger = source.type === "trigger";

    // Tipo de gestión (Clasificar gestión y disparadores).
    if (refs.caseType) {
      const caseType = byName(catalog.caseTypes, refs.caseType);
      if (caseType) {
        data.caseTypeId = caseType.id;
        data.caseTypeName = caseType.name;
      } else if (isTrigger) {
        warn(
          source,
          `No existe el tipo de gestión "${refs.caseType}" en tu espacio. El disparador quedó sin tipo y se activaría con cualquier gestión: configúralo antes de publicar.`,
        );
      } else {
        warn(source, `No existe el tipo de gestión "${refs.caseType}" en tu espacio; el nodo quedó sin configurar.`);
      }
    }

    // Etapa (Clasificar gestión, Cambiar etapa y disparador de cambio de etapa).
    if (refs.stage) {
      const typeName = refs.stageCaseType ?? refs.caseType;
      // Si el tipo de gestión ya se avisó como faltante, no se repite el aviso por la etapa.
      const typeAlreadyMissing = typeName === refs.caseType && !data.caseTypeId;
      if (typeName) {
        const found = typeAlreadyMissing ? null : resolveStage(source, typeName, refs.stage, true);
        if (found) {
          data.stageId = found.stage.id;
          data.stageName = found.stage.name;
        } else if (isTrigger) {
          notices.push({
            level: "warning",
            nodeId: source.id,
            nodeLabel: typeof data.label === "string" ? data.label : undefined,
            message: "El disparador quedó sin etapa y se activaría con cualquier cambio de etapa: configúralo antes de publicar.",
          });
        }
      }
    }

    // Categoría (Clasificar gestión): del tipo de gestión del nodo.
    if (refs.category && refs.caseType) {
      const caseType = byName(catalog.caseTypes, refs.caseType);
      const category = caseType ? byName(caseType.categories ?? [], refs.category) : undefined;
      if (category) {
        data.categoryId = category.id;
        data.categoryName = category.name;
      } else if (caseType) {
        // Sin el tipo ya se avisó que el nodo no está configurado.
        warn(
          source,
          `El tipo de gestión "${refs.caseType}" no tiene una categoría llamada "${refs.category}"; el nodo clasifica sin categoría.`,
        );
      }
    }

    // Equipo (Asignar a equipo).
    if (refs.team) {
      const team = byName(catalog.teams, refs.team);
      if (team) {
        data.teamId = team.id;
        data.teamName = team.name;
      } else {
        warn(source, `No existe un equipo llamado "${refs.team}"; el nodo quedó sin configurar. Elige el equipo en el nodo.`);
      }
    }

    // Condiciones de gestión.
    if (refs.conditions) {
      const conditions = data.conditions as Array<{ field: string; operator: string; value: string }>;
      for (const ref of refs.conditions) {
        const value = resolveConditionValue(source, ref, catalog, resolveStage, warn);
        if (value !== null) conditions[ref.index].value = value;
      }
    }

    return node;
  });

  return { nodes, edges: template.graph.edges.map((e) => ({ ...e })), notices };
}

function resolveConditionValue(
  node: TemplateNode,
  ref: ConditionRef,
  catalog: TemplateCatalog,
  resolveStage: (
    node: TemplateNode,
    caseTypeName: string,
    stageName: string,
    openOnly: boolean,
  ) => { caseType: CatalogCaseType; stage: CatalogStage } | null,
  warn: (node: TemplateNode, message: string) => void,
): string | null {
  switch (ref.kind) {
    case "stage": {
      if (!ref.caseType) return null;
      return resolveStage(node, ref.caseType, ref.name, false)?.stage.id ?? null;
    }
    case "caseType": {
      const found = byName(catalog.caseTypes, ref.name);
      if (!found) warn(node, `No existe el tipo de gestión "${ref.name}"; la condición quedó sin valor.`);
      return found?.id ?? null;
    }
    case "team": {
      const found = byName(catalog.teams, ref.name);
      if (!found) warn(node, `No existe un equipo llamado "${ref.name}"; la condición quedó sin valor. Elige el equipo en el nodo.`);
      return found?.id ?? null;
    }
    case "contactType": {
      const found = byName(catalog.contactTypes, ref.name);
      if (!found) warn(node, `No existe el tipo de contacto "${ref.name}"; la condición quedó sin valor.`);
      return found?.id ?? null;
    }
  }
}

// ── Descripción para la tarjeta ─────────────────────────────────────────────

function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "24 horas" : `${days} días`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hora" : `${hours} horas`;
  }
  return `${minutes} minutos`;
}

const OUTCOME_LABELS: Record<string, string> = { won: "ganada", lost: "perdida", resolved: "resuelta" };

/** Qué dispara la plantilla, en una frase. */
export function describeTrigger(template: FlowTemplate): string {
  const node = template.graph.nodes.find((n) => n.type === "trigger");
  if (!node) return "Sin disparador";
  const type = node.data.triggerType as string;
  const caseType = node.refs?.caseType;
  switch (type) {
    case "welcome":
      return "Primer mensaje del cliente";
    case "case_opened":
      return node.data.onlyUnclassified === true
        ? "Se abre una gestión nueva que queda sin clasificar"
        : "Se abre una gestión nueva (el primer mensaje del cliente o el de un cliente que vuelve)";
    case "default":
      return "Cualquier mensaje que no coincida con otro disparador";
    case "keyword": {
      const words = ((node.data.keywords as Array<{ value: string }>) ?? []).map((k) => k.value);
      return `Palabras clave: ${words.join(", ")}`;
    }
    case "case_stage_changed":
      return `La gestión${caseType ? ` de ${caseType}` : ""} pasa a la etapa "${node.refs?.stage ?? "cualquiera"}"`;
    case "case_closed": {
      const outcome = node.data.outcome as string | undefined;
      return `Se cierra una gestión${caseType ? ` de ${caseType}` : ""}${outcome ? ` como ${OUTCOME_LABELS[outcome] ?? outcome}` : ""}`;
    }
    case "client_no_reply":
      return `El cliente no responde en ${formatMinutes(Number(node.data.minutes) || 60)}${caseType ? ` (gestión de ${caseType})` : ""}`;
    default:
      return type;
  }
}

/** Lista de pasos de la plantilla, en el orden del lienzo (arriba a abajo). */
export function describeSteps(template: FlowTemplate): string[] {
  const fieldNames = new Map((template.customFields ?? []).map((f) => [f.slug, f.name]));
  const sorted = [...template.graph.nodes]
    .filter((n) => n.type !== "trigger")
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  return sorted.map((n) => {
    const label = typeof n.data.label === "string" ? n.data.label : "";
    switch (n.type) {
      case "sendMessage": {
        const messages = (n.data.messages as Array<{ buttons?: unknown[]; quickReplies?: unknown[] }>) ?? [];
        const interactive = messages.some((m) => m.buttons?.length || m.quickReplies?.length);
        const extras = [interactive ? "con botones" : "", n.data.template ? "con plantilla de respaldo" : ""].filter(Boolean);
        return `Mensaje: ${label}${extras.length ? ` (${extras.join(", ")})` : ""}`;
      }
      case "condition":
        return `Condición: ${label}`;
      case "delay":
        return `Espera: ${label}`;
      case "action":
        switch (n.data.actionType) {
          case "classifyCase":
            return `Clasificar la gestión como "${n.refs?.caseType ?? ""}"${n.refs?.category ? ` (categoría "${n.refs.category}")` : ""}`;
          case "changeStage":
            return `Cambiar la etapa a "${n.refs?.stage ?? ""}"`;
          case "assignTeam":
            return `Asignar al equipo "${n.refs?.team ?? ""}"`;
          case "distributeCase":
            return "Repartir la gestión a un asesor";
          case "smartDelay":
            return "Esperar la respuesta del cliente";
          case "addTag":
            return `Etiquetar con "${String(n.data.tagName ?? "")}"`;
          case "setCustomField": {
            const slug = String(n.data.fieldSlug ?? "");
            return `Guardar la respuesta en el campo "${fieldNames.get(slug) ?? slug}"`;
          }
          case "humanTakeover":
            return "Pasar a atención humana";
          case "unsubscribe":
            return "Desuscribir al contacto de los mensajes";
          default:
            return label;
        }
      default:
        return label;
    }
  });
}
