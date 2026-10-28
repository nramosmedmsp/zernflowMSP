// Enlaces del índice de Configuración según el rol (docs/FASE-1-TECNICO.md
// 4.4 y 4.5). Los no administradores solo ven sus respuestas guardadas, las plantillas
// de WhatsApp (en modo lectura) y el cambio de contraseña. Sin dependencias
// de React para probarlo con vitest.

import { isAdminRole } from "@/lib/permissions";

export type SettingsLinkKey =
  | "general"
  | "team"
  | "mail"
  | "cases"
  | "contact-types"
  | "teams"
  | "hours"
  | "attention"
  | "replies"
  | "whatsapp-templates"
  | "dictionary"
  | "password";

export interface SettingsLink {
  key: SettingsLinkKey;
  title: string;
  description: string;
  href: string;
  adminOnly: boolean;
}

export const SETTINGS_LINKS: readonly SettingsLink[] = [
  {
    key: "general",
    title: "General",
    description: "Nombre del espacio, claves de API y palabras clave globales.",
    href: "#general",
    adminOnly: true,
  },
  {
    key: "team",
    title: "Equipo",
    description: "Crea usuarios, reenvía accesos y administra a los miembros.",
    href: "/dashboard/settings/team",
    adminOnly: true,
  },
  {
    key: "mail",
    title: "Correo",
    description: "Servidor SMTP para invitaciones y restablecer contraseñas.",
    href: "/dashboard/settings/correo",
    adminOnly: true,
  },
  {
    key: "cases",
    title: "Gestiones",
    description: "Tipos de gestión, etapas, categorías, destino, tiempos y reglas.",
    href: "/dashboard/settings/cases",
    adminOnly: true,
  },
  {
    key: "contact-types",
    title: "Tipos de contacto",
    description: "Clasifica a tus contactos (cliente, prospecto, socio...).",
    href: "/dashboard/settings/contact-types",
    adminOnly: true,
  },
  {
    key: "teams",
    title: "Equipos",
    description: "Sedes, áreas o turnos, con sus miembros y su modo de reparto.",
    href: "/dashboard/settings/teams",
    adminOnly: true,
  },
  {
    key: "hours",
    title: "Horarios",
    description: "Horario de atención de la empresa y de cada equipo, y feriados.",
    href: "/dashboard/settings/hours",
    adminOnly: true,
  },
  {
    key: "attention",
    title: "Atención",
    description: "Qué ve cada asesor, reparto, respuesta fuera de horario y reasignación por espera.",
    href: "/dashboard/settings/attention",
    adminOnly: true,
  },
  {
    key: "replies",
    title: "Respuestas guardadas",
    description: "Textos listos para usar en la bandeja escribiendo «/».",
    href: "/dashboard/settings/replies",
    adminOnly: false,
  },
  {
    key: "whatsapp-templates",
    title: "Plantillas de WhatsApp",
    description: "Plantillas aprobadas para escribir pasadas las 24 horas.",
    href: "/dashboard/settings/whatsapp-templates",
    adminOnly: false,
  },
  {
    key: "dictionary",
    title: "Diccionario de la tienda",
    description: "Marcas y palabras que el corrector no debe marcar. Los asesores piden; los administradores aprueban.",
    href: "/dashboard/settings/dictionary",
    adminOnly: false,
  },
  {
    key: "password",
    title: "Cambiar contraseña",
    description: "Actualiza la contraseña de tu cuenta.",
    href: "/cuenta/contrasena",
    adminOnly: false,
  },
];

/** Enlaces que ve un rol. Un rol desconocido o ausente se trata como Miembro. */
export function settingsLinksFor(role: string | null | undefined): SettingsLink[] {
  const admin = isAdminRole(role);
  return SETTINGS_LINKS.filter((link) => admin || !link.adminOnly);
}
