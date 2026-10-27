"use client";

// Botón de avisos de la bandeja (campana): cada asesor elige en su equipo.

import { useEffect, useRef, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALERT_SCOPE_LABELS, type AlertScope, type AlertSettings } from "@/lib/inbox-alerts";

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-accent/60">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-primary" />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-foreground">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function AlertSettingsButton({
  settings,
  onChange,
}: {
  settings: AlertSettings;
  onChange: (patch: Partial<AlertSettings>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = settings.sound || settings.desktop;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggleDesktop(on: boolean) {
    setNotice(null);
    if (!on) {
      onChange({ desktop: false });
      return;
    }
    if (typeof Notification === "undefined") {
      setNotice("Este navegador no permite notificaciones.");
      return;
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") {
      setNotice("El navegador bloqueó las notificaciones. Actívalas en el candado junto a la dirección de la página.");
      return;
    }
    onChange({ desktop: true });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Avisos de mensajes nuevos"
        aria-label="Avisos de mensajes nuevos"
        aria-expanded={open}
        className={cn(
          "rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground",
          (open || active) && "text-foreground",
        )}
      >
        {active ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Avisos"
          className="animate-pop-in absolute -right-9 top-full z-40 mt-1 w-[17rem] space-y-2 rounded-xl border border-border bg-card p-3 shadow-lg"
        >
          <p className="text-xs font-semibold">Avisos de mensajes nuevos</p>
          <div className="space-y-0.5">
            <Toggle
              checked={settings.tabCount}
              onChange={(v) => onChange({ tabCount: v })}
              label="Número en la pestaña"
              hint="Ejemplo: (3) en el título de la pestaña."
            />
            <Toggle checked={settings.sound} onChange={(v) => onChange({ sound: v })} label="Sonido" />
            <Toggle
              checked={settings.desktop}
              onChange={(v) => void toggleDesktop(v)}
              label="Notificación de Windows"
              hint="Solo cuando estás en otra pestaña o programa."
            />
          </div>
          <div className="space-y-1 border-t border-border pt-2">
            <p className="text-[11px] font-medium text-muted-foreground">Avisarme de</p>
            {(Object.keys(ALERT_SCOPE_LABELS) as AlertScope[]).map((scope) => (
              <label key={scope} className="flex cursor-pointer items-center gap-2 px-1 text-xs">
                <input
                  type="radio"
                  name="alert-scope"
                  checked={settings.scope === scope}
                  onChange={() => onChange({ scope })}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {ALERT_SCOPE_LABELS[scope]}
              </label>
            ))}
          </div>
          {notice && <p className="text-[11px] text-amber-700 dark:text-amber-300">{notice}</p>}
          <p className="text-[11px] text-muted-foreground">Se guarda solo en este equipo.</p>
        </div>
      )}
    </div>
  );
}
