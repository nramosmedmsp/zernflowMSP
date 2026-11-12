"use server";

import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { RATE_LIMIT_MESSAGE, RATE_RULES, clientIp, hashSubject } from "@/lib/rate-limit";
import { rateLimitDecision } from "@/lib/rate-limit-http";
import { rpcAuthUserExists } from "@/lib/supabase/extra-rpc";
import { findAuthUserByEmail, generateAccessLink } from "@/lib/supabase/admin-users";
import { isMailConfigured } from "@/lib/mail/settings";
import { sendAppMail } from "@/lib/mail/send";
import { resetPasswordEmail } from "@/lib/mail/templates";
import { accessLinkTypeFor, appBaseUrl, displayName, normalizeEmail } from "@/lib/team-rules";

// Los archivos "use server" solo pueden exportar funciones async.
const RESET_REQUESTED_MESSAGE = "Si el correo está registrado, te enviamos un enlace.";
const RESET_UNAVAILABLE_MESSAGE =
  "Por ahora pide a un administrador que te restablezca la contraseña.";

/** Mínimo entre dos enlaces de recuperación para la misma cuenta. */
const RESEND_COOLDOWN_MS = 60_000;

/**
 * "¿Olvidaste tu contraseña?" del login. Responde siempre lo mismo para no
 * revelar si el correo existe: el mensaje solo depende de si la app tiene
 * correo configurado, que es igual para cualquier dirección.
 */
export async function requestPasswordReset(rawEmail: string): Promise<{ message: string }> {
  const service = await createServiceClient();

  if (!(await isMailConfigured(service))) {
    return { message: RESET_UNAVAILABLE_MESSAGE };
  }

  const email = normalizeEmail(rawEmail);
  const baseUrl = appBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (!email || !baseUrl) {
    if (!baseUrl) console.error("[requestPasswordReset] falta NEXT_PUBLIC_APP_URL");
    return { message: RESET_REQUESTED_MESSAGE };
  }

  // SEG-01: tope por IP y por correo (acción pública; cada pedido invalida el
  // enlace anterior y gasta cuota de correo). El correo se guarda con hash.
  // El tope por correo cuenta aunque la cuenta no exista, para no revelarlo.
  const ip = clientIp(await headers());
  const [byIp, byEmail] = await Promise.all([
    rateLimitDecision(RATE_RULES.passwordResetIp, hashSubject(ip)),
    rateLimitDecision(RATE_RULES.passwordResetEmail, hashSubject(email)),
  ]);
  if (!byIp.allowed || !byEmail.allowed) return { message: RATE_LIMIT_MESSAGE };

  try {
    const { exists } = await rpcAuthUserExists(service, email);
    if (!exists) return { message: RESET_REQUESTED_MESSAGE };

    const user = await findAuthUserByEmail(service, email);
    if (!user?.email) return { message: RESET_REQUESTED_MESSAGE };

    // Freno simple contra pedidos repetidos (la acción es pública).
    // generateLink actualiza recovery_sent_at (recuperación) o invited_at (invitación).
    const lastSent = Math.max(
      user.recovery_sent_at ? new Date(user.recovery_sent_at).getTime() : 0,
      !user.email_confirmed_at && user.invited_at ? new Date(user.invited_at).getTime() : 0,
    );
    if (Date.now() - lastSent < RESEND_COOLDOWN_MS) return { message: RESET_REQUESTED_MESSAGE };

    const link = await generateAccessLink(service, {
      email: user.email,
      type: accessLinkTypeFor(!!user.email_confirmed_at),
      baseUrl,
      fullName: displayName(user),
    });
    if (!link.ok) return { message: RESET_REQUESTED_MESSAGE };

    const result = await sendAppMail(
      service,
      user.email,
      resetPasswordEmail({ name: displayName(user), url: link.url }),
    );
    if (!result.ok && !result.notConfigured) {
      console.error("[requestPasswordReset] envío", result.error);
    }
  } catch (err) {
    console.error("[requestPasswordReset]", err);
  }

  return { message: RESET_REQUESTED_MESSAGE };
}
