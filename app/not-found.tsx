import type { Metadata } from "next";
import { NotFoundScreen } from "@/components/not-found-screen";

export const metadata: Metadata = {
  title: "Página no encontrada",
};

export default function NotFound() {
  return <NotFoundScreen />;
}
