import type { MetadataRoute } from "next";

// CRM interno: nada debe indexarse.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
