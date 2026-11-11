import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";
import { isViewAsLocked, markReadOnlyHit } from "@/lib/view-as/lock";
import { createReadOnlyFetch } from "@/lib/view-as/read-only-fetch";

/**
 * Mientras hay una vista activa ("Ver como", cookie crm_view_as) los clientes
 * del servidor llevan el candado de solo lectura: ver lib/view-as/read-only-fetch.ts.
 * Sin la cookie no cambia nada.
 */
async function lockedGlobal(): Promise<{ fetch: typeof fetch } | undefined> {
  if (!(await isViewAsLocked())) return undefined;
  return { fetch: createReadOnlyFetch({ onBlocked: () => void markReadOnlyHit() }) };
}

export async function createClient() {
  const cookieStore = await cookies();
  const global = await lockedGlobal();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(global ? { global } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component. Can be ignored if middleware refreshes sessions.
          }
        },
      },
    }
  );
}

export async function createServiceClient() {
  const global = await lockedGlobal();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      ...(global ? { global } : {}),
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    }
  );
}

/**
 * Cliente de servicio SIN candado de "Ver como" y sin leer cookies. Solo para
 * lib/view-as/* (empezar, cerrar y registrar vistas, que escriben mientras hay
 * una vista activa) y para cachés de Next (unstable_cache no permite cookies()),
 * donde solo se leen datos que no dependen de la identidad.
 */
export function createRawServiceClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    }
  );
}
