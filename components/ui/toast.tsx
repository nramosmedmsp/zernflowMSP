"use client";

// Avisos breves (toast) para confirmar que algo se guardó o mostrar un error.
// Uso: const toast = useToast(); toast.success("Guardado"); toast.error("No se pudo…").

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const MAX_VISIBLE = 4;
const DURATION: Record<ToastKind, number> = { success: 3500, info: 4000, error: 7000 };

const ToastContext = createContext<ToastApi | null>(null);

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info } as const;
const STYLES: Record<ToastKind, string> = {
  success: "text-green-600 dark:text-green-400",
  error: "text-destructive",
  info: "text-primary",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setItems((prev) =>
        [...prev.filter((t) => t.message !== message || t.kind !== kind), { id, kind, message }].slice(-MAX_VISIBLE),
      );
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION[kind]),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const current = timers.current;
    return () => {
      for (const timer of current.values()) clearTimeout(timer);
      current.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className="animate-toast-in pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-lg"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", STYLES[t.kind])} />
              <p className="min-w-0 flex-1 break-words">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Cerrar aviso"
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Sin proveedor (por ejemplo en pruebas) los avisos se ignoran en silencio. */
const NOOP: ToastApi = { success: () => {}, error: () => {}, info: () => {} };

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}
