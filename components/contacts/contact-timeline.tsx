import {
  ArrowRightLeft,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Settings,
  StickyNote,
  UserRound,
  XCircle,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { TimelineItem, TimelineKind, TimelineTone } from "@/components/contacts/timeline";

const ICONS: Record<TimelineKind, React.ComponentType<{ className?: string }>> = {
  case: Briefcase,
  stage: Workflow,
  assignment: ArrowRightLeft,
  contact: UserRound,
  note: StickyNote,
  schedule: CalendarClock,
  closed: CheckCircle2,
  system: Settings,
};

const TONE_DOT: Record<TimelineTone, string> = {
  default: "bg-muted text-muted-foreground",
  won: "bg-emerald-500/15 text-emerald-600",
  lost: "bg-red-500/15 text-red-600",
  note: "bg-yellow-500/20 text-yellow-700",
  muted: "bg-muted text-muted-foreground/70",
};

export function ContactTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground/60">Todavía no hay actividad registrada.</p>;
  }
  return (
    <ol className="space-y-4">
      {items.map((item) => {
        const Icon = item.tone === "lost" ? XCircle : ICONS[item.kind];
        return (
          <li key={item.key} className="flex gap-3">
            <span
              className={cn(
                "mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",
                TONE_DOT[item.tone],
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div
              className={cn(
                "min-w-0 flex-1",
                item.tone === "note" && "rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2",
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium">{item.title}</p>
                <time dateTime={item.at} className="text-xs text-muted-foreground" suppressHydrationWarning>
                  {formatDateTime(item.at)}
                </time>
              </div>
              {item.detail && (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.detail}</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground/80">
                {item.actor}
                {item.caseLabel && (
                  <>
                    {" · "}
                    <span className="rounded bg-muted px-1.5 py-0.5">{item.caseLabel}</span>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
