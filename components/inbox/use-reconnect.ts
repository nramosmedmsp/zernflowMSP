"use client";

// Llama a onReconnect cuando vuelve internet o cuando la pestaña vuelve a verse
// después de un rato oculta (laptop suspendida): el realtime pudo perder eventos.

import { useEffect, useRef } from "react";

const HIDDEN_MS = 30_000;

export function useReconnect(onReconnect: () => void) {
  const callback = useRef(onReconnect);
  useEffect(() => {
    callback.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    const onOnline = () => callback.current();
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= HIDDEN_MS) callback.current();
      hiddenAt = null;
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
