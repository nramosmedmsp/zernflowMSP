"use client";

// Franja superior de "Ver como" (todo el panel):
//   * en reposo y solo para el Dueño real: "Vista: Dueño (tú)" a la derecha;
//   * en vista: franja ámbar con la persona o el rol, "Solo lectura",
//     [Cambiar vista] y [Salir];
//   * capa "La vista terminó" al caducar.
// Mientras hay vista: avisa a /touch (sección abierta y actividad) y convierte
// cualquier escritura bloqueada en un aviso "Solo lectura…".

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Eye, Loader2, Lock, Search, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useViewAs } from "./view-as-context";
import type { ViewAsOptions, ViewAsPersonOption, ViewAsRoleOption } from "@/lib/view-as/rules";
import {
  MAX_TIMER_MS,
  VIEW_AS_ENTRY_PATH,
  VIEW_AS_TOUCH_INTERVAL_MS,
  filterViewAsPeople,
  isReadOnlyRejection,
  msUntilEndLayer,
  newReadOnlyHit,
} from "@/lib/view-as/ui-rules";

async function postJson(path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  }
}

/** Sale de la vista (borra el candado) y recarga por completo para limpiar cachés y canales. */
async function stopAndReload(returnTo: string) {
  await postJson("/api/v1/view-as/stop");
  window.location.assign(returnTo);
}

// ── Selector ────────────────────────────────────────────────────────────────

