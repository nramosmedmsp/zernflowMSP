"use client";

import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ZoomIn, ZoomOut, Maximize2, ArrowLeft, Save, Rocket, Loader2, History, Play, Download, Trash2, FlaskConical, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import { flowFileName } from "@/lib/flow-file-name";
import { formatTime } from "@/lib/format";
import { flowStatusLabel } from "./labels";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { startRouteProgress } from "@/components/ui/route-progress";
import { apiErrorMessage } from "@/lib/api-errors";
import { flowSignature, UNSAVED_CHANGES_MESSAGE } from "@/lib/flow-editor-state";
import type { FlowIssue } from "@/lib/flow-engine/validate";
import type { Database } from "@/lib/types/database";

import { NodePalette } from "./node-palette";
import { TriggerNode } from "./nodes/trigger-node";
import { SendMessageNode } from "./nodes/send-message-node";
import { ConditionNode } from "./nodes/condition-node";
import { DelayNode } from "./nodes/delay-node";
import { ActionNode } from "./nodes/action-node";
import { AiResponseNode } from "./nodes/AiResponseNode";
import { NodeConfigSidebar } from "./panels/NodeConfigSidebar";
import { VersionHistoryPanel } from "./panels/VersionHistoryPanel";
import { TestPanel } from "./panels/TestPanel";
import { PublishReviewDialog } from "./publish-review-dialog";

type Flow = Database["public"]["Tables"]["flows"]["Row"];

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  sendMessage: SendMessageNode,
  condition: ConditionNode,
  delay: DelayNode,
  action: ActionNode,
  aiResponse: AiResponseNode,
};

interface FlowCanvasProps {
  flow: Flow;
}

let nodeId = 0;
function getNodeId() {
  return `node_${Date.now()}_${nodeId++}`;
}

function getDefaultData(type: string, actionType?: string): Record<string, unknown> {
  switch (type) {
    case "trigger":
      return { triggerType: "keyword", keywords: [] };
    case "sendMessage":
      return { messages: [] };
    case "condition":
      return { conditions: [], logic: "and" };
    case "delay":
      return { duration: 5, unit: "minutes" };
    case "aiResponse":
      return { systemPrompt: "", model: "openai/gpt-4o-mini", temperature: 0.7, maxTokens: 500, contextMessages: 10 };
    case "action":
      return { actionType: actionType || "addTag" };
    default:
      return {};
  }
}

