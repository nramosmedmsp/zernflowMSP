// Comparación de nombres: sin mayúsculas, tildes ni espacios de más. Igual que
// normalizeName de lib/business-templates.ts, que no se importa aquí porque
// arrastra el cliente de servidor de Supabase (esto corre en el navegador).

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return normalizeName(a) === normalizeName(b);
}

export function findByName<T extends { name: string }>(list: readonly T[], name: string): T | undefined {
  return list.find((i) => sameName(i.name, name));
}
