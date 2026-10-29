"use client";

// Piezas compartidas de Configuración → Gestiones y Tipos de contacto.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  BadgeDollarSign,
  Calendar,
  Check,
  CreditCard,
  Dumbbell,
  FileText,
  Gift,
  Handshake,
  Headphones,
  Heart,
  LifeBuoy,
  Loader2,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Package,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  ShieldAlert,
  ShoppingCart,
  Star,
  Tag,
  Trash2,
  Truck,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { ConfigResult } from "@/lib/actions/case-config";
import {
  CASE_TYPE_ICONS,
  COLOR_SWATCHES,
  type CaseConfigData,
  type CaseTypeConfig,
} from "./config-rules";

// ── Estilos ────────────────────────────────────────────────────────────────

export const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50";

export const iconButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

export const noticeStyles = {
  ok: "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;

export const KIND_BADGE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  won: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  lost: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  resolved: "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
};

// ── Ejecutar acciones ──────────────────────────────────────────────────────

export interface Notice {
  kind: "ok" | "warn" | "error";
  text: string;
}

export type RunFn = <T extends object>(
  action: () => Promise<ConfigResult<T>>,
  okMessage?: string | ((result: T) => string | undefined),
) => Promise<boolean>;

/**
 * Ejecuta una acción de servidor, muestra el resultado y refresca los datos de
 * la página (la pantalla se vuelve a pintar con lo que quedó guardado).
 */
