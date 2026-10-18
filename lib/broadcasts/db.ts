// Utilidades de lectura para las difusiones: PostgREST devuelve como mucho
// 1000 filas por consulta y las listas de `in (...)` no pueden ser enormes.

export const PAGE_SIZE = 1000;
export const IN_CHUNK = 200;

export function chunk<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** Lee todas las filas de una consulta paginando con `range`. La consulta debe tener un orden estable. */
export async function pageAll<T>(query: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Ejecuta una consulta por cada tramo de `ids` y junta las filas. */
export async function selectInChunks<T>(
  ids: readonly string[],
  query: (idsChunk: string[]) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (const part of chunk(ids)) {
    const { data, error } = await query(part);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}
