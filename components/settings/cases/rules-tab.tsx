"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { addRule, removeRule, reorderRules, setRuleEnabled, updateRule } from "@/lib/actions/case-config";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { CaseRuleAction, CaseRuleTrigger } from "@/lib/types/database";
import {
  ACTION_LABELS,
  MAX_RULE_DAYS,
  OUTCOME_KINDS,
  RULE_ACTIONS,
  RULE_TRIGGERS,
  TRIGGER_LABELS,
  archivedRuleTargets,
  describeRule,
  moveId,
  type CaseConfigData,
  type CaseTypeConfig,
  type RuleConfig,
  type RuleInput,
} from "./config-rules";
import {
  SectionTitle,
  Switch,
  iconButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  type RunFn,
  type TabProps,
} from "./shared";
import { cn } from "@/lib/utils";

interface FormState {
  trigger: CaseRuleTrigger;
  triggerStageId: string;
  categoryId: string;
  reasonId: string;
  contactTypeId: string;
  action: CaseRuleAction;
  targetContactTypeId: string;
  fromNth: string;
  scheduleCaseTypeId: string;
  scheduleMode: "days_after" | "days_before_key_date";
  days: string;
  label: string;
}

function initialForm(rule: RuleConfig | null, type: CaseTypeConfig, data: CaseConfigData): FormState {
  const p = rule?.params ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? String(v) : "");
  const activeContactTypes = data.contactTypes.filter((c) => !c.archived);
  return {
    trigger: rule?.trigger ?? "on_won",
    triggerStageId: rule?.triggerStageId ?? type.stages.find((s) => !s.archived)?.id ?? "",
    categoryId: rule?.condition.category_id ?? "",
    reasonId: rule?.condition.outcome_reason_id ?? "",
    contactTypeId: rule?.condition.contact_type_id ?? "",
    action: rule?.action ?? "set_contact_type",
    targetContactTypeId: str(p.contact_type_id) || activeContactTypes[0]?.id || "",
    fromNth: num(p.from_nth_win),
    scheduleCaseTypeId: str(p.case_type_id) || data.caseTypes.find((t) => !t.archived)?.id || "",
    scheduleMode: typeof p.days_before_key_date === "number" ? "days_before_key_date" : "days_after",
    days: num(p.days_before_key_date) || num(p.days_after) || "",
    label: str(p.label) || data.keyDateLabel || "Fecha clave",
  };
}

function toInput(f: FormState): RuleInput {
  const nth = f.fromNth.trim() === "" ? null : Number(f.fromNth);
  return {
    trigger: f.trigger,
    triggerStageId: f.trigger === "on_stage" ? f.triggerStageId : null,
    condition: {
      categoryId: f.categoryId || null,
      outcomeReasonId: f.reasonId || null,
      contactTypeId: f.contactTypeId || null,
    },
    action: f.action,
    contactTypeId: f.targetContactTypeId || null,
    fromNthWin: nth,
    scheduleCaseTypeId: f.scheduleCaseTypeId || null,
    scheduleMode: f.scheduleMode,
    days: f.days.trim() === "" ? null : Number(f.days),
    label: f.label,
  };
}

