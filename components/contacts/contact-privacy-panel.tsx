"use client";

// Datos personales del cliente (PRIV-06): corregir nombre, correo y teléfono,
// descargar una copia imprimible de todo lo que se guarda, y eliminar sus datos.
// Solo Dueño y Administrador (la ficha no lo muestra a nadie más y el servidor lo
// vuelve a comprobar). Si los datos ya se eliminaron, muestra la constancia y,
// si quedaron archivos sin borrar, el botón para reintentar.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Loader2, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { updateContactDetails } from "@/lib/actions/contacts";
import { eraseContact, retryEraseFiles } from "@/lib/actions/contact-privacy";
import { erasureConfirmationMatches, erasureConfirmationWord } from "@/lib/erase-confirmation";
import { formatDateTime } from "@/lib/format";
import { Field, Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/inbox/ui";
import { useToast } from "@/components/ui/toast";

export interface ErasureRecord {
  id: string;
  requestedAt: string;
  requestedByName: string | null;
  filesPending: number;
  filesTotal: number;
  lastFileError: string | null;
}

export interface ContactPrivacyPanelProps {
  contactId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Cuántas gestiones tiene y cuántas son reclamos (se conservan). */
  caseCount: number;
  claimCount: number;
  /** Constancia del borrado, si los datos ya se eliminaron. */
  erasure: ErasureRecord | null;
  erased: boolean;
}

const btn = "px-2.5 py-1 text-xs";

export function ContactPrivacyPanel(props: ContactPrivacyPanelProps) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (!props.erasure) return;
    setRetrying(true);
    let res: Awaited<ReturnType<typeof retryEraseFiles>>;
    try {
      res = await retryEraseFiles(props.erasure.id);
    } catch {
      res = { error: "No se pudo reintentar. Inténtalo de nuevo." };
    }
    setRetrying(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    if (res.filesPending > 0) toast.error(`Todavía faltan ${res.filesPending} archivos por borrar. Inténtalo más tarde.`);
    else toast.success("Todos los archivos se borraron");
    router.refresh();
  }

  if (props.erased) {
    const e = props.erasure;
    return (
      <div className="space-y-2 rounded-lg border border-border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-green-600" />
          Los datos personales de este cliente fueron eliminados
        </p>
        {e && (
          <p className="text-xs text-muted-foreground">
            {formatDateTime(e.requestedAt)}
            {e.requestedByName ? ` · por ${e.requestedByName}` : ""}. Quedan solo sus gestiones, sin nombre, teléfono ni
            mensajes, para que las estadísticas no cambien.
          </p>
        )}
        {e && e.filesPending > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs dark:border-red-900/50 dark:bg-red-900/10">
            <p className="font-medium text-red-700 dark:text-red-400">
              Faltan {e.filesPending} de {e.filesTotal} archivos por borrar del almacenamiento.
            </p>
            {e.lastFileError && <p className="mt-1 text-muted-foreground">Último error: {e.lastFileError}</p>}
            <button type="button" className={`${secondaryButtonClass} ${btn} mt-2`} disabled={retrying} onClick={() => void retry()}>
              {retrying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Reintentar borrar archivos
            </button>
          </div>
        )}
        {e && e.filesPending === 0 && e.filesTotal > 0 && (
          <p className="text-xs text-muted-foreground">Los {e.filesTotal} archivos del cliente también se borraron.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-xs text-muted-foreground">
        Solo el Dueño y los Administradores ven esto. Sirve para atender un pedido del cliente: ver sus datos, corregirlos
        o eliminarlos.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${secondaryButtonClass} ${btn}`} onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" />
          Corregir datos
        </button>
        <a
          href={`/api/v1/contacts/${props.contactId}/export`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${secondaryButtonClass} ${btn}`}
        >
          <Download className="h-3.5 w-3.5" />
          Descargar copia de sus datos
        </a>
        <button
          type="button"
          className={`${secondaryButtonClass} ${btn} border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-900/10`}
          onClick={() => setErasing(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Eliminar sus datos
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        La copia se abre en otra pestaña como una página: usa «Imprimir» y «Guardar como PDF» para entregarla al cliente.
      </p>

      <EditDialog
        key={`edit-${editing}`}
        open={editing}
        contactId={props.contactId}
        name={props.name}
        email={props.email}
        phone={props.phone}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          router.refresh();
        }}
      />
      <EraseDialog
        key={`erase-${erasing}`}
        open={erasing}
        contactId={props.contactId}
        name={props.name}
        caseCount={props.caseCount}
        claimCount={props.claimCount}
        onClose={() => setErasing(false)}
        onDone={() => {
          setErasing(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function EditDialog({
  open,
  contactId,
  name,
  email,
  phone,
  onClose,
  onSaved,
}: {
  open: boolean;
  contactId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: name ?? "", email: email ?? "", phone: phone ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    let res: Awaited<ReturnType<typeof updateContactDetails>>;
    try {
      res = await updateContactDetails(contactId, { displayName: form.name, email: form.email, phone: form.phone });
    } catch {
      res = { error: "No se pudo guardar el cambio. Inténtalo de nuevo." };
    }
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    toast.success("Datos corregidos");
    onSaved();
  }

  return (
    <Modal
      open={open}
      title="Corregir datos del cliente"
      onClose={() => (busy ? undefined : onClose())}
      footer={
        <>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => void save()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input className={inputClass} value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Correo" hint="Déjalo vacío para quitarlo.">
        <input className={inputClass} type="email" value={form.email} maxLength={254} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field label="Teléfono" hint="Déjalo vacío para quitarlo. Queda anotado quién corrigió y cuándo, sin copiar los datos.">
        <input className={inputClass} value={form.phone} maxLength={30} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Modal>
  );
}

function EraseDialog({
  open,
  contactId,
  name,
  caseCount,
  claimCount,
  onClose,
  onDone,
}: {
  open: boolean;
  contactId: string;
  name: string | null;
  caseCount: number;
  claimCount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const word = erasureConfirmationWord(name);
  const matches = erasureConfirmationMatches(typed, name);

  async function erase() {
    setBusy(true);
    setError(null);
    let res: Awaited<ReturnType<typeof eraseContact>>;
    try {
      res = await eraseContact(contactId, typed);
    } catch {
      res = { error: "No se pudo eliminar. Inténtalo de nuevo." };
    }
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    if (res.warning) toast.error(res.warning);
    else toast.success("Los datos del cliente se eliminaron");
    onDone();
  }

  return (
    <Modal
      open={open}
      title="Eliminar los datos de este cliente"
      onClose={() => (busy ? undefined : onClose())}
      className="max-w-lg"
      footer={
        <>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !matches}
            onClick={() => void erase()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Eliminar para siempre
          </button>
        </>
      }
    >
      <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50/60 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Esto no se puede deshacer desde la aplicación. Las copias de seguridad automáticas de la base de datos pueden guardar estos datos unos días más, hasta que se renueven.</p>
      </div>
      <div className="space-y-1 text-sm">
        <p className="font-medium">Se eliminará:</p>
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          <li>Su nombre, teléfono, correo y foto.</li>
          <li>Sus cuentas de WhatsApp e Instagram vinculadas.</li>
          <li>Todos los mensajes y los archivos que envió o recibió.</li>
          <li>Las notas internas, etiquetas, campos y su historial de movimientos.</li>
        </ul>
      </div>
      <div className="space-y-1 text-sm">
        <p className="font-medium">Se conservará, sin datos personales:</p>
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          <li>
            {caseCount > 0
              ? `Sus ${caseCount} ${caseCount === 1 ? "gestión" : "gestiones"} con su tipo, pasos, fechas y resultado, para que las estadísticas no cambien.`
              : "Sus gestiones (si las tuviera) con su tipo, pasos, fechas y resultado, para que las estadísticas no cambien."}
          </li>
          {claimCount > 0 ? (
            <li>
              <strong>{claimCount === 1 ? "1 reclamo" : `${claimCount} reclamos`}</strong>: la ley obliga a conservar los
              reclamos, así que se queda la gestión del reclamo con su solución escrita, pero sin su nombre, teléfono ni
              mensajes.
            </li>
          ) : (
            <li>Si tuviera reclamos, se conservarían (la ley lo exige) con su solución escrita, pero sin su nombre, teléfono ni mensajes.</li>
          )}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        Esto no borra los mensajes que el cliente tiene en su propio WhatsApp o Instagram, ni las copias que guarden Zernio
        o Meta. Si el cliente lo pide, pídeles también a ellos que los borren. Quedará anotado quién eliminó los datos y cuándo.
      </p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          Para confirmar, escribe: <strong className="text-foreground">{word}</strong>
        </span>
        <input className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Modal>
  );
}
