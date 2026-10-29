import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El ZIP del código (scripts/build-source-zip.mjs) viaja con la función de descarga.
  outputFileTracingIncludes: {
    "/api/v1/admin/source-zip": ["./.source-zip/codigo-crm.zip"],
  },
  // Sin `images.remotePatterns`: la app no usa el optimizador de imágenes y así
  // nadie lo puede usar como proxy de imágenes de otros sitios.
};

export default nextConfig;
