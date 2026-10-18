import type { Metadata } from "next";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { getImportContext } from "@/lib/actions/import";
import { ImportWizard } from "@/components/contacts/import-wizard";
import { NoPermission } from "@/components/settings/cases/no-permission";

export const metadata: Metadata = { title: "Importar contactos" };

export default async function ImportContactsPage() {
  const { role } = await getWorkspace();
  if (!isAdminRole(role)) {
    return <NoPermission title="Importar contactos" message="Solo el Dueño o un Administrador pueden importar contactos." />;
  }
  const context = await getImportContext();
  if ("error" in context) return <NoPermission title="Importar contactos" message={context.error} />;
  return <ImportWizard context={context.context} />;
}
