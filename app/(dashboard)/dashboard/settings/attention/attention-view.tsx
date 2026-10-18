"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveAttentionSettings } from "@/lib/actions/settings";
import { ASSIGNMENT_MODE_OPTIONS } from "@/components/settings/teams/team-rules";
import type { BusinessHours } from "@/lib/types/database";
import { AGENT_VISIBILITY_OPTIONS, type AttentionSettings } from "./attention-rules";
import type { AutomationForm } from "./automation-rules";
import { AutomationSection } from "./automation-section";

export function AttentionView({
  workspaceId,
  workspaceName,
  initial,
  automation,
  businessHours,
  holidayDates,
  activeTeams,
}: {
  workspaceId: string;
  workspaceName: string;
  initial: AttentionSettings;
  automation: AutomationForm;
  businessHours: BusinessHours | null;
  holidayDates: string[];
  activeTeams: number;
}) {
  const [visibility, setVisibility] = useState(initial.agentVisibility);
  const [mode, setMode] = useState(initial.assignmentMode);
  const [canReturn, setCanReturn] = useState(initial.agentCanReturnToQueue);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMode = ASSIGNMENT_MODE_OPTIONS.find((o) => o.value === mode);
  const dirty =
    visibility !== initial.agentVisibility ||
    mode !== initial.assignmentMode ||
    canReturn !== initial.agentCanReturnToQueue;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const result = await saveAttentionSettings(workspaceId, {
        agentVisibility: visibility,
        assignmentMode: mode,
        agentCanReturnToQueue: canReturn,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("No se pudo guardar la configuración. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Volver a Configuración"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold">Atención</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Qué gestiones ve cada asesor y cómo se reparten las que llegan. Los supervisores siempre ven su equipo y
          los administradores, todo.
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
          <section>
            <h2 className="text-sm font-semibold">Qué ve un asesor</h2>
            <div className="mt-3 space-y-2" role="radiogroup" aria-label="Visibilidad del asesor">
              {AGENT_VISIBILITY_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                    visibility === o.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name="agent_visibility"
                    value={o.value}
                    checked={visibility === o.value}
                    onChange={() => setVisibility(o.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {o.label}
                      {o.recommended && (
                        <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
                          Recomendado
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{o.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Sin equipos, la regla aplica sobre toda la empresa.
            </p>
          </section>

          <hr className="border-border" />

          <section>
            <h2 className="text-sm font-semibold">Reparto cuando no hay equipos</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {activeTeams > 0
                ? `Tienes ${activeTeams} ${activeTeams === 1 ? "equipo activo" : "equipos activos"}: cada uno elige su modo de reparto en `
                : "Sin equipos, las gestiones se reparten entre todos los miembros de la empresa. Si más adelante creas equipos, cada uno elegirá su modo en "}
              <Link href="/dashboard/settings/teams" className="underline underline-offset-2">
                Configuración → Equipos
              </Link>
              .
            </p>
            <select
              value={mode}
              onChange={(e) => {
                const next = ASSIGNMENT_MODE_OPTIONS.find((o) => o.value === e.target.value);
                if (next) setMode(next.value);
              }}
              aria-label="Modo de reparto sin equipos"
              className="mt-3 block w-full max-w-xs rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {ASSIGNMENT_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {selectedMode && <p className="mt-1.5 text-xs text-muted-foreground">{selectedMode.description}</p>}
          </section>

          <hr className="border-border" />

          <section>
            <h2 className="text-sm font-semibold">Devolver gestiones</h2>
            <label className="mt-3 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={canReturn}
                onChange={(e) => setCanReturn(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-medium">Los asesores pueden devolver una gestión a la cola</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Si lo desactivas, solo los supervisores y los administradores pueden dejar una gestión sin
                  asignar.
                </span>
              </span>
            </label>
          </section>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
            {saved && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <Check className="h-4 w-4" />
                Configuración guardada
              </span>
            )}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>

          <AutomationSection
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            initial={automation}
            businessHours={businessHours}
            holidayDates={holidayDates}
            activeTeams={activeTeams}
          />
        </div>
      </div>
    </div>
  );
}
