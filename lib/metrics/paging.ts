// Lectura de una consulta por páginas hasta el final. PostgREST corta cada
// respuesta en 1 000 filas sin avisar; leer una sola página y sumar daba números
// equivocados con volumen. Aquí se recorre hasta que una página viene corta; si se
// llega al tope de seguridad se avisa (`truncated`) en vez de callar.

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface AllPages<T> {
  rows: T[];
  truncated: boolean;
  error: string | null;
}

export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; max: number },
): Promise<AllPages<T>> {
  const pageSize = opts.pageSize ?? 1000;
  const rows: T[] = [];
  for (let from = 0; from < opts.max; from += pageSize) {
    const to = Math.min(from + pageSize, opts.max) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { rows, truncated: false, error: error.message };
    const part = data ?? [];
    rows.push(...part);
    if (part.length < to - from + 1) return { rows, truncated: false, error: null };
  }
  // Se leyó exactamente `max` filas: si hay una más, falta información.
  const probe = await fetchPage(opts.max, opts.max);
  if (probe.error) return { rows, truncated: true, error: probe.error.message };
  return { rows, truncated: (probe.data ?? []).length > 0, error: null };
}
