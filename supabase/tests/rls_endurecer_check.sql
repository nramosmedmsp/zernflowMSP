-- Prueba de la migración 00031 (revisión de seguridad, tanda 1).
--
-- Cómo usarla: aplicar antes 00031 y pegar este archivo completo en el editor
-- SQL de Supabase (rol postgres). Solo LEE el catálogo (privilegios, políticas,
-- índices, funciones): no crea ni cambia nada, así que se puede ejecutar en
-- producción. Termina SIEMPRE con RAISE EXCEPTION para mostrar el resultado:
--   RESULTADO: N comprobaciones, 0 fallos. TODO OK
-- o la lista de lo que falla.
--
-- Las pruebas de comportamiento (el asesor intenta el ataque con su sesión y
-- debe fallar; las acciones normales deben seguir funcionando) se hicieron con
-- supabase-js sobre una base local con los usuarios de prueba (asesor,
-- supervisor, administrador): supabase/tests/rls_endurecer_attacks.mjs
-- (`node supabase/tests/rls_endurecer_attacks.mjs post`). Plan:
--   * Ataques que deben fallar tras 00031: A-1 mover contact_channels; A-3
--     limpiar la marca de reclamo, mover/reasignar/cambiar de espacio una
--     conversación o insertar conversaciones; M-1 insertar o actualizar
--     mensajes; B-1 editar contactos y sus etiquetas; B-2 escribir o leer
--     analytics_events (asesor) y leer comment_logs; B-3 leer/actualizar
--     invitaciones siendo asesor; A-2 adjunto de respuesta con ruta ajena,
--     cambiar attachment_url, mismo archivo en dos respuestas, leer, listar o
--     borrar el bucket chat-media directo; A-4 mismo late_account_id en otro
--     espacio; B-4 llamar funciones security definer como anon.
--   * Acciones normales que deben seguir funcionando: poner unread_count=0,
--     leer conversaciones, mensajes y contactos visibles, supervisor y
--     administrador leen analytics_events, administrador lee invitaciones,
--     crear/editar/borrar respuesta personal, subir archivo con enlace
--     firmado y registrarlo desde el servidor, canal demo repetido en otro
--     espacio, el servidor (service_role) escribe mensajes.

do $$
declare
  v_total int := 0;
  v_fail int := 0;
  v_errors text := '';

