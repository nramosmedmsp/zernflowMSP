// Entradas del menú lateral según el rol (docs/FASE-1-TECNICO.md 4.5), sin
// dependencias de React ni de servidor para poder probarlas con vitest.
//
// Esto solo decide qué se muestra: el acceso real lo protegen las políticas
// RLS y las acciones del servidor.

import { isAdminRole } from "@/lib/permissions";

export type NavKey =
  | "flows"
  | "inbox"
  | "cases"
  | "contacts"
  | "broadcasts"
  | "sequences"
  | "metrics"
  | "analytics"
  | "growth"
  | "channels"
  | "settings";

export interface NavEntry {
  key: NavKey;
  name: string;
  href: string;
  /** Solo Dueño y Administradores. */
  adminOnly: boolean;
}

export const NAV_ENTRIES: readonly NavEntry[] = [
  { key: "flows", name: "Flujos", href: "/dashboard/flows", adminOnly: true },
  { key: "inbox", name: "Bandeja", href: "/dashboard/inbox", adminOnly: false },
  { key: "cases", name: "Gestiones", href: "/dashboard/cases", adminOnly: false },
  { key: "contacts", name: "Contactos", href: "/dashboard/contacts", adminOnly: false },
  { key: "broadcasts", name: "Difusiones", href: "/dashboard/broadcasts", adminOnly: true },
  { key: "sequences", name: "Secuencias", href: "/dashboard/sequences", adminOnly: true },
  // Cada persona ve lo que le deja ver RLS: un asesor lo suyo, un supervisor su equipo.
  { key: "metrics", name: "Métricas", href: "/dashboard/metrics", adminOnly: false },
  { key: "analytics", name: "Analítica del bot", href: "/dashboard/analytics", adminOnly: true },
  { key: "growth", name: "Crecimiento", href: "/dashboard/growth", adminOnly: true },
  { key: "channels", name: "Canales", href: "/dashboard/channels", adminOnly: true },
  // Los miembros la ven para su contraseña y sus respuestas guardadas.
  { key: "settings", name: "Configuración", href: "/dashboard/settings", adminOnly: false },
];

/** Entradas que ve un rol. Un rol desconocido o ausente se trata como Miembro. */
export function navigationFor(role: string | null | undefined): NavEntry[] {
  const admin = isAdminRole(role);
  return NAV_ENTRIES.filter((entry) => admin || !entry.adminOnly);
}

/**
 * ¿La entrada está activa para la ruta actual? Coincide por segmento, así
 * "/dashboard/cases-x" no activa "/dashboard/cases".
 */
export function isNavActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
