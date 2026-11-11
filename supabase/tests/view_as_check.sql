-- Prueba de la migración 00040 ("Ver como").
--
-- Cómo usarla: aplicar antes 00040 y pegar este archivo completo en el editor
-- SQL de Supabase (rol postgres). Solo LEE el catálogo (privilegios, políticas,
-- índices, funciones, configuración del rol): no crea ni cambia nada, así que
-- se puede ejecutar en producción. Termina SIEMPRE con RAISE EXCEPTION para
-- mostrar el resultado:
--   RESULTADO: N comprobaciones, 0 fallos. TODO OK
-- o la lista de lo que falla.
--
-- Las pruebas de comportamiento (el Dueño mira como otra persona y ve lo mismo
-- que ella; no puede escribir; caducidad; ataques) están en
-- supabase/tests/view_as_parity.mjs y supabase/tests/view_as_attacks.mjs, sobre
-- una base LOCAL con los usuarios de prueba.
--
-- Si "pgrst.db_pre_request" aparece como no configurado aquí, el interruptor de
-- apagado está puesto (ver la cabecera de 00040): la vista no funciona pero la
-- API sigue normal. Eso se reporta como fallo para no olvidarlo apagado.

do $$
declare
  v_total int := 0;
  v_fail int := 0;
  v_errors text := '';
  v_cfg text;
  v_fn text;
  v_oid oid;
