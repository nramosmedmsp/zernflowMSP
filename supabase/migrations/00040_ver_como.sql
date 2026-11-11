-- Parte 2 de "Ver como": el Dueño ve el CRM tal como lo ve otra persona (o un
-- rol de ejemplo), SOLO LECTURA, con registro y caducidad de 30 minutos.
--
-- Cómo funciona (cambio de identidad dentro de la base, atado a la sesión del
-- Dueño):
--   * PostgREST ejecuta una función "pre-request" antes de CADA petición a la
--     API de datos (pgrst.db_pre_request). La nuestra es
--     crm_private.view_as_pre_request(). Si el JWT de la petición (sub +
--     session_id) tiene una fila ACTIVA en public.view_as_sessions, el sub del
--     JWT pasa a ser el de la persona mirada y la transacción queda en SOLO
--     LECTURA (transaction_read_only = on). Desde ahí auth.uid(), todas las
--     políticas RLS y can_see_contact*, is_ws_admin, is_ws_supervisor... corren
--     como esa persona, sin tocar ninguna política. Cualquier INSERT/UPDATE/
--     DELETE (o RPC que escriba) falla con el error 25006.
--   * No se crea ningún token ni se inicia sesión como la persona: el JWT sigue
--     siendo el del Dueño. last_sign_in_at y el estado "Pendiente" de una
--     persona invitada no cambian.
--   * "Por rol" (Administrador, Supervisor/Asesor de un equipo) no usa cuentas
--     reales: la fila de la sesión lleva un id inventado (que no existe en
--     auth.users) y dos vistas internas de "membresías efectivas"
--     (crm_private.effective_workspace_members / effective_team_members =
--     tabla real + las sesiones de rol activas) hacen que ese id parezca
--     miembro. Las 7 funciones de permisos leen esas vistas; para personas
--     reales el resultado es idéntico al de antes.
--   * Cabecera x-crm-read-only: 1. Los clientes del servidor de la app la envían
--     mientras hay una vista activa; el pre-request deja entonces la
--     transacción en solo lectura también para el cliente de servicio.
--   * Tras caducar (o con la fila sin cerrar) la identidad vuelve a ser la del
--     Dueño, pero la base mantiene el solo lectura 5 minutos más, hasta que el
--     Dueño pulse "Volver a mi vista" (stop) o pase ese margen.
--
-- Piezas:
--   * public.view_as_sessions: estado y REGISTRO (no se borra nunca). RLS activada
--     sin políticas y sin permisos para anon/authenticated (como
--     workspace_secrets): solo el servidor (service_role) la lee.
--   * crm_private (esquema NO expuesto por la API): el pre-request y las dos
--     vistas. El pre-request vive aquí y no en public para que "ninguna
--     función security definer de public sea ejecutable por anon" (B-4 de
--     rls_endurecer_check.sql) siga siendo cierto.
--   * public.view_as_start / view_as_stop / view_as_touch: solo service_role.
--     view_as_start valida en la base: quien mira es Dueño del espacio, no se
--     mira a sí mismo, la persona es miembro del espacio y no pertenece a
--     ningún espacio donde quien mira no sea Dueño (evita fugas entre
--     espacios), el equipo del rol está activo y es del espacio. Cierra la vista
--     anterior de esa misma sesión de Auth.
--   * public.view_as_current(): lo que la base aplicó a esta petición (para
--     authenticated).
--   * Las 7 funciones de permisos se reescriben con un bloque DO que toma el
--     cuerpo VIGENTE (pg_get_functiondef), cambia public.workspace_members /
--     public.team_members por las vistas efectivas y ABORTA si algo no cuadra.
--
-- Costes conocidos: Realtime y Storage no pasan por el pre-request (Realtime
-- entrega eventos con nivel de Dueño; Storage no tiene políticas de usuario).
--
-- INTERRUPTOR DE APAGADO (deja la API exactamente como antes de esta migración;
-- no borra nada ni hace falta redeploy):
--     alter role authenticator reset pgrst.db_pre_request;
--     notify pgrst, 'reload config';
-- Para volver a encenderlo:
--     alter role authenticator set pgrst.db_pre_request = 'crm_private.view_as_pre_request';
--     notify pgrst, 'reload config';
-- (Con el interruptor apagado las vistas efectivas siguen devolviendo lo mismo
-- que las tablas reales, porque solo añaden filas cuando el pre-request ha
-- cambiado la identidad a un id de ejemplo.)
--
-- Aditiva e idempotente: se puede volver a ejecutar. No cambia datos. Orden de
-- despliegue: aplicar ANTES del código; es inerte sin sesiones activas.

