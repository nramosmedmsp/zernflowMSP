"use client";

// Laboratorio de conversaciones: la simulación corre aquí, en el navegador, con
// las acciones puras de lib/flow-lab (no se escribe en la base ni se envía nada).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical } from "lucide-react";
import {
  advanceTime,
  agentReplies,
  assign,
  buildSampleProfiles,
  changeStage,
  classify,
  clientSays,
  closeCase,
  createLabState,
  setBotPaused,
  setCategory,
  setChannel,
  setEnabledFlows,
} from "@/lib/flow-lab";
import type { ClientInput, LabCatalog, LabChannel, LabProfile, LabResult, LabState } from "@/lib/flow-lab/types";
import { ConfigBar } from "./config-bar";
import { Controls, type AgentAction } from "./controls";
import { DetailPanel, type DetailTab, type Selection } from "./detail-panel";
import {
  CUSTOM_PROFILE_ID,
  buildCustomProfile,
  buildSummary,
  clearSaved,
  defaultCustomProfile,
  defaultFlowIds,
  loadSaved,
  pushEntry,
  readableSteps,
  reconcileSaved,
  saveSaved,
  snapshotOf,
  visitedHighlight,
  type CustomProfileInput,
  type Highlight,
  type LabConfig,
  type LabEntry,
  type SavedLab,
  type StorageLike,
} from "./lab-model";
import { Phone } from "./phone";

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

type Session = Pick<SavedLab, "config" | "state" | "entries" | "initialSnapshot">;

function profilesFor(catalog: LabCatalog, nowIso: string): LabProfile[] {
  return buildSampleProfiles(catalog, nowIso);
}

function freshSession(catalog: LabCatalog, config: LabConfig): Session {
  const nowIso = new Date().toISOString();
  const profile =
    config.profileId === CUSTOM_PROFILE_ID
      ? buildCustomProfile(config.custom, catalog, nowIso)
      : (profilesFor(catalog, nowIso).find((p) => p.id === config.profileId) ?? buildCustomProfile(config.custom, catalog, nowIso));
  const state = createLabState(catalog, { profile, channel: config.channel, clock: nowIso, enabledFlowIds: config.flowIds });
  return { config, state, entries: [], initialSnapshot: snapshotOf(catalog, state) };
}

function initialConfig(catalog: LabCatalog, focusFlowId: string | null): LabConfig {
  return {
    profileId: buildSampleProfiles(catalog)[0]?.id ?? CUSTOM_PROFILE_ID,
    custom: defaultCustomProfile(catalog),
    channel: "whatsapp",
    flowIds: defaultFlowIds(catalog, focusFlowId),
  };
}

