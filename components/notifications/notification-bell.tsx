"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { markNotificationsRead } from "@/lib/actions/cases";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  NOTIFICATION_LIST_LIMIT,
  badgeLabel,
  markAsRead,
  safeInternalLink,
  unreadIds,
  upsertNotification,
  type NotificationItem,
} from "./notification-rules";

const COLUMNS = "id, type, title, body, link, read_at, created_at";

type BrowserClient = ReturnType<typeof createClient>;

/** Últimas notificaciones del usuario en el espacio y cuántas siguen sin leer. */
async function fetchSnapshot(supabase: BrowserClient, userId: string, workspaceId: string) {
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select(COLUMNS)
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_LIST_LIMIT),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .is("read_at", null),
  ]);
  return { items: (data as NotificationItem[] | null) ?? null, count: typeof count === "number" ? count : null };
}

/**
 * Campana del menú: contador de no leídas, lista desplegable y actualización
 * en tiempo real de las notificaciones del usuario en este espacio. Las
 * lecturas usan el cliente del usuario (RLS: cada uno ve las suyas); marcar
 * como leídas pasa por la acción del servidor.
 */
export function NotificationBell({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const [supabase] = useState(() => createClient());
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  // Las que estaban sin leer al abrir se siguen resaltando mientras el panel está abierto.
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    const snapshot = await fetchSnapshot(supabase, userId, workspaceId);
    if (snapshot.items) setItems(snapshot.items);
    if (snapshot.count !== null) setUnread(snapshot.count);
  }, [supabase, userId, workspaceId]);

  const refreshCount = useCallback(async () => {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .is("read_at", null);
    if (typeof count === "number") setUnread(count);
  }, [supabase, userId, workspaceId]);

  // Carga inicial.
  useEffect(() => {
    let cancelled = false;
    void fetchSnapshot(supabase, userId, workspaceId).then((snapshot) => {
      if (cancelled) return;
      if (snapshot.items) setItems(snapshot.items);
      if (snapshot.count !== null) setUnread(snapshot.count);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId, workspaceId]);

  // Tiempo real: nuevas notificaciones y cambios de "leída" (también desde otra pestaña).
  useEffect(() => {
    let subscribedBefore = false;
    const channel = supabase
      .channel(`notifications:${userId}:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            void reload();
            return;
          }
          const row = payload.new as NotificationItem & { workspace_id?: string };
          if (row.workspace_id !== workspaceId) return;
          setItems((prev) => upsertNotification(prev, row));
          void refreshCount();
        },
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Al reconectar se recupera lo que pudo llegar mientras no había conexión.
        if (subscribedBefore) void reload();
        subscribedBefore = true;
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId, workspaceId, reload, refreshCount]);

  const close = useCallback(() => {
    setOpen(false);
    setHighlight(new Set());
  }, []);

  // Cerrar con Escape o al hacer clic fuera.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    }
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  /**
   * Marca en el servidor y vuelve a leer lo real: confirma el estado
   * optimista y, si la acción falló, lo corrige en vez de mostrar uno falso.
   */
  async function markRead(ids: string[] | "all") {
    try {
      await markNotificationsRead(ids);
    } catch {
      // Se corrige con la lectura de abajo.
    }
    await reload();
  }

  function toggle() {
    if (open) {
      close();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ left: Math.max(8, rect.left), top: rect.bottom + 8 });
    setOpen(true);

    // Abrir la lista marca como leídas las que se ven.
    const ids = unreadIds(items);
    if (ids.length > 0) {
      setHighlight(new Set(ids));
      setItems((prev) => markAsRead(prev, ids, new Date().toISOString()));
      setUnread((prev) => Math.max(0, prev - ids.length));
      void markRead(ids);
    } else {
      void reload();
    }
  }

  function markAll() {
    setItems((prev) => markAsRead(prev, "all", new Date().toISOString()));
    setUnread(0);
    void markRead("all");
  }

  function onItemClick(item: NotificationItem) {
    if (item.read_at === null) {
      setItems((prev) => markAsRead(prev, [item.id], new Date().toISOString()));
      setUnread((prev) => Math.max(0, prev - 1));
      void markRead([item.id]);
    }
    close();
  }

  const badge = badgeLabel(unread);

  return (
    <div ref={rootRef} className="shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative rounded-lg p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="h-4 w-4" />
        {badge && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {badge}
          </span>
        )}
      </button>

      {open && anchor && (
        <div
          role="dialog"
          aria-label="Notificaciones"
          style={{ left: anchor.left, top: anchor.top }}
          className="animate-pop-in fixed z-50 flex max-h-[min(28rem,calc(100vh-6rem))] w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold">Notificaciones</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar todas
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No tienes notificaciones.</p>
          ) : (
            <ul className="flex-1 divide-y divide-border overflow-y-auto">
              {items.map((item) => {
                const href = safeInternalLink(item.link);
                const isNew = item.read_at === null || highlight.has(item.id);
                const content = (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", isNew ? "bg-primary" : "bg-transparent")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", isNew ? "font-semibold" : "font-medium")}>{item.title}</span>
                      {item.body && (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{item.body}</span>
                      )}
                      <span className="mt-1 block text-xs text-muted-foreground/80">
                        {formatRelative(item.created_at)}
                      </span>
                    </span>
                  </>
                );
                const rowClass = cn("flex gap-3 px-4 py-3", isNew && "bg-primary/5");
                return (
                  <li key={item.id}>
                    {href ? (
                      <Link href={href} onClick={() => onItemClick(item)} className={cn(rowClass, "hover:bg-muted")}>
                        {content}
                      </Link>
                    ) : (
                      <div className={rowClass}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
