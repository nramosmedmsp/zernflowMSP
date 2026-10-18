import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SET_PASSWORD_PATH } from "@/lib/auth-helpers";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = {
  title: "Contraseña",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(SET_PASSWORD_PATH)}`);

  return <SetPasswordForm email={user.email ?? ""} />;
}
