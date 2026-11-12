"use client";

import { ErrorScreen } from "@/components/error-screen";

// Errores de cualquier pantalla fuera del panel y fallos del layout del panel
// (p. ej. no se pudo leer la membresía): pantalla completa con la marca.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