function Selector({ onClose, starting, onStart, error }: {
  onClose: () => void;
  starting: string | null;
  onStart: (body: Record<string, unknown>, key: string) => void;
  error: string | null;
}) {
  const [options, setOptions] = useState<ViewAsOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/view-as/options", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as ViewAsOptions;
      })
      .then((data) => {
        if (!cancelled) setOptions(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("No se pudieron cargar las opciones. Inténtalo de nuevo.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [onClose]);

  const people = options ? filterViewAsPeople(options.people, query) : [];

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Ver como"
      className="absolute right-0 top-full z-50 mt-1.5 w-[25rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-popover text-left text-popover-foreground shadow-xl"
    >
      <div className="border-b border-border px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Eye className="h-4 w-4" /> Ver como…
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Mira la app tal como la ve un rol o una persona. «Por rol» siempre está disponible, aunque nadie tenga ese rol todavía.
        </p>
      </div>

      <div className="max-h-[calc(100vh-9rem)] overflow-y-auto">
        {loadError && <p role="alert" className="px-3 py-3 text-sm text-destructive">{loadError}</p>}
        {!options && !loadError && (
          <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </p>
        )}
        {options && (
          <>
            <p className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="h-3 w-3" /> Por rol
            </p>
            {options.roles.map((r: ViewAsRoleOption) => (
              <button
                key={r.key}
                type="button"
                disabled={!!starting}
                onClick={() =>
                  onStart(r.role === "admin" ? { kind: "role", role: "admin" } : { kind: "role", role: r.role, teamId: r.teamId }, `role:${r.key}`)
                }
                className="flex w-full flex-col px-3 py-1 text-left hover:bg-accent disabled:opacity-60"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {r.label}
                  {starting === `role:${r.key}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                </span>
                <span className="text-xs text-muted-foreground">Ve lo que vería cualquier {r.label.charAt(0).toLowerCase() + r.label.slice(1)}.</span>
              </button>
            ))}

            <div className="mt-1 border-t border-border">
              <p className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <UserRound className="h-3 w-3" /> Por persona
              </p>
              <div className="relative mx-3 mb-1.5">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Buscar persona"
                  placeholder="Buscar por nombre, rol o equipo…"
                  className="w-full rounded-lg border border-input bg-background py-1.5 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {people.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No hay personas con ese nombre, rol o equipo.</p>}
              {people.map((p: ViewAsPersonOption) => (
                <button
                  key={p.userId}
                  type="button"
                  disabled={!!starting}
                  onClick={() => onStart({ kind: "person", userId: p.userId }, `person:${p.userId}`)}
                  className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-accent disabled:opacity-60"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 truncate text-sm font-medium">
                      {p.name}
                      {p.status === "pending" && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                          Pendiente
                        </span>
                      )}
                      {starting === `person:${p.userId}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[p.roleLabel === "Miembro" && p.teams.length > 0 ? null : p.roleLabel, ...p.teams].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {error && <p role="alert" className="border-t border-border px-3 py-2 text-xs text-destructive">{error}</p>}
      <p className="flex items-start gap-1.5 border-t border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
        Solo lectura: no marcas chats como leídos ni cambias Disponible/Ausente. Queda registrado quién miró.
      </p>
    </div>
  );
}

// ── Vigilancia de la vista (touch, fin, avisos de solo lectura) ─────────────

function useViewWatcher(onEnded: () => void) {
  const view = useViewAs();
  const pathname = usePathname();
  const toast = useToast();
  const { active, info, blockedNotice } = view;

  // Sección abierta + actividad: al cambiar de sección y cada 60 s.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const touch = useCallback(async () => {
    const res = await postJson("/api/v1/view-as/touch", { path: pathRef.current });
    if (res.ok && res.json.active === false) onEnded();
  }, [onEnded]);
  useEffect(() => {
    if (!active) return;
    void touch();
  }, [active, pathname, touch]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void touch(), VIEW_AS_TOUCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, touch]);

  // Cerrar la pestaña con la vista abierta no deja huella: al volver desde la caché del navegador, se recarga.
  useEffect(() => {
    if (!view.locked) return;
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [view.locked]);

  // Red general de "solo lectura": cualquier escritura rechazada (por el
  // servidor, la cookie crm_ro_hit, o la base, 25006) se convierte en un aviso.
  const lastNotice = useRef(0);
  const noticeRef = useRef<string | null>(blockedNotice);
  const toastRef = useRef(toast);
  useEffect(() => {
    noticeRef.current = blockedNotice;
    toastRef.current = toast;
  }, [blockedNotice, toast]);
  const lastHit = useRef<number | null>(null);
  useEffect(() => {
    if (!active || !info) return;
    const notify = () => {
      const text = noticeRef.current;
      if (!text) return;
      const now = Date.now();
      if (now - lastNotice.current < 1500) return;
      lastNotice.current = now;
      toastRef.current.info(text);
    };
    const original = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      if ([400, 403, 405, 409, 500].includes(res.status)) {
        res
          .clone()
          .text()
          .then((text) => {
            if (isReadOnlyRejection(res.status, text)) notify();
          })
          .catch(() => {});
      }
      return res;
    };
    // Un bloqueo anterior (la cookie dura 60 s) no se vuelve a avisar al recargar.
    if (lastHit.current === null) lastHit.current = newReadOnlyHit(document.cookie, 0) ?? 0;
    const timer = setInterval(() => {
      const hit = newReadOnlyHit(document.cookie, lastHit.current ?? 0);
      if (hit !== null) {
        lastHit.current = hit;
        notify();
      }
    }, 600);
    return () => {
      window.fetch = original;
      clearInterval(timer);
    };
  }, [active, info]);
}

// ── Capa "La vista terminó" ─────────────────────────────────────────────────

function EndLayer({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="view-as-end-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-xl">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          <Eye className="h-5 w-5" />
        </span>
        <h2 id="view-as-end-title" className="text-lg font-semibold">La vista terminó</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pasaron 30 minutos y «Ver como» se cerró. No se guardó ningún cambio. Vuelve a tu vista para seguir trabajando.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void stopAndReload(returnTo);
          }}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Volver a mi vista
        </button>
      </div>
    </div>
  );
}

// ── Franja ──────────────────────────────────────────────────────────────────

export function ViewAsBar({ isRealOwner }: { isRealOwner: boolean }) {
  const view = useViewAs();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const markEnded = useCallback(() => setTimedOut(true), []);
  useViewWatcher(markEnded);

  // Capa de fin 5 s antes de caducar.
  const expiresAt = view.info?.expiresAt ?? null;
  useEffect(() => {
    if (!view.active || !expiresAt) return;
    let id: ReturnType<typeof setTimeout>;
    const arm = () => {
      const wait = msUntilEndLayer(expiresAt, Date.now());
      if (wait <= 0) {
        setTimedOut(true);
        return;
      }
      id = setTimeout(arm, Math.min(wait, MAX_TIMER_MS));
    };
    arm();
    return () => clearTimeout(id);
  }, [view.active, expiresAt]);

  const showEnd = view.ended || timedOut;
  const close = useCallback(() => setOpen(false), []);

  async function start(body: Record<string, unknown>, key: string) {
    setStarting(key);
    setError(null);
    const res = await postJson("/api/v1/view-as/start", body);
    if (!res.ok) {
      setStarting(null);
      setError(typeof res.json.error === "string" ? res.json.error : "No se pudo iniciar la vista.");
      return;
    }
    window.location.assign(VIEW_AS_ENTRY_PATH);
  }

  async function exit() {
    setLeaving(true);
    await stopAndReload(pathname.startsWith("/dashboard") ? pathname : "/dashboard/inbox");
  }

  if (showEnd) return <EndLayer returnTo={pathname.startsWith("/dashboard") ? pathname : "/dashboard/inbox"} />;
  if (!view.active && !isRealOwner) return null;

  const viewing = view.active && view.info;
  const trigger = cn(
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
    viewing
      ? "border-amber-900/30 bg-amber-50/70 text-amber-950 hover:bg-amber-50"
      : "border-border bg-background text-foreground hover:bg-accent",
    open && "ring-2 ring-ring",
  );

  return (
    <div
      role={viewing ? "status" : undefined}
      data-view-as-bar={viewing ? "active" : "idle"}
      className={cn(
        "relative z-40 flex shrink-0 items-center gap-3 border-b px-4",
        viewing ? "h-10 border-amber-600/40 bg-amber-400 text-amber-950" : "h-9 border-border bg-muted/40",
      )}
    >
      {viewing && view.info ? (
        <>
          <Eye className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 truncate text-sm">
            Estás viendo como <strong className="font-semibold">{view.info.name}</strong>
            {view.info.kind === "role" ? (
              <span> (vista de ejemplo)</span>
            ) : (
              <>
                <span className="mx-1.5 opacity-60">·</span>
                {view.roleText}
              </>
            )}
            <span className="mx-1.5 opacity-60">·</span>
            <strong className="font-semibold">Solo lectura</strong>
          </p>
        </>
      ) : (
        <div className="flex-1" />
      )}
      <div className="relative">
        <button
          type="button"
          className={trigger}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setError(null);
            setOpen((v) => !v);
          }}
        >
          {viewing ? "Cambiar vista" : "Vista: Dueño (tú)"}
          <ChevronDown className="h-3 w-3" />
        </button>
        {open && <Selector onClose={close} starting={starting} onStart={(b, k) => void start(b, k)} error={error} />}
      </div>
      {viewing && (
        <button
          type="button"
          disabled={leaving}
          onClick={() => void exit()}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60"
        >
          {leaving && <Loader2 className="h-3 w-3 animate-spin" />}
          Salir
        </button>
      )}
    </div>
  );
}