export function LabScreen({ catalog, workspaceId, focusFlowId }: { catalog: LabCatalog; workspaceId: string; focusFlowId: string | null }) {
  const [session, setSession] = useState<Session | null>(null);
  const [selection, setSelection] = useState<Selection>({ entry: null, step: null });
  const [tab, setTab] = useState<DetailTab>("trace");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Al abrir: recupera la prueba guardada (si hay) o arranca una nueva.
  useEffect(() => {
    const saved = loadSaved(browserStorage(), workspaceId);
    if (saved) {
      const sampleIds = buildSampleProfiles(catalog).map((p) => p.id);
      const rec = reconcileSaved(saved, catalog, sampleIds);
      // Con ?flow= el flujo indicado participa aunque sea borrador.
      const flowIds = focusFlowId && catalog.flows.some((f) => f.id === focusFlowId) && !rec.config.flowIds.includes(focusFlowId) ? [...rec.config.flowIds, focusFlowId] : rec.config.flowIds;
      const state = setEnabledFlows(rec.state, flowIds);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura única de localStorage al montar
      setSession({ config: { ...rec.config, flowIds }, state, entries: rec.entries, initialSnapshot: rec.initialSnapshot });
      setSelection({ entry: rec.selected, step: null });
    } else {
      setSession(freshSession(catalog, initialConfig(catalog, focusFlowId)));
    }
  }, [catalog, workspaceId, focusFlowId]);

  // Guarda cada cambio.
  useEffect(() => {
    if (!session) return;
    saveSaved(browserStorage(), workspaceId, { version: 1, ...session, selected: selection.entry });
  }, [session, selection.entry, workspaceId]);

  const profiles = useMemo(() => (session ? profilesFor(catalog, session.state.clock) : []), [catalog, session]);

  function reset(config: LabConfig) {
    setSession(freshSession(catalog, config));
    setSelection({ entry: null, step: null });
    setError(null);
  }

  function apply(run: (state: LabState) => LabResult) {
    if (!session) return;
    let result: LabResult;
    try {
      result = run(session.state);
    } catch (e) {
      setError(`La simulación falló: ${e instanceof Error ? e.message : "error desconocido"}`);
      return;
    }
    if (result.trace.error) {
      setError(result.trace.error);
      return;
    }
    setError(null);
    const entry: LabEntry = { trace: result.trace, snapshot: snapshotOf(catalog, result.state) };
    setSession({ ...session, state: result.state, entries: pushEntry(session.entries, entry) });
    setSelection({ entry: null, step: null });
  }

  function onClient(input: ClientInput) {
    apply((s) => clientSays(catalog, s, input));
  }

  function onAction(action: AgentAction) {
    switch (action.type) {
      case "advance":
        return apply((s) => advanceTime(catalog, s, action.minutes));
      case "reply":
        return apply((s) => agentReplies(catalog, s, action.text, { agentId: action.agentId }));
      case "stage":
        return apply((s) => changeStage(catalog, s, action.stageId));
      case "classify":
        return apply((s) => classify(catalog, s, action.caseTypeId));
      case "category":
        return apply((s) => setCategory(catalog, s, action.categoryId));
      case "assign":
        return apply((s) => assign(catalog, s, action.memberId));
      case "close":
        return apply((s) => closeCase(catalog, s, action.input));
      case "pause":
        return apply((s) => setBotPaused(catalog, s, action.paused));
    }
  }

  if (!session) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Preparando el laboratorio…</div>;
  }

  const { config, state, entries } = session;
  const traces = entries.map((e) => e.trace);
  const profileName = config.profileId === CUSTOM_PROFILE_ID ? "Personalizado" : (profiles.find((p) => p.id === config.profileId)?.name ?? config.profileId);

  // Qué se ilumina en el mapa: un paso, una acción o la última con nodos recorridos.
  let highlight: Highlight = [];
  let highlightLabel = "";
  if (selection.entry !== null && entries[selection.entry]) {
    const entry = entries[selection.entry];
    if (selection.step !== null) {
      const find = (rows: ReturnType<typeof readableSteps>): Highlight | null => {
        for (const row of rows) {
          if (row.n === selection.step) return row.highlight;
          const inner = find(row.children);
          if (inner) return inner;
        }
        return null;
      };
      highlight = find(readableSteps(entry.trace)) ?? [];
      highlightLabel = `Nodos del paso ${selection.step} de «${entry.trace.title}».`;
    } else {
      highlight = visitedHighlight(entry.trace);
      highlightLabel = `Camino recorrido en «${entry.trace.title}».`;
    }
  } else {
    for (let i = entries.length - 1; i >= 0; i--) {
      const h = visitedHighlight(entries[i].trace);
      if (h.length > 0) {
        highlight = h;
        highlightLabel = `Camino recorrido en «${entries[i].trace.title}».`;
        break;
      }
    }
  }

  async function copy() {
    const text = buildSummary({
      catalog,
      state,
      profileName,
      flowNames: catalog.flows.filter((f) => config.flowIds.includes(f.id)).map((f) => f.name),
      traces,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("No se pudo copiar al portapapeles. Revisa los permisos del navegador.");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Link href="/dashboard/flows" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Volver a Flujos">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <FlaskConical className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold leading-tight">Laboratorio de conversaciones</h1>
          <p className="text-xs text-muted-foreground">Simula una conversación con tus flujos. No envía mensajes ni cambia nada en tu cuenta.</p>
        </div>
      </div>

      <ConfigBar
        catalog={catalog}
        config={config}
        profiles={profiles}
        focusFlowId={focusFlowId}
        copied={copied}
        onProfile={(profileId) => reset({ ...config, profileId })}
        onCustom={(custom: CustomProfileInput) => reset({ ...config, profileId: CUSTOM_PROFILE_ID, custom })}
        onChannel={(channel: LabChannel) => {
          setSession({ ...session, config: { ...config, channel }, state: setChannel(state, channel) });
        }}
        onFlows={(flowIds) => {
          setSession({ ...session, config: { ...config, flowIds }, state: setEnabledFlows(state, flowIds) });
        }}
        onReset={() => {
          clearSaved(browserStorage(), workspaceId);
          reset(config);
        }}
        onCopy={copy}
      />

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(340px,430px)_1fr] lg:overflow-hidden">
        <div className="space-y-3 lg:overflow-y-auto lg:pr-1">
          <Phone
            messages={state.messages}
            traces={traces}
            channel={state.channel}
            clock={state.clock}
            contactName={state.contact.name}
            botPaused={state.automationPaused}
            busy={false}
            onSend={onClient}
          />
          <Controls catalog={catalog} state={state} busy={false} error={error} onAction={onAction} />
        </div>
        <div className="min-h-[480px] lg:min-h-0">
          <DetailPanel
            catalog={catalog}
            entries={entries}
            initialSnapshot={session.initialSnapshot}
            currentSnapshot={snapshotOf(catalog, state)}
            selection={selection}
            onSelect={setSelection}
            tab={tab}
            onTab={setTab}
            highlight={highlight}
            highlightLabel={highlightLabel}
          />
        </div>
      </div>
    </div>
  );
}
