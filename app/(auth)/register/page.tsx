"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandLogo } from "@/lib/brand-logo";
import { APP_NAME } from "@/lib/brand";
import {
  MIN_PASSWORD_LENGTH,
  SIGNUP_REQUIRES_INVITE_MESSAGE,
  isSignupRequiresInviteError,
  validateNewPassword,
} from "@/lib/auth-helpers";

// El registro abierto solo sirve para la primera persona de una instalación
// nueva: el trigger handle_new_user (migración 00017) rechaza a cualquier otra
// que no tenga una invitación pendiente.

function translateSignUpError(message: string): string {
  if (isSignupRequiresInviteError(message)) return SIGNUP_REQUIRES_INVITE_MESSAGE;
  const text = message.toLowerCase();
  if (text.includes("already registered") || text.includes("already exists")) {
    return "Ya existe una cuenta con este correo. Inicia sesión.";
  }
  if (text.includes("signups not allowed")) return SIGNUP_REQUIRES_INVITE_MESSAGE;
  if (text.includes("password")) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (text.includes("rate limit") || text.includes("security purposes")) {
    return "Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
  }
  return "No se pudo crear la cuenta. Inténtalo de nuevo.";
}

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const passwordError = validateNewPassword(password, confirmation);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(translateSignUpError(error.message));
      setLoading(false);
      return;
    }

    // Con la confirmación de correo activa no hay sesión hasta abrir el enlace.
    if (!data.session) {
      setCheckEmail(true);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandLogo size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Crea tu cuenta</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Primer acceso a {APP_NAME}
          </p>
        </div>

        {checkEmail ? (
          <p className="rounded-lg border border-border bg-muted px-3 py-3 text-center text-sm text-muted-foreground">
            Revisa tu correo: te enviamos un enlace para confirmar tu cuenta.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1.5">
                Nombre
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
                autoComplete="name"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Tu nombre y apellido"
              />
            </div>

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
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
              />
            </div>

            <div>
              <label htmlFor="confirmation" className="block text-sm font-medium mb-1.5">
                Confirma tu contraseña
              </label>
              <input
                id="confirmation"
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Repite la contraseña"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Creando cuenta..." : "Crear cuenta"}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          ¿Ya tienes una cuenta?{" "}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