-- ============================================================
-- 1. Esquema privado
-- ============================================================

create schema if not exists crm_private;
revoke all on schema crm_private from public;
-- Solo USAGE: hace falta para que los roles de la API puedan llamar al
-- pre-request. No se concede nada sobre las vistas ni otras funciones.
grant usage on schema crm_private to anon, authenticated, service_role;

-- ============================================================
-- 2. Estado y registro de las vistas
-- ============================================================

create table if not exists public.view_as_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  viewer_id uuid not null,           -- Dueño que mira (sin FK: el registro no se borra)
  viewer_name text,
  auth_session_id uuid not null,     -- session_id del JWT del Dueño
  target_kind text not null check (target_kind in ('person', 'role')),
  target_user_id uuid not null,      -- persona real, o id inventado si es por rol
  target_label text not null,
  target_detail text,
  role_ws text check (role_ws in ('admin', 'member')),
  role_team_id uuid,                 -- sin FK: el registro sobrevive al equipo
  role_team_role text check (role_team_role in ('supervisor', 'agent')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('manual', 'expired', 'replaced', 'revoked')),
  sections text[] not null default '{}',
  constraint view_as_sessions_kind_ck check (
    (target_kind = 'role' and role_ws is not null)
    or (target_kind = 'person' and role_ws is null and role_team_id is null and role_team_role is null)
  ),
  constraint view_as_sessions_team_ck check (
    (role_team_id is null) = (role_team_role is null)
  )
);

-- Una sola vista activa por sesión de Auth.
create unique index if not exists uq_view_as_active_per_session
  on public.view_as_sessions (auth_session_id) where ended_at is null;
create index if not exists idx_view_as_active_role_target
  on public.view_as_sessions (target_user_id) where target_kind = 'role' and ended_at is null;
create index if not exists idx_view_as_ws_started
  on public.view_as_sessions (workspace_id, started_at desc);
create index if not exists idx_view_as_viewer
  on public.view_as_sessions (viewer_id, started_at desc);

alter table public.view_as_sessions enable row level security;
-- Sin políticas a propósito. Sin permisos para usuarios ni anónimos.
revoke all on public.view_as_sessions from public, anon, authenticated;
grant select on public.view_as_sessions to service_role;

comment on table public.view_as_sessions is
  '"Ver como": estado y registro de las vistas del Dueño. Sin políticas RLS; solo el servidor (service_role) lee. No se borra.';

-- ============================================================
-- 3. Membresías efectivas (tabla real + identidades de ejemplo activas)
-- ============================================================
-- Solo añaden filas cuando auth.uid() ES el id inventado de una vista por rol
-- activa: ese id solo lo adopta el pre-request, y solo para el Dueño de esa
-- sesión. Para cualquier otra persona devuelven exactamente la tabla real.

create or replace view crm_private.effective_workspace_members as
  select m.workspace_id, m.user_id, m.role
  from public.workspace_members m
  union all
  select s.workspace_id, s.target_user_id, s.role_ws
  from public.view_as_sessions s
  where s.target_kind = 'role'
    and s.ended_at is null
    and s.expires_at > now()
    and s.target_user_id = auth.uid();

create or replace view crm_private.effective_team_members as
  select t.team_id, t.user_id, t.role
  from public.team_members t
  union all
  select s.role_team_id, s.target_user_id, s.role_team_role
  from public.view_as_sessions s
  where s.target_kind = 'role'
    and s.role_team_id is not null
    and s.ended_at is null
    and s.expires_at > now()
    and s.target_user_id = auth.uid();

revoke all on crm_private.effective_workspace_members from public, anon, authenticated;
revoke all on crm_private.effective_team_members from public, anon, authenticated;

-- ============================================================
-- 4. Las 7 funciones de permisos leen las vistas efectivas
-- ============================================================
-- Se toma el cuerpo vigente (no una copia), se sustituyen las dos tablas y se
-- aborta si alguna función no existe, no es única o queda sin cambiar.

do $$
declare
  v_names text[] := array[
    'is_workspace_member', 'ws_role', 'is_ws_admin', 'is_team_member',
    'is_team_supervisor', 'can_see_contact_row', 'is_ws_supervisor'
  ];
  v_name text;
  v_oid oid;
  v_n int;
  v_def text;
  v_new text;
