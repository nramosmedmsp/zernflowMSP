// Cabeceras de seguridad de toda la app (SEG-04). Las usa next.config.ts, por eso
// este archivo no importa nada de la app (ni alias "@/").
//
// CSP de BAJO RIESGO, sin nonces. La guía de Next
// (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md,
// sección "Without Nonces") explica que con nonces TODAS las páginas pasarían a
// renderizado dinámico (sin caché de CDN, más costo y más latencia). Esta
// política elige no obligar a eso:
//   * script-src 'self' 'unsafe-inline': Next inyecta scripts en línea para
//     arrancar React y la app tiene un script fijo del tema (app/layout.tsx).
//     Lo que SÍ se bloquea es cargar scripts de cualquier otro origen y eval en
//     producción: un XSS que intente traer un script externo no puede.
//   * style-src 'self' 'unsafe-inline': Tailwind, React (style={...}) y next/font.
//   * connect-src: la propia app y Supabase (https y wss para Realtime).
//   * img-src / media-src con https: las fotos de perfil, los archivos de los
//     clientes y los medios de Zernio/Meta salen de muchos hosts (fbcdn,
//     cdninstagram, whatsapp.net, telegram, Supabase Storage firmado, el logo de
//     marca configurable, api.dicebear.com) y los enlaces de archivos externos se
//     pintan si empiezan por https://: una lista cerrada rompería chats. Se
//     suma el origen de Supabase por si es http (Supabase local).
//   * object-src 'none', base-uri 'self', form-action 'self', frame-ancestors 'none'.
// Fuentes: next/font/google las descarga al compilar y las sirve desde la propia
// app (font-src 'self'); no se carga nada de fonts.googleapis.com en el navegador.
// El corrector corre en /spell-worker.js (worker-src 'self') y lee su diccionario
// de /dictionaries/ (connect-src 'self').

export interface HeaderEntry {
  key: string;
  value: string;
}

export interface SecurityHeaderOptions {
  /** next dev: React necesita eval y el recarga en caliente usa WebSocket local. */
  isDev?: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl?: string | null;
}

interface SupabaseOrigins {
  /** Origen para peticiones y para imágenes/medios firmados. */
  http: string;
  /** Origen del WebSocket de Realtime. */
  ws: string;
}

/** Orígenes de Supabase a partir de su URL. Sin URL válida se aceptan los proyectos *.supabase.co. */
export function supabaseOrigins(raw: string | null | undefined): SupabaseOrigins {
  try {
    const u = new URL((raw ?? "").trim());
    if (u.protocol === "https:" || u.protocol === "http:") {
      return { http: u.origin, ws: `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}` };
    }
  } catch {
    // URL ausente o rota: se usa el comodín de Supabase.
  }
  return { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
}

export function buildCsp(options: SecurityHeaderOptions = {}): string {
  const { isDev = false } = options;
  const sb = supabaseOrigins(options.supabaseUrl);
  const secureSupabase = sb.http.startsWith("https:");

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:", sb.http]],
    ["media-src", ["'self'", "blob:", "https:", sb.http]],
    ["font-src", ["'self'", "data:"]],
    [
      "connect-src",
      [
        "'self'",
        sb.http,
        sb.ws,
        // Recarga en caliente de next dev (WebSocket y peticiones locales).
        ...(isDev ? ["ws://localhost:*", "ws://127.0.0.1:*", "http://localhost:*", "http://127.0.0.1:*"] : []),
      ],
    ],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  // Subir a https las peticiones http solo tiene sentido en producción y con Supabase por https
  // (con Supabase local por http rompería todas las llamadas).
  if (!isDev && secureSupabase) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export function securityHeaders(options: SecurityHeaderOptions = {}): HeaderEntry[] {
  return [
    { key: "Content-Security-Policy", value: buildCsp(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Redundantes con frame-ancestors, pero cubren navegadores viejos.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    // Siempre https en el dominio de producción (el navegador lo ignora en http local). Sin "preload": es un compromiso permanente.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    // Aísla la ventana de la app; "allow-popups" deja abrir enlaces nuevos sin romperlos.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  ];
}
