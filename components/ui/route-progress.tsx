"use client";

// Barra fina arriba que aparece al hacer clic en un enlace interno y se completa
// cuando cambia la ruta. Sin librerías: escucha los clics en enlaces y termina
// cuando cambian la ruta o los parámetros de búsqueda.

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function isInternalNavigation(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const anchor = (e.target as Element | null)?.closest?.("a");
  if (!anchor || !anchor.href) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  // Mismo destino: no hay navegación que mostrar.
  if (url.pathname === window.location.pathname && url.search === window.location.search) return false;
  return true;
}

const START_EVENT = "crm:route-progress-start";

/** Muestra la barra al navegar por código (router.push/replace), donde no hay clic en un enlace. */
export function startRouteProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(START_EVENT));
}

export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const lastKey = useRef(routeKey);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearAll() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  }

  function finish() {
    clearAll();
    setWidth(100);
    timers.current.push(
      setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 300),
    );
  }

  function start() {
    clearAll();
    setVisible(true);
    setWidth(12);
    // Avanza cada vez más despacio, sin llegar nunca al final.
    tick.current = setInterval(() => setWidth((w) => (w < 90 ? w + (90 - w) * 0.12 : w)), 200);
    // Red de seguridad: si la ruta nunca cambia, se oculta sola.
    timers.current.push(setTimeout(finish, 15000));
  }

  // Empieza al hacer clic en un enlace interno o al usar atrás/adelante.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (isInternalNavigation(e)) start();
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    window.addEventListener(START_EVENT, start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
      window.removeEventListener(START_EVENT, start);
      clearAll();
    };
    // start y finish solo usan refs y setters estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Termina cuando la ruta ya cambió.
  useEffect(() => {
    if (lastKey.current === routeKey) return;
    lastKey.current = routeKey;
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 250ms ease-out" }}
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_var(--primary)]"
        style={{ width: `${width}%`, transition: "width 200ms ease-out" }}
      />
    </div>
  );
}
