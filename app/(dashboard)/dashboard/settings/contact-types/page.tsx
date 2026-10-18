import type { Metadata } from "next";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { getCaseConfig } from "@/lib/actions/case-config";
import { ContactTypesView } from "@/components/settings/cases/contact-types-view";
import { NoPermission } from "@/components/settings/cases/no-permission";

export const metadata: Metadata = { title: "Tipos de contacto" };

export default async function ContactTypesPage() {
  const { role } = await getWorkspace();
  if (!isAdminRole(role)) return <NoPermission title="Tipos de contacto" />;

  const config = await getCaseConfig();
  if ("error" in config) return <NoPermission title="Tipos de contacto" message={config.error} />;

  return <ContactTypesView data={config.data} />;
}