begin
  -- Tabla de estado y registro
  v_total := v_total + 1;
  if to_regclass('public.view_as_sessions') is null then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- falta public.view_as_sessions';
  else
    v_total := v_total + 1;
    if not (select relrowsecurity from pg_class where oid = 'public.view_as_sessions'::regclass) then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- view_as_sessions sin RLS activada';
    end if;
    v_total := v_total + 1;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'view_as_sessions') then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- view_as_sessions tiene políticas (debe tener ninguna)';
    end if;
    v_total := v_total + 1;
    if has_table_privilege('anon', 'public.view_as_sessions', 'SELECT')
       or has_table_privilege('authenticated', 'public.view_as_sessions', 'SELECT')
       or has_any_column_privilege('anon', 'public.view_as_sessions', 'SELECT')
       or has_any_column_privilege('authenticated', 'public.view_as_sessions', 'SELECT')
       or has_table_privilege('anon', 'public.view_as_sessions', 'INSERT')
       or has_table_privilege('authenticated', 'public.view_as_sessions', 'INSERT')
       or has_table_privilege('authenticated', 'public.view_as_sessions', 'UPDATE')
       or has_table_privilege('authenticated', 'public.view_as_sessions', 'DELETE') then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- anon o authenticated tienen permisos sobre view_as_sessions';
    end if;
    v_total := v_total + 1;
    if not has_table_privilege('service_role', 'public.view_as_sessions', 'SELECT') then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- service_role no puede leer view_as_sessions (la pantalla de registro no funcionaría)';
    end if;
    v_total := v_total + 1;
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and tablename = 'view_as_sessions'
        and indexname = 'uq_view_as_active_per_session' and indexdef ilike '%unique%' and indexdef ilike '%ended_at is null%'
    ) then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- falta el índice único parcial de una vista activa por sesión';
    end if;
  end if;

  -- Esquema privado: sin acceso a vistas; la API no lo expone
  v_total := v_total + 1;
  if to_regnamespace('crm_private') is null then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- falta el esquema crm_private';
  else
    v_total := v_total + 1;
    if has_table_privilege('anon', 'crm_private.effective_workspace_members', 'SELECT')
       or has_table_privilege('authenticated', 'crm_private.effective_workspace_members', 'SELECT')
       or has_table_privilege('anon', 'crm_private.effective_team_members', 'SELECT')
       or has_table_privilege('authenticated', 'crm_private.effective_team_members', 'SELECT') then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- anon/authenticated leen las vistas efectivas de crm_private';
    end if;
    v_total := v_total + 1;
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'crm_private' and c.relkind in ('r', 'v', 'm')
        and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))
    ) then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- hay objetos legibles de crm_private para anon/authenticated';
    end if;
    -- Ninguna otra función ejecutable por los roles de la API en crm_private.
    v_total := v_total + 1;
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'crm_private' and p.proname <> 'view_as_pre_request'
        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    ) then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- hay funciones de crm_private ejecutables por anon/authenticated además del pre-request';
    end if;
  end if;

  -- Pre-request: instalado y ejecutable por los tres roles de la API
  v_total := v_total + 1;
  select substring(c from '^pgrst\.db_pre_request=(.*)$') into v_cfg
  from pg_roles r, unnest(r.rolconfig) c
  where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%';
  if v_cfg is distinct from 'crm_private.view_as_pre_request' then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- authenticator.pgrst.db_pre_request = ' || coalesce(v_cfg, '(sin configurar: interruptor apagado)');
  end if;
  v_total := v_total + 1;
  v_oid := to_regprocedure('crm_private.view_as_pre_request()');
  if v_oid is null then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- falta crm_private.view_as_pre_request()';
  else
    if not (has_function_privilege('anon', v_oid, 'EXECUTE')
            and has_function_privilege('authenticated', v_oid, 'EXECUTE')
            and has_function_privilege('service_role', v_oid, 'EXECUTE')) then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- el pre-request no es ejecutable por anon, authenticated y service_role (la API caería)';
    end if;
    v_total := v_total + 1;
    if not exists (select 1 from pg_proc p where p.oid = v_oid and p.prosecdef
                   and p.proconfig is not null and exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%')) then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- el pre-request no es security definer con search_path fijo';
    end if;
  end if;

  -- Funciones de servidor: nadie con sesión de usuario las ejecuta
  foreach v_fn in array array[
    'public.view_as_start(uuid, uuid, uuid, text, uuid, text, uuid)',
    'public.view_as_stop(uuid, uuid, text)',
    'public.view_as_touch(uuid, uuid, text)'
  ] loop
    v_total := v_total + 1;
    v_oid := to_regprocedure(v_fn);
    if v_oid is null then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- falta ' || v_fn;
    elsif has_function_privilege('anon', v_oid, 'EXECUTE')
          or has_function_privilege('authenticated', v_oid, 'EXECUTE')
          or not has_function_privilege('service_role', v_oid, 'EXECUTE') then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- ' || v_fn || ' debe ser solo de service_role';
    end if;
  end loop;
  v_total := v_total + 1;
  v_oid := to_regprocedure('public.view_as_current()');
  if v_oid is null then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- falta public.view_as_current()';
  elsif has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- view_as_current debe ser ejecutable por authenticated y no por anon';
  end if;

  -- Las 7 funciones de permisos leen las vistas efectivas, y solo ellas
  foreach v_fn in array array[
    'is_workspace_member', 'ws_role', 'is_ws_admin', 'is_team_member',
    'is_team_supervisor', 'can_see_contact_row', 'is_ws_supervisor'
  ] loop
    v_total := v_total + 1;
    select p.oid into v_oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_fn;
    if v_oid is null then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- falta la función ' || v_fn;
    elsif pg_get_functiondef(v_oid) !~ 'crm_private\.effective_(workspace|team)_members'
       or regexp_replace(pg_get_functiondef(v_oid), 'crm_private\.effective_(workspace|team)_members', '', 'g')
            ~ '(workspace_members|team_members)' then
      v_fail := v_fail + 1; v_errors := v_errors || E'\n- ' || v_fn || ' no lee solo las vistas efectivas';
    end if;
  end loop;

  -- Las demás funciones que tocan membresías siguen leyendo las tablas REALES
  -- (asignación, guardas, alta de usuarios): nunca deben ver identidades de ejemplo.
  v_total := v_total + 1;
  if exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and p.proname not in ('is_workspace_member', 'ws_role', 'is_ws_admin', 'is_team_member',
                            'is_team_supervisor', 'can_see_contact_row', 'is_ws_supervisor')
      and p.prosrc ~ 'crm_private\.effective_'
  ) then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- una función distinta de las 7 usa las vistas efectivas: ' || (
      select string_agg(p.proname, ', ') from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        and p.proname not in ('is_workspace_member', 'ws_role', 'is_ws_admin', 'is_team_member',
                              'is_team_supervisor', 'can_see_contact_row', 'is_ws_supervisor')
        and p.prosrc ~ 'crm_private\.effective_');
  end if;

  -- Las políticas no leen las tablas de membresías directamente (si lo hicieran,
  -- no verían las identidades de ejemplo): se avisa para revisarlo.
  v_total := v_total + 1;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ '(workspace_members|team_members)' or coalesce(with_check, '') ~ '(workspace_members|team_members)')
      and tablename not in ('workspace_members', 'team_members')
  ) then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- hay políticas que leen workspace_members/team_members directamente: ' || (
      select string_agg(distinct tablename || '.' || policyname, ', ') from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') ~ '(workspace_members|team_members)' or coalesce(with_check, '') ~ '(workspace_members|team_members)')
        and tablename not in ('workspace_members', 'team_members'));
  end if;

  -- Sin vistas activas, las membresías efectivas son exactamente las reales
  v_total := v_total + 1;
  if exists (
    (select workspace_id, user_id, role from crm_private.effective_workspace_members
     except select workspace_id, user_id, role from public.workspace_members)
    union all
    (select team_id, user_id, role from crm_private.effective_team_members
     except select team_id, user_id, role from public.team_members)
  ) then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- las vistas efectivas devuelven filas que no están en las tablas reales (sin auth.uid() no debería)';
  end if;

  -- Ninguna identidad de ejemplo existe como cuenta ni como membresía real
  v_total := v_total + 1;
  if exists (
    select 1 from public.view_as_sessions s
    where s.target_kind = 'role'
      and (exists (select 1 from auth.users u where u.id = s.target_user_id)
           or exists (select 1 from public.workspace_members m where m.user_id = s.target_user_id)
           or exists (select 1 from public.team_members t where t.user_id = s.target_user_id))
  ) then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- una identidad de ejemplo por rol existe en auth.users o en membresías reales';
  end if;

  -- B-4 sigue cierto: ninguna función security definer de public ejecutable por anon
  v_total := v_total + 1;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- hay funciones security definer de public ejecutables por anon';
  end if;

  raise exception E'RESULTADO: % comprobaciones, % fallos.%', v_total, v_fail,
    case when v_fail = 0 then ' TODO OK' else v_errors end;
end $$;
