"use client";

import { useState, useCallback } from "react";
import { useToast } from "@/components/ui/toast";
import {
  ArrowLeft,
  Plus,
  Trash2,
  MessageSquare,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { updateSequence, deleteSequence } from "@/lib/actions/sequences";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TemplateContentEditor } from "@/components/sequences/template-content-editor";
import { validateSequenceSteps } from "@/lib/broadcasts/sequence-step";
import type { SequenceStep, TemplateMessageContent } from "@/lib/types/database";

interface SequenceEditorProps {
  workspaceId: string;
  sequence: {
    id: string;
    name: string;
    description: string | null;
    status: "draft" | "active" | "paused";
    steps: SequenceStep[];
  };
}

const statusConfig = {
  draft: {
    label: "Borrador",
    classes: "bg-muted text-muted-foreground",
  },
  active: {
    label: "Activa",
    classes:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  paused: {
    label: "Pausada",
    classes:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
};

export function SequenceEditor({ workspaceId, sequence }: SequenceEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(sequence.name);
  const [description, setDescription] = useState(sequence.description || "");
  const [steps, setSteps] = useState<SequenceStep[]>(sequence.steps);
  const [status, setStatus] = useState(sequence.status);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setError(null);
    setSuccess(null);

    // Los pasos de plantilla necesitan una plantilla elegida y, si la secuencia
    // queda activa, todos los pasos tienen que estar completos.
    const missing = steps.findIndex(
      (s) => s.type === "template" && !(s.template?.template_name && s.template?.language)
    );
    if (missing >= 0) {
      setError("El paso " + (missing + 1) + " es de plantilla: elige una plantilla aprobada.");
      return;
    }
    if (status === "active") {
      const problem = validateSequenceSteps(steps);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setSaving(true);

    try {
      const result = await updateSequence(sequence.id, {
        name: name.trim(),
        description: description.trim() || null,
        steps,
        status,
      });

      if (result.error) {
        setError(result.error);
        toast.error(result.error);
      } else {
        setSuccess("Guardado");
        toast.success("Secuencia guardada");
        setTimeout(() => setSuccess(null), 2000);
      }
    } catch {
      setError("No se pudo guardar la secuencia. Inténtalo de nuevo.");
      toast.error("No se pudo guardar la secuencia. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }, [sequence.id, name, description, steps, status, toast]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    const result = await deleteSequence(sequence.id);
    if (result.error) {
      setError(result.error);
      setDeleting(false);
    } else {
      router.push("/dashboard/sequences");
    }
  }, [sequence.id, router]);

  const addStep = useCallback(
    (index: number, type: "message" | "template" | "delay") => {
      const newStep: SequenceStep =
        type === "message"
          ? { type: "message", content: "" }
          : type === "template"
            ? { type: "template", template: null }
            : { type: "delay", delayMinutes: 60 };

      const updated = [...steps];
      updated.splice(index, 0, newStep);
      setSteps(updated);
      setError(null);
    },
    [steps]
  );

  const updateStep = useCallback(
    (index: number, data: Partial<SequenceStep>) => {
      const updated = [...steps];
      updated[index] = { ...updated[index], ...data };
      setSteps(updated);
      setError(null);
    },
    [steps]
  );

  const removeStep = useCallback(
    (index: number) => {
      setSteps(steps.filter((_, i) => i !== index));
      setError(null);
    },
    [steps]
  );

  const toggleStatus = useCallback(() => {
    if (status === "active") {
      setError(null);
      setStatus("paused");
    } else {
      const problem = validateSequenceSteps(steps);
      if (problem) {
        setError(problem);
        return;
      }
      setError(null);
      setStatus("active");
    }
  }, [status, steps]);

  const statusInfo = statusConfig[status];

  return (
    <div className="flex-1 overflow-auto">
      {/* Encabezado */}
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard/sequences")}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-2xl font-bold bg-transparent border-none outline-none focus:ring-0 p-0"
                placeholder="Nombre de la secuencia"
              />
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                  statusInfo.classes
                )}
              >
                {statusInfo.label}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleStatus}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                status === "active"
                  ? "border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
                  : "border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
              )}
            >
              {status === "active" ? "Pausar" : "Activar"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              title="Eliminar secuencia"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <ConfirmDialog
              open={confirmDelete}
              title="Eliminar secuencia"
              message="¿Seguro que quieres eliminar esta secuencia? Esta acción no se puede deshacer."
              confirmLabel="Eliminar"
              destructive
              onConfirm={() => {
                setConfirmDelete(false);
                handleDelete();
              }}
              onCancel={() => setConfirmDelete(false)}
            />
          </div>
        </div>
      </div>

      {/* Contenido */}
      <div className="px-8 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Descripción */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Descripción
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="¿Para qué sirve esta secuencia?"
              rows={2}
              className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Mensajes de error y éxito */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {success}
            </div>
          )}

          {/* Pasos */}
          <div>
            <label className="mb-3 block text-sm font-medium">Pasos</label>

            {/* Botón para agregar al inicio */}
            <AddStepButton onAdd={(type) => addStep(0, type)} />

            {steps.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Aún no hay pasos. Haz clic en el botón + de arriba para agregar el primero.
                </p>
              </div>
            )}

            {steps.map((step, index) => (
              <div key={index}>
                <StepCard
                  workspaceId={workspaceId}
                  step={step}
                  index={index}
                  onChange={(data) => updateStep(index, data)}
                  onRemove={() => removeStep(index)}
                />
                <AddStepButton onAdd={(type) => addStep(index + 1, type)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type MessageMode = "message" | "template" | "fallback";

function modeOf(step: SequenceStep): MessageMode {
  if (step.type === "template") return "template";
  return step.template ? "fallback" : "message";
}

const MODE_LABELS: Record<MessageMode, string> = {
  message: "Mensaje",
  template: "Plantilla",
  fallback: "Mensaje con plantilla alternativa",
};

const MODE_HINTS: Record<MessageMode, string> = {
  message:
    "Solo sale si el contacto escribió hace menos de 24 horas. Si no, el paso falla y la secuencia sigue con el siguiente.",
  template: "Plantilla aprobada de WhatsApp: llega siempre, aunque hayan pasado más de 24 horas.",
  fallback:
    "Si el contacto escribió hace menos de 24 horas se envía el mensaje; si no, se envía la plantilla.",
};

function StepCard({
  workspaceId,
  step,
  index,
  onChange,
  onRemove,
}: {
  workspaceId: string;
  step: SequenceStep;
  index: number;
  onChange: (data: Partial<SequenceStep>) => void;
  onRemove: () => void;
}) {
  const isMessage = step.type === "message" || step.type === "template";
  const mode = modeOf(step);

  function changeMode(next: MessageMode) {
    if (next === mode) return;
    if (next === "template") {
      // Plantilla pura: se conserva la plantilla; el texto ya no aplica.
      onChange({ type: "template", content: undefined, template: step.template ?? null });
    } else if (next === "message") {
      onChange({ type: "message", content: step.content ?? "", template: null });
    } else {
      onChange({ type: "message", content: step.content ?? "", template: step.template ?? null });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-white",
              !isMessage ? "bg-purple-500" : step.type === "template" ? "bg-emerald-500" : "bg-blue-500"
            )}
          >
            {isMessage ? (
              <MessageSquare className="h-3.5 w-3.5" />
            ) : (
              <Clock className="h-3.5 w-3.5" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium">
              Paso {index + 1}:{" "}
              {!isMessage ? "Esperar" : step.type === "template" ? "Enviar plantilla" : "Enviar mensaje"}
            </p>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3">
        {isMessage ? (
          <div className="space-y-3">
            <div>
              <select
                value={mode}
                onChange={(e) => changeMode(e.target.value as MessageMode)}
                aria-label="Tipo de envío"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {(Object.keys(MODE_LABELS) as MessageMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">{MODE_HINTS[mode]}</p>
            </div>

            {mode !== "template" && (
              <textarea
                value={step.content || ""}
                onChange={(e) => onChange({ content: e.target.value })}
                placeholder="Escribe tu mensaje..."
                rows={3}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}

            {mode !== "message" && (
              <div>
                {mode === "fallback" && (
                  <p className="mb-2 text-xs font-medium">Plantilla si pasaron más de 24 horas</p>
                )}
                <TemplateContentEditor
                  workspaceId={workspaceId}
                  value={step.template ?? null}
                  onChange={(template: TemplateMessageContent | null) => onChange({ template })}
                />
              </div>
            )}
          </div>
        ) : (
          <DelayPicker
            minutes={step.delayMinutes || 60}
            onChange={(delayMinutes) => onChange({ delayMinutes })}
          />
        )}
      </div>
    </div>
  );
}

function DelayPicker({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  // Convertir los minutos a la mejor unidad
  let value: number;
  let unit: "minutes" | "hours" | "days";

  if (minutes >= 1440 && minutes % 1440 === 0) {
    value = minutes / 1440;
    unit = "days";
  } else if (minutes >= 60 && minutes % 60 === 0) {
    value = minutes / 60;
    unit = "hours";
  } else {
    value = minutes;
    unit = "minutes";
  }

  const [localValue, setLocalValue] = useState(value);
  const [localUnit, setLocalUnit] = useState(unit);

  function handleChange(newValue: number, newUnit: string) {
    const multipliers: Record<string, number> = {
      minutes: 1,
      hours: 60,
      days: 1440,
    };
    const totalMinutes = Math.max(1, newValue) * (multipliers[newUnit] || 1);
    onChange(totalMinutes);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Esperar</span>
      <input
        type="number"
        min={1}
        value={localValue}
        onChange={(e) => {
          const v = parseInt(e.target.value) || 1;
          setLocalValue(v);
          handleChange(v, localUnit);
        }}
        className="w-20 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <select
        value={localUnit}
        onChange={(e) => {
          setLocalUnit(e.target.value as typeof localUnit);
          handleChange(localValue, e.target.value);
        }}
        className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="minutes">Minutos</option>
        <option value="hours">Horas</option>
        <option value="days">Días</option>
      </select>
    </div>
  );
}

function AddStepButton({
  onAdd,
}: {
  onAdd: (type: "message" | "template" | "delay") => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex justify-center py-2">
      {open ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              onAdd("message");
              setOpen(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <MessageSquare className="h-3 w-3" />
            Mensaje
          </button>
          <button
            onClick={() => {
              onAdd("template");
              setOpen(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <MessageSquare className="h-3 w-3" />
            Plantilla
          </button>
          <button
            onClick={() => {
              onAdd("delay");
              setOpen(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <Clock className="h-3 w-3" />
            Esperar
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
