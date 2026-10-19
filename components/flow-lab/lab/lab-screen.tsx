"use client";

// Laboratorio de conversaciones: la simulación corre aquí, en el navegador, con
// las acciones puras de lib/flow-lab (no se escribe en la base ni se envía nada).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, ListChecks, Save } from "lucide-react";
import { createLabScenario } from "@/lib/actions/lab-scenarios";
import { stepFromAction, type RecordableAction } from "@/lib/flow-lab/scenarios/from-session";
import type { ScenarioDefinition } from "@/lib/flow-lab/scenarios/types";
import type { BusinessTemplate } from "@/lib/types/database";
import { ScenarioFormDialog } from "@/components/flow-lab/scenarios/scenario-form-dialog";
import { primaryButtonClass, secondaryButtonClass } from "@/components/inbox/ui";
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
import { scenarioFromLab, sessionFromScenario, type ScenarioFromLab } from "./scenario-bridge";

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

/** Escenario guardado que se reproduce al abrir el laboratorio (?scenario=). */
export interface LabReplay {
  id: string;
  name: string;
  definition: ScenarioDefinition;
}

export function LabScreen({
  catalog,
  workspaceId,
  focusFlowId,
  replay = null,
  business = null,
}: {
  catalog: LabCatalog;
  workspaceId: string;
  focusFlowId: string | null;
  replay?: LabReplay | null;
  business?: BusinessTemplate | null;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState<ScenarioFromLab | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "warning"; text: string; link?: boolean } | null>(null);
  const replayedId = useRef<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ entry: null, step: null });
  const [tab, setTab] = useState<DetailTab>("trace");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Al abrir: recupera la prueba guardada (si hay) o arranca una nueva.
  useEffect(() => {
    // Un escenario guardado (?scenario=): reproduce sus pasos con el catálogo actual y quita el parámetro de la dirección.
    if (replay) {
      if (replayedId.current === replay.id) return;
      replayedId.current = replay.id;
      const result = sessionFromScenario(catalog, replay.definition, replay.definition.startAt || new Date().toISOString());
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        // Sin historial: no pasa nada.
      }
      if (result.ok) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reproducción única al montar
        setSession(result.session);
        setSelection({ entry: null, step: null });
        const pasos = result.session.entries.length;
        setBanner({
          kind: result.notices.length > 0 ? "warning" : "ok",
          text: `Se reprodujo el escenario «${replay.name}» (${pasos} ${pasos === 1 ? "paso" : "pasos"}). Puedes seguir la conversación a mano.${result.notices.length > 0 ? ` ${result.notices.join(" ")}` : ""}`,
        });
        return;
      }
      setSession(freshSession(catalog, initialConfig(catalog, focusFlowId)));
      setBanner({ kind: "warning", text: `No se pudo reproducir «${replay.name}»: ${result.error}` });
      return;
    }
    const saved = loadSaved(browserStorage(), workspaceId);
    if (saved) {
      const sampleIds = buildSampleProfiles(catalog).map((p) => p.id);
      const rec = reconcileSaved(saved, catalog, sampleIds);
      // Con ?flow= el flujo indicado participa aunque sea borrador.
      const flowIds = focusFlowId && catalog.flows.some((f) => f.id === focusFlowId) && !rec.config.flowIds.includes(focusFlowId) ? [...rec.config.flowIds, focusFlowId] : rec.config.flowIds;
      const state = setEnabledFlows(rec.state, flowIds);
      setSession({ config: { ...rec.config, flowIds }, state, entries: rec.entries, initialSnapshot: rec.initialSnapshot });
      setSelection({ entry: rec.selected, step: null });
    } else {
      setSession(freshSession(catalog, initialConfig(catalog, focusFlowId)));
    }
  }, [catalog, workspaceId, focusFlowId, replay]);

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

  function apply(run: (state: LabState) => LabResult, action: RecordableAction) {
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
    const entry: LabEntry = { trace: result.trace, snapshot: snapshotOf(catalog, result.state), step: stepFromAction(catalog, session.state, action) };
    setSession({ ...session, state: result.state, entries: pushEntry(session.entries, entry) });
    setSelection({ entry: null, step: null });
  }

  function onClient(input: ClientInput) {
    apply((s) => clientSays(catalog, s, input), { type: "client", input });
  }

  function onAction(action: AgentAction) {
    switch (action.type) {
      case "advance":
        return apply((s) => advanceTime(catalog, s, action.minutes), action);
      case "reply":
        return apply((s) => agentReplies(catalog, s, action.text, { agentId: action.agentId }), action);
      case "stage":
        return apply((s) => changeStage(catalog, s, action.stageId), action);
      case "classify":
        return apply((s) => classify(catalog, s, action.caseTypeId), action);
      case "category":
        return apply((s) => setCategory(catalog, s, action.categoryId), action);
      case "assign":
        return apply((s) => assign(catalog, s, action.memberId), action);
      case "close":
        return apply((s) => closeCase(catalog, s, action.input), action);
      case "pause":
        return apply((s) => setBotPaused(catalog, s, action.paused), action);
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
        <div className="ml-auto flex items-center gap-2">
          <Link href="/dashboard/flows/scenarios" className={secondaryButtonClass}>
            <ListChecks className="h-4 w-4" />
            Escenarios
          </Link>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={entries.length === 0}
            title={entries.length === 0 ? "Haz una prueba primero: escribe como cliente o usa los controles del asesor" : "Guarda esta prueba para volver a correrla después de editar tus flujos"}
            onClick={() => setDraft(scenarioFromLab({ catalog, config, entries, finalState: state, business }))}
          >
            <Save className="h-4 w-4" />
            Guardar como escenario
          </button>
        </div>
      </div>

      {banner && (
        <p role="status" className={`border-b border-border px-6 py-2 text-xs ${banner.kind === "warning" ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-emerald-500/10"}`}>
          {banner.text}
          {banner.link && (
            <>
              {" "}
              <Link href="/dashboard/flows/scenarios" className="font-medium underline">
                Ver escenarios
              </Link>
            </>
          )}
          <button type="button" className="ml-3 underline" onClick={() => setBanner(null)}>
            Cerrar
          </button>
        </p>
      )}

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

      {draft && (
        <ScenarioFormDialog
          title="Guardar como escenario"
          confirmLabel="Guardar escenario"
          catalog={catalog}
          initial={{ name: "", description: "", definition: draft.definition }}
          notices={draft.notices}
          onClose={() => setDraft(null)}
          onSave={async (d) => {
            const res = await createLabScenario({ name: d.name, description: d.description, definition: d.definition });
            if ("error" in res) return res.error;
            setDraft(null);
            setBanner({ kind: "ok", text: `Se guardó el escenario «${res.scenario.name}».`, link: true });
            return null;
          }}
        />
      )}
    </div>
  );
}
