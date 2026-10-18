import type { Metadata } from "next";
import { INVALID_LINK_MESSAGE, safeNextPath } from "@/lib/auth-helpers";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string }>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;

  let notice: string | null = null;
  if (params.error === "enlace") {
    notice = INVALID_LINK_MESSAGE;
  } else if (params.error === "auth") {
    notice = "No pudimos validar el enlace de acceso. Pide uno nuevo e inténtalo otra vez.";
  }

  return <LoginForm next={safeNextPath(rawNext)} notice={notice} />;
}
