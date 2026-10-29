"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { createContact } from "@/lib/actions/contacts";

const FIELD_CLASS =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** B-38: «Crear contacto» desde la página de Contactos (nombre y teléfono). Se monta solo abierto. */
export function NewContactDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: { contactId: string; existed: boolean }) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await createContact({ name, phone });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onCreated({ contactId: res.contact.id, existed: res.existed });
    } catch {
      setError("No se pudo crear el contacto. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Crear contacto">
      <form onSubmit={create} className="w-full max-w-md space-y-3 rounded-xl border border-border bg-background p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Crear contacto</h2>
          <button type="button" onClick={onClose} disabled={saving} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Para un cliente nuevo (por ejemplo, una venta por teléfono). Si el teléfono ya existe, te llevamos a ese contacto.
        </p>
        <div>
          <label htmlFor="new-contact-name" className="mb-1 block text-xs font-medium text-muted-foreground">
            Nombre
          </label>
          <input id="new-contact-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={FIELD_CLASS} />
        </div>
        <div>
          <label htmlFor="new-contact-phone" className="mb-1 block text-xs font-medium text-muted-foreground">
            Teléfono (con código de país)
          </label>
          <input id="new-contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" placeholder="+51 999 999 999" className={FIELD_CLASS} />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-60">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim() || !phone.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Crear contacto
          </button>
        </div>
      </form>
    </div>
  );
}
