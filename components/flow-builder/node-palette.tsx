"use client";

import {
  Zap,
  MessageSquare,
  GitBranch,
  Clock,
  Tag,
  FileText,
  ArrowRightLeft,
  UserCheck,
  Bell,
  Shuffle,
  Hourglass,
  Sparkles,
  ListOrdered,
  Layers,
  Flag,
  Users,
  UserPlus,
} from "lucide-react";
import type { DragEvent } from "react";

interface PaletteItem {
  type: string;
  nodeType: string;
  label: string;
  icon: typeof Zap;
  actionType?: string;
}

interface PaletteCategory {
  name: string;
  items: PaletteItem[];
}

const categories: PaletteCategory[] = [
  {
    name: "Disparadores",
    items: [
      { type: "trigger", nodeType: "trigger", label: "Disparador de palabra clave", icon: Zap },
    ],
  },
  {
    name: "Mensajes",
    items: [
      {
        type: "sendMessage",
        nodeType: "sendMessage",
        label: "Enviar mensaje",
        icon: MessageSquare,
      },
      {
        type: "aiResponse",
        nodeType: "aiResponse",
        label: "Respuesta con IA",
        icon: Sparkles,
      },
    ],
  },
  {
    name: "Lógica",
    items: [
      { type: "condition", nodeType: "condition", label: "Condición", icon: GitBranch },
      { type: "delay", nodeType: "delay", label: "Espera", icon: Clock },
      {
        type: "action",
        nodeType: "abSplit",
        label: "Prueba A/B",
        icon: Shuffle,
        actionType: "abSplit",
      },
      {
        type: "action",
        nodeType: "smartDelay",
        label: "Espera inteligente",
        icon: Hourglass,
        actionType: "smartDelay",
      },
    ],
  },
  {
    name: "Gestiones",
    items: [
      {
        type: "action",
        nodeType: "classifyCase",
        label: "Clasificar gestión",
        icon: Layers,
        actionType: "classifyCase",
      },
      {
        type: "action",
        nodeType: "changeStage",
        label: "Cambiar etapa",
        icon: Flag,
        actionType: "changeStage",
      },
      {
        type: "action",
        nodeType: "assignTeam",
        label: "Asignar a equipo",
        icon: Users,
        actionType: "assignTeam",
      },
      {
        type: "action",
        nodeType: "distributeCase",
        label: "Repartir a asesor",
        icon: UserPlus,
        actionType: "distributeCase",
      },
    ],
  },
  {
    name: "Acciones",
    items: [
      {
        type: "action",
        nodeType: "addTag",
        label: "Agregar etiqueta",
        icon: Tag,
        actionType: "addTag",
      },
      {
        type: "action",
        nodeType: "removeTag",
        label: "Quitar etiqueta",
        icon: Tag,
        actionType: "removeTag",
      },
      {
        type: "action",
        nodeType: "setCustomField",
        label: "Asignar campo",
        icon: FileText,
        actionType: "setCustomField",
      },
      // "Solicitud HTTP" (httpRequest) ya no se ofrece para agregar nodos
      // nuevos; el motor y los flujos existentes siguen soportándolo.
      {
        type: "action",
        nodeType: "goToFlow",
        label: "Ir a flujo",
        icon: ArrowRightLeft,
        actionType: "goToFlow",
      },
      {
        type: "action",
        nodeType: "humanTakeover",
        label: "Atención humana",
        icon: UserCheck,
        actionType: "humanTakeover",
      },
      {
        type: "action",
        nodeType: "subscribe",
        label: "Suscribir",
        icon: Bell,
        actionType: "subscribe",
      },
      {
        type: "action",
        nodeType: "unsubscribe",
        label: "Desuscribir",
        icon: Bell,
        actionType: "unsubscribe",
      },
      {
        type: "action",
        nodeType: "enrollSequence",
        label: "Inscribir en secuencia",
        icon: ListOrdered,
        actionType: "enrollSequence",
      },
    ],
  },
];

function onDragStart(event: DragEvent, item: PaletteItem) {
  const data = JSON.stringify({
    type: item.type,
    nodeType: item.nodeType,
    actionType: item.actionType,
  });
  event.dataTransfer.setData("application/reactflow", data);
  event.dataTransfer.effectAllowed = "move";
}

export function NodePalette() {
  return (
    <div className="flex w-56 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Nodos</h2>
        <p className="text-xs text-muted-foreground">Arrastra al lienzo</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {categories.map((category) => (
          <div key={category.name} className="mb-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {category.name}
            </h3>
            <div className="space-y-1">
              {category.items.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.nodeType}
                    draggable
                    onDragStart={(e) => onDragStart(e, item)}
                    className="flex cursor-grab items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground active:cursor-grabbing"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-xs font-medium">{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
