"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  MessageSquare,
  HelpCircle,
  UserPlus,
  GitBranch,
  Loader2,
  BookmarkPlus,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

// --- Template types ---

interface TemplateNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface TemplateEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

// --- Built-in templates ---

const templates: FlowTemplate[] = [
  {
    id: "welcome-flow",
    name: "Flujo de bienvenida",
    description:
      "Saluda a los clientes nuevos con un mensaje de bienvenida, espera un minuto y envía un seguimiento para mantener la conversación.",
    category: "Bienvenida",
    icon: MessageSquare,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-100",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 250, y: 0 },
        data: {
          label: "Disparador de bienvenida",
          triggerType: "welcome",
          config: {},
        },
      },
      {
        id: "msg-1",
        type: "sendMessage",
        position: { x: 250, y: 150 },
        data: {
          label: "Saludo",
          text: "¡Hola! Bienvenido, qué gusto tenerte por aquí. ¿En qué podemos ayudarte hoy?",
        },
      },
      {
        id: "delay-1",
        type: "delay",
        position: { x: 250, y: 300 },
        data: {
          label: "Esperar 1 minuto",
          duration: 60,
          unit: "seconds",
        },
      },
      {
        id: "msg-2",
        type: "sendMessage",
        position: { x: 250, y: 450 },
        data: {
          label: "Seguimiento",
          text: "Por cierto, pregúntame lo que necesites. ¡Estoy para ayudarte!",
        },
      },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "msg-1" },
      { id: "e2", source: "msg-1", target: "delay-1" },
      { id: "e3", source: "delay-1", target: "msg-2" },
    ],
  },
  {
    id: "faq-bot",
    name: "Bot de preguntas frecuentes",
    description:
      'Responde a las palabras clave "ayuda" o "preguntas" revisando el mensaje y dirigiéndolo a distintas ramas de respuesta.',
    category: "Soporte",
    icon: HelpCircle,
    iconColor: "text-amber-600",
    iconBg: "bg-amber-100",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 250, y: 0 },
        data: {
          label: "Disparador de preguntas frecuentes",
          triggerType: "keyword",
          config: { keywords: ["ayuda", "preguntas"] },
        },
      },
      {
        id: "condition-1",
        type: "condition",
        position: { x: 250, y: 150 },
        data: {
          label: "Revisar palabra clave",
          conditions: [
            {
              id: "c1",
              field: "trigger_keyword",
              operator: "equals",
              value: "ayuda",
            },
          ],
        },
      },
      {
        id: "msg-help",
        type: "sendMessage",
        position: { x: 50, y: 350 },
        data: {
          label: "Respuesta de ayuda",
          text: "Te puedo ayudar con lo siguiente:\n- Precios y promociones\n- Pedidos y delivery\n- Soporte con tu compra\n\n¡Escribe tu consulta y te respondo enseguida!",
        },
      },
      {
        id: "msg-faq",
        type: "sendMessage",
        position: { x: 450, y: 350 },
        data: {
          label: "Respuesta de preguntas frecuentes",
          text: "Estas son nuestras preguntas más frecuentes:\n\n1. ¿Cómo hago mi pedido?\n2. ¿Qué medios de pago aceptan (Yape, Plin, tarjeta)?\n3. ¿Hacen envíos a todo el Perú?\n\n¡Responde con un número para ver más detalles!",
        },
      },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "condition-1" },
      {
        id: "e2",
        source: "condition-1",
        target: "msg-help",
        sourceHandle: "true",
      },
      {
        id: "e3",
        source: "condition-1",
        target: "msg-faq",
        sourceHandle: "false",
      },
    ],
  },
  {
    id: "lead-capture",
    name: "Captura de clientes potenciales",
    description:
      "Recoge los datos del cliente paso a paso: pregunta el nombre, espera la respuesta y guárdala; luego pide el correo y etiqueta al contacto.",
    category: "Marketing",
    icon: UserPlus,
    iconColor: "text-green-600",
    iconBg: "bg-green-100",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 250, y: 0 },
        data: {
          label: "Disparador de clientes potenciales",
          triggerType: "keyword",
          config: { keywords: ["me interesa", "info", "precio"] },
        },
      },
      {
        id: "msg-name",
        type: "sendMessage",
        position: { x: 250, y: 120 },
        data: {
          label: "Pedir nombre",
          text: "¡Genial, con gusto te ayudo! ¿Cómo te llamas?",
        },
      },
      {
        id: "wait-name",
        type: "smartDelay",
        position: { x: 250, y: 240 },
        data: {
          label: "Esperar el nombre",
          waitForInput: true,
          timeout: 300,
        },
      },
      {
        id: "set-name",
        type: "setCustomField",
        position: { x: 250, y: 360 },
        data: {
          label: "Guardar nombre",
          fieldSlug: "name",
          value: "{{last_message}}",
        },
      },
      {
        id: "msg-email",
        type: "sendMessage",
        position: { x: 250, y: 480 },
        data: {
          label: "Pedir correo",
          text: "¡Gracias, {{name}}! ¿Cuál es tu correo electrónico para enviarte más detalles?",
        },
      },
      {
        id: "wait-email",
        type: "smartDelay",
        position: { x: 250, y: 600 },
        data: {
          label: "Esperar el correo",
          waitForInput: true,
          timeout: 300,
        },
      },
      {
        id: "set-email",
        type: "setCustomField",
        position: { x: 250, y: 720 },
        data: {
          label: "Guardar correo",
          fieldSlug: "email",
          value: "{{last_message}}",
        },
      },
      {
        id: "tag-lead",
        type: "addTag",
        position: { x: 250, y: 840 },
        data: {
          label: 'Agregar etiqueta "lead"',
          tagName: "lead",
        },
      },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "msg-name" },
      { id: "e2", source: "msg-name", target: "wait-name" },
      { id: "e3", source: "wait-name", target: "set-name" },
      { id: "e4", source: "set-name", target: "msg-email" },
      { id: "e5", source: "msg-email", target: "wait-email" },
      { id: "e6", source: "wait-email", target: "set-email" },
      { id: "e7", source: "set-email", target: "tag-lead" },
    ],
  },
];