begin
  -- A-1: nadie actualiza contact_channels con su sesión
  v_total := v_total + 1;
  if has_table_privilege('authenticated', 'public.contact_channels', 'UPDATE')
     or has_any_column_privilege('authenticated', 'public.contact_channels', 'UPDATE')
     or exists (select 1 from pg_policies where schemaname='public' and tablename='contact_channels' and cmd='UPDATE') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- A-1: authenticated aún puede actualizar contact_channels';
  end if;

  -- A-3: de conversations solo unread_count es editable; no se inserta
  v_total := v_total + 1;
  if has_table_privilege('authenticated', 'public.conversations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.conversations', 'INSERT')
     or not has_column_privilege('authenticated', 'public.conversations', 'unread_count', 'UPDATE') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- A-3: conversations no quedó con UPDATE solo en unread_count';
  end if;
  v_total := v_total + 1;
  if exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.conversations'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname <> 'unread_count'
      and has_column_privilege('authenticated', 'public.conversations', a.attname, 'UPDATE')
  ) then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- A-3: otra columna de conversations es editable por usuarios';
  end if;

  -- M-1: messages sin escritura para usuarios
  v_total := v_total + 1;
  if has_table_privilege('authenticated', 'public.messages', 'INSERT')
     or has_table_privilege('authenticated', 'public.messages', 'UPDATE')
     or has_table_privilege('authenticated', 'public.messages', 'DELETE')
     or exists (select 1 from pg_policies where schemaname='public' and tablename='messages' and cmd in ('INSERT','UPDATE','DELETE')) then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- M-1: authenticated aún escribe en messages';
  end if;

  -- B-1: contacts sin UPDATE para usuarios
  v_total := v_total + 1;
  if has_table_privilege('authenticated', 'public.contacts', 'UPDATE')
     or exists (select 1 from pg_policies where schemaname='public' and tablename='contacts' and cmd='UPDATE') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- B-1: authenticated aún actualiza contacts';
  end if;
  v_total := v_total + 1;
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename in ('contact_tags','contact_custom_fields')
      and cmd in ('INSERT','UPDATE','DELETE')
      and coalesce(qual, '') || coalesce(with_check, '') not like '%is_ws_admin%'
  ) then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- B-1: etiquetas/campos del contacto aún editables por no administradores';
  end if;

  -- A-2: trigger, restricción de ruta e índice único en saved_replies
  v_total := v_total + 1;
  if not exists (select 1 from pg_trigger where tgrelid='public.saved_replies'::regclass and tgname='guard_saved_reply_attachment' and not tgisinternal) then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- A-2: falta el trigger guard_saved_reply_attachment';
  end if;
  v_total := v_total + 1;
  if not exists (select 1 from pg_constraint where conrelid='public.saved_replies'::regclass and conname='saved_replies_attachment_path_check') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- A-2: falta la restricción saved_replies_attachment_path_check';
  end if;
  v_total := v_total + 1;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='saved_replies_attachment_url_key') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- A-2: falta el índice único saved_replies_attachment_url_key';
  end if;
  v_total := v_total + 1;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and qual ilike '%chat-media%')
     or exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and 'authenticated' = any(roles::text[]) and cmd in ('SELECT','DELETE','ALL')) then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- A-2: storage.objects tiene una política de acceso para usuarios (el bucket chat-media debe quedar solo por enlaces firmados)';
  end if;

  -- A-4: índice único del identificador de cuenta (fuera de los canales demo)
  v_total := v_total + 1;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='channels_late_account_id_real_key') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- A-4: falta el índice único channels_late_account_id_real_key';
  end if;

  -- B-2: analytics_events y comment_logs
  v_total := v_total + 1;
  if has_table_privilege('authenticated', 'public.analytics_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.analytics_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.analytics_events', 'DELETE')
     or has_table_privilege('authenticated', 'public.comment_logs', 'INSERT')
     or has_table_privilege('authenticated', 'public.comment_logs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.comment_logs', 'DELETE') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- B-2: usuarios aún escriben en analytics_events o comment_logs';
  end if;
  v_total := v_total + 1;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analytics_events' and cmd='SELECT' and qual like '%is_ws_admin%' and qual like '%is_ws_supervisor%')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='comment_logs' and cmd='SELECT' and qual like '%is_ws_admin%') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- B-2: la lectura de analytics_events/comment_logs no está limitada a administradores (y supervisores)';
  end if;

  -- B-3: workspace_invites
  v_total := v_total + 1;
  if has_table_privilege('authenticated', 'public.workspace_invites', 'UPDATE')
     or exists (select 1 from pg_policies where schemaname='public' and tablename='workspace_invites' and cmd='UPDATE')
     or exists (select 1 from pg_policies where schemaname='public' and tablename='workspace_invites' and cmd='SELECT' and qual not like '%is_ws_admin%') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- B-3: workspace_invites aún se actualiza o lo leen no administradores';
  end if;

  -- B-4: ninguna función security definer de public ejecutable por anon/public, todas con search_path fijo
  v_total := v_total + 1;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'EXECUTE'))
  ) then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- B-4: funciones security definer ejecutables por anon: ' || (
      select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'));
  end if;
  v_total := v_total + 1;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  ) then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- B-4: funciones security definer sin search_path fijo: ' || (
      select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')));
  end if;
  v_total := v_total + 1;
  if to_regprocedure('public.rls_auto_enable()') is null
     or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') then
    v_fail := v_fail + 1; v_errors := v_errors || E'\n- B-4: rls_auto_enable falta o la ejecuta authenticated';
  end if;

  raise exception E'RESULTADO: % comprobaciones, % fallos.%', v_total, v_fail,
    case when v_fail = 0 then ' TODO OK' else v_errors end;
end $$;
