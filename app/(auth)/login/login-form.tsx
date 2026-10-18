"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandLogo } from "@/lib/brand-logo";
import { APP_NAME } from "@/lib/brand";

function translateAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (text.includes("email not confirmed")) {
    return "Tu correo aún no está confirmado. Revisa tu bandeja o pide un enlace de acceso.";
  }
  if (text.includes("signups not allowed") || text.includes("user not found")) {
    return "No hay una cuenta con ese correo. Pide a un administrador tu enlace de invitación.";
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
  const [magicSent, setMagicSent] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(translateAuthError(error.message));
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  // Passwordless sign-in. Must start in the browser: the client uses the PKCE
  // flow, so the code verifier cookie is set here and /auth/callback can
  // exchange the code from the emailed link. Links sent from the Supabase
  // dashboard use the implicit flow and are rejected by this client.
  async function handleMagicLink() {
    setError(null);
    if (!email) {
      setError("Primero escribe tu correo.");
      return;
    }
    setMagicLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setMagicLoading(false);
    if (error) {
      setError(translateAuthError(error.message));
      return;
    }
    setMagicSent(true);
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

        <form onSubmit={handleSubmit} className="space-y-4">
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

          {magicSent ? (
            <p className="text-center text-sm text-muted-foreground">
              Revisa tu correo: te enviamos un enlace de acceso.
            </p>
          ) : (
            <button
              type="button"
              onClick={handleMagicLink}
              disabled={magicLoading}
              className="w-full text-center text-sm font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
            >
              {magicLoading
                ? "Enviando enlace..."
                : "¿Olvidaste tu contraseña? Envíame un enlace de acceso"}
            </button>
          )}
        </form>

        <p className="text-center text-xs text-muted-foreground">
          ¿Aún no tienes cuenta? El acceso es solo por invitación: pide a un administrador tu
          enlace.
        </p>
      </div>
    </div>
  );
}
