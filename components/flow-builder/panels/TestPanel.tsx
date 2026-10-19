"use client";

import { useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import {
  X,
  Play,
  MessageSquare,
  GitBranch,
  Clock,
  Tag,
  Sparkles,
  Shuffle,
  Hand,
  ArrowRight,
  Globe,
  AlertCircle,
  CheckCircle2,
  XCircle,
  UserPlus,
  ListOrdered,
  Send,
  Zap,
  User,
  RotateCcw,
  ExternalLink,
} from "lucide-react";
import {
  simulateFlow,
  type SimulationConfig,
  type SimulationState,
  type SimulationStep,
} from "@/lib/flow-engine/simulator";
import {
  simulatorNodeLabel,
  triggerTypeLabel,
  unitLabel,
} from "../labels";

interface TestPanelProps {
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  onHighlightNode: (nodeId: string) => void;
}

const stepIcons: Record<string, typeof MessageSquare> = {
  trigger: Zap,
  message: MessageSquare,
  reply: User,
  template: MessageSquare,
  message_skipped: AlertCircle,
  condition: GitBranch,
  delay: Clock,
  action: Tag,
  ai_response: Sparkles,
  split: Shuffle,
  smart_delay: Clock,
  human_takeover: Hand,
  go_to_flow: ArrowRight,
  enroll_sequence: ListOrdered,
  subscribe: UserPlus,
  unsubscribe: UserPlus,
  comment_reply: Send,
  private_reply: Send,
  http_request: Globe,
  error: AlertCircle,
  flow_end: CheckCircle2,
};

const stepColors: Record<string, string> = {
  trigger: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950",
  message: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950",
  reply: "text-slate-600 bg-slate-100 dark:text-slate-300 dark:bg-slate-800",
  template: "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950",
  message_skipped: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950",
  condition:
    "text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950",
  delay: "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950",
  action: "text-teal-600 bg-teal-50 dark:text-teal-400 dark:bg-teal-950",
  ai_response:
    "text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-950",
  split: "text-pink-600 bg-pink-50 dark:text-pink-400 dark:bg-pink-950",
  smart_delay:
    "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950",
  human_takeover:
    "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950",
  go_to_flow: "text-cyan-600 bg-cyan-50 dark:text-cyan-400 dark:bg-cyan-950",
  enroll_sequence:
    "text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-950",
  subscribe: "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950",
  unsubscribe: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950",
  comment_reply:
    "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950",
  private_reply:
    "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950",
  http_request:
    "text-cyan-600 bg-cyan-50 dark:text-cyan-400 dark:bg-cyan-950",
  error: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950",
  flow_end: "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950",
};

export function TestPanel({
  nodes,
  edges,
  onClose,
  onHighlightNode,
}: TestPanelProps) {
  const [message, setMessage] = useState("ayuda");
  const [reply, setReply] = useState("");
  const [tags, setTags] = useState("");
  const [windowClosed, setWindowClosed] = useState(false);
  const [offHours, setOffHours] = useState(false);
  const [hasAssignee, setHasAssignee] = useState(false);
  // La prueba es una conversación por turnos: el flujo se detiene en cada espera
  // de respuesta y el siguiente mensaje (escrito o un botón) lo retoma.
  const [started, setStarted] = useState(false);
  const [steps, setSteps] = useState<SimulationStep[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [waiting, setWaiting] = useState<SimulationState | null>(null);

  function baseConfig(text: string): SimulationConfig {
    const mockTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return {
      incomingMessage: text,
      mockContact: {
        tags: mockTags,
        isSubscribed: true,
      },
      mockCase: { withinHours: !offHours, hasAssignee },
      windowOpen: windowClosed ? false : undefined,
    };
  }

  /** Envía un mensaje del cliente: retoma la espera, o inicia el flujo de nuevo si no hay espera. */
  function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean) return;
    const config = baseConfig(clean);
    const sim = waiting ? simulateFlow(nodes, edges, { ...config, resume: waiting }) : simulateFlow(nodes, edges, config);
    setSteps((prev) => (started ? [...prev, ...sim.steps] : sim.steps));
    setErrors(sim.errors);
    setWaiting(sim.waiting ?? null);
    setStarted(true);
    setReply("");
  }

  function restart() {
    setStarted(false);
    setSteps([]);
    setErrors([]);
    setWaiting(null);
    setReply("");
  }

  const lastMessageIndex = steps.reduce((last, s, i) => (s.result.type === "message" ? i : last), -1);

  function renderStepDetail(step: SimulationStep, canPick: boolean) {
    const r = step.result;

    switch (r.type) {
      case "trigger":
        return (
          <div>
            <span className="text-xs text-muted-foreground">
              Tipo: {triggerTypeLabel(r.triggerType)}
              {r.keywords && ` | Palabras clave: ${r.keywords.join(", ")}`}
            </span>
            <div className="mt-1">
              {r.matched ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <CheckCircle2 className="h-3 w-3" /> Coincide
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                  <XCircle className="h-3 w-3" /> No coincide
                </span>
              )}
            </div>
          </div>
        );

      case "reply":
        return (
          <div className="ml-auto w-fit max-w-full rounded-lg bg-muted px-3 py-2 text-xs">
            {r.text || "(vacío)"}
          </div>
        );

      case "message": {
        const options = [
          ...(r.buttons ?? []).map((b) => ({ ...b, kind: "button" as const })),
          ...(r.quickReplies ?? []).map((q) => ({ title: q.title, type: "postback" as const, url: undefined, kind: "quick" as const })),
        ];
        return (
          <div className="space-y-1">
            {r.texts.map((text, i) => (
              <div
                key={i}
                className="whitespace-pre-wrap rounded-lg bg-primary/10 px-3 py-2 text-xs"
              >
                {text}
              </div>
            ))}
            {options.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {options.map((o, i) =>
                  o.type === "url" ? (
                    <span
                      key={i}
                      title={o.url || "Enlace"}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      {o.title}
                    </span>
                  ) : (
                    <button
                      key={i}
                      type="button"
                      disabled={!canPick}
                      onClick={() => sendMessage(o.title)}
                      title={canPick ? "Responder con este botón" : "Solo se puede pulsar en el último mensaje"}
                      className={`border px-2 py-0.5 text-[10px] transition-colors ${
                        o.kind === "quick" ? "rounded-full" : "rounded-md"
                      } ${
                        canPick
                          ? "border-primary/40 text-primary hover:bg-primary/10"
                          : "cursor-not-allowed border-border text-muted-foreground"
                      }`}
                    >
                      {o.title}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        );
      }

      case "template":
        return (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Ventana de 24 h cerrada: enviaría la plantilla{" "}
              <span className="font-mono">
                {r.templateName} ({r.language})
              </span>
            </p>
            {r.params.length > 0 && (
              <div className="rounded-lg bg-primary/10 px-3 py-2 text-xs">
                {r.params.map((p, i) => (
                  <p key={i}>
                    {"{{"}
                    {i + 1}
                    {"}}"} = {p}
                  </p>
                ))}
              </div>
            )}
          </div>
        );

      case "message_skipped":
        return <p className="text-xs text-amber-600">No se enviaría. {r.reason}</p>;

      case "condition":
        return (
          <div>
            <div className="space-y-0.5">
              {r.conditions.map((c, i) => (
                <p key={i} className="text-xs text-muted-foreground font-mono">
                  {c}
                </p>
              ))}
            </div>
            <div className="mt-1">
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium ${
                  r.result ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {r.result ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <XCircle className="h-3 w-3" />
                )}
                {r.result ? "VERDADERO" : "FALSO"} &rarr; rama{" "}
                {r.path === "true" ? "Sí" : r.path === "false" ? "No" : r.path}
              </span>
            </div>
          </div>
        );

      case "delay":
        return (
          <p className="text-xs text-muted-foreground">
            Esperaría {r.duration} {unitLabel(r.unit)}{" "}
            <span className="text-amber-600">(omitido en la prueba)</span>
          </p>
        );

      case "action":
        return (
          <p className="text-xs text-muted-foreground">
            {r.detail}
          </p>
        );

      case "ai_response":
        return (
          <p className="text-xs text-muted-foreground">
            {r.mode === "skipped"
              ? "Aquí la IA generaría una respuesta"
              : r.text}
          </p>
        );

      case "split":
        return (
          <p className="text-xs text-muted-foreground">
            Elegido al azar: <strong>{r.selectedPath}</strong> (peso:{" "}
            {r.weight})
          </p>
        );

      case "smart_delay":
        return (
          <p className="text-xs text-muted-foreground">
            Espera la respuesta del cliente{" "}
            <span className="text-amber-600">(en pausa)</span>
          </p>
        );

      case "human_takeover":
        return (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Automatización en pausa, marcada para atención humana
            </p>
            {r.note && (
              <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs">
                <span className="font-medium">Nota interna para el asesor:</span> {r.note}
              </div>
            )}
          </div>
        );

      case "go_to_flow":
        return (
          <p className="text-xs text-muted-foreground">
            Saltaría al flujo: <span className="font-mono">{r.flowId}</span>
          </p>
        );

      case "enroll_sequence":
        return (
          <p className="text-xs text-muted-foreground">
            Inscribiría en la secuencia:{" "}
            <span className="font-mono">{r.sequenceId}</span>
          </p>
        );

      case "subscribe":
        return (
          <p className="text-xs text-muted-foreground">
            El contacto sería suscrito
          </p>
        );

      case "unsubscribe":
        return (
          <p className="text-xs text-muted-foreground">
            El contacto sería desuscrito
          </p>
        );

      case "comment_reply":
        return (
          <div className="rounded-lg bg-primary/10 px-3 py-2 text-xs">
            {r.text || "(vacío)"}
          </div>
        );

      case "private_reply":
        return (
          <div className="rounded-lg bg-primary/10 px-3 py-2 text-xs">
            {r.text || "(vacío)"}
          </div>
        );

      case "http_request":
        return (
          <p className="text-xs text-muted-foreground font-mono">
            {r.method} {r.url}
          </p>
        );

      case "error":
        return (
          <p className="text-xs text-red-600">
            {r.message}
          </p>
        );

      case "flow_end":
        return (
          <p className="text-xs text-emerald-600 font-medium">
            Flujo completado correctamente
          </p>
        );

      default:
        return null;
    }
  }

  return (
    <div className="flex w-80 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Probar flujo</h3>
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          title="Cerrar"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Config */}
      <div className="space-y-3 border-b border-border p-4">
        {!started && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Mensaje simulado
            </label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escribe un mensaje de prueba..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMessage(message);
              }}
            />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Etiquetas de prueba (separadas por comas)
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="vip, mayorista"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={windowClosed}
              onChange={(e) => setWindowClosed(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input"
            />
            Ventana de 24 h de WhatsApp cerrada
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={offHours}
              onChange={(e) => setOffHours(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input"
            />
            Fuera de horario
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={hasAssignee}
              onChange={(e) => setHasAssignee(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input"
            />
            La gestión ya tiene responsable
          </label>
        </div>
        {started ? (
          <button
            onClick={restart}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Empezar de nuevo
          </button>
        ) : (
          <button
            onClick={() => sendMessage(message)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Play className="h-3.5 w-3.5" />
            Ejecutar prueba
          </button>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {!started ? (
          <div className="py-8 text-center">
            <Play className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              Ejecuta una prueba para ver el recorrido del flujo
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              El simulador recorre el flujo sin enviar mensajes reales.
            </p>
          </div>
        ) : (
          <div className="space-y-0">
            {/* Errors */}
            {errors.length > 0 && (
              <div className="mb-3 space-y-1">
                {errors.map((err, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 p-2"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                    <p className="text-xs text-red-700 dark:text-red-400">
                      {err}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Steps timeline */}
            {steps.map((step, i) => {
              const Icon =
                stepIcons[step.result.type] || AlertCircle;
              const colorClass =
                stepColors[step.result.type] || stepColors.error;
              const isLast = i === steps.length - 1;

              return (
                <div key={i} className="flex gap-3">
                  {/* Timeline line */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${colorClass}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    {!isLast && (
                      <div className="w-px flex-1 bg-border" />
                    )}
                  </div>

                  {/* Content */}
                  <div
                    className="min-w-0 flex-1 pb-4 cursor-pointer"
                    onClick={() => onHighlightNode(step.nodeId)}
                  >
                    <p className="text-xs font-medium leading-7">
                      {simulatorNodeLabel(step.nodeLabel)}
                    </p>
                    {renderStepDetail(step, i === lastMessageIndex)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Respuesta del cliente */}
      {started && (
        <div className="border-t border-border p-3">
          <p className="mb-1.5 text-[11px] text-muted-foreground">
            {waiting
              ? "El flujo espera la respuesta del cliente: escríbela o pulsa un botón."
              : "El flujo terminó. Un mensaje nuevo lo inicia de nuevo."}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={waiting ? "Respuesta del cliente..." : "Otro mensaje..."}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMessage(reply);
              }}
            />
            <button
              type="button"
              onClick={() => sendMessage(reply)}
              disabled={!reply.trim()}
              aria-label="Enviar"
              title="Enviar"
              className="rounded-lg bg-primary px-3 py-2 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
