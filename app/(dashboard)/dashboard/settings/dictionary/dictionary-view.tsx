"use client";

// Diccionario de la tienda: palabras que el corrector de la Bandeja no marca
// como error. El Dueño o un Administrador agrega, aprueba, rechaza y quita;
// los demás piden agregar palabras y ven sus pedidos pendientes.

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Clock, Info, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import {
  addOrRequestSpellWord,
  approveSpellWord,
  rejectSpellWord,
  removeSpellWord,
  type SpellWordsData,
  type SpellWordView,
} from "@/lib/actions/spell-words";

const byWord = (a: SpellWordView, b: SpellWordView) => a.word.localeCompare(b.word, "es");

export function DictionaryView({ data, error }: { data: SpellWordsData | null; error: string | null }) {
  const isAdmin = !!data?.isAdmin;
  const [words, setWords] = useState<SpellWordView[]>(data?.words ?? []);
  const [pending, setPending] = useState<SpellWordView[]>(data?.pending ?? []);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  async function submit() {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const result = await addOrRequestSpellWord(draft);
      if ("error" in result) {
        setFormError(result.error);
        return;
      }
      setDraft("");
      if (result.status === "approved") {
        setPending((prev) => prev.filter((w) => w.id !== result.word.id));
        setWords((prev) => [...prev.filter((w) => w.id !== result.word.id), result.word].sort(byWord));
        toast.success(`«${result.word.word}» se agregó al diccionario.`);
      } else {
        setPending((prev) => [...prev, result.word].sort(byWord));
        toast.success(`Pediste agregar «${result.word.word}». Un administrador lo revisará.`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function approve(word: SpellWordView) {
    setBusy(word.id);
    try {
      const result = await approveSpellWord(word.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setPending((prev) => prev.filter((w) => w.id !== word.id));
      setWords((prev) => [...prev, result.word].sort(byWord));
      toast.success(`«${word.word}» se agregó al diccionario.`);
    } finally {
      setBusy(null);
    }
  }

  async function reject(word: SpellWordView) {
    setBusy(word.id);
    try {
      const result = await rejectSpellWord(word.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setPending((prev) => prev.filter((w) => w.id !== word.id));
      toast.success(`Se rechazó «${word.word}».`);
    } finally {
      setBusy(null);
    }
  }

  async function remove(word: SpellWordView) {
    setBusy(word.id);
    try {
      const result = await removeSpellWord(word.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setWords((prev) => prev.filter((w) => w.id !== word.id));
      toast.success(`Se quitó «${word.word}».`);
    } finally {
      setBusy(null);
    }
  }

  const who = (w: SpellWordView) => (w.addedBy ? `${w.addedBy} · ${formatRelative(w.createdAt)}` : "Lista inicial");

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
            <h1 className="text-2xl font-bold">Diccionario de la tienda</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Palabras que el corrector de la Bandeja no marca como error: marcas, productos y palabras propias de la tienda.
              {isAdmin
                ? " Los asesores piden agregar palabras desde el chat; tú las apruebas o rechazas aquí."
                : " Pide agregar una palabra y un administrador la aprobará."}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-2xl space-y-6">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <>
              <div className="space-y-2">
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={isAdmin ? "Agregar una palabra (por ejemplo, Dymatize)" : "Pedir una palabra (por ejemplo, Dymatize)"}
                    maxLength={60}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
                  />
                  <button
                    type="submit"
                    disabled={saving || !draft.trim()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isAdmin ? (
                      <Plus className="h-4 w-4" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {isAdmin ? "Agregar" : "Pedir"}
                  </button>
                </form>
                {formError && <p className="text-sm text-destructive">{formError}</p>}
              </div>

              {pending.length > 0 && (
                <section className="space-y-2">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                    <Clock className="h-4 w-4 text-amber-600" />
                    {isAdmin ? "Pedidos por revisar" : "Tus pedidos pendientes"}
                    <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                      {pending.length}
                    </span>
                  </h2>
                  <ul className="divide-y divide-border rounded-xl border border-amber-200 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/10">
                    {pending.map((w) => (
                      <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <span className="text-sm font-medium">{w.word}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            {isAdmin ? `Pidió ${who(w)}` : `Pedida ${formatRelative(w.createdAt)} · esperando aprobación`}
                          </span>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => void reject(w)}
                                disabled={busy === w.id}
                                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                              >
                                <X className="h-3.5 w-3.5" />
                                Rechazar
                              </button>
                              <button
                                type="button"
                                onClick={() => void approve(w)}
                                disabled={busy === w.id}
                                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                              >
                                {busy === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                Aprobar
                              </button>
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="space-y-2">
                <h2 className="text-sm font-semibold">En el diccionario ({words.length})</h2>
                {words.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                    Aún no hay palabras. Agrega marcas o productos que el corrector marque por error.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                    {words.map((w) => (
                      <li key={w.id} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-sm font-medium">{w.word}</span>
                        <span className="flex items-center gap-3">
                          <span className="text-[11px] text-muted-foreground">{who(w)}</span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => void remove(w)}
                              disabled={busy === w.id}
                              aria-label={`Quitar ${w.word}`}
                              title="Quitar"
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                            >
                              {busy === w.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="mt-px h-3 w-3 shrink-0" />
                Los nombres con mayúscula (Patricia, Miraflores), las siglas y los enlaces nunca se marcan.
                {!isAdmin && " Solo el Dueño o un Administrador agregan y quitan palabras."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
