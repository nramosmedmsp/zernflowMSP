"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface CatalogStage {
  id: string;
  name: string;
  kind: "open" | "won" | "lost" | "resolved";
}

export interface CatalogCategory {
  id: string;
  name: string;
}

export interface CatalogCaseType {
  id: string;
  name: string;
  stages: CatalogStage[];
  categories: CatalogCategory[];
}

export interface CaseCatalog {
  loading: boolean;
  contactTypes: Array<{ id: string; name: string }>;
  caseTypes: CatalogCaseType[];
  teams: Array<{ id: string; name: string }>;
}

const EMPTY: CaseCatalog = { loading: true, contactTypes: [], caseTypes: [], teams: [] };

/**
 * Tipos de contacto, tipos de gestión (con sus etapas) y equipos del espacio
 * para los paneles de los nodos y disparadores de gestión. Las políticas de la
 * base limitan las filas al espacio activo.
 */
export function useCaseCatalog(): CaseCatalog {
  const [catalog, setCatalog] = useState<CaseCatalog>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const [contactTypes, caseTypes, stages, categories, teams] = await Promise.all([
        supabase.from("contact_types").select("id, name").is("archived_at", null).order("position", { ascending: true }),
        supabase.from("case_types").select("id, name").is("archived_at", null).order("position", { ascending: true }),
        supabase
          .from("case_stages")
          .select("id, case_type_id, name, kind")
          .is("archived_at", null)
          .order("position", { ascending: true }),
        supabase
          .from("case_categories")
          .select("id, case_type_id, name")
          .is("archived_at", null)
          .order("position", { ascending: true }),
        supabase.from("teams").select("id, name").is("archived_at", null).order("name", { ascending: true }),
      ]);
      if (cancelled) return;
      const stagesByType = new Map<string, CatalogStage[]>();
      for (const s of stages.data ?? []) {
        const list = stagesByType.get(s.case_type_id) ?? [];
        list.push({ id: s.id, name: s.name, kind: s.kind });
        stagesByType.set(s.case_type_id, list);
      }
      const categoriesByType = new Map<string, CatalogCategory[]>();
      for (const c of categories.data ?? []) {
        const list = categoriesByType.get(c.case_type_id) ?? [];
        list.push({ id: c.id, name: c.name });
        categoriesByType.set(c.case_type_id, list);
      }
      setCatalog({
        loading: false,
        contactTypes: contactTypes.data ?? [],
        caseTypes: (caseTypes.data ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          stages: stagesByType.get(t.id) ?? [],
          categories: categoriesByType.get(t.id) ?? [],
        })),
        teams: teams.data ?? [],
      });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return catalog;
}

/** Etapas abiertas de un tipo (las únicas a las que se puede mover una gestión). */
export function openStages(type: CatalogCaseType | undefined): CatalogStage[] {
  return (type?.stages ?? []).filter((s) => s.kind === "open");
}
