import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth-helpers";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string; created?: string }>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;

  let notice: string | null = null;
  if (params.error === "auth") {
    notice = "No pudimos validar el enlace de acceso. Pide uno nuevo e inténtalo otra vez.";
  } else if (params.created === "1") {
    notice = "Tu cuenta ya está lista. Inicia sesión con tu correo y contraseña.";
  }

  return <LoginForm next={safeNextPath(rawNext)} notice={notice} />;
}
