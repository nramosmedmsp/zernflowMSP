"use client";

// Piezas visuales del tipo de contacto: el chip de color, el menú para
// cambiarlo, la pregunta única del chat y el bloque de la ficha. Las usan la
// bandeja (cabecera del chat, lista, panel) y la ficha completa del contacto.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  firstName,
  historyLineText,
  questionOptions,
  typeStatusText,
  type ContactTypeInfo,
  type ContactTypeOption,
} from "@/lib/cases/contact-type-model";

/** Color del tipo con valores por defecto si no tiene. */
function hex(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#6b7280";
}

/** "● Cliente ▾" con el color del tipo. Sin tipo: «Sin tipo». */
export function ContactTypeChip({
  type,
  small = false,
  caret = false,
  open = false,
  className,
}: {
  type: Pick<ContactTypeOption, "name" | "color"> | null;
  small?: boolean;
  caret?: boolean;
  open?: boolean;
  className?: string;
}) {
  const color = hex(type?.color);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border font-medium",
        small ? "px-1.5 py-0 text-[10px]" : "px-2.5 py-0.5 text-[11px]",
        open && "ring-2 ring-ring",
        className,
      )}
      style={{ borderColor: `${color}66`, backgroundColor: `${color}1a` }}
    >
      <span className={cn("shrink-0 rounded-full", small ? "h-1.5 w-1.5" : "h-2 w-2")} style={{ backgroundColor: color }} />
      <span className="truncate">{type?.name ?? "Sin tipo"}</span>
      {caret && <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />}
    </span>
  );
}

/** Cierra al hacer clic fuera o con Escape. */
function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

