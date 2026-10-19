"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TriggerNodeProps {
  label?: string;
  triggerType?: string;
  keywords?: Array<{ value: string; matchType: string }>;
  alsoMatchInDms?: boolean;
  caseTypeName?: string;
  stageName?: string;
  outcome?: string;
  minutes?: number;
  onlyUnclassified?: boolean;
  contactTypeNames?: string[];
}

const triggerLabels: Record<string, string> = {
  keyword: "Palabra clave",
  postback: "Botón (postback)",
  quick_reply: "Respuesta rápida",
  welcome: "Bienvenida",
  default: "Por defecto",
  comment_keyword: "Palabra clave en comentario",
  case_opened: "Gestión nueva",
  case_stage_changed: "Cambio de etapa",
  case_closed: "Gestión cerrada",
  client_no_reply: "Cliente sin responder",
};

const outcomeLabels: Record<string, string> = { won: "Ganada", lost: "Perdida", resolved: "Resuelta" };

/** Resumen de los filtros de un disparador de gestión. */
function caseTriggerSummary(data: TriggerNodeProps, triggerType: string): string | null {
  const parts: string[] = [];
  if (triggerType === "case_opened") {
    parts.push(data.onlyUnclassified ? "Sin clasificar" : "Cualquier gestión nueva");
    if (data.contactTypeNames && data.contactTypeNames.length > 0) parts.push(data.contactTypeNames.join(", "));
    return parts.join(" · ");
  }
  if (data.caseTypeName) parts.push(data.caseTypeName);
  if (triggerType === "case_stage_changed" && data.stageName) parts.push(data.stageName);
  if (triggerType === "case_closed" && data.outcome) parts.push(outcomeLabels[data.outcome] ?? data.outcome);
  if (triggerType === "client_no_reply") parts.push(`${data.minutes ?? 60} min`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function TriggerNode({ data, selected }: NodeProps) {
  const nodeData = data as TriggerNodeProps;
  const triggerType = nodeData.triggerType || "keyword";
  const label = nodeData.label || triggerLabels[triggerType] || "Disparador";

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card shadow-sm transition-shadow",
        selected ? "border-emerald-500 shadow-md" : "border-border"
      )}
    >
      <div className="flex items-center gap-2 rounded-t-lg bg-emerald-500 px-3 py-2 text-white">
        <Zap className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">Disparador</span>
      </div>
      <div className="p-3">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium">{label}</p>
          {triggerType === "comment_keyword" && nodeData.alsoMatchInDms === true && (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              También en DM
            </span>
          )}
        </div>
        {nodeData.keywords && nodeData.keywords.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Palabras clave:{" "}
            {nodeData.keywords
              .slice(0, 3)
              .map((k) => k.value)
              .join(", ")}
            {nodeData.keywords.length > 3 && ` +${nodeData.keywords.length - 3} más`}
          </p>
        )}
        {!nodeData.keywords?.length && triggerType !== "keyword" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {caseTriggerSummary(nodeData, triggerType) ?? (triggerLabels[triggerType] || triggerType)}
          </p>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !border-2 !border-emerald-500 !bg-white"
      />
    </div>
  );
}
