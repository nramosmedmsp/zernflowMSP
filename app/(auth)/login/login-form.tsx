"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandLogo } from "@/lib/brand-logo";
import { APP_NAME } from "@/lib/brand";
import { requestPasswordReset } from "@/lib/actions/auth";

function translateAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (text.includes("email not confirmed")) {
    return "Tu cuenta aún no está activada. Abre el enlace de activación o pide a un administrador que te lo reenvíe.";
  }
  if (text.includes("signups not allowed") || text.includes("user not found")) {
    return "No hay una cuenta con ese correo. Pide a un administrador que te cree un usuario.";
  }
  if (text.includes("rate limit") || text.includes("security purposes")) {
    return "Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
  }
  return "No se pudo iniciar sesión. Inténtalo de nuevo.";
}

export function LoginForm({ next, notice }: { next: string; notice: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Escribe tu correo y tu contraseña.");
      return;
    }
    setLoading(true);

    let error: { message: string } | null;
    try {
      ({ error } = await supabase.auth.signInWithPassword({
        email,
        password,
      }));
    } catch {
      setError("No se pudo iniciar sesión. Revisa tu conexión e inténtalo de nuevo.");
      setLoading(false);
      return;
    }

    if (error) {
      setError(translateAuthError(error.message));
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  // "¿Olvidaste tu contraseña?": el enlace lo arma y lo envía el servidor con
  // el correo de la app (Configuración → Correo) y lleva a /auth/confirm →
  // /cuenta/contrasena. La respuesta no revela si el correo existe.
  async function handleForgotPassword() {
    setError(null);
    if (!email.trim()) {
      setError("Primero escribe tu correo.");
      return;
    }
    setResetLoading(true);
    try {
      const { message } = await requestPasswordReset(email);
      setResetMessage(message);
    } catch {
      setError("No se pudo procesar el pedido. Inténtalo de nuevo.");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandLogo size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Hola de nuevo</h1>
          <p className="mt-1 text-sm text-muted-foreground">Inicia sesión en {APP_NAME}</p>
        </div>

        {notice && (
          <p className="rounded-lg border border-border bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
            {notice}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1.5">
              Correo
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="tu@correo.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1.5">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="Tu contraseña"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Iniciando sesión..." : "Iniciar sesión"}
          </button>

          {resetMessage ? (
            <p className="text-center text-sm text-muted-foreground">{resetMessage}</p>
          ) : (
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={resetLoading}
              className="w-full text-center text-sm font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
            >
              {resetLoading ? "Enviando..." : "¿Olvidaste tu contraseña?"}
            </button>
          )}
        </form>

        <p className="text-center text-xs text-muted-foreground">
          ¿Aún no tienes cuenta? El acceso es solo por invitación: pide a un administrador que
          te cree un usuario.
        </p>
      </div>
    </div>
  );
}
