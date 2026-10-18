import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { confirmNextPath, parseEmailOtpType } from "@/lib/auth-helpers";

// Valida el enlace de acceso (activación y recuperación, generados con
// auth.admin.generateLink) solo cuando la persona pulsa «Continuar» en
// /auth/confirm. Va por POST para que las vistas previas y los filtros de correo,
// que solo hacen GET, no gasten el token de un solo uso. verifyOtp con
// token_hash crea la sesión y la deja en las cookies.
function redirectTo(request: NextRequest, path: string) {
  // 303: el navegador sigue con GET aunque la petición original fuera POST.
  return NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
}

export async function POST(request: NextRequest) {
  let form: FormData | null = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }

  const rawHash = form?.get("token_hash");
  const rawType = form?.get("type");
  const rawNext = form?.get("next");

  const tokenHash = typeof rawHash === "string" ? rawHash.trim() : "";
  const type = parseEmailOtpType(typeof rawType === "string" ? rawType : null);
  const next = confirmNextPath(type, typeof rawNext === "string" ? rawNext : null);

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return redirectTo(request, next);
    }
    console.warn("[auth/confirm] verifyOtp", type, error.code ?? error.message);
  }

  return redirectTo(request, "/login?error=enlace");
}

export async function GET(request: NextRequest) {
  return redirectTo(request, "/login?error=enlace");
}