export function useRunner(): {
  run: RunFn;
  busy: boolean;
  notice: Notice | null;
  setNotice: (notice: Notice | null) => void;
  clearNotice: () => void;
} {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const run: RunFn = useCallback(
    async (action, okMessage) => {
      setBusy(true);
      setNotice(null);
      try {
        const result = await action();
        if ("error" in result) {
          setNotice({ kind: "error", text: result.error });
          toast.error(result.error);
          return false;
        }
        const text = typeof okMessage === "function" ? okMessage(result) : okMessage;
        if (text) toast.success(text);
        router.refresh();
        return true;
      } catch {
        setNotice({ kind: "error", text: "No se pudo completar la operación. Inténtalo de nuevo." });
        toast.error("No se pudo completar la operación. Inténtalo de nuevo.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [router, toast],
  );

  return { run, busy, notice, setNotice, clearNotice: () => setNotice(null) };
}

export function NoticeBox({ notice, onClose }: { notice: Notice; onClose?: () => void }) {
  return (
    <div role={notice.kind === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs", noticeStyles[notice.kind])}>
      <p className="flex-1">{notice.text}</p>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Cerrar aviso">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export interface TabProps {
  type: CaseTypeConfig;
  data: CaseConfigData;
  run: RunFn;
  busy: boolean;
  /** Muestra un aviso en pantalla (para lo que no pasa por run). */
  notify: (notice: Notice | null) => void;
}

// ── Íconos de tipo de gestión ──────────────────────────────────────────────

const ICONS: Record<string, LucideIcon> = {
  "shopping-cart": ShoppingCart,
  "badge-dollar-sign": BadgeDollarSign,
  "credit-card": CreditCard,
  package: Package,
  truck: Truck,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  headphones: Headphones,
  "life-buoy": LifeBuoy,
  repeat: Repeat,
  "refresh-cw": RefreshCw,
  calendar: Calendar,
  dumbbell: Dumbbell,
  star: Star,
  heart: Heart,
  gift: Gift,
  handshake: Handshake,
  users: Users,
  phone: Phone,
  "file-text": FileText,
  receipt: Receipt,
  megaphone: Megaphone,
  "shield-alert": ShieldAlert,
  wrench: Wrench,
  tag: Tag,
};

export function CaseTypeIcon({ name, className, style }: { name: string | null; className?: string; style?: React.CSSProperties }) {
  const Icon = (name && ICONS[name]) || Tag;
  return <Icon className={className} style={style} aria-hidden />;
}

export function IconPicker({ value, onChange, disabled }: { value: string | null; onChange: (icon: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ícono">
      {CASE_TYPE_ICONS.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={value === name}
          title={name}
          disabled={disabled}
          onClick={() => onChange(name)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-50",
            value === name ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          <CaseTypeIcon name={name} className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

// ── Color ──────────────────────────────────────────────────────────────────

/** Muestra el color elegido y despliega una paleta corta al hacer clic. */
export function ColorPicker({
  value,
  onChange,
  disabled,
  label = "Color",
}: {
  value: string | null;
  onChange: (color: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={label}
        aria-label={label}
        aria-expanded={open}
        className="h-7 w-7 rounded-md border border-border transition-shadow hover:ring-2 hover:ring-ring disabled:opacity-50"
        style={{ backgroundColor: value ?? "#9ca3af" }}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="animate-pop-in absolute left-0 top-9 z-50 w-44 rounded-lg border border-border bg-card p-2 shadow-lg">
            <div className="grid grid-cols-6 gap-1.5">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => {
                    setOpen(false);
                    if (c !== value) onChange(c);
                  }}
                  className={cn("flex h-5 w-5 items-center justify-center rounded-full border border-black/10", value === c && "ring-2 ring-ring ring-offset-1")}
                  style={{ backgroundColor: c }}
                >
                  {value === c && <Check className="h-3 w-3 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Interruptor ────────────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed opacity-60")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

// ── Ventana ────────────────────────────────────────────────────────────────

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade-in fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("animate-pop-in relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lg", wide ? "max-w-3xl" : "max-w-md")}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <button type="button" onClick={onClose} className={iconButtonClass} aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Filas de listas ordenables ─────────────────────────────────────────────

/**
 * Fila de una lista editable: botones subir y bajar, nombre que se guarda al
 * salir del campo (o con Enter), piezas propias a los lados y acciones.
 * Se monta con `key` = id + fecha de actualización para reiniciar el borrador.
 */
export function ListRow({
  name,
  lead,
  extra,
  canUp,
  canDown,
  onUp,
  onDown,
  onRename,
  onArchive,
  onRemove,
  disabled,
  nameLabel,
}: {
  name: string;
  lead?: ReactNode;
  extra?: ReactNode;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onRename: (name: string) => void;
  onArchive?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  nameLabel: string;
}) {
  const [draft, setDraft] = useState(name);

  function commit() {
    const next = draft.trim();
    if (next === "" || next === name) {
      setDraft(name);
      return;
    }
    onRename(next);
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
      <div className="flex flex-col">
        <button type="button" className={cn(iconButtonClass, "h-4")} disabled={disabled || !canUp} onClick={onUp} title="Subir" aria-label="Subir">
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={cn(iconButtonClass, "h-4")} disabled={disabled || !canDown} onClick={onDown} title="Bajar" aria-label="Bajar">
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {lead}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(name);
            e.currentTarget.blur();
          }
        }}
        disabled={disabled}
        maxLength={100}
        aria-label={nameLabel}
        className={cn(inputClass, "min-w-[8rem] flex-1 px-2 py-1")}
      />
      {extra}
      <div className="ml-auto flex items-center">
        {onArchive && (
          <button type="button" className={iconButtonClass} disabled={disabled} onClick={onArchive} title="Archivar" aria-label="Archivar">
            <Archive className="h-4 w-4" />
          </button>
        )}
        {onRemove && (
          <button type="button" className={cn(iconButtonClass, "hover:text-destructive")} disabled={disabled} onClick={onRemove} title="Quitar" aria-label="Quitar">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </li>
  );
}

/** Fila de un elemento archivado: se puede reactivar o intentar borrar (si no tiene uso). */
export function ArchivedRow({
  name,
  tag,
  onRestore,
  onRemove,
  disabled,
}: {
  name: string;
  tag?: ReactNode;
  onRestore: () => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground">
      <span className="min-w-0 flex-1 truncate line-through decoration-muted-foreground/40">{name}</span>
      {tag}
      <button type="button" className={cn(secondaryButtonClass, "px-2 py-1 text-xs")} disabled={disabled} onClick={onRestore}>
        <ArchiveRestore className="h-3.5 w-3.5" />
        Reactivar
      </button>
      {onRemove && (
        <button type="button" className={cn(iconButtonClass, "hover:text-destructive")} disabled={disabled} onClick={onRemove} title="Borrar si no tiene uso" aria-label="Borrar">
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

/** Campo de nombre con un botón para agregar. `extra` agrega controles propios (clase, etc.). */
export function AddForm({
  placeholder,
  onAdd,
  extra,
  disabled,
  buttonLabel = "Agregar",
}: {
  placeholder: string;
  onAdd: (name: string) => Promise<boolean>;
  extra?: ReactNode;
  disabled?: boolean;
  buttonLabel?: string;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || name.trim() === "") return;
    setSaving(true);
    let ok = false;
    try {
      ok = await onAdd(name.trim());
    } catch {
      // Sin conexión: el botón vuelve a quedar disponible y el texto no se pierde.
    } finally {
      setSaving(false);
    }
    if (ok) setName("");
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        maxLength={100}
        disabled={disabled || saving}
        aria-label={placeholder}
        className={cn(inputClass, "min-w-[10rem] flex-1")}
      />
      {extra}
      <button type="submit" disabled={disabled || saving || name.trim() === ""} className={primaryButtonClass}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {buttonLabel}
      </button>
    </form>
  );
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SaveBar({ dirty, busy, onSave, label = "Guardar cambios" }: { dirty: boolean; busy: boolean; onSave: () => void; label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onSave} disabled={!dirty || busy} className={primaryButtonClass}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
      {!dirty && <span className="text-xs text-muted-foreground">Sin cambios por guardar.</span>}
    </div>
  );
}
