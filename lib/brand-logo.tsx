import { APP_LOGO_URL, APP_NAME } from "@/lib/brand";

/**
 * Logo de la instalación. Se usa <img> y no next/image porque APP_LOGO_URL
 * puede ser una URL externa cualquiera (CDN de la tienda, data:, http) que
 * next/image rechazaría o tendría que optimizar.
 */
export function BrandLogo({
  size = 48,
  className,
  alt = APP_NAME,
}: {
  size?: number;
  className?: string;
  alt?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={APP_LOGO_URL}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