begin
  foreach v_name in array v_names loop
    select count(*) into v_n
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = v_name;
    if v_n <> 1 then
      raise exception '00040: se esperaba exactamente una función public.% y hay %', v_name, v_n;
    end if;

    select p.oid into v_oid
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = v_name;
    v_def := pg_get_functiondef(v_oid);
    v_new := replace(replace(v_def,
      'public.workspace_members', 'crm_private.effective_workspace_members'),
      'public.team_members', 'crm_private.effective_team_members');

    -- Debe leer alguna vista efectiva y no quedar ninguna lectura directa de
    -- las tablas reales (con o sin esquema).
    if v_new !~ 'crm_private\.effective_(workspace|team)_members' then
      raise exception '00040: % no lee workspace_members ni team_members; no se reconoce su cuerpo', v_name;
    end if;
    if regexp_replace(v_new, 'crm_private\.effective_(workspace|team)_members', '', 'g')
         ~ '(workspace_members|team_members)' then
      raise exception '00040: % aún menciona workspace_members/team_members sin esquema conocido', v_name;
    end if;
    if v_new !~* 'security definer' then
      raise exception '00040: % ya no es security definer; se aborta', v_name;
    end if;

    if v_new <> v_def then
      execute v_new;
    end if;
  end loop;

  -- Comprobación final: las 7 leen solo vistas efectivas.
  for v_name in
    select p.proname from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any (v_names)
      and (pg_get_functiondef(p.oid) !~ 'crm_private\.effective_'
           or regexp_replace(pg_get_functiondef(p.oid), 'crm_private\.effective_(workspace|team)_members', '', 'g')
                ~ '(workspace_members|team_members)')
  loop
    raise exception '00040: % no quedó apuntando a las vistas efectivas', v_name;
  end loop;
end $$;

-- Nombre para mostrar de una cuenta (mismo criterio que displayName() de
-- lib/team-rules.ts: nombre completo, name, parte local del correo).
create or replace function crm_private.display_name_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'name'), ''),
    nullif(split_part(u.email, '@', 1), ''),
    'Sin nombre'
  )
  from auth.users u where u.id = p_user;
$$;
revoke all on function crm_private.display_name_of(uuid) from public, anon, authenticated;

-- ============================================================
-- 5. Pre-request: cambia la identidad de la petición
-- ============================================================
-- Debe ser mínimo: se ejecuta en cada petición de la API. Si falla, no deja la
-- API caída: avisa y la petición sigue con su identidad real.

create or replace function crm_private.view_as_pre_request()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c jsonb;
  s record;
  h json;
  v_ro boolean := false;
  v_claims text;
  v_sub text;
begin
  -- OJO: transaction_read_only NO se puede fijar dentro del bloque con EXCEPTION:
  -- una subtransacción restaura el modo de solo lectura al terminar. Por eso el
  -- bloque solo DECIDE (variables) y los set_config se hacen después, fuera.
  begin
    -- Candado de los clientes del servidor (también service_role).
    h := nullif(current_setting('request.headers', true), '')::json;
    if h is not null and h->>'x-crm-read-only' = '1' then
      v_ro := true;
    end if;

    c := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    if c is not null
       and c->>'role' is not distinct from 'authenticated'
       and c->>'session_id' is not null
       and c->>'sub' is not null then
      select * into s
      from public.view_as_sessions v
      where v.auth_session_id = (c->>'session_id')::uuid
        and v.viewer_id = (c->>'sub')::uuid
        and v.ended_at is null
        and v.expires_at + interval '5 minutes' > now();
      if found then
        -- Vista sin cerrar: desde que empieza hasta 5 minutos tras caducar la
        -- base no deja escribir con esta sesión.
        v_ro := true;
        -- Solo cambia la identidad si sigue vigente y el Dueño sigue siendo Dueño.
        if s.expires_at > now()
           and exists (
             select 1 from public.workspace_members m
             where m.workspace_id = s.workspace_id
               and m.user_id = s.viewer_id
               and m.role = 'owner'
           ) then
          v_sub := s.target_user_id::text;
          v_claims := (c || jsonb_build_object(
              'sub', s.target_user_id,
              'view_as', jsonb_build_object('sid', s.id, 'by', s.viewer_id)
          ))::text;
        end if;
      end if;
    end if;
  exception when others then
    -- Si algo falla se deja pasar con la identidad real (nunca se cae la API).
    -- Pero si ya se había decidido el solo lectura, se conserva.
    raise warning 'view_as_pre_request: % (%)', sqlerrm, sqlstate;
    v_sub := null;
    v_claims := null;
  end;

  if v_ro then
    perform set_config('transaction_read_only', 'on', true);
  end if;
  if v_claims is not null then
    perform set_config('request.jwt.claims', v_claims, true);
    perform set_config('request.jwt.claim.sub', v_sub, true);
  end if;
