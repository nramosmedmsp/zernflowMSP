import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El ZIP del código (scripts/build-source-zip.mjs) viaja con la función de descarga.
  outputFileTracingIncludes: {
    "/api/v1/admin/source-zip": ["./.source-zip/codigo-crm.zip"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
