import { NotFoundScreen } from "@/components/not-found-screen";

// "No encontrada" dentro del panel (p. ej. un contacto o secuencia que ya no existe):
// conserva el menú lateral.
export default function DashboardNotFound() {
  return <NotFoundScreen compact />;
}
