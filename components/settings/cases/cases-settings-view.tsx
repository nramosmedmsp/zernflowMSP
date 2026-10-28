"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, ArchiveRestore, Loader2, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { createCaseType, reorderCaseTypes, restoreCaseType } from "@/lib/actions/case-config";
import { moveId, type CaseConfigData } from "./config-rules";
import type { TemplateSummary } from "./template-summary";
import { AddTemplateDialog, TemplateWizard } from "./template-wizard";
import { GeneralTab } from "./general-tab";
import { StagesTab } from "./stages-tab";
import { CategoriesTab } from "./categories-tab";
import { RoutingTab } from "./routing-tab";
import { TimesTab } from "./times-tab";
import { ClaimsTab } from "./claims-tab";
import { RulesTab } from "./rules-tab";
import { FunnelPreview } from "./funnel-preview";
import {
  CaseTypeIcon,
  Modal,
  NoticeBox,
  iconButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  useRunner,
} from "./shared";

const TABS = [
  { key: "general", label: "General" },
  { key: "stages", label: "Etapas" },
  { key: "categories", label: "Categorías y motivos" },
  { key: "routing", label: "Destino" },
  { key: "times", label: "Tiempos" },
  { key: "claims", label: "Control de reclamos" },
  { key: "rules", label: "Reglas" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function CasesSettingsView({ data, templates }: { data: CaseConfigData; templates: TemplateSummary[] }) {
  const { run, busy, notice, setNotice, clearNotice } = useRunner();
  const [selectedId, setSelectedId] = useState<string | null>(data.caseTypes.find((t) => !t.archived)?.id ?? null);
  const [tab, setTab] = useState<TabKey>("general");
  const [showArchived, setShowArchived] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const sorted = [...data.caseTypes].sort((a, b) => a.position - b.position);
  const active = sorted.filter((t) => !t.archived);
  const archived = sorted.filter((t) => t.archived);
  const visible = showArchived ? [...active, ...archived] : active;
  const current = data.caseTypes.find((t) => t.id === selectedId);
  const selected = current && (showArchived || !current.archived) ? current : (visible[0] ?? null);

  // Sin tipos y sin haber elegido "En blanco": el asistente de inicio.
  const showWizard = data.caseTypes.length === 0 && data.businessTemplate !== "blank";

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (newName.trim() === "") return;
    const created: { id: string | null } = { id: null };
    const ok = await run(
      async () => {
        const result = await createCaseType({ name: newName.trim(), color: "#3b82f6", icon: "message-circle" });
        if ("ok" in result) created.id = result.id;
        return result;
      },
      `Tipo «${newName.trim()}» creado con las etapas Abierta y Resuelta. Personalízalo en las pestañas.`,
    );
    if (ok) {
      setNewName("");
      setCreating(false);
      if (created.id) {
        setSelectedId(created.id);
        setTab("general");
        setShowArchived(false);
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/dashboard/settings" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Volver a Configuración">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">Gestiones</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Los tipos de gestión, sus etapas, motivos, destino, tiempos y reglas.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => setTemplateOpen(true)} title="Agrega lo que falte de una plantilla; nunca borra nada">
              <Sparkles className="h-4 w-4" />
              Agregar desde plantilla
            </button>
            {!showWizard && (
              <button type="button" className={primaryButtonClass} onClick={() => setCreating(true)} disabled={busy}>
                <Plus className="h-4 w-4" />
                Nuevo tipo
              </button>
            )}
          </div>
        </div>
      </div>

      {notice && !showWizard && (
        <div className="px-8 pt-4">
          <NoticeBox notice={notice} onClose={clearNotice} />
        </div>
      )}

      {showWizard ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TemplateWizard templates={templates} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-8 py-6 lg:grid-cols-[18rem_1fr]">
          <aside className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tipos de gestión</h2>
              {archived.length > 0 && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" />
                  Ver archivados ({archived.length})
                </label>
              )}
            </div>

            <ul className="space-y-1.5">
              {visible.map((t) => {
                const activeIndex = active.findIndex((a) => a.id === t.id);
                const isActive = activeIndex >= 0;
                return (
                  <li key={t.id} className={cn("flex items-center gap-1 rounded-lg border bg-card pr-1", selected?.id === t.id ? "border-primary ring-1 ring-primary/30" : "border-border")}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(t.id);
                        clearNotice();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${t.color ?? "#9ca3af"}22` }}>
                        <CaseTypeIcon name={t.icon} className="h-4 w-4" style={{ color: t.color ?? "#6b7280" }} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm font-medium", t.archived && "text-muted-foreground line-through")}>{t.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {t.archived ? "Archivado" : t.isProactive ? "Proactiva" : `${t.stages.filter((s) => !s.archived).length} etapas`}
                        </span>
                      </span>
                    </button>
                    {isActive ? (
                      <div className="flex flex-col">
                        <button type="button" className={cn(iconButtonClass, "h-4")} disabled={busy || activeIndex === 0} title="Subir" aria-label={`Subir ${t.name}`} onClick={() => run(() => reorderCaseTypes(moveId(active.map((a) => a.id), t.id, "up")))}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className={cn(iconButtonClass, "h-4")} disabled={busy || activeIndex === active.length - 1} title="Bajar" aria-label={`Bajar ${t.name}`} onClick={() => run(() => reorderCaseTypes(moveId(active.map((a) => a.id), t.id, "down")))}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button type="button" className={iconButtonClass} disabled={busy} title="Reactivar" aria-label={`Reactivar ${t.name}`} onClick={() => run(() => restoreCaseType(t.id), `El tipo «${t.name}» se reactivó.`)}>
                        <ArchiveRestore className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
              {visible.length === 0 && (
                <li className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Aún no hay tipos de gestión. Crea uno con «Nuevo tipo» o agrega los de una plantilla.
                </li>
              )}
            </ul>
          </aside>

          <section className="min-w-0 space-y-5">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: `${selected.color ?? "#9ca3af"}22` }}>
                    <CaseTypeIcon name={selected.icon} className="h-5 w-5" style={{ color: selected.color ?? "#6b7280" }} />
                  </span>
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  {selected.archived && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Archivado</span>
                  )}
                  {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>

                <div role="tablist" aria-label="Configuración del tipo" className="flex flex-wrap gap-1 border-b border-border">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.key}
                      onClick={() => setTab(t.key)}
                      className={cn(
                        "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                        tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* `key` reinicia los borradores cuando lo guardado cambia. */}
                <div role="tabpanel" className="rounded-xl border border-border bg-card p-5">
                  {tab === "general" && (
                    <GeneralTab key={`${selected.id}:${selected.updatedAt}`} type={selected} data={data} run={run} busy={busy} notify={setNotice} onGone={() => setSelectedId(null)} />
                  )}
                  {tab === "stages" && <StagesTab key={selected.id} type={selected} data={data} run={run} busy={busy} notify={setNotice} />}
                  {tab === "categories" && <CategoriesTab key={selected.id} type={selected} data={data} run={run} busy={busy} notify={setNotice} />}
                  {tab === "routing" && <RoutingTab key={`${selected.id}:${selected.updatedAt}`} type={selected} data={data} run={run} busy={busy} notify={setNotice} />}
                  {tab === "times" && <TimesTab key={`${selected.id}:${selected.updatedAt}`} type={selected} data={data} run={run} busy={busy} notify={setNotice} />}
                  {tab === "claims" && <ClaimsTab key={`${selected.id}:${selected.updatedAt}`} type={selected} data={data} run={run} busy={busy} notify={setNotice} />}
                  {tab === "rules" && <RulesTab key={selected.id} type={selected} data={data} run={run} busy={busy} notify={setNotice} />}
                </div>

                <FunnelPreview stages={selected.stages} />
              </>
            ) : (
              <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Elige un tipo de gestión de la lista para ver y cambiar su configuración.
              </p>
            )}
          </section>
        </div>
      )}

      <Modal open={creating} title="Nuevo tipo de gestión" onClose={() => setCreating(false)}>
        <form onSubmit={submitNew} className="space-y-3">
          <p className="text-xs text-muted-foreground">Se crea con las etapas Abierta y Resuelta; luego puedes personalizarlas, agregar categorías, motivos y reglas.</p>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={100}
            placeholder="Nombre del tipo, por ejemplo Garantía"
            aria-label="Nombre del tipo de gestión"
            disabled={busy}
            className={`${inputClass} w-full`}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => setCreating(false)}>
              Cancelar
            </button>
            <button type="submit" className={primaryButtonClass} disabled={busy || newName.trim() === ""}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear tipo
            </button>
          </div>
        </form>
      </Modal>

      <AddTemplateDialog open={templateOpen} onClose={() => setTemplateOpen(false)} templates={templates} />
    </div>
  );
}