function FlowCanvasInner({ flow }: FlowCanvasProps) {
  const router = useRouter();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow();

  const initialNodes: Node[] = Array.isArray(flow.nodes)
    ? (flow.nodes as unknown as Node[])
    : [];
  const initialEdges: Edge[] = Array.isArray(flow.edges)
    ? (flow.edges as unknown as Edge[])
    : [];

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const toast = useToast();
  const [flowName, setFlowName] = useState(flow.name);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Firma de lo último guardado o cargado: si difiere de la actual, hay cambios sin guardar.
  const [savedSignature, setSavedSignature] = useState(() => flowSignature(flow.name, initialNodes, initialEdges));
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Problemas y avisos de la revisión previa a publicar.
  const [issues, setIssues] = useState<FlowIssue[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const signature = useMemo(() => flowSignature(flowName, nodes, edges), [flowName, nodes, edges]);
  const dirty = signature !== savedSignature;

  // Aviso del navegador al cerrar o recargar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = UNSAVED_CHANGES_MESSAGE;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Enlaces internos (menú lateral, "Laboratorio" en la misma pestaña...): también piden confirmar.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm(UNSAVED_CHANGES_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const issueNodeIds = useMemo(
    () => new Set(issues.filter((i) => i.severity === "error" && i.nodeId).map((i) => i.nodeId as string)),
    [issues],
  );
  const displayNodes = useMemo(
    () =>
      issueNodeIds.size === 0
        ? nodes
        : nodes.map((n) => (issueNodeIds.has(n.id) ? { ...n, className: cn(n.className, "rounded-xl ring-2 ring-red-500") } : n)),
    [nodes, issueNodeIds],
  );

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId) || null
    : null;

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: "var(--border)", strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const raw = event.dataTransfer.getData("application/reactflow");
      if (!raw) return;

      const { type, nodeType, actionType } = JSON.parse(raw) as {
        type: string;
        nodeType: string;
        actionType?: string;
      };

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: getNodeId(),
        type,
        position,
        data: getDefaultData(type, actionType || nodeType),
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
    },
    []
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const onNodeDataChange = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: newData } : n
        )
      );
    },
    [setNodes]
  );

  const closeSidebar = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
    },
    [setNodes, setEdges]
  );

  const leaveEditor = useCallback(() => {
    startRouteProgress();
    router.push("/dashboard/flows");
  }, [router]);

  const handleBack = useCallback(() => {
    if (dirty) setConfirmLeave(true);
    else leaveEditor();
  }, [dirty, leaveEditor]);

  // Guarda por la API (revisa el rol): si no cambia ninguna fila responde error y nunca se muestra un éxito falso.
  const saveFlow = useCallback(
    async (quiet = false): Promise<boolean> => {
      setSaving(true);
      try {
        const res = await fetch(`/api/v1/flows/${flow.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: flowName, nodes, edges }),
        });

        if (!res.ok) {
          setSaveError("No se pudo guardar");
          toast.error(await apiErrorMessage(res, "guardar el flujo"));
          setTimeout(() => setSaveError(null), 3000);
          return false;
        }

        setSaveError(null);
        setSavedSignature(flowSignature(flowName, nodes, edges));
        setLastSaved(new Date());
        if (!quiet) toast.success("Flujo guardado");
        return true;
      } catch {
        setSaveError("No se pudo guardar");
        toast.error("No se pudo guardar el flujo. Revisa tu conexión.");
        setTimeout(() => setSaveError(null), 3000);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [flowName, nodes, edges, flow.id, toast]
  );

  const handleSave = useCallback(() => void saveFlow(), [saveFlow]);
  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/flows/${flow.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        console.error("Failed to delete flow");
        setSaveError("No se pudo eliminar");
        toast.error(await apiErrorMessage(res, "eliminar el flujo"));
        setTimeout(() => setSaveError(null), 3000);
        setDeleting(false);
        return;
      }
      // Ya no hay nada que guardar: que el aviso de salida no se interponga.
      setSavedSignature(signature);
      toast.success("Flujo eliminado");
      startRouteProgress();
      router.push("/dashboard/flows");
    } catch (err) {
      console.error("Failed to delete flow:", err);
      setSaveError("No se pudo eliminar");
      toast.error("No se pudo eliminar el flujo.");
      setTimeout(() => setSaveError(null), 3000);
      setDeleting(false);
    }
  }, [flow.id, router, toast, signature]);

  // Publica lo guardado. El servidor revisa el flujo: con errores (422) no
  // publica; con avisos (409) pide confirmar. Ambos abren el diálogo con la lista.
  const handlePublish = useCallback(
    async (confirm = false) => {
      setPublishing(true);
      try {
        // Primero se guarda el estado actual.
        if (!(await saveFlow(true))) return;
        const res = await fetch(`/api/v1/flows/${flow.id}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm }),
        });
        if (res.status === 422 || res.status === 409) {
          const body = (await res.json().catch(() => null)) as { issues?: FlowIssue[] } | null;
          setIssues(body?.issues ?? []);
          setReviewOpen(true);
          return;
        }
        if (!res.ok) {
          console.error("Failed to publish flow");
          setSaveError("No se pudo publicar");
          toast.error(await apiErrorMessage(res, "publicar flujos"));
          setTimeout(() => setSaveError(null), 3000);
          return;
        }
        setIssues([]);
        setReviewOpen(false);
        setSaveError(null);
        setLastSaved(new Date());
        toast.success("Flujo publicado");
        router.refresh();
      } catch {
        toast.error("No se pudo publicar el flujo. Revisa tu conexión.");
      } finally {
        setPublishing(false);
      }
    },
    [saveFlow, flow.id, router, toast]
  );

  const showIssueNode = useCallback(
    (nodeId: string) => {
      setReviewOpen(false);
      setVersionPanelOpen(false);
      setTestPanelOpen(false);
      setSelectedNodeId(nodeId);
      void fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1.2 });
    },
    [fitView]
  );

  // Tras restaurar una versión el lienzo debe mostrar lo restaurado (no solo refrescar la página),
  // o un "Guardar" posterior pisaría la versión con los nodos viejos.
  const handleRestored = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/flows/${flow.id}`);
      if (res.ok) {
        const fresh = (await res.json()) as { nodes?: unknown; edges?: unknown };
        const freshNodes = Array.isArray(fresh.nodes) ? (fresh.nodes as Node[]) : [];
        const freshEdges = Array.isArray(fresh.edges) ? (fresh.edges as Edge[]) : [];
        setNodes(freshNodes);
        setEdges(freshEdges);
        setSelectedNodeId(null);
        setIssues([]);
        setSavedSignature(flowSignature(flowName, freshNodes, freshEdges));
      }
    } finally {
      router.refresh();
    }
  }, [flow.id, flowName, router, setNodes, setEdges]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 [&_a]:whitespace-nowrap [&_button]:whitespace-nowrap">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </button>
          <div className="h-5 w-px bg-border" />
          <input
            type="text"
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            className="w-auto max-w-[200px] border-none bg-transparent text-sm font-semibold outline-none focus:ring-0"
            style={{ width: `${Math.max(flowName.length, 8)}ch` }}
            placeholder="Nombre del flujo"
          />
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
              flow.status === "published"
                ? "bg-emerald-100 text-emerald-800"
                : flow.status === "archived"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {flowStatusLabel(flow.status)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saveError && (
            <span className="text-xs font-medium text-destructive">
              {saveError}
            </span>
          )}
          {!saveError && dirty && (
            <span className="text-xs font-medium text-amber-600">Cambios sin guardar</span>
          )}
          {!saveError && !dirty && lastSaved && (
            <span className="text-xs text-muted-foreground">
              Guardado {formatTime(lastSaved)}
            </span>
          )}
          <button
            onClick={() => {
              setTestPanelOpen(!testPanelOpen);
              if (!testPanelOpen) {
                setVersionPanelOpen(false);
                setSelectedNodeId(null);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              testPanelOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-accent"
            )}
          >
            <Play className="h-3.5 w-3.5" />
            Probar
          </button>
          <Link
            href={`/dashboard/flows/lab?flow=${flow.id}`}
            target="_blank"
            title="Abre el laboratorio con este flujo (usa la versión guardada)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Probar en el laboratorio
          </Link>
          <Link
            href={`/dashboard/flows/explorer?flow=${flow.id}`}
            target="_blank"
            title="Genera todos los caminos posibles de este flujo y cómo termina cada uno (usa la versión guardada)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            <Route className="h-3.5 w-3.5" />
            Explorar caminos
          </Link>
          <button
            onClick={() => {
              setVersionPanelOpen(!versionPanelOpen);
              if (!versionPanelOpen) {
                setTestPanelOpen(false);
                setSelectedNodeId(null);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              versionPanelOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-accent"
            )}
          >
            <History className="h-3.5 w-3.5" />
            Historial
          </button>
          <button
            onClick={() => {
              const exportData = {
                name: flowName,
                description: flow.description || null,
                nodes,
                edges,
                version: flow.version || 1,
                exportedAt: new Date().toISOString(),
                source: "zernflow",
              };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = flowFileName(flowName);
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button
            onClick={() => void handlePublish()}
            disabled={publishing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {publishing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            {publishing ? "Publicando…" : "Publicar"}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            title="Eliminar flujo"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
          <ConfirmDialog
            open={confirmLeave}
            title="Salir sin guardar"
            message="Tienes cambios sin guardar en este flujo. Si sales ahora, se perderán."
            confirmLabel="Salir sin guardar"
            cancelLabel="Seguir editando"
            destructive
            onConfirm={() => {
              setConfirmLeave(false);
              setSavedSignature(signature);
              leaveEditor();
            }}
            onCancel={() => setConfirmLeave(false)}
          />
          <ConfirmDialog
            open={confirmDelete}
            title="Eliminar flujo"
            message={`"${flowName}" y sus disparadores, versiones e historial de ejecuciones se eliminarán de forma permanente. Esta acción no se puede deshacer.`}
            confirmLabel="Eliminar"
            cancelLabel="Cancelar"
            destructive
            onConfirm={() => {
              setConfirmDelete(false);
              handleDelete();
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex flex-1 overflow-hidden">
        <NodePalette />
        <div ref={reactFlowWrapper} className="flex-1">
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ maxZoom: 1 }}
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
            className="bg-background"
          >
            <Background gap={16} size={1} className="!bg-background" />
            <Controls
              showZoom={false}
              showFitView={false}
              aria-label="Controles del lienzo"
              className="!border-border !bg-card !shadow-sm [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground [&>button:hover]:!bg-accent"
            >
              <ControlButton onClick={() => void zoomIn()} title="Acercar" aria-label="Acercar">
                <ZoomIn />
              </ControlButton>
              <ControlButton onClick={() => void zoomOut()} title="Alejar" aria-label="Alejar">
                <ZoomOut />
              </ControlButton>
              <ControlButton onClick={() => void fitView({ maxZoom: 1 })} title="Ajustar a la pantalla" aria-label="Ajustar a la pantalla">
                <Maximize2 />
              </ControlButton>
            </Controls>
            <MiniMap
              className="!border-border !bg-card"
              nodeColor={() => "var(--primary)"}
              maskColor="rgba(0, 0, 0, 0.1)"
            />
          </ReactFlow>
        </div>
        {selectedNode && !versionPanelOpen && !testPanelOpen && (
          <NodeConfigSidebar
            node={selectedNode}
            nodes={nodes}
            edges={edges}
            onChange={onNodeDataChange}
            onClose={closeSidebar}
            onDelete={deleteNode}
            currentFlowId={flow.id}
          />
        )}
        {versionPanelOpen && (
          <VersionHistoryPanel
            flowId={flow.id}
            currentVersion={flow.version}
            flowStatus={flow.status}
            onClose={() => setVersionPanelOpen(false)}
            onRestore={() => void handleRestored()}
          />
        )}
        {testPanelOpen && (
          <TestPanel
            nodes={nodes}
            edges={edges}
            onClose={() => setTestPanelOpen(false)}
            onHighlightNode={(nodeId) => {
              // Scroll to and highlight the node
              const node = nodes.find((n) => n.id === nodeId);
              if (node) setSelectedNodeId(nodeId);
            }}
          />
        )}
      </div>
      {reviewOpen && (
        <PublishReviewDialog
          issues={issues}
          publishing={publishing}
          onClose={() => setReviewOpen(false)}
          onPublishAnyway={() => void handlePublish(true)}
          onShowNode={showIssueNode}
        />
      )}
    </div>
  );
}

export function FlowCanvas({ flow }: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner flow={flow} />
    </ReactFlowProvider>
  );
}
