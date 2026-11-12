"use client";

// Menú lateral responsivo. Desde 1024 px de ancho el menú va fijo a la izquierda
// (como siempre). En pantallas más angostas (celular, tableta vertical) se
// esconde y se abre con el botón de la barra superior, sobre el contenido, para
// que la pantalla use todo el ancho. Se cierra al elegir una sección, al tocar
// fuera o con Escape.

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function MobileNavShell({ appName, children }: { appName: string; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  // Al cambiar de sección el menú se cierra (se ajusta durante el render, sin efecto).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-2 lg:hidden">
        <button
          type="button"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={open}
          aria-controls="menu-lateral"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground hover:bg-accent"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <span className="min-w-0 truncate text-sm font-semibold">{appName}</span>
      </div>
      {open && (
        <button
          type="button"
          aria-label="Cerrar menú"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}
      <div
        id="menu-lateral"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-60 max-w-[85vw] shadow-xl transition-transform duration-200 lg:static lg:z-auto lg:max-w-none lg:translate-x-0 lg:shadow-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {children}
      </div>
    </>
  );
}