// --- Component ---

export function TemplatesView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function handleUseTemplate(template: FlowTemplate) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setCreating(template.id);

    try {
      const res = await fetch("/api/v1/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          description: template.description,
          nodes: template.nodes,
          edges: template.edges,
        }),
      });

      if (!res.ok) {
        throw new Error("No se pudo crear el flujo");
      }

      const flow = await res.json();
      router.push(`/dashboard/flows/${flow.id}`);
    } catch (err) {
      console.error("No se pudo crear el flujo desde la plantilla:", err);
      pendingRef.current = false;
      setCreating(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link
                href="/dashboard/flows"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Flujos
              </Link>
            </div>
            <h1 className="text-2xl font-bold">Plantillas de flujos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Empieza con un flujo prediseñado y personalízalo a tu medida
            </p>
          </div>
          <button
            disabled
            className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2 text-sm font-medium text-muted-foreground cursor-not-allowed opacity-60"
            title="Próximamente"
          >
            <BookmarkPlus className="h-4 w-4" />
            Guardar flujo actual como plantilla
          </button>
        </div>
      </div>

      {/* Template gallery */}
      <div className="flex-1 overflow-auto p-8">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const isCreating = creating === template.id;
            const Icon = template.icon;
            const nodeCount = template.nodes.length;

            return (
              <div
                key={template.id}
                className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/50"
              >
                {/* Icon + category */}
                <div className="flex items-start justify-between">
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      template.iconBg
                    )}
                  >
                    <Icon className={cn("h-5 w-5", template.iconColor)} />
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {template.category}
                  </span>
                </div>

                {/* Name + description */}
                <h3 className="mt-4 text-sm font-semibold group-hover:text-primary transition-colors">
                  {template.name}
                </h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  {template.description}
                </p>

                {/* Node count */}
                <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <GitBranch className="h-3 w-3" />
                  <span>
                    {nodeCount} {nodeCount === 1 ? "nodo" : "nodos"}
                  </span>
                </div>

                {/* Use template button */}
                <button
                  onClick={() => handleUseTemplate(template)}
                  disabled={!!creating}
                  className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {isCreating ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Creando...
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5" />
                      Usar plantilla
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
