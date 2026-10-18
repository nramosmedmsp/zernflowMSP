import { cookies } from "next/headers";
import { WORKSPACE_COOKIE } from "@/lib/workspace";

/**
 * Fija el espacio de trabajo activo. No es una server action: solo debe
 * llamarse desde código de servidor que ya validó la membresía.
 */
export async function setWorkspaceCookie(workspaceId: string) {
  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}
