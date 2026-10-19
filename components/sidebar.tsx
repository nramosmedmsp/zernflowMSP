"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  type LucideIcon,
  Briefcase,
  GitBranch,
  MessageSquare,
  Users,
  Radio,
  ListOrdered,
  BarChart3,
  ChartLine,
  Sprout,
  Plug,
  Settings,
  LogOut,
  Moon,
  Sun,
  KeyRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { isNavActive, navigationFor, type NavKey } from "@/components/sidebar-nav";
import { setMyAvailability } from "@/lib/actions/cases";
import type { Database, MemberAvailability } from "@/lib/types/database";
import { APP_NAME } from "@/lib/brand";
import { BrandLogo } from "@/lib/brand-logo";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

function subscribeToThemeClass(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const NAV_ICONS: Record<NavKey, LucideIcon> = {
  flows: GitBranch,
  inbox: MessageSquare,
  cases: Briefcase,
  contacts: Users,
  broadcasts: Radio,
  sequences: ListOrdered,
  metrics: ChartLine,
  analytics: BarChart3,
  growth: Sprout,
  channels: Plug,
  settings: Settings,
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Dueño",
  admin: "Administrador",
  member: "Miembro",
};

/** Interruptor Disponible / Ausente: con Ausente no se te reparten gestiones nuevas. */
function AvailabilityToggle({ initial }: { initial: MemberAvailability }) {
  const [availability, setAvailability] = useState<MemberAvailability>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = availability === "available";

  async function toggle() {
    if (pending) return;
    const previous = availability;
    const next: MemberAvailability = available ? "away" : "available";
    setPending(true);
    setError(null);
    setAvailability(next);
    try {
      const result = await setMyAvailability(next);
      if ("error" in result) {
        setAvailability(previous);
        setError(result.error);
      }
    } catch {
      setAvailability(previous);
      setError("No se pudo cambiar tu estado. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn("h-2 w-2 shrink-0 rounded-full", available ? "bg-green-500" : "bg-gray-400")}
        />
        <span className="flex-1 text-xs text-sidebar-foreground/70">{available ? "Disponible" : "Ausente"}</span>
        <button
          type="button"
          role="switch"
          aria-checked={available}
          aria-label="Disponible para recibir gestiones"
          title={available ? "Cambiar a Ausente" : "Cambiar a Disponible"}
          onClick={toggle}
          disabled={pending}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
            available ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
              available ? "translate-x-[1.125rem]" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function Sidebar({
  workspace,
  user,
  userName,
  role,
  availability,
  workspaces,
}: {
  workspace: Workspace;
  user: { id: string; email?: string };
  /** Nombre para mostrar de la persona que inició sesión. */
  userName: string;
  /** Rol en este espacio: decide qué entradas del menú se muestran. */
  role: string;
  availability: MemberAvailability;
  workspaces: WorkspaceItem[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const dark = useSyncExternalStore(
    subscribeToThemeClass,
    () => document.documentElement.classList.contains("dark"),
    () => false
  );

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-full w-60 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-sidebar-border px-3 py-3">
        <div className="mb-2 flex items-center gap-1">
          <Link
            href="/dashboard"
            className="flex min-w-0 flex-1 items-center gap-2 px-2 text-xs font-semibold text-sidebar-foreground/70 hover:text-sidebar-foreground"
          >
            <BrandLogo size={20} alt="" className="rounded" />
            <span className="truncate">{APP_NAME}</span>
          </Link>
          <NotificationBell userId={user.id} workspaceId={workspace.id} />
        </div>
        <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navigationFor(role).map((item) => {
          const isActive = isNavActive(pathname, item.href);
          const Icon = NAV_ICONS[item.key];
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-1">
        <div className="mb-1 space-y-2 rounded-lg bg-sidebar-accent/50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={user.email ?? userName}>
              {userName}
            </p>
            <p className="truncate text-xs text-sidebar-foreground/60">{ROLE_LABELS[role] ?? "Miembro"}</p>
          </div>
          <AvailabilityToggle initial={availability} />
        </div>
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {dark ? "Modo claro" : "Modo oscuro"}
        </button>
        <Link
          href="/cuenta/contrasena"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <KeyRound className="h-4 w-4" />
          Cambiar contraseña
        </Link>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
