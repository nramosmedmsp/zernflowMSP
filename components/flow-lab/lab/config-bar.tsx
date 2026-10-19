"use client";

// Barra superior: perfil inicial, canal, flujos que participan, reiniciar y copiar.

import { useState } from "react";
import { Check, ChevronDown, Copy, RotateCcw, UserCog } from "lucide-react";
import { LAB_CHANNELS, LAB_CHANNEL_LABELS, type LabCatalog, type LabChannel, type LabProfile } from "@/lib/flow-lab/types";
import { Field, Modal, Popover, inputClass, primaryButtonClass, secondaryButtonClass, selectClass } from "@/components/inbox/ui";
import { CUSTOM_PROFILE_ID, defaultFlowIds, type CustomProfileInput, type LabConfig } from "./lab-model";

const STATUS_TEXT = { draft: "Borrador", published: "Publicado", archived: "Archivado" } as const;

export function ConfigBar({
  catalog,
  config,
  profiles,
  focusFlowId,
  copied,
  onProfile,
  onCustom,
  onChannel,
  onFlows,
  onReset,
  onCopy,
}: {
  catalog: LabCatalog;
  config: LabConfig;
  profiles: LabProfile[];
  focusFlowId: string | null;
  copied: boolean;
  onProfile: (profileId: string) => void;
  onCustom: (input: CustomProfileInput) => void;
  onChannel: (channel: LabChannel) => void;
  onFlows: (ids: string[]) => void;
  onReset: () => void;
  onCopy: () => void;
}) {
  const [flowsOpen, setFlowsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const profile = profiles.find((p) => p.id === config.profileId);

  function toggleFlow(id: string) {
    onFlows(config.flowIds.includes(id) ? config.flowIds.filter((x) => x !== id) : [...config.flowIds, id]);
  }

  return (
    <div className="space-y-2 border-b border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Perfil inicial">
          <select value={config.profileId} onChange={(e) => onProfile(e.target.value)} className={`${selectClass} min-w-[200px] py-1.5`}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={CUSTOM_PROFILE_ID}>Personalizado…</option>
          </select>
        </Field>
        {config.profileId === CUSTOM_PROFILE_ID && (
          <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
            <UserCog className="h-3.5 w-3.5" />
            Editar perfil
          </button>
        )}
        <Field label="Canal">
          <select value={config.channel} onChange={(e) => onChannel(e.target.value as LabChannel)} className={`${selectClass} py-1.5`}>
            {LAB_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {LAB_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <span className="block pb-1 text-xs font-medium text-muted-foreground">Flujos que participan</span>
          <Popover
            open={flowsOpen}
            onClose={() => setFlowsOpen(false)}
            className="w-80"
            trigger={
              <button type="button" onClick={() => setFlowsOpen((v) => !v)} className={`${secondaryButtonClass} py-1`}>
                {config.flowIds.length} de {catalog.flows.length}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            }
          >
            <div className="mb-2 flex flex-wrap gap-1">
              <button type="button" className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-accent" onClick={() => onFlows(defaultFlowIds(catalog, focusFlowId))}>
                Solo publicados
              </button>
              <button type="button" className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-accent" onClick={() => onFlows(catalog.flows.map((f) => f.id))}>
                Incluir borradores
              </button>
              <button type="button" className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-accent" onClick={() => onFlows([])}>
                Ninguno
              </button>
            </div>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {catalog.flows.length === 0 && <li className="px-1 py-2 text-xs text-muted-foreground">El espacio no tiene flujos.</li>}
              {catalog.flows.map((f) => (
                <li key={f.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent">
                    <input type="checkbox" checked={config.flowIds.includes(f.id)} onChange={() => toggleFlow(f.id)} />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="flex-shrink-0 text-[10px] text-muted-foreground">{STATUS_TEXT[f.status] ?? f.status}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Popover>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onCopy} className={secondaryButtonClass}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : "Copiar resumen"}
          </button>
          <button type="button" onClick={onReset} className={primaryButtonClass}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reiniciar
          </button>
        </div>
      </div>
      {profile && <p className="text-xs text-muted-foreground">{profile.description}</p>}
      {profile && profile.notices.length > 0 && (
        <ul className="space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
          {profile.notices.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {editing && <CustomProfileDialog catalog={catalog} value={config.custom} onClose={() => setEditing(false)} onSave={(v) => { setEditing(false); onCustom(v); }} />}
    </div>
  );
}

function CustomProfileDialog({ catalog, value, onClose, onSave }: { catalog: LabCatalog; value: CustomProfileInput; onClose: () => void; onSave: (v: CustomProfileInput) => void }) {
  const [draft, setDraft] = useState<CustomProfileInput>(value);
  const set = (patch: Partial<CustomProfileInput>) => setDraft((d) => ({ ...d, ...patch }));
  const caseType = catalog.caseTypes.find((t) => t.id === draft.caseTypeId);

  return (
    <Modal
      open
      title="Perfil personalizado"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={primaryButtonClass} onClick={() => onSave(draft)}>
            Aplicar y reiniciar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input className={inputClass} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Tipo de contacto">
        <select className={inputClass} value={draft.contactTypeId ?? ""} onChange={(e) => set({ contactTypeId: e.target.value || null })}>
          <option value="">Sin tipo</option>
          {catalog.contactTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Etiquetas" hint="Separadas por comas.">
        <input className={inputClass} value={draft.tags} onChange={(e) => set({ tags: e.target.value })} list="lab-tags" />
        <datalist id="lab-tags">
          {catalog.tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.existed} onChange={(e) => set({ existed: e.target.checked })} />
        Ya existe como contacto (si no, su primer mensaje dispara la bienvenida)
      </label>
      <Field label="Gestión inicial: tipo">
        <select className={inputClass} value={draft.caseTypeId ?? ""} onChange={(e) => set({ caseTypeId: e.target.value || null, stageId: null })}>
          <option value="">Sin gestión</option>
          {catalog.caseTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      {caseType && (
        <>
          <Field label="Gestión inicial: etapa">
            <select className={inputClass} value={draft.stageId ?? ""} onChange={(e) => set({ stageId: e.target.value || null })}>
              <option value="">Primera etapa abierta</option>
              {caseType.stages
                .filter((s) => s.kind === "open")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.recentInbound} onChange={(e) => set({ recentInbound: e.target.checked })} />
            Escribió hace menos de 24 h (ventana de WhatsApp abierta)
          </label>
        </>
      )}
    </Modal>
  );
}
