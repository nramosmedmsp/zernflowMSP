import { requireAdminPage } from "@/lib/admin-guard";

// Sección solo para Dueño y Administradores: el servidor revisa el rol antes
// de mostrar nada, aunque la persona escriba la dirección a mano.
export default async function AdminSectionLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return children;
}
