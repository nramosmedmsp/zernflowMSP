import { redirect } from "next/navigation";
import { HOME_PATH } from "@/lib/admin-guard";

// Todos los roles entran a la Bandeja.
export default function DashboardPage() {
  redirect(HOME_PATH);
}
