"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BrandLogo } from "@/lib/brand-logo";
import { APP_NAME } from "@/lib/brand";
import {
  DEFAULT_AFTER_LOGIN,
  MIN_PASSWORD_LENGTH,
  translatePasswordUpdateError,
  validateNewPassword,
} from "@/lib/auth-helpers";

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/** Sirve para el invitado que crea su contraseña y para quien la recupera. */
export function SetPasswordForm({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    const validation = validateNewPassword(password, confirmation);
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        setError(translatePasswordUpdateError(updateError.message));
        setSaving(false);
        return;
      }
    } catch {
      setError("No se pudo guardar la contraseña. Revisa tu conexión e inténtalo de nuevo.");
      setSaving(false);
      return;
    }

    router.push(DEFAULT_AFTER_LOGIN);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandLogo size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Crea tu contraseña</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            La usarás para entrar a {APP_NAME}
            {email && (
              <>
                {" "}
                con <span className="font-medium text-foreground">{email}</span>
              </>
            )}
            .
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
              Contraseña nueva
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className={inputClass}
              placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
            />
          </div>

          <div>
            <label htmlFor="confirmation" className="mb-1.5 block text-sm font-medium">
              Confirma la contraseña
            </label>
            <input
              id="confirmation"
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className={inputClass}
              placeholder="Repite la contraseña"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Guardando..." : "Guardar y entrar"}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          <Link href={DEFAULT_AFTER_LOGIN} className="hover:text-foreground hover:underline">
            Volver al panel sin cambiarla
          </Link>
        </p>
      </div>
    </div>
  );
}
