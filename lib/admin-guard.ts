// Acceso a las pantallas de administración (Flujos, Canales, Difusiones,
// Secuencias, Analítica del bot y Crecimiento). El menú ya las oculta a los
// asesores; esto cierra el acceso por dirección: el servidor revisa el rol y
// manda a quien no es Dueño ni Administrador a su pantalla de trabajo.

import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";

/** Pantalla de trabajo de quien no administra: la Bandeja. */
export const NON_ADMIN_HOME = "/dashboard/inbox";
/** Pantalla de entrada de todos los roles: la Bandeja. */
export const HOME_PATH = "/dashboard/inbox";

/** Pantalla a la que entra cada rol al abrir la app o iniciar sesión: la Bandeja para todos. */
export function homePathFor(_role?: string | null): string {
  return HOME_PATH;
}

/** Úsalo en el `layout.tsx` de cada sección de administración. */
export async function requireAdminPage(): Promise<void> {
  const { role } = await getWorkspace();
  if (!isAdminRole(role)) redirect(NON_ADMIN_HOME);
}
