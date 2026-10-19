import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth-helpers";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims verifica el JWT en local (llaves públicas en caché) y refresca la
  // sesión si el token venció; evita el viaje al servidor de Auth de getUser.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims?.sub ? { id: claimsData.claims.sub } : null;

  const pathname = request.nextUrl.pathname;

  const isAuthPage = pathname === "/login";
  // /auth/confirm (página con el botón Continuar) y /auth/confirm/verificar
  // (verifica el token_hash y crea la sesión) deben pasar sin sesión: la persona
  // todavía no la tiene.
  const isAuthCallback =
    pathname === "/auth/callback" ||
    pathname === "/auth/confirm" ||
    pathname === "/auth/confirm/verificar";
  const isAccount = pathname === "/cuenta" || pathname.startsWith("/cuenta/");
  const isDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const isApiRoute = pathname.startsWith("/api/");
  const isNoWorkspace = pathname === "/sin-espacio";
  // /invite/<id> is public: it only explains that invitations now arrive by
  // email, so it falls through untouched.

  // Auth callback and API routes (including webhooks) always pass through
  if (isAuthCallback || isApiRoute) {
    return supabaseResponse;
  }

  // Redirect while keeping any refreshed session cookies (with their options).
  function redirectTo(path: string) {
    const url = request.nextUrl.clone();
    const q = path.indexOf("?");
    url.pathname = q < 0 ? path : path.slice(0, q);
    url.search = q < 0 ? "" : path.slice(q);
    url.hash = "";
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  // No public landing page: the root goes to the dashboard or to login.
  if (pathname === "/") {
    return redirectTo(user ? "/dashboard" : "/login");
  }

  // Logged-in users on /login go to ?next= (internal paths only) or to the
  // dashboard.
  if (user && isAuthPage) {
    return redirectTo(safeNextPath(request.nextUrl.searchParams.get("next")));
  }

  // Unauthenticated users trying to access the dashboard go to login,
  // remembering where they were headed.
  if (!user && (isDashboard || isAccount)) {
    const target = `${pathname}${request.nextUrl.search}`;
    const next = target === "/dashboard" ? "" : `?next=${encodeURIComponent(target)}`;
    return redirectTo(`/login${next}`);
  }

  // /sin-espacio is for signed-in users without a workspace: with a session it
  // falls through (sending it to /dashboard would loop); without one it is
  // pointless, so it goes to login.
  if (!user && isNoWorkspace) {
    return redirectTo("/login");
  }

  return supabaseResponse;
}