/** Chip que abre el menú con todos los tipos activos (color, descripción corta y ✓ en el actual). */
export function ContactTypePicker({
  current,
  options,
  busy = false,
  disabled = false,
  disabledTitle,
  onSelect,
  align = "left",
}: {
  current: ContactTypeOption | null;
  /** Tipos activos, en orden. */
  options: readonly ContactTypeOption[];
  busy?: boolean;
  disabled?: boolean;
  /** Texto del `title` cuando está apagado (p. ej. la nota de «Ver como»). */
  disabledTitle?: string;
  onSelect: (typeId: string) => void | Promise<void>;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const choices = options.filter((t) => !t.archived);

  if (choices.length === 0) return <ContactTypeChip type={current} />;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Tipo de contacto: ${current?.name ?? "sin tipo"}. Cambiar`}
        title={disabled && disabledTitle ? disabledTitle : (current?.description ?? "Cambiar el tipo de contacto")}
        className={cn(
          "inline-flex items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70",
          disabled && "cursor-not-allowed",
        )}
      >
        <ContactTypeChip type={current} caret={!busy} open={open} />
        {busy && <Loader2 className="ml-1 h-3 w-3 animate-spin text-muted-foreground" />}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full z-40 mt-1 w-72 rounded-lg border border-border bg-card p-2 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase text-muted-foreground">Tipo de contacto</p>
          {choices.map((t) => {
            const selected = t.id === current?.id;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setOpen(false);
                  if (!selected) void onSelect(t.id);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                  selected && "bg-accent",
                )}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: hex(t.color) }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t.name}</span>
                  {t.description && <span className="block text-[11px] text-muted-foreground">{t.description}</span>}
                </span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
          <p className="mt-1 border-t border-border px-2 pt-1.5 text-[11px] leading-snug text-muted-foreground">
            Cambia solo al ganar una venta. También puedes corregirlo aquí; queda en la ficha.
          </p>
        </div>
      )}
    </div>
  );
}

const questionButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50";

/**
 * "¿Ya nos compró antes?" — pregunta única bajo la cabecera del chat. No bloquea:
 * quien atiende puede escribir igual. Responder (incluso dejar el tipo por
 * defecto) confirma el tipo; "Preguntar después" la calla 7 días.
 */
export function ContactTypeQuestion({
  contactName,
  options,
  busy,
  disabled = false,
  disabledNote,
  onAnswer,
  onSnooze,
}: {
  contactName: string | null;
  options: readonly ContactTypeOption[];
  busy: boolean;
  /** Apagada (p. ej. «Ver como»): botones en gris y con `disabledNote` como título y nota. */
  disabled?: boolean;
  disabledNote?: string;
  onAnswer: (typeId: string) => void | Promise<void>;
  onSnooze: () => void | Promise<void>;
}) {
  const { buttons, overflow } = questionOptions(options);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useDismiss(moreOpen, () => setMoreOpen(false));
  if (buttons.length === 0) return null;
  const first = firstName(contactName);

  return (
    <div
      role="region"
      aria-label="Pregunta sobre el tipo de contacto"
      className="shrink-0 border-b border-sky-200 bg-sky-50 px-4 py-2.5 dark:border-sky-900/60 dark:bg-sky-950/30"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Sparkles className="h-4 w-4 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden />
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-semibold text-sky-950 dark:text-sky-100">¿Ya nos compró antes?</p>
          <p className="text-[11px] text-sky-900/80 dark:text-sky-200/80">
            Así sabemos cómo atender a {first}. Se guarda en su ficha y se pregunta una sola vez.
          </p>
          {disabled && disabledNote && (
            <p data-testid="view-as-unavailable-note" className="mt-0.5 text-[11px] text-sky-900/80 dark:text-sky-200/80">
              {disabledNote}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {buttons.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={busy || disabled}
              title={disabled ? disabledNote : (t.description ?? undefined)}
              onClick={() => void onAnswer(t.id)}
              className={cn(questionButtonClass, disabled && "cursor-not-allowed")}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hex(t.color) }} />
              {t.label}
            </button>
          ))}
          {overflow.length > 0 && (
            <div ref={moreRef} className="relative">
              <button
                type="button"
                disabled={busy || disabled}
                title={disabled ? disabledNote : undefined}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
                className={cn(questionButtonClass, disabled && "cursor-not-allowed")}
              >
                Otro <ChevronDown className="h-3 w-3" />
              </button>
              {moreOpen && (
                <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-border bg-card p-1 shadow-lg">
                  {overflow.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        void onAnswer(t.id);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hex(t.color) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{t.name}</span>
                        {t.description && <span className="block text-[11px] text-muted-foreground">{t.description}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            disabled={busy || disabled}
            title={disabled ? disabledNote : undefined}
            onClick={() => void onSnooze()}
            className={cn(
              "ml-1 text-[11px] text-sky-900/80 underline hover:text-sky-950 disabled:opacity-50 dark:text-sky-200/80 dark:hover:text-sky-100",
              disabled && "cursor-not-allowed",
            )}
          >
            Preguntar después
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Bloque de la ficha: el chip (con menú si se puede cambiar), desde cuándo y por quién,
 * y los últimos 3 cambios.
 */
export function ContactTypeBlock({
  current,
  options,
  info,
  personName,
  busy,
  onSelect,
  readOnly = false,
  disabled = false,
  disabledTitle,
  action,
  className,
}: {
  current: ContactTypeOption | null;
  options: readonly ContactTypeOption[];
  info: ContactTypeInfo | null;
  personName: (id: string) => string;
  busy?: boolean;
  onSelect?: (typeId: string) => void | Promise<void>;
  readOnly?: boolean;
  /** Apagado (p. ej. «Ver como»): el chip se ve pero no abre el menú. */
  disabled?: boolean;
  disabledTitle?: string;
  /** Algo extra junto al título (p. ej. un indicador de guardado). */
  action?: ReactNode;
  className?: string;
}) {
  const nameOf = (id: string | null) => options.find((t) => t.id === id)?.name ?? (id ? (current?.id === id ? current.name : "Otro tipo") : "Sin tipo");
  const history = (info?.history ?? []).slice(0, 3);
  const now = new Date();
  return (
    <div className={cn("rounded-lg border border-border bg-background p-2.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase text-muted-foreground">Tipo de contacto</p>
        {action}
      </div>
      <div className="mt-1 space-y-1">
        {readOnly || !onSelect ? (
          <ContactTypeChip type={current} />
        ) : (
          <ContactTypePicker
            current={current}
            options={options}
            busy={busy}
            disabled={disabled}
            disabledTitle={disabledTitle}
            onSelect={onSelect}
          />
        )}
        {info && <p className="text-[11px] text-muted-foreground">{typeStatusText(info, personName, now)}</p>}
      </div>
      {history.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-[11px] text-muted-foreground" aria-label="Últimos cambios de tipo">
          {history.map((h) => (
            <li key={h.id}>{historyLineText(h, nameOf, personName, now)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
