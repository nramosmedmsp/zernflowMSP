import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

// SEG-04: cabeceras de seguridad y CSP de bajo riesgo (sin nonces, para no obligar
// a renderizado dinámico). Qué permite cada directiva y por qué: lib/security-headers.ts.
// Se calculan al arrancar o compilar con NEXT_PUBLIC_SUPABASE_URL.
const headers = securityHeaders({
  isDev: process.env.NODE_ENV === "development",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

const nextConfig: NextConfig = {
  // Sin "X-Powered-By: Next.js": no le decimos a nadie con qué está hecha la app.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers }];
  },
  // El ZIP del código (scripts/build-source-zip.mjs) viaja con la función de descarga.
  outputFileTracingIncludes: {
    "/api/v1/admin/source-zip": ["./.source-zip/codigo-crm.zip"],
  },
  // Sin `images.remotePatterns`: la app no usa el optimizador de imágenes y así
  // nadie lo puede usar como proxy de imágenes de otros sitios.
};

export default nextConfig;