end;
$$;

revoke all on function crm_private.view_as_pre_request() from public;
-- Imprescindible: sin esto cae TODA la API. PostgREST la llama con el rol de la
-- petición (anon, authenticated o service_role).
grant execute on function crm_private.view_as_pre_request() to anon, authenticated, service_role;

-- ============================================================
-- 6. view_as_current: lo que la base aplicó a esta petición
-- ============================================================
-- Devuelve null si la petición no está en vista (o ya caducó). El id que lee
-- viene del claim que SOLO pone el pre-request (un JWT firmado no puede traerlo).

create or replace function public.view_as_current()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c jsonb;
  s record;
  v_sid uuid;
  v_email text;
  v_name text;
  v_team text;
begin
  c := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if c is null or c->'view_as'->>'sid' is null then
    return null;
  end if;
  v_sid := (c->'view_as'->>'sid')::uuid;
  select * into s from public.view_as_sessions v
  where v.id = v_sid
    and v.target_user_id = auth.uid()
    and v.ended_at is null
    and v.expires_at > now();
  if not found then
    return null;
  end if;
  if s.target_kind = 'person' then
    select u.email, crm_private.display_name_of(u.id)
      into v_email, v_name
    from auth.users u where u.id = s.target_user_id;
  else
    v_name := s.target_label;
  end if;
  if s.role_team_id is not null then
    select t.name into v_team from public.teams t where t.id = s.role_team_id;
  end if;
  return jsonb_build_object(
    'session_id', s.id,
    'workspace_id', s.workspace_id,
    'viewer_id', s.viewer_id,
    'kind', s.target_kind,
    'target_user_id', s.target_user_id,
    'label', s.target_label,
    'detail', s.target_detail,
    'name', v_name,
    'email', v_email,
    'role_ws', s.role_ws,
    'team_id', s.role_team_id,
    'team_name', v_team,
    'team_role', s.role_team_role,
    'started_at', s.started_at,
    'expires_at', s.expires_at
  );
end;
$$;

revoke all on function public.view_as_current() from public, anon;
grant execute on function public.view_as_current() to authenticated, service_role;

-- ============================================================
-- 7. view_as_start / view_as_stop / view_as_touch (solo servidor)
-- ============================================================
-- p_kind 'person': p_target_user = la persona. p_kind 'role': p_role es
-- 'admin' | 'supervisor' | 'agent' (estos dos con p_team). Devuelve un jsonb
-- con la misma forma que view_as_current, o lanza un error con mensaje estable
-- (view_as_not_owner, view_as_self, view_as_target_invalid, view_as_foreign_workspace,
-- view_as_team_invalid, view_as_bad_args).

