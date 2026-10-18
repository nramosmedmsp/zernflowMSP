"use client";

import { useEffect, useState } from "react";

/**
 * Hora actual que se actualiza cada `intervalMs`. Es null hasta montar, para
 * que el servidor y el primer render del cliente coincidan (los tiempos
 * relativos dependen del reloj y provocan errores de hidratación).
 */
export function useNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