const REASON_KIND_FOR: Partial<Record<CaseRuleTrigger, (typeof OUTCOME_KINDS)[number]>> = {
  on_won: "won",
  on_lost: "lost",
  on_resolved: "resolved",
};

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function RuleForm({
  rule,
  type,
  data,
  run,
  busy,
  onDone,
}: {
  rule: RuleConfig | null;
  type: CaseTypeConfig;
  data: CaseConfigData;
  run: RunFn;
  busy: boolean;
  onDone: () => void;
}) {
  const [f, setF] = useState<FormState>(() => initialForm(rule, type, data));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((cur) => ({ ...cur, [key]: value }));

  const stages = type.stages.filter((s) => !s.archived || s.id === f.triggerStageId);
  const categories = type.categories.filter((c) => !c.archived || c.id === f.categoryId);
  const expectedKind = REASON_KIND_FOR[f.trigger];
  const reasons = type.reasons.filter((r) => (!r.archived || r.id === f.reasonId) && r.kind === expectedKind);
  const contactTypes = data.contactTypes.filter((c) => !c.archived || c.id === f.contactTypeId || c.id === f.targetContactTypeId);
  const caseTypes = data.caseTypes.filter((t) => !t.archived || t.id === f.scheduleCaseTypeId);

  function changeTrigger(trigger: CaseRuleTrigger) {
    setF((cur) => ({ ...cur, trigger, reasonId: "" }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = toInput(f);
    const ok = await run(
      () => (rule ? updateRule({ id: rule.id, rule: input }) : addRule({ caseTypeId: type.id, rule: input })),
      rule ? "Regla actualizada." : "Regla agregada.",
    );
    if (ok) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <h4 className="text-sm font-semibold">{rule ? "Editar regla" : "Regla nueva"}</h4>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Momento" htmlFor="rule-trigger">
          <select id="rule-trigger" value={f.trigger} onChange={(e) => changeTrigger(e.target.value as CaseRuleTrigger)} disabled={busy} className={`${inputClass} w-full`}>
            {RULE_TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        {f.trigger === "on_stage" && (
          <Field label="Etapa" htmlFor="rule-stage">
            <select id="rule-stage" value={f.triggerStageId} onChange={(e) => set("triggerStageId", e.target.value)} disabled={busy} className={`${inputClass} w-full`}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.archived ? " (archivada)" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <fieldset className="space-y-3 rounded-lg border border-border bg-card p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">Condición (opcional)</legend>
        <p className="text-xs text-muted-foreground">Si no eliges nada, la regla se aplica siempre en ese momento.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Categoría" htmlFor="rule-category">
            <select id="rule-category" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} disabled={busy || categories.length === 0} className={`${inputClass} w-full`}>
              <option value="">Cualquiera</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Motivo" htmlFor="rule-reason" hint={expectedKind ? undefined : "Solo al ganar, perder o resolver."}>
            <select id="rule-reason" value={f.reasonId} onChange={(e) => set("reasonId", e.target.value)} disabled={busy || !expectedKind} className={`${inputClass} w-full`}>
              <option value="">Cualquiera</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo de contacto" htmlFor="rule-contact-type">
            <select id="rule-contact-type" value={f.contactTypeId} onChange={(e) => set("contactTypeId", e.target.value)} disabled={busy} className={`${inputClass} w-full`}>
              <option value="">Cualquiera</option>
              {contactTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-border bg-card p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">Acción</legend>
        <Field label="Qué hacer" htmlFor="rule-action">
          <select id="rule-action" value={f.action} onChange={(e) => set("action", e.target.value as CaseRuleAction)} disabled={busy} className={`${inputClass} w-full sm:max-w-xs`}>
            {RULE_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>

        {f.action === "set_contact_type" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pasar el contacto a" htmlFor="rule-target-contact-type">
              <select id="rule-target-contact-type" value={f.targetContactTypeId} onChange={(e) => set("targetContactTypeId", e.target.value)} disabled={busy} className={`${inputClass} w-full`}>
                {data.contactTypes
                  .filter((c) => !c.archived || c.id === f.targetContactTypeId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Desde la vez número" htmlFor="rule-nth" hint="Vacío: siempre. Con 2, desde la segunda gestión ganada del contacto.">
              <input id="rule-nth" type="number" min={1} step={1} value={f.fromNth} onChange={(e) => set("fromNth", e.target.value)} disabled={busy} placeholder="Siempre" className={`${inputClass} w-full`} />
            </Field>
          </div>
        )}

        {f.action === "schedule_case" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Programar una gestión de tipo" htmlFor="rule-schedule-type">
              <select id="rule-schedule-type" value={f.scheduleCaseTypeId} onChange={(e) => set("scheduleCaseTypeId", e.target.value)} disabled={busy} className={`${inputClass} w-full`}>
                {caseTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cuándo" htmlFor="rule-schedule-mode">
              <select id="rule-schedule-mode" value={f.scheduleMode} onChange={(e) => set("scheduleMode", e.target.value as FormState["scheduleMode"])} disabled={busy} className={`${inputClass} w-full`}>
                <option value="days_after">N días después</option>
                <option value="days_before_key_date">N días antes de la fecha clave</option>
              </select>
            </Field>
            <Field label="Días" htmlFor="rule-days">
              <input id="rule-days" type="number" min={0} max={MAX_RULE_DAYS} step={1} value={f.days} onChange={(e) => set("days", e.target.value)} disabled={busy} className={`${inputClass} w-full`} />
            </Field>
          </div>
        )}

        {f.action === "ask_key_date" && (
          <Field label="Etiqueta de la fecha" htmlFor="rule-label" hint="Es lo que verá la persona al cerrar la gestión, por ejemplo «Vencimiento de membresía».">
            <input id="rule-label" value={f.label} onChange={(e) => set("label", e.target.value)} maxLength={100} disabled={busy} className={`${inputClass} w-full sm:max-w-sm`} />
          </Field>
        )}
      </fieldset>

      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onDone} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className={primaryButtonClass} disabled={busy}>
          {rule ? "Guardar regla" : "Agregar regla"}
        </button>
      </div>
    </form>
  );
}

export function RulesTab({ type, data, run, busy }: TabProps) {
  const [editing, setEditing] = useState<RuleConfig | "new" | null>(null);
  const [deleting, setDeleting] = useState<RuleConfig | null>(null);

  const rules = [...type.rules].sort((a, b) => a.position - b.position);
  const ids = rules.map((r) => r.id);
  const lookup = {
    stages: type.stages,
    categories: type.categories,
    reasons: type.reasons,
    contactTypes: data.contactTypes,
    caseTypes: data.caseTypes,
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Reglas"
        hint="Qué pasa en el CRM cuando una gestión de este tipo se abre, cambia de etapa o se cierra. Se aplican en este orden. Si varias reglas cambian el tipo de contacto, gana la más específica (la que pide más ganadas, p. ej. «desde la 3.ª» gana a «desde la 2.ª»); si empatan, la que está más abajo."
      />

      <ul className="space-y-2">
        {rules.map((r, i) => {
          const d = describeRule(r, lookup);
          const archivedTargets = archivedRuleTargets(r, lookup);
          return (
            <li key={r.id} className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2", !r.enabled && "opacity-60")}>
              <div className="flex flex-col">
                <button type="button" className={cn(iconButtonClass, "h-4")} disabled={busy || i === 0} onClick={() => run(() => reorderRules({ caseTypeId: type.id, orderedIds: moveId(ids, r.id, "up") }))} title="Subir" aria-label="Subir regla">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" className={cn(iconButtonClass, "h-4")} disabled={busy || i === rules.length - 1} onClick={() => run(() => reorderRules({ caseTypeId: type.id, orderedIds: moveId(ids, r.id, "down") }))} title="Bajar" aria-label="Bajar regla">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">{d.when}</p>
                {d.condition && <p className="text-xs text-muted-foreground">{d.condition}</p>}
                <p className="text-muted-foreground">{d.what}</p>
                {archivedTargets.length > 0 && (
                  <p className="text-xs font-medium text-amber-600">
                    Usa {archivedTargets.join(" y ")} (archivado): no se aplica hasta que lo reactives o cambies la regla.
                  </p>
                )}
              </div>
              <Switch
                checked={r.enabled}
                disabled={busy}
                onChange={(enabled) => run(() => setRuleEnabled({ id: r.id, enabled }), enabled ? "Regla activada." : "Regla desactivada.")}
                label={r.enabled ? "Activa" : "Inactiva"}
              />
              <div className="flex items-center">
                <button type="button" className={iconButtonClass} disabled={busy} onClick={() => setEditing(r)} title="Editar" aria-label="Editar regla">
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" className={cn(iconButtonClass, "hover:text-destructive")} disabled={busy} onClick={() => setDeleting(r)} title="Borrar" aria-label="Borrar regla">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
        {rules.length === 0 && <li className="text-xs text-muted-foreground">Este tipo no tiene reglas.</li>}
      </ul>

      {editing === null ? (
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" />
          Agregar regla
        </button>
      ) : (
        <RuleForm
          key={editing === "new" ? "new" : `${editing.id}:${editing.updatedAt}`}
          rule={editing === "new" ? null : editing}
          type={type}
          data={data}
          run={run}
          busy={busy}
          onDone={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Borrar la regla"
        message="Las reglas no guardan historial: se borra de verdad y deja de aplicarse a las gestiones nuevas. Si solo quieres pausarla, desactívala."
        confirmLabel="Borrar"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const rule = deleting;
          setDeleting(null);
          if (rule) await run(() => removeRule(rule.id), "Regla borrada.");
        }}
      />
    </div>
  );
}
