"use client";

// Diccionario de la tienda: palabras que el corrector de la Bandeja no marca
// como error. Cualquier miembro agrega; el Dueño o un Administrador quita.

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Info, Loader2, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import { addSpellWord, removeSpellWord, type SpellWordsData, type SpellWordView } from "@/lib/actions/spell-words";

export function DictionaryView({ data, error }: { data: SpellWordsData | null; error: string | null }) {
  const [words, setWords] = useState<SpellWordView[]>(data?.words ?? []);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const toast = useToast();

  async function add() {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const result = await addSpellWord(draft);
      if ("error" in result) {
        setFormError(result.error);
        return;
      }
      setWords((prev) => [...prev, result.word].sort((a, b) => a.word.localeCompare(b.word, "es")));
      setDraft("");
      toast.success(`«${result.word.word}» se agregó al diccionario.`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(word: SpellWordView) {
    setRemoving(word.id);
    try {
      const result = await removeSpellWord(word.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setWords((prev) => prev.filter((w) => w.id !== word.id));
      toast.success(`Se quitó «${word.word}».`);
    } finally {
      setRemoving(null);
    }
  }

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
              Las agrega cualquier asesor desde el chat; aquí se revisan.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-2xl space-y-4">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void add();
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Agregar una palabra (por ejemplo, Dymatize)"
                  maxLength={60}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={saving || !draft.trim()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Agregar
                </button>
              </form>
              {formError && <p className="text-sm text-destructive">{formError}</p>}

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
                        <span className="text-[11px] text-muted-foreground">
                          {w.addedBy ? `${w.addedBy} · ${formatRelative(w.createdAt)}` : "Lista inicial"}
                        </span>
                        {data?.canRemove && (
                          <button
                            type="button"
                            onClick={() => void remove(w)}
                            disabled={removing === w.id}
                            aria-label={`Quitar ${w.word}`}
                            title="Quitar"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                          >
                            {removing === w.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="mt-px h-3 w-3 shrink-0" />
                Los nombres con mayúscula (Patricia, Miraflores), las siglas y los enlaces nunca se marcan.
                {!data?.canRemove && " Solo el Dueño o un Administrador pueden quitar palabras."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
