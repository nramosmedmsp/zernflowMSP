import { NextRequest, NextResponse } from "next/server";
import { requireApiMember } from "@/lib/api-auth";
import { cleanSearch } from "@/components/contacts/contact-list-query";
import { ilikePattern } from "@/components/cases/case-filters";

const MAX_LIMIT = 100;

/**
 * GET /api/v1/contacts
 *
 * Cualquier miembro; usa el cliente del usuario, así que RLS (can_see_contact)
 * limita la lista a los contactos que esa persona puede ver.
 */
export async function GET(request: NextRequest) {
  const guard = await requireApiMember();
  if (!guard.ok) return guard.response;
  const { supabase } = guard.ctx;
  const membership = { workspace_id: guard.ctx.workspaceId };

  const searchParams = request.nextUrl.searchParams;
  const search = searchParams.get("search");
  const tag = searchParams.get("tag");
  const subscribed = searchParams.get("subscribed");
  // Cantidad acotada: un número raro o enorme no pide toda la tabla.
  const rawLimit = parseInt(searchParams.get("limit") || "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : 50;
  const rawOffset = parseInt(searchParams.get("offset") || "0", 10);
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

  let query = supabase
    .from("contacts")
    .select("*, contact_tags(tag_id, tags(id, name, color)), contact_channels(platform_sender_id, channel_id, channels(platform))", { count: "exact" })
    .eq("workspace_id", membership.workspace_id)
    .order("last_interaction_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Mismo texto limpio que la pantalla de Contactos (comas y paréntesis rompen el filtro).
  const text = search ? cleanSearch(search) : "";
  if (text) {
    const pattern = ilikePattern(text);
    query = query.or(`display_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`);
  }

  if (subscribed === "true") {
    query = query.eq("is_subscribed", true);
  } else if (subscribed === "false") {
    query = query.eq("is_subscribed", false);
  }

  const { data: contacts, error, count } = await query;

  if (error) {
    console.error("[contacts] no se pudo listar:", error.message);
    return NextResponse.json({ error: "No se pudieron cargar los contactos. Inténtalo de nuevo." }, { status: 500 });
  }

  // Filter by tag in-memory (Supabase doesn't easily filter through join)
  let filtered = contacts || [];
  if (tag) {
    filtered = filtered.filter((c) =>
      (c.contact_tags as Array<{ tags: { name: string } | null }>)?.some(
        (ct) => ct.tags?.name === tag
      )
    );
  }

  return NextResponse.json({ contacts: filtered, total: count });
}
