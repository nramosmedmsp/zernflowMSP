"use client";

// "Posponer" en la cabecera del chat (lib/postpone.ts): guarda el próximo
// contacto de la gestión con una fecha rápida, así el chat vuelve en "Para hoy".

import { useCallback, useState } from "react";
import { AlarmClock, CalendarClock, CalendarDays, CalendarRange, ChevronDown, Loader2, Sunrise, Sunset, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { postponeCase, type CaseView } from "@/lib/actions/cases";
import { postponeOptions, type PostponeOption } from "@/lib/postpone";
import { useToast } from "@/components/ui/toast";
import { Popover, inputClass, primaryButtonClass } from "./ui";
import { useNow } from "./use-now";

const ICONS: Record<PostponeOption["key"], typeof Timer> = {
  hour: Timer,
  evening: Sunset,
  tomorrow: Sunrise,
  "three-days": CalendarDays,
  monday: CalendarRange,
};

export function PostponeMenu({ caseView, onDone }: { caseView: CaseView; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const toast = useToast();
  const now = useNow();
  const options = now === null ? [] : postponeOptions(new Date(now));
  const close = useCallback(() => {
    setOpen(false);
    setCustom(false);
  }, []);

  async function postpone(at: string, when: string) {
    setBusy(true);
    try {
      const result = await postponeCase(caseView.id, at);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.assignedToMe
          ? `Pospuesta hasta ${when}. Te la asignamos: volverá a tu lista «Para hoy» a esa hora.`
          : `Pospuesta hasta ${when}. Volverá a la lista «Para hoy» a esa hora.`,
      );
      close();
      onDone?.();
    } catch {
      toast.error("No se pudo posponer. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onClose={close}
      align="right"
      className="w-72"
      trigger={
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          title="Volver a este chat más tarde"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlarmClock className="h-3 w-3" />}
          Posponer
          <ChevronDown className="h-3 w-3" />
        </button>
      }
    >
      <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase text-muted-foreground">Posponer hasta…</p>
      {options.map((o) => {
        const Icon = ICONS[o.key];
        return (
          <button
            key={o.key}
            onClick={() => void postpone(o.at, `${o.label.toLowerCase()} (${o.detail})`)}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{o.label}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">{o.detail}</span>
          </button>
        );
      })}
      <div className="mt-1 border-t border-border pt-1">
        {custom ? (
          <div className="space-y-2 p-1">
            <div className="flex gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={cn(inputClass, "py-1 text-xs")}
                aria-label="Fecha"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={cn(inputClass, "w-28 py-1 text-xs")}
                aria-label="Hora"
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => void postpone(`${date}T${time || "09:00"}:00-05:00`, `el ${date.split("-").reverse().join("/")} a las ${time || "09:00"}`)}
                disabled={busy || !date}
                className={cn(primaryButtonClass, "py-1 text-xs")}
              >
                Posponer
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCustom(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
          >
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
            Elegir fecha y hora…
          </button>
        )}
      </div>
      <p className="mt-1 border-t border-border px-2 pt-1.5 text-[11px] leading-snug text-muted-foreground">
        Se guarda como Próximo contacto de la gestión. El chat vuelve a <span className="font-medium text-foreground">Para hoy</span> a esa hora.
      </p>
    </Popover>
  );
}
