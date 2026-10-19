"use client";

// Detalle de un camino: la conversación resumida en burbujas, cómo terminó y
// el estado final de la gestión y del contacto con lo que cambió.

import { Bot, FileText, MousePointerClick, User, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { END_KIND_LABELS, type ExplorePath, type ExploreStateSummary } from "@/lib/flow-lab/explorer/types";
import type { LabMessage } from "@/lib/flow-lab/types";
import { END_BADGE } from "./path-tree";

function Bubble({ message }: { message: LabMessage }) {
  const fromClient = message.author === "client";
  const options = [...(message.buttons ?? []).map((b) => b.title), ...(message.quickReplies ?? []).map((q) => q.title)];
  return (
    <div className={cn("flex gap-1.5", fromClient ? "justify-end" : "justify-start")}>
      {!fromClient && (
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10" title={message.author === "bot" ? "Bot" : "Asesor"}>
          {message.author === "bot" ? <Bot className="h-3.5 w-3.5 text-primary" /> : <UserRound className="h-3.5 w-3.5 text-primary" />}
        </div>
      )}
      <div className="max-w-[85%] space-y-1">
        <div className={cn("rounded-2xl px-3 py-1.5 text-sm shadow-sm", fromClient ? "rounded-tr-md bg-primary text-primary-foreground" : "rounded-tl-md bg-muted")}>
          {message.kind === "template" && (
            <span className="mb-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              <FileText className="h-3 w-3" />
              Plantilla de WhatsApp
            </span>
          )}
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        </div>
        {options.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {options.map((o, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                <MousePointerClick className="h-2.5 w-2.5" />
                {o}
              </span>
            ))}
          </div>
        )}
        {fromClient && message.payload && <p className="text-right text-[10px] text-muted-foreground">pulsó un botón</p>}
      </div>
      {fromClient && (
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted" title="Cliente">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function Row({ label, value, changed }: { label: string; value: string; changed?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words text-right", changed && "font-medium text-primary")}>{value}</dd>
    </div>
  );
}

function stateRows(final: ExploreStateSummary, initial: ExploreStateSummary): Array<{ label: string; value: string; changed: boolean }> {
  const c = final.case;
  const i = initial.case;
  const rows: Array<{ label: string; value: string; changed: boolean }> = [
    { label: "Tipo de contacto", value: final.contactType ?? "Sin tipo", changed: final.contactType !== initial.contactType },
    { label: "Etiquetas", value: final.tags.length > 0 ? final.tags.join(", ") : "Ninguna", changed: JSON.stringify(final.tags) !== JSON.stringify(initial.tags) },
    { label: "Responsable del contacto", value: final.owner ?? "Nadie", changed: final.owner !== initial.owner },
    { label: "Suscripción", value: final.subscribed ? "Suscrito" : "Dado de baja", changed: final.subscribed !== initial.subscribed },
  ];
  if (c) {
    const sameCase = !!i && i.id === c.id;
    rows.push(
      { label: "Tipo de gestión", value: c.type ?? "Sin clasificar", changed: !sameCase || i?.type !== c.type },
      { label: "Etapa", value: c.stage ?? "Sin etapa", changed: !sameCase || i?.stage !== c.stage },
      { label: "Categoría", value: c.category ?? "Sin categoría", changed: !sameCase || i?.category !== c.category },
      { label: "Estado", value: c.status, changed: !sameCase || i?.status !== c.status },
      { label: "Responsable", value: c.assignee ?? "Nadie", changed: !sameCase || i?.assignee !== c.assignee },
      { label: "Equipo", value: c.team ?? "Sin equipo", changed: !sameCase || i?.team !== c.team },
    );
  } else {
    rows.push({ label: "Gestión", value: "Ninguna", changed: false });
  }
  rows.push({ label: "Bot", value: final.botPaused ? "En pausa (atiende una persona)" : "Activo", changed: final.botPaused !== initial.botPaused });
  return rows;
}

export function PathDetail({ path, initial }: { path: ExplorePath; initial: ExploreStateSummary }) {
  const { final } = path;
  const fields = Object.entries(final.customFields);
  const variables = Object.entries(final.variables);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Camino {path.id}</h2>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", END_BADGE[path.end.kind])}>{END_KIND_LABELS[path.end.kind]}</span>
          {path.variant.map((v) => (
            <span key={v} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {v}
            </span>
          ))}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{path.label}</p>
        <p className="mt-1 text-sm">{path.end.text}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Conversación" className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversación</p>
          <div className="space-y-2">
            {path.messages.length === 0 && <p className="text-sm text-muted-foreground">No hubo mensajes.</p>}
            {path.messages.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}
          </div>
        </section>

        <section aria-label="Estado final" className="rounded-xl border border-border bg-card p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estado final</p>
          <dl className="divide-y divide-border/60">
            {stateRows(final, initial).map((r) => (
              <Row key={r.label} {...r} />
            ))}
            {fields.length > 0 && <Row label="Campos" value={fields.map(([k, v]) => `${k} = ${v}`).join("; ")} changed={fields.some(([k, v]) => initial.customFields[k] !== v)} />}
            {final.scheduled.length > 0 && <Row label="Programadas" value={final.scheduled.join("; ")} changed={final.scheduled.some((s) => !initial.scheduled.includes(s))} />}
            {variables.length > 0 && <Row label="Variables" value={variables.map(([k, v]) => `${k} = ${v}`).join("; ")} />}
          </dl>
          <p className="mt-2 text-[11px] text-muted-foreground">En azul, lo que cambió respecto al estado de partida.</p>
          {path.changes.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qué cambió</p>
              <ul className="list-disc space-y-0.5 pl-4 text-sm">
                {path.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {final.notes.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notas internas</p>
              <ul className="list-disc space-y-0.5 pl-4 text-sm">
                {final.notes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {path.warnings.length > 0 && (
        <ul className="space-y-0.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {path.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
