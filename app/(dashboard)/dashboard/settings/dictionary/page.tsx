import type { Metadata } from "next";
import { listSpellWords } from "@/lib/actions/spell-words";
import { DictionaryView } from "./dictionary-view";

export const metadata: Metadata = { title: "Diccionario de la tienda" };
// Lee la sesión del usuario: nunca se arma en el build.
export const dynamic = "force-dynamic";

export default async function DictionarySettingsPage() {
  const result = await listSpellWords();
  return <DictionaryView data={"error" in result ? null : result.data} error={"error" in result ? result.error : null} />;
}
