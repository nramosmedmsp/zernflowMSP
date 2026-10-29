import type { NextConfig } from "next";

// B-15: cabeceras de endurecimiento. No se define una CSP estricta (rompería
// los estilos y scripts en línea de Next ni los medios de WhatsApp): la única
// directiva CSP es frame-ancestors, que impide incrustar la app en otro sitio.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // El ZIP del código (scripts/build-source-zip.mjs) viaja con la función de descarga.
  outputFileTracingIncludes: {
    "/api/v1/admin/source-zip": ["./.source-zip/codigo-crm.zip"],
  },
  // Sin `images.remotePatterns`: la app no usa el optimizador de imágenes y así
  // nadie lo puede usar como proxy de imágenes de otros sitios.
};

export default nextConfig;
