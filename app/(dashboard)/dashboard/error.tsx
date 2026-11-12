"use client";

import { ErrorScreen } from "@/components/error-screen";

// Error de una sección del panel: se queda dentro del layout, así que el menú
// lateral sigue visible y se puede cambiar de sección.
export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} compact />;
}
