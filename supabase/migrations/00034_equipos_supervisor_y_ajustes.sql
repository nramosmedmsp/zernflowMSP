-- Tanda 7A: configuración de equipos y ajustes del espacio (R2-17 y ajustes JSON).
--
-- 1. teams.supervisor_skips_chats: "El supervisor no recibe chats". Con true, los
--    supervisores del equipo quedan fuera del reparto automático (la asignación
--    a mano sigue permitida). Por defecto false: los supervisores siguen
--    entrando al reparto como hasta ahora.
-- 2. merge_workspace_settings: mezcla claves en workspaces.settings en una sola
--    instrucción, para que dos administradores que guardan secciones distintas
--    a la vez no se pisen. Es SECURITY INVOKER: rige la misma RLS que un UPDATE
--    normal de workspaces (solo Dueño/Administrador).
--
-- Orden de despliegue: ambas piezas son aditivas y el código las tolera
-- ausentes (lee los equipos con select *, y si la función no existe guarda los
-- ajustes como antes). Lo ideal es aplicar esta migración ANTES de desplegar;
-- si se despliega primero, solo faltan el interruptor del supervisor (no se
-- puede guardar hasta migrar) y la mezcla atómica de ajustes.

alter table public.teams
  add column if not exists supervisor_skips_chats boolean not null default false;

create or replace function public.merge_workspace_settings(
  p_workspace_id uuid,
  p_set jsonb,
  p_remove text[] default '{}'
) returns void
language sql
security invoker
set search_path = public
as $$
  update public.workspaces
     set settings = (coalesce(settings, '{}'::jsonb) - coalesce(p_remove, '{}'::text[])) || coalesce(p_set, '{}'::jsonb)
   where id = p_workspace_id;
$$;

revoke all on function public.merge_workspace_settings(uuid, jsonb, text[]) from public, anon;
grant execute on function public.merge_workspace_settings(uuid, jsonb, text[]) to authenticated, service_role;
