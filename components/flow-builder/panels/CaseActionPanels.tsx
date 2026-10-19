"use client";

import { Loader2 } from "lucide-react";
import { openStages, useCaseCatalog } from "./use-case-catalog";

interface PanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const selectClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted p-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Cargando {what}...
    </div>
  );
}

const NO_OPEN_CASE =
  "Si el contacto no tiene una gestión abierta, el nodo abre una (como lo haría un mensaje entrante) antes de actuar.";

/* ───────── Clasificar gestión ───────── */
export function ClassifyCasePanel({ data, onChange }: PanelProps) {
  const catalog = useCaseCatalog();
  const caseTypeId = (data.caseTypeId as string) || "";
  const stageId = (data.stageId as string) || "";
  const categoryId = (data.categoryId as string) || "";
  const type = catalog.caseTypes.find((t) => t.id === caseTypeId);
  const stages = openStages(type);
  const categories = type?.categories ?? [];

  return (
    <div className="space-y-4">
      <InfoBox title="Clasificar gestión">
        Asigna un tipo a la gestión abierta del contacto. {NO_OPEN_CASE}
      </InfoBox>

      <div>
        <label className="mb-2 block text-xs font-semibold text-muted-foreground">Tipo de gestión</label>
        {catalog.loading ? (
          <Loading what="tipos de gestión" />
        ) : catalog.caseTypes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay tipos de gestión. Créalos en Configuración &gt; Gestiones.</p>
        ) : (
          <select
            value={caseTypeId}
            onChange={(e) => {
              const next = catalog.caseTypes.find((t) => t.id === e.target.value);
              onChange({
                ...data,
                caseTypeId: e.target.value,
                caseTypeName: next?.name ?? "",
                stageId: "",
                stageName: "",
                categoryId: "",
                categoryName: "",
              });
            }}
            className={selectClass}
          >
            <option value="">Selecciona un tipo...</option>
            {catalog.caseTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {caseTypeId && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-muted-foreground">Etapa (opcional)</label>
          <select
            value={stageId}
            onChange={(e) => {
              const stage = stages.find((s) => s.id === e.target.value);
              onChange({ ...data, stageId: e.target.value, stageName: stage?.name ?? "" });
            }}
            className={selectClass}
          >
            <option value="">Primera etapa del tipo</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Al clasificar, la gestión pasa a la primera etapa del tipo. Elige otra si debe quedar en una etapa distinta.
          </p>
        </div>
      )}

      {caseTypeId && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-muted-foreground">Categoría (opcional)</label>
          <select
            value={categoryId}
            onChange={(e) => {
              const category = categories.find((c) => c.id === e.target.value);
              onChange({ ...data, categoryId: e.target.value, categoryName: category?.name ?? "" });
            }}
            className={selectClass}
          >
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Debe ser una categoría del tipo elegido; si no lo es, el flujo la ignora y deja registro.
          </p>
        </div>
      )}
    </div>
  );
}

/* ───────── Cambiar etapa ───────── */
export function ChangeStagePanel({ data, onChange }: PanelProps) {
  const catalog = useCaseCatalog();
  const stageId = (data.stageId as string) || "";

  return (
    <div className="space-y-4">
      <InfoBox title="Cambiar etapa">
        Mueve la gestión del contacto a otra etapa de su tipo. La etapa debe pertenecer al tipo con el que está
        clasificada la gestión. {NO_OPEN_CASE}
      </InfoBox>

      <div>
        <label className="mb-2 block text-xs font-semibold text-muted-foreground">Etapa</label>
        {catalog.loading ? (
          <Loading what="etapas" />
        ) : catalog.caseTypes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay tipos de gestión. Créalos en Configuración &gt; Gestiones.</p>
        ) : (
          <select
            value={stageId}
            onChange={(e) => {
              const id = e.target.value;
              const stage = catalog.caseTypes.flatMap((t) => t.stages).find((s) => s.id === id);
              onChange({ ...data, stageId: id, stageName: stage?.name ?? "" });
            }}
            className={selectClass}
          >
            <option value="">Selecciona una etapa...</option>
            {catalog.caseTypes.map((t) => (
              <optgroup key={t.id} label={t.name}>
                {openStages(t).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">
          Para ganar, perder o resolver una gestión, ciérrala desde la gestión: aquí solo hay etapas abiertas.
        </p>
      </div>
    </div>
  );
}

/* ───────── Asignar a equipo ───────── */
export function AssignTeamPanel({ data, onChange }: PanelProps) {
  const catalog = useCaseCatalog();
  const mode = data.mode === "reroute" ? "reroute" : "fixed";
  const teamId = (data.teamId as string) || "";

  return (
    <div className="space-y-4">
      <InfoBox title="Asignar a equipo">
        Cambia el equipo de la gestión y, si no tiene responsable, la reparte entre los asesores del equipo nuevo.{" "}
        {NO_OPEN_CASE}
      </InfoBox>

      <div className="space-y-1.5">
        {(
          [
            ["fixed", "Equipo fijo", "Siempre al equipo que elijas."],
            ["reroute", "Volver a rutear", "Recalcula el equipo según el tipo de gestión y el contacto (equipo fijo del tipo, sede del contacto o equipo por defecto)."],
          ] as const
        ).map(([value, title, description]) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 hover:border-input"
          >
            <input
              type="radio"
              name="assignTeamMode"
              checked={mode === value}
              onChange={() => onChange({ ...data, mode: value })}
              className="mt-0.5 h-4 w-4 border-input"
            />
            <div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </label>
        ))}
      </div>

      {mode === "fixed" && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-muted-foreground">Equipo</label>
          {catalog.loading ? (
            <Loading what="equipos" />
          ) : catalog.teams.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay equipos. Créalos en Configuración &gt; Equipos.</p>
          ) : (
            <select
              value={teamId}
              onChange={(e) => {
                const team = catalog.teams.find((t) => t.id === e.target.value);
                onChange({ ...data, teamId: e.target.value, teamName: team?.name ?? "" });
              }}
              className={selectClass}
            >
              <option value="">Selecciona un equipo...</option>
              {catalog.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────── Repartir a asesor ───────── */
export function DistributeCasePanel({ data, onChange }: PanelProps) {
  return (
    <div className="space-y-4">
      <InfoBox title="Repartir a asesor">
        Aplica el reparto del equipo actual de la gestión (por turnos o por carga, según el equipo). Fuera del horario
        del equipo, la gestión queda sin asignar y se reparte al abrir. {NO_OPEN_CASE}
      </InfoBox>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3">
        <input
          type="checkbox"
          checked={data.replaceAssignee === true}
          onChange={(e) => onChange({ ...data, replaceAssignee: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <div>
          <p className="text-sm font-medium text-foreground">Repartir aunque ya tenga responsable</p>
          <p className="text-xs text-muted-foreground">
            Si no lo marcas y la gestión ya tiene responsable, el nodo no cambia nada.
          </p>
        </div>
      </label>
    </div>
  );
}
