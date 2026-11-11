import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SET_PASSWORD_PATH } from "@/lib/auth-helpers";
import { getVerifiedAuthUser } from "@/lib/view-as/state";
import { isViewAsLocked } from "@/lib/view-as/lock";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = {
  title: "Contraseña",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  // Cambia la contraseña de la persona REAL (el Dueño): identidad real, nunca la
  // de una vista, y no se ofrece mientras hay una vista de "Ver como".
  const supabase = await createClient();
  const user = await getVerifiedAuthUser(supabase);

  if (!user) redirect(`/login?next=${encodeURIComponent(SET_PASSWORD_PATH)}`);
  if (await isViewAsLocked()) redirect("/dashboard");

  return <SetPasswordForm email={user.email ?? ""} />;
}
