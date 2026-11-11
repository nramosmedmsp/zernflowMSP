// `fetch` con candado de solo lectura para los clientes de Supabase del servidor
// mientras hay una vista activa ("Ver como"). Capa 2 del candado:
//   * añade la cabecera x-crm-read-only: 1, con la que el pre-request de la base
//     (00040) deja la transacción en solo lectura también para service_role;
//   * devuelve un 403 sintético (VIEW_AS_READ_ONLY) a todo lo que no sea GET o
//     HEAD, sin llegar a la red. Excepciones: refrescar la sesión, firmar
//     enlaces de LECTURA de Storage y consultar view_as_current.

import { VIEW_AS_READ_ONLY_CODE, VIEW_AS_READ_ONLY_MESSAGE } from "./guard";

export const READ_ONLY_HEADER = "x-crm-read-only";

const ALLOWED_WRITE_PATHS: readonly RegExp[] = [
  /^\/auth\/v1\/token$/,
  /^\/storage\/v1\/object\/sign\//,
  /^\/rest\/v1\/rpc\/view_as_current$/,
];

export function isAllowedViewAsWrite(pathname: string): boolean {
  return ALLOWED_WRITE_PATHS.some((re) => re.test(pathname));
}

function requestInfo(input: RequestInfo | URL, init?: RequestInit): { method: string; pathname: string } {
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : undefined) ?? "GET").toUpperCase();
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    // ruta relativa: se usa tal cual
  }
  return { method, pathname };
}

export function readOnlyResponse(): Response {
  return new Response(
    JSON.stringify({ code: VIEW_AS_READ_ONLY_CODE, message: VIEW_AS_READ_ONLY_MESSAGE, details: null, hint: null }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}

export interface ReadOnlyFetchOptions {
  baseFetch?: typeof fetch;
  /** Se llama cuando se bloquea una escritura (deja la cookie de aviso). */
  onBlocked?: () => void;
}

export function createReadOnlyFetch(options: ReadOnlyFetchOptions = {}): typeof fetch {
  return async (input, init) => {
    const { method, pathname } = requestInfo(input, init);
    if (method !== "GET" && method !== "HEAD" && !isAllowedViewAsWrite(pathname)) {
      try {
        options.onBlocked?.();
      } catch {
        // el aviso es opcional
      }
      return readOnlyResponse();
    }
    const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
    headers.set(READ_ONLY_HEADER, "1");
    return (options.baseFetch ?? fetch)(input, { ...init, headers });
  };
}