create or replace function public.view_as_start(
  p_viewer uuid,
  p_auth_session uuid,
  p_workspace uuid,
  p_kind text,
  p_target_user uuid default null,
  p_role text default null,
  p_team uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_viewer_name text;
  v_target_id uuid;
  v_label text;
  v_detail text;
  v_role_ws text;
  v_team_role text;
  v_team_id uuid;
  v_team_name text;
  v_row public.view_as_sessions;
begin
  if p_viewer is null or p_auth_session is null or p_workspace is null or p_kind not in ('person', 'role') then
    raise exception 'view_as_bad_args' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_viewer and m.role = 'owner'
  ) then
    raise exception 'view_as_not_owner' using errcode = '42501';
  end if;

  v_viewer_name := crm_private.display_name_of(p_viewer);

  if p_kind = 'person' then
    if p_target_user is null then
      raise exception 'view_as_bad_args' using errcode = '22023';
    end if;
    if p_target_user = p_viewer then
      raise exception 'view_as_self' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace and m.user_id = p_target_user
    ) then
      raise exception 'view_as_target_invalid' using errcode = '22023';
    end if;
    -- Nadie que pertenezca a un espacio donde quien mira no sea Dueño.
    if exists (
      select 1 from public.workspace_members o
      where o.user_id = p_target_user
        and o.workspace_id <> p_workspace
        and not exists (
          select 1 from public.workspace_members w
          where w.workspace_id = o.workspace_id and w.user_id = p_viewer and w.role = 'owner'
        )
    ) then
      raise exception 'view_as_foreign_workspace' using errcode = '42501';
    end if;
    v_target_id := p_target_user;
    select crm_private.display_name_of(u.id), u.email
      into v_label, v_detail from auth.users u where u.id = p_target_user;
  else
    if p_role not in ('admin', 'supervisor', 'agent') then
      raise exception 'view_as_bad_args' using errcode = '22023';
    end if;
    if p_role = 'admin' then
      v_role_ws := 'admin';
      v_label := 'Administrador';
    else
      select t.id, t.name into v_team_id, v_team_name
      from public.teams t
      where t.id = p_team and t.workspace_id = p_workspace and t.archived_at is null;
      if v_team_id is null then
        raise exception 'view_as_team_invalid' using errcode = '22023';
      end if;
      v_role_ws := 'member';
      v_team_role := p_role;
      v_label := case p_role when 'supervisor' then 'Supervisor de ' else 'Asesor de ' end || v_team_name;
    end if;
    v_target_id := gen_random_uuid();   -- no existe en auth.users ni en ninguna tabla real
    v_detail := 'Ejemplo por rol, sin cuenta';
  end if;

  -- Cierra la vista anterior de esta sesión de Auth (y las caducadas sin cerrar).
  update public.view_as_sessions v
     set ended_at = now(),
         end_reason = case when v.expires_at <= now() then 'expired' else 'replaced' end
   where v.auth_session_id = p_auth_session and v.ended_at is null;

  insert into public.view_as_sessions (
    workspace_id, viewer_id, viewer_name, auth_session_id, target_kind, target_user_id,
    target_label, target_detail, role_ws, role_team_id, role_team_role, expires_at
  ) values (
    p_workspace, p_viewer, v_viewer_name, p_auth_session, p_kind, v_target_id,
    v_label, v_detail, v_role_ws, v_team_id, v_team_role, now() + interval '30 minutes'
  ) returning * into v_row;

  return jsonb_build_object(
    'session_id', v_row.id,
    'workspace_id', v_row.workspace_id,
    'viewer_id', v_row.viewer_id,
    'kind', v_row.target_kind,
    'target_user_id', v_row.target_user_id,
    'label', v_row.target_label,
    'detail', v_row.target_detail,
    'role_ws', v_row.role_ws,
    'team_id', v_row.role_team_id,
    'team_name', v_team_name,
    'team_role', v_row.role_team_role,
    'started_at', v_row.started_at,
    'expires_at', v_row.expires_at
  );
end;
$$;

create or replace function public.view_as_stop(
  p_viewer uuid,
  p_auth_session uuid,
  p_reason text default 'manual'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  update public.view_as_sessions v
     set ended_at = now(),
         end_reason = case
           when v.expires_at <= now() then 'expired'
           when p_reason in ('manual', 'revoked') then p_reason
           else 'manual' end
   where v.auth_session_id = p_auth_session
     and v.viewer_id = p_viewer
     and v.ended_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Marca de actividad y sección abierta. Devuelve expires_at si la vista sigue
-- activa, o null si ya no (caducada o cerrada).
create or replace function public.view_as_touch(
  p_viewer uuid,
  p_auth_session uuid,
  p_section text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exp timestamptz;
begin
  update public.view_as_sessions v
     set last_seen_at = now(),
         sections = case
           when p_section is null or length(p_section) > 60 then v.sections
           when cardinality(v.sections) > 0 and v.sections[cardinality(v.sections)] = p_section then v.sections
           when cardinality(v.sections) >= 200 then v.sections
           else array_append(v.sections, p_section) end
   where v.auth_session_id = p_auth_session
     and v.viewer_id = p_viewer
     and v.ended_at is null
     and v.expires_at > now()
  returning v.expires_at into v_exp;
  return v_exp;
end;
$$;

revoke all on function public.view_as_start(uuid, uuid, uuid, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.view_as_stop(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.view_as_touch(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.view_as_start(uuid, uuid, uuid, text, uuid, text, uuid) to service_role;
grant execute on function public.view_as_stop(uuid, uuid, text) to service_role;
grant execute on function public.view_as_touch(uuid, uuid, text) to service_role;

-- ============================================================
-- 8. Activar el pre-request (aborta si ya hay otro)
-- ============================================================

do $$
declare
  v_cur text;
begin
  select substring(c from '^pgrst\.db_pre_request=(.*)$') into v_cur
  from pg_roles r, unnest(r.rolconfig) c
  where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%';

  if v_cur is not null and v_cur <> 'crm_private.view_as_pre_request' then
    raise exception '00040: authenticator ya tiene otro pgrst.db_pre_request (%). No se pisa; revisar a mano.', v_cur;
  end if;

  alter role authenticator set pgrst.db_pre_request = 'crm_private.view_as_pre_request';
end $$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
