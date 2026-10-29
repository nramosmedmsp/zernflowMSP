import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { homePathFor } from "@/lib/admin-guard";

// Cada rol entra a su pantalla: Dueño y Administradores a Flujos; asesores y
// supervisores a la Bandeja.
export default async function DashboardPage() {
  const { role } = await getWorkspace();
  redirect(homePathFor(role));
}
