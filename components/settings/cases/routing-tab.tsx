"use client";

import { useState } from "react";
import { updateCaseType } from "@/lib/actions/case-config";
import { ROUTINGS, ROUTING_HINTS, ROUTING_LABELS } from "./config-rules";
import { SaveBar, SectionTitle, inputClass, type TabProps } from "./shared";
import type { CaseRouting } from "@/lib/types/database";

export function RoutingTab({ type, data, run, busy }: TabProps) {
  const [routing, setRouting] = useState<CaseRouting>(type.routing);
  const [teamId, setTeamId] = useState(type.fixedTeamId ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const dirty = routing !== type.routing || (routing === "fixed_team" && teamId !== (type.fixedTeamId ?? ""));

  async function save() {
    if (routing === "fixed_team" && teamId === "") {
      setLocalError("Elige el equipo al que irán estas gestiones.");
      return;
    }
    setLocalError(null);
    await run(
      () => updateCaseType({ id: type.id, routing, fixedTeamId: routing === "fixed_team" ? teamId : null }),
      "Destino guardado.",
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle title="Destino" hint="A dónde llega una gestión nueva de este tipo para repartirse." />

      <div className="space-y-2" role="radiogroup" aria-label="Destino de las gestiones">
        {ROUTINGS.map((r) => (
          <label
            key={r}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
          >
            <input
              type="radio"
              name={`routing-${type.id}`}
              value={r}
              checked={routing === r}
              disabled={busy}
              onChange={() => setRouting(r)}
              className="mt-1 h-4 w-4 accent-[var(--primary)]"
            />
            <span className="text-sm">
              <span className="font-medium">{ROUTING_LABELS[r]}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{ROUTING_HINTS[r]}</span>
            </span>
          </label>
        ))}
      </div>

      {routing === "fixed_team" && (
        <div>
          <label htmlFor="fixed-team" className="mb-1 block text-xs font-medium text-muted-foreground">
            Equipo
          </label>
          {data.teams.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aún no hay equipos activos. Créalos en Configuración → Equipos.</p>
          ) : (
            <>
              {type.fixedTeamId && !data.teams.some((t) => t.id === type.fixedTeamId) && (
                <p className="mb-2 text-xs font-medium text-amber-600">
                  El equipo elegido está archivado: estas gestiones van al equipo del contacto o al de por defecto. Elige otro equipo.
                </p>
              )}
            <select id="fixed-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={busy} className={`${inputClass} w-full max-w-sm`}>
              <option value="">Elige un equipo</option>
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            </>
          )}
        </div>
      )}

      {localError && <p className="text-xs text-destructive">{localError}</p>}
      <SaveBar dirty={dirty} busy={busy} onSave={save} />
    </div>
  );
}
