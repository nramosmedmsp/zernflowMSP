"use client";

// El filtro de segmento de una difusión dicho en palabras (en vez del JSON
// guardado): «Tiene la etiqueta “VIP”», «El equipo es “Lima”»...

import { useEffect, useState } from "react";
import { Filter } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PLATFORM_LABELS, type Platform } from "@/lib/platforms";
import { listCaseMembers } from "@/lib/actions/cases";
import { describeSegmentFilter, type SegmentFilter, type SegmentNames } from "@/lib/broadcasts/segment";

interface Lookups {
  tags: Map<string, string>;
  types: Map<string, string>;
  teams: Map<string, string>;
  owners: Map<string, string>;
}

export function SegmentSummary({ filter, workspaceId }: { filter: SegmentFilter; workspaceId: string }) {
  const [lookups, setLookups] = useState<Lookups | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createClient();
        const [tags, types, teams, members] = await Promise.all([
          supabase.from("tags").select("id, name").eq("workspace_id", workspaceId),
          supabase.from("contact_types").select("id, name").eq("workspace_id", workspaceId),
          supabase.from("teams").select("id, name").eq("workspace_id", workspaceId),
          listCaseMembers(),
        ]);
        if (cancelled) return;
        const toMap = (rows: { id: string; name: string }[] | null) => new Map((rows ?? []).map((r) => [r.id, r.name]));
        setLookups({
          tags: toMap(tags.data),
          types: toMap(types.data),
          teams: toMap(teams.data),
          owners: new Map("members" in members ? members.members.map((m) => [m.userId, m.name] as const) : []),
        });
      } catch {
        // Sin nombres, se muestran los valores tal como se guardaron.
        if (!cancelled) setLookups({ tags: new Map(), types: new Map(), teams: new Map(), owners: new Map() });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const names: SegmentNames = {
    tag: (v) => lookups?.tags.get(v) ?? v,
    contactType: (v) => lookups?.types.get(v),
    team: (v) => lookups?.teams.get(v),
    owner: (v) => lookups?.owners.get(v),
    platform: (v) => PLATFORM_LABELS[v as Platform],
  };
  const lines = describeSegmentFilter(filter, names);

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Filter className="h-4 w-4 text-muted-foreground" />
        Se enviará a los contactos que cumplan
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-muted-foreground">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {filter.groups.length > 1 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {filter.combinator === "or" ? "Basta con que cumpla alguno de los grupos." : "Debe cumplir todos los grupos."}
        </p>
      )}
    </div>
  );
}
