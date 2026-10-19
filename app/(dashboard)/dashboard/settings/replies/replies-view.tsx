"use client";

import { useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { invalidateSavedRepliesCache } from "@/components/composer/saved-reply-picker";
import {
  createSavedReply,
  deleteSavedReply,
  updateSavedReply,
  type SavedReplyView,
  type SavedRepliesData,
} from "@/lib/actions/saved-replies";
import { REPLY_VARIABLES, SAVED_REPLY_BODY_MAX, SAVED_REPLY_TITLE_MAX } from "@/lib/saved-replies";
import type { SavedReplyScope } from "@/lib/types/database";

type Tab = "workspace" | "team" | "personal";

interface FormState {
  /** null = respuesta nueva. */
  id: string | null;
  title: string;
  shortcut: string;
  body: string;
  caseTypeId: string;
}

const EMPTY_FORM: FormState = { id: null, title: "", shortcut: "", body: "", caseTypeId: "" };

const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export function RepliesView({
  data,
  customFields,
}: {
  data: SavedRepliesData;
  customFields: Array<{ name: string; slug: string }>;
}) {
  const [replies, setReplies] = useState<SavedReplyView[]>(data.replies);
  const manageableTeams = useMemo(() => data.teams.filter((t) => t.canManage), [data.teams]);
  const showTeamTab = manageableTeams.length > 0;

  const [tab, setTab] = useState<Tab>("workspace");
  const [teamId, setTeamId] = useState<string>(manageableTeams[0]?.id ?? "");
  const [form, setForm] = useState<FormState | null>(null);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<SavedReplyView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const caseTypeName = (id: string | null) => data.caseTypes.find((t) => t.id === id)?.name ?? null;

  const visible = useMemo(() => {
    const list = replies.filter((r) => {
      if (tab === "workspace") return r.scope === "workspace";
      if (tab === "personal") return r.scope === "personal";
      return r.scope === "team" && r.teamId === teamId;
    });
    return [...list].sort((a, b) => a.title.localeCompare(b.title, "es"));
  }, [replies, tab, teamId]);

  const canCreate =
    tab === "workspace" ? data.canManageWorkspace : tab === "team" ? !!teamId : true;

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "workspace", label: "Empresa" },
    ...(showTeamTab ? [{ key: "team" as const, label: "Mi equipo" }] : []),
    { key: "personal", label: "Personales" },
  ];

  function selectTab(next: Tab) {
    setTab(next);
    setForm(null);
    setError(null);
  }

  function insertVariable(token: string) {
    if (!form) return;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? form.body.length;
    const end = el?.selectionEnd ?? form.body.length;
    setForm({ ...form, body: form.body.slice(0, start) + token + form.body.slice(end) });
    // Deja el cursor justo después de la variable insertada.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    try {
      const input = {
        title: form.title,
        shortcut: form.shortcut,
        body: form.body,
        caseTypeId: form.caseTypeId || null,
      };
      const scope: SavedReplyScope = tab;
      const result = form.id
        ? await updateSavedReply(form.id, input)
        : await createSavedReply({ ...input, scope, teamId: scope === "team" ? teamId : null });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      invalidateSavedRepliesCache();
      setReplies((prev) =>
        form.id ? prev.map((r) => (r.id === result.reply.id ? result.reply : r)) : [...prev, result.reply],
      );
      setForm(null);
      toast.success(form.id ? "Respuesta actualizada" : "Respuesta guardada");
    } catch {
      setError("No se pudo guardar la respuesta. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const target = toDelete;
    if (!target) return;
    setDeleteError(null);
    try {
      const result = await deleteSavedReply(target.id);
      if ("error" in result) {
        setDeleteError(result.error);
        return;
      }
      invalidateSavedRepliesCache();
      setReplies((prev) => prev.filter((r) => r.id !== target.id));
      setToDelete(null);
      toast.success("Respuesta borrada");
    } catch {
      setDeleteError("No se pudo borrar la respuesta. Inténtalo de nuevo.");
    }
  }

  const hint =
    tab === "workspace"
      ? "Las ve todo el equipo. Solo el Dueño y los Administradores las cambian."
      : tab === "team"
        ? "Las ven las personas del equipo. Las cambian su supervisor y los Administradores."
        : "Solo las ves tú.";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Volver a Configuración"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Respuestas guardadas</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Escribe <span className="font-mono">/</span> en la bandeja para buscarlas y pegarlas en el mensaje. Nunca se
              envían solas.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="flex gap-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => selectTab(t.key)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                  tab === t.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">{hint}</p>
              {tab === "team" && manageableTeams.length > 1 && (
                <select
                  value={teamId}
                  onChange={(e) => {
                    setTeamId(e.target.value);
                    setForm(null);
                  }}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  aria-label="Equipo"
                >
                  {manageableTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              {tab === "team" && manageableTeams.length === 1 && (
                <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{manageableTeams[0].name}</span>
              )}
            </div>
            {canCreate && !form && (
              <button
                onClick={() => {
                  setForm({ ...EMPTY_FORM });
                  setError(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Nueva respuesta
              </button>
            )}
          </div>

          {form && (
            <div className="space-y-4 rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">{form.id ? "Editar respuesta" : "Nueva respuesta"}</h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Título</span>
                  <input
                    type="text"
                    value={form.title}
                    maxLength={SAVED_REPLY_TITLE_MAX}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Lista de precios"
                    className={inputClass}
                    autoFocus
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    Atajo (opcional)
                  </span>
                  <input
                    type="text"
                    value={form.shortcut}
                    onChange={(e) => setForm({ ...form, shortcut: e.target.value })}
                    placeholder="/precios"
                    className={cn(inputClass, "font-mono")}
                  />
                </label>
              </div>

              <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Texto</span>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-[11px] text-muted-foreground">Insertar:</span>
                    {REPLY_VARIABLES.map((v) => (
                      <button
                        key={v.token}
                        type="button"
                        title={v.label}
                        onClick={() => insertVariable(v.token)}
                        className="rounded-md border border-border px-2 py-0.5 font-mono text-[11px] hover:bg-accent"
                      >
                        {v.token}
                      </button>
                    ))}
                    {customFields.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => e.target.value && insertVariable(`{campo:${e.target.value}}`)}
                        className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px]"
                        aria-label="Insertar campo personalizado"
                      >
                        <option value="">Campo personalizado...</option>
                        {customFields.map((f) => (
                          <option key={f.slug} value={f.slug}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                <textarea
                  ref={bodyRef}
                  value={form.body}
                  maxLength={SAVED_REPLY_BODY_MAX}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={6}
                  placeholder="Hola {nombre}, te cuento los precios..."
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Las variables sin dato quedan vacías al pegarlas. {form.body.length}/{SAVED_REPLY_BODY_MAX}
                </p>
              </div>

              {data.caseTypes.length > 0 && (
                <label className="block sm:max-w-xs">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    Tipo de gestión (opcional)
                  </span>
                  <select
                    value={form.caseTypeId}
                    onChange={(e) => setForm({ ...form, caseTypeId: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Para cualquier tipo</option>
                    {data.caseTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Si eliges uno, saldrá primero en las gestiones de ese tipo.
                  </span>
                </label>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setForm(null)}
                  disabled={saving}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Guardar
                </button>
              </div>
            </div>
          )}

          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              {canCreate
                ? "Aún no hay respuestas aquí. Crea la primera con “Nueva respuesta”."
                : "Aún no hay respuestas de la empresa."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {visible.map((reply) => (
                <li key={reply.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{reply.title}</span>
                      {reply.shortcut && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {reply.shortcut}
                        </span>
                      )}
                      {caseTypeName(reply.caseTypeId) && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                          {caseTypeName(reply.caseTypeId)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{reply.body}</p>
                  </div>
                  {reply.canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => {
                          setForm({
                            id: reply.id,
                            title: reply.title,
                            shortcut: reply.shortcut ?? "",
                            body: reply.body,
                            caseTypeId: reply.caseTypeId ?? "",
                          });
                          setError(null);
                        }}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Editar"
                        aria-label={`Editar ${reply.title}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          setDeleteError(null);
                          setToDelete(reply);
                        }}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                        title="Borrar"
                        aria-label={`Borrar ${reply.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Borrar respuesta"
        message={
          deleteError ??
          `¿Borrar “${toDelete?.title ?? ""}”? Esta acción no se puede deshacer.`
        }
        confirmLabel="Borrar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
