import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // /api/health es público para un monitor externo: pasa sin sesión y sin
  // trabajo de autenticación (es barato a propósito).
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|dictionaries/|spell-worker.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
